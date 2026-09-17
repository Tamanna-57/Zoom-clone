"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Icon, type IconName } from "@/components/ui/Icon";
import {
  BOARD_COLORS,
  DEFAULT_WIDTH,
  NOTE_COLORS,
  NOTE_SIZE,
  TEXT_WIDTH,
  boardRect,
  boundsOf,
  clampPoint,
  drawBoard,
  drawItem,
  itemAt,
  movedBy,
  newItemId,
  toBoard,
  type BoardRect,
} from "@/lib/board";
import type { LiveCursor } from "@/lib/useMeetingRoom";
import type { BoardItem, BoardKind } from "@/lib/types";

type Tool = BoardKind | "select" | "eraser";

const TOOLS: { tool: Tool; icon: IconName; label: string }[] = [
  { tool: "select", icon: "cursor", label: "Select" },
  { tool: "pen", icon: "pencil", label: "Pen" },
  { tool: "highlighter", icon: "highlighter", label: "Highlighter" },
  { tool: "text", icon: "text", label: "Text" },
  { tool: "note", icon: "note", label: "Sticky note" },
  { tool: "line", icon: "line", label: "Line" },
  { tool: "arrow", icon: "arrow-up-right", label: "Arrow" },
  { tool: "rect", icon: "square", label: "Rectangle" },
  { tool: "ellipse", icon: "circle", label: "Ellipse" },
  { tool: "eraser", icon: "eraser", label: "Eraser" },
];

/** How close a click has to be to count as landing on a mark, in board units. */
const HIT_TOLERANCE = 0.008;
/** Shorter than this and a shape drag was really a stray click. */
const MIN_DRAG = 0.004;
/** Cursors go out at most this often: presence, not a firehose. */
const CURSOR_INTERVAL_MS = 40;

/**
 * One step of a person's own history.
 *
 * Every change to the board is either marks appearing and disappearing or a
 * mark sliding, so two shapes cover undo entirely — and inverting an `edit` is
 * just swapping the two lists.
 */
type BoardOp =
  | { kind: "edit"; added: BoardItem[]; removed: BoardItem[] }
  | { kind: "move"; id: string; dx: number; dy: number };

function invert(op: BoardOp): BoardOp {
  return op.kind === "edit"
    ? { kind: "edit", added: op.removed, removed: op.added }
    : { kind: "move", id: op.id, dx: -op.dx, dy: -op.dy };
}

/** A text box or sticky note being typed into, before it reaches the board. */
interface Draft {
  kind: "text" | "note";
  /** Set when an existing mark is being re-typed rather than a new one made. */
  replacing: BoardItem | null;
  points: [number, number][];
  color: string;
  width: number;
  text: string;
}

/**
 * The shared whiteboard.
 *
 * The board is a set of objects, so the interactions people expect from Zoom's
 * are all possible: pick a mark up and move it, rub one out without touching
 * its neighbours, undo your own work and nobody else's. What it is *not* is a
 * pixel buffer — nothing here paints onto a shared bitmap.
 *
 * Marks are rendered optimistically. Every change is sent to the server and
 * comes back as the authoritative echo, but the pen has to feel like a pen, so
 * local copies are drawn immediately and retired as the echo lands.
 */
export function Whiteboard({
  items,
  cursors,
  selfConnectionId,
  selfName,
  canModerate,
  locked,
  topic,
  onAdd,
  onMove,
  onDelete,
  onClear,
  onLock,
  onCursor,
}: {
  items: BoardItem[];
  cursors: LiveCursor[];
  selfConnectionId: string | null;
  selfName: string;
  /** Hosts and cohosts may edit anyone's marks, wipe the board and latch it. */
  canModerate: boolean;
  locked: boolean;
  topic: string;
  onAdd: (item: BoardItem) => void;
  onMove: (id: string, dx: number, dy: number) => void;
  onDelete: (ids: string[]) => void;
  onClear: () => void;
  onLock: (locked: boolean) => void;
  onCursor: (x: number, y: number) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [rect, setRect] = useState<BoardRect>({ left: 0, top: 0, width: 1, height: 1 });

  const [tool, setTool] = useState<Tool>("pen");
  const [color, setColor] = useState(BOARD_COLORS[0]);
  const [noteColor, setNoteColor] = useState(NOTE_COLORS[0]);
  // Each tool remembers its own weight: a highlighter and a pen want very
  // different numbers, and swapping between them should not reset either.
  const [widths, setWidths] = useState<Record<string, number>>(() => ({ ...DEFAULT_WIDTH }));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);

  // The optimistic layer: marks drawn locally but not yet echoed, marks erased
  // locally but not yet gone, and marks moved locally but not yet confirmed.
  const [pending, setPending] = useState<BoardItem[]>([]);
  const [hidden, setHidden] = useState<Set<string>>(() => new Set());
  const [overrides, setOverrides] = useState<Record<string, [number, number][]>>({});

  const [past, setPast] = useState<BoardOp[]>([]);
  const [future, setFuture] = useState<BoardOp[]>([]);

  const strokeRef = useRef<BoardItem | null>(null);
  const dragRef = useRef<{ id: string; from: [number, number]; last: [number, number]; moved: boolean } | null>(null);
  const eraseRef = useRef<Set<string> | null>(null);
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const cursorSentRef = useRef(0);
  const frameRef = useRef(0);

  const canDraw = canModerate || !locked;
  const activeWidth = widths[tool] ?? 4;
  const activeColor = tool === "note" ? noteColor : color;
  const palette = tool === "note" ? NOTE_COLORS : BOARD_COLORS;

  // --- what is actually on the board right now -------------------------------

  const rendered = useMemo(() => {
    const known = new Set(items.map((item) => item.id));
    return [...items, ...pending.filter((item) => !known.has(item.id))]
      .filter((item) => !hidden.has(item.id))
      .map((item) => (overrides[item.id] ? { ...item, points: overrides[item.id] } : item));
  }, [items, pending, hidden, overrides]);

  const renderedRef = useRef(rendered);
  renderedRef.current = rendered;

  const canEdit = useCallback(
    (item: BoardItem) => canModerate || item.byConnection === selfConnectionId,
    [canModerate, selfConnectionId],
  );

  // Reconcile the optimistic layer against the server's copy of the board.
  //
  // This is the one thing here that genuinely belongs in an effect: the board
  // arrives from a socket, and each local guess has to be retired at the moment
  // the authoritative version agrees with it. Lint reads any setState in an
  // effect as a cascading render; every branch below returns the identical
  // object when nothing changed, so a quiet echo costs one comparison.
  useEffect(() => {
    const known = new Set(items.map((item) => item.id));
    setPending((current) => {
      const next = current.filter((item) => !known.has(item.id));
      return next.length === current.length ? current : next;
    });
    setHidden((current) => {
      if (current.size === 0) return current;
      const next = new Set([...current].filter((id) => known.has(id)));
      return next.size === current.size ? current : next;
    });
    setOverrides((current) => {
      const ids = Object.keys(current);
      if (ids.length === 0) return current;
      const byId = new Map(items.map((item) => [item.id, item]));
      const waiting: Record<string, [number, number][]> = {};
      for (const id of ids) {
        const server = byId.get(id);
        const local = current[id];
        // A move shifts every point by the same amount, so the first point
        // settles it: once the server agrees, the local copy has served its turn.
        const settled =
          !server ||
          (Math.abs(server.points[0][0] - local[0][0]) < 1e-6 &&
            Math.abs(server.points[0][1] - local[0][1]) < 1e-6);
        if (!settled) waiting[id] = local;
      }
      return Object.keys(waiting).length === ids.length ? current : waiting;
    });

    // A board that emptied is a host clear or the end of the share - drawing
    // never empties it. Undoing past that would resurrect what they just took
    // down, so the history stops here.
    if (items.length === 0) {
      setPast([]);
      setFuture([]);
      setSelectedId(null);
    }
  }, [items]);

  // --- painting --------------------------------------------------------------

  const paint = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const ratio = window.devicePixelRatio || 1;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, canvas.width / ratio, canvas.height / ratio);

    // The paper, so the board reads as a board rather than as the call's chrome.
    ctx.save();
    ctx.fillStyle = "#ffffff";
    ctx.shadowColor = "rgba(0,0,0,0.35)";
    ctx.shadowBlur = 18;
    ctx.fillRect(rect.left, rect.top, rect.width, rect.height);
    ctx.restore();

    const drag = dragRef.current;
    const erasing = eraseRef.current;
    for (const item of renderedRef.current) {
      if (erasing?.has(item.id)) {
        // Fade rather than remove, so a drag across the board shows what it is
        // about to take before the pen comes up.
        ctx.save();
        ctx.globalAlpha = 0.2;
        drawItem(ctx, item, rect);
        ctx.restore();
      } else if (drag?.moved && drag.id === item.id) {
        drawItem(ctx, movedBy(item, drag.last[0] - drag.from[0], drag.last[1] - drag.from[1]), rect);
      } else {
        drawItem(ctx, item, rect);
      }
    }

    if (strokeRef.current) drawItem(ctx, strokeRef.current, rect);

    const selected = renderedRef.current.find((item) => item.id === selectedId);
    if (selected) {
      const drawn = drag?.moved && drag.id === selected.id
        ? movedBy(selected, drag.last[0] - drag.from[0], drag.last[1] - drag.from[1])
        : selected;
      const { x0, y0, x1, y1 } = boundsOf(drawn);
      const pad = 6;
      ctx.save();
      ctx.strokeStyle = "#2d8cff";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([5, 4]);
      ctx.strokeRect(
        rect.left + x0 * rect.width - pad,
        rect.top + y0 * rect.height - pad,
        (x1 - x0) * rect.width + pad * 2,
        (y1 - y0) * rect.height + pad * 2,
      );
      ctx.restore();
    }
  }, [rect, selectedId]);

  const paintRef = useRef(paint);
  paintRef.current = paint;

  /** Coalesce the repaints a pointer drag would otherwise ask for per event. */
  const schedulePaint = useCallback(() => {
    if (frameRef.current) return;
    frameRef.current = window.requestAnimationFrame(() => {
      frameRef.current = 0;
      paintRef.current();
    });
  }, []);

  useEffect(() => {
    schedulePaint();
  }, [paint, rendered, schedulePaint]);

  useEffect(() => () => window.cancelAnimationFrame(frameRef.current), []);

  // Size the backing store to the device's pixels, and remember where the 16:9
  // board landed inside it so the overlays can be positioned over the same spot.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const measure = () => {
      const box = canvas.getBoundingClientRect();
      const ratio = window.devicePixelRatio || 1;
      const width = Math.max(Math.round(box.width * ratio), 1);
      const height = Math.max(Math.round(box.height * ratio), 1);
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      setRect(boardRect(box.width, box.height));
      schedulePaint();
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [schedulePaint]);

  // --- sending changes -------------------------------------------------------

  const applyOp = useCallback(
    (op: BoardOp) => {
      if (op.kind === "move") {
        const item = renderedRef.current.find((candidate) => candidate.id === op.id);
        if (!item) return;
        const moved = movedBy(item, op.dx, op.dy);
        setOverrides((current) => ({ ...current, [op.id]: moved.points }));
        onMove(op.id, op.dx, op.dy);
        return;
      }
      const removedIds = op.removed.map((item) => item.id);
      setHidden((current) => {
        const next = new Set(current);
        removedIds.forEach((id) => next.add(id));
        op.added.forEach((item) => next.delete(item.id));
        return next;
      });
      if (op.added.length > 0) {
        setPending((current) => [
          ...current.filter((item) => !op.added.some((added) => added.id === item.id)),
          ...op.added,
        ]);
      }
      if (removedIds.length > 0) onDelete(removedIds);
      op.added.forEach((item) => onAdd(item));
    },
    [onAdd, onDelete, onMove],
  );

  /** Do it, and remember how to take it back. A new change forfeits the redos. */
  const commit = useCallback(
    (op: BoardOp) => {
      applyOp(op);
      setPast((current) => [...current.slice(-99), op]);
      setFuture([]);
    },
    [applyOp],
  );

  const undo = useCallback(() => {
    setPast((current) => {
      const op = current[current.length - 1];
      if (!op) return current;
      applyOp(invert(op));
      setFuture((redos) => [...redos, op]);
      return current.slice(0, -1);
    });
  }, [applyOp]);

  const redo = useCallback(() => {
    setFuture((current) => {
      const op = current[current.length - 1];
      if (!op) return current;
      applyOp(op);
      setPast((undos) => [...undos, op]);
      return current.slice(0, -1);
    });
  }, [applyOp]);

  const newItem = useCallback(
    (kind: BoardKind, points: [number, number][], text?: string): BoardItem => ({
      id: newItemId(),
      kind,
      points,
      color: kind === "note" ? noteColor : color,
      width: widths[kind] ?? DEFAULT_WIDTH[kind],
      ...(text === undefined ? {} : { text }),
      // Stamped locally so the optimistic copy knows whose it is; the server
      // stamps its own copy the same way and the echo replaces this one.
      by: selfName,
      byConnection: selfConnectionId ?? "",
    }),
    [color, noteColor, widths, selfName, selfConnectionId],
  );

  const deleteSelected = useCallback(() => {
    const item = renderedRef.current.find((candidate) => candidate.id === selectedId);
    if (!item || !canEdit(item)) return;
    commit({ kind: "edit", added: [], removed: [item] });
    setSelectedId(null);
  }, [selectedId, canEdit, commit]);

  // --- pointer ---------------------------------------------------------------

  const pointOf = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>): [number, number] => {
      const box = event.currentTarget.getBoundingClientRect();
      return toBoard(rect, event.clientX - box.left, event.clientY - box.top);
    },
    [rect],
  );

  function openDraft(kind: "text" | "note", at: [number, number]) {
    const points: [number, number][] =
      kind === "note"
        ? [at, [Math.min(at[0] + NOTE_SIZE[0], 1), Math.min(at[1] + NOTE_SIZE[1], 1)]]
        : [at, [Math.min(at[0] + TEXT_WIDTH, 1), at[1]]];
    setDraft({
      kind,
      replacing: null,
      points,
      color: kind === "note" ? noteColor : color,
      width: widths[kind] ?? DEFAULT_WIDTH[kind],
      text: "",
    });
  }

  function commitDraft() {
    const current = draft;
    setDraft(null);
    if (!current) return;
    const text = current.text.trim();
    const removed = current.replacing ? [current.replacing] : [];
    if (!text) {
      // An empty box is nothing. Clearing an existing one deletes it instead.
      if (removed.length > 0) commit({ kind: "edit", added: [], removed });
      return;
    }
    const item: BoardItem = {
      ...newItem(current.kind, current.points, text),
      color: current.color,
      width: current.width,
    };
    commit({ kind: "edit", added: [item], removed });
  }

  function handlePointerDown(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!canDraw) return;
    if (draft) {
      // Clicking away from an open box is how you finish typing in it.
      commitDraft();
      return;
    }
    const point = clampPoint(pointOf(event));

    if (tool === "text" || tool === "note") {
      // The default action of a mousedown moves focus to whatever was clicked.
      // That lands *after* React has mounted the editor, so without this the
      // box blurs the instant it appears - and a blur commits it, empty.
      event.preventDefault();
      openDraft(tool, point);
      return;
    }

    event.currentTarget.setPointerCapture(event.pointerId);

    if (tool === "select") {
      const hit = itemAt(renderedRef.current, point[0], point[1], HIT_TOLERANCE);
      setSelectedId(hit?.id ?? null);
      if (hit && canEdit(hit)) dragRef.current = { id: hit.id, from: point, last: point, moved: false };
      schedulePaint();
      return;
    }

    if (tool === "eraser") {
      eraseRef.current = new Set();
      eraseAt(point);
      return;
    }

    setSelectedId(null);
    strokeRef.current = newItem(
      tool,
      tool === "pen" || tool === "highlighter" ? [point] : [point, point],
    );
    schedulePaint();
  }

  function eraseAt(point: [number, number]) {
    const marks = eraseRef.current;
    if (!marks) return;
    const hit = itemAt(renderedRef.current, point[0], point[1], HIT_TOLERANCE);
    if (!hit || marks.has(hit.id) || !canEdit(hit)) return;
    marks.add(hit.id);
    schedulePaint();
  }

  function handlePointerMove(event: React.PointerEvent<HTMLCanvasElement>) {
    const point = clampPoint(pointOf(event));

    const now = Date.now();
    if (canDraw && now - cursorSentRef.current > CURSOR_INTERVAL_MS) {
      cursorSentRef.current = now;
      onCursor(point[0], point[1]);
    }

    const stroke = strokeRef.current;
    if (stroke) {
      if (stroke.kind === "pen" || stroke.kind === "highlighter") stroke.points.push(point);
      else stroke.points[1] = point;
      schedulePaint();
      return;
    }
    const drag = dragRef.current;
    if (drag) {
      drag.last = point;
      drag.moved = true;
      schedulePaint();
      return;
    }
    if (eraseRef.current) eraseAt(point);
  }

  function handlePointerUp() {
    const stroke = strokeRef.current;
    if (stroke) {
      strokeRef.current = null;
      if (stroke.kind === "pen" || stroke.kind === "highlighter") {
        // A tap is a dot. Two identical points draw nothing, so give the second
        // a nudge and let the round cap make the dot.
        if (stroke.points.length < 2) {
          stroke.points = [stroke.points[0], [stroke.points[0][0] + 0.0005, stroke.points[0][1]]];
        }
        commit({ kind: "edit", added: [stroke], removed: [] });
      } else {
        const [[ax, ay], [bx, by]] = stroke.points;
        // A click with a shape tool selected is a click, not a zero-size shape.
        if (Math.hypot(bx - ax, by - ay) >= MIN_DRAG) {
          commit({ kind: "edit", added: [stroke], removed: [] });
        }
      }
      schedulePaint();
      return;
    }

    const drag = dragRef.current;
    if (drag) {
      dragRef.current = null;
      const item = renderedRef.current.find((candidate) => candidate.id === drag.id);
      if (drag.moved && item) {
        // Record the delta the board actually took, not the one asked for: the
        // move is clamped at the edges, and undo has to retrace the real path.
        const moved = movedBy(item, drag.last[0] - drag.from[0], drag.last[1] - drag.from[1]);
        const dx = moved.points[0][0] - item.points[0][0];
        const dy = moved.points[0][1] - item.points[0][1];
        if (dx !== 0 || dy !== 0) commit({ kind: "move", id: drag.id, dx, dy });
      }
      schedulePaint();
      return;
    }

    const marks = eraseRef.current;
    if (marks) {
      eraseRef.current = null;
      const removed = renderedRef.current.filter((item) => marks.has(item.id));
      if (removed.length > 0) commit({ kind: "edit", added: [], removed });
      schedulePaint();
    }
  }

  function handleDoubleClick(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!canDraw) return;
    const point = clampPoint(pointOf(event));
    const hit = itemAt(renderedRef.current, point[0], point[1], HIT_TOLERANCE);
    if (!hit || (hit.kind !== "text" && hit.kind !== "note") || !canEdit(hit)) return;
    // Re-typing replaces the mark: one op, so undo puts the old wording back.
    setSelectedId(null);
    setDraft({
      kind: hit.kind,
      replacing: hit,
      points: hit.points,
      color: hit.color,
      width: hit.width,
      text: hit.text ?? "",
    });
  }

  // Focus the editor once it has mounted rather than with `autoFocus`, which
  // fires during the same commit as the pointer event that opened it.
  useEffect(() => {
    if (!draft) return;
    const frame = window.requestAnimationFrame(() => editorRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [draft?.replacing?.id, draft?.kind, draft?.points]);

  // --- keyboard --------------------------------------------------------------

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      // The call has a chat box and this board has a text box; neither wants
      // Backspace read as "delete the selected mark".
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) {
        return;
      }
      const meta = event.metaKey || event.ctrlKey;
      if (meta && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
        return;
      }
      if (meta && event.key.toLowerCase() === "y") {
        event.preventDefault();
        redo();
        return;
      }
      if (event.key === "Escape") {
        setSelectedId(null);
        setDraft(null);
        return;
      }
      if ((event.key === "Delete" || event.key === "Backspace") && selectedId) {
        event.preventDefault();
        deleteSelected();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo, selectedId, deleteSelected]);

  // --- export ----------------------------------------------------------------

  function saveImage() {
    const out = document.createElement("canvas");
    out.width = 1920;
    out.height = 1080;
    const ctx = out.getContext("2d");
    if (!ctx) return;
    // The board's own 16:9 space is the export, which is exactly why it has one.
    drawBoard(ctx, rendered, { left: 0, top: 0, width: out.width, height: out.height });
    out.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${(topic || "meeting").replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-whiteboard.png`;
      link.click();
      URL.revokeObjectURL(url);
    });
  }

  // --- overlays --------------------------------------------------------------

  const selected = rendered.find((item) => item.id === selectedId);
  const cursorFor: Record<Tool, string> = {
    select: "default",
    eraser: "cell",
    text: "text",
    note: "copy",
    pen: "crosshair",
    highlighter: "crosshair",
    line: "crosshair",
    arrow: "crosshair",
    rect: "crosshair",
    ellipse: "crosshair",
  };

  const draftStyle = draft
    ? {
        left: rect.left + draft.points[0][0] * rect.width,
        top: rect.top + draft.points[0][1] * rect.height,
        width: Math.max((draft.points[1][0] - draft.points[0][0]) * rect.width, 40),
        height: draft.kind === "note" ? (draft.points[1][1] - draft.points[0][1]) * rect.height : undefined,
        fontSize: (draft.width / 1000) * rect.height,
      }
    : null;

  return (
    <div className="flex h-full min-h-0 gap-2">
      <div
        className={`flex w-[46px] shrink-0 flex-col gap-0.5 self-start rounded-xl bg-ink-800 p-1.5 ring-1 ring-white/10 ${
          canDraw ? "" : "pointer-events-none opacity-40"
        }`}
      >
        {TOOLS.map((entry) => (
          <button
            key={entry.tool}
            onClick={() => {
              setTool(entry.tool);
              if (entry.tool !== "select") setSelectedId(null);
            }}
            title={entry.label}
            aria-label={entry.label}
            aria-pressed={tool === entry.tool}
            className={`grid h-8 w-8 place-items-center rounded-lg transition ${
              tool === entry.tool ? "bg-zoom-blue text-white" : "text-ink-300 hover:bg-white/10 hover:text-white"
            }`}
          >
            <Icon name={entry.icon} size={17} />
          </button>
        ))}
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          {tool !== "select" && tool !== "eraser" && (
            <>
              <div className="flex items-center gap-1.5">
                {palette.map((swatch) => (
                  <button
                    key={swatch}
                    onClick={() => (tool === "note" ? setNoteColor(swatch) : setColor(swatch))}
                    disabled={!canDraw}
                    aria-label={`Colour ${swatch}`}
                    aria-pressed={activeColor === swatch}
                    className={`h-6 w-6 rounded-full ring-2 ring-offset-2 ring-offset-ink-900 transition disabled:opacity-40 ${
                      activeColor === swatch ? "ring-white" : "ring-transparent"
                    }`}
                    style={{ background: swatch }}
                  />
                ))}
              </div>
              <label className="flex items-center gap-2 text-[11px] text-ink-300">
                {tool === "text" || tool === "note" ? "Text size" : "Size"}
                <input
                  type="range"
                  min={tool === "text" || tool === "note" ? 16 : 1}
                  max={tool === "text" || tool === "note" ? 70 : 40}
                  value={activeWidth}
                  disabled={!canDraw}
                  onChange={(event) =>
                    setWidths((current) => ({ ...current, [tool]: Number(event.target.value) }))
                  }
                  className="w-20"
                  aria-label="Size"
                />
              </label>
            </>
          )}

          <div className="ml-auto flex items-center gap-1">
            <button
              onClick={undo}
              disabled={past.length === 0}
              title="Undo"
              aria-label="Undo"
              className="grid h-7 w-7 place-items-center rounded-md text-ink-300 transition hover:bg-white/10 hover:text-white disabled:opacity-30"
            >
              <Icon name="undo" size={15} />
            </button>
            <button
              onClick={redo}
              disabled={future.length === 0}
              title="Redo"
              aria-label="Redo"
              className="grid h-7 w-7 place-items-center rounded-md text-ink-300 transition hover:bg-white/10 hover:text-white disabled:opacity-30"
            >
              <Icon name="redo" size={15} />
            </button>
            {selected && canEdit(selected) && (
              <button
                onClick={deleteSelected}
                className="flex items-center gap-1 rounded-md bg-white/10 px-2 py-1 text-xs text-white transition hover:bg-white/20"
              >
                <Icon name="trash" size={13} /> Delete
              </button>
            )}
            <button
              onClick={saveImage}
              title="Save the board as a PNG"
              className="flex items-center gap-1 rounded-md bg-white/10 px-2 py-1 text-xs text-white transition hover:bg-white/20"
            >
              <Icon name="download" size={13} /> Save
            </button>
            {canModerate && (
              <>
                <button
                  onClick={() => onLock(!locked)}
                  title={locked ? "Let everyone draw again" : "Only let hosts draw"}
                  className={`flex items-center gap-1 rounded-md px-2 py-1 text-xs transition ${
                    locked ? "bg-amber-400 text-ink-900" : "bg-white/10 text-white hover:bg-white/20"
                  }`}
                >
                  <Icon name={locked ? "lock" : "unlock"} size={13} />
                  {locked ? "Locked" : "Lock"}
                </button>
                <button
                  onClick={onClear}
                  className="flex items-center gap-1 rounded-md bg-white/10 px-2 py-1 text-xs text-white transition hover:bg-white/20"
                >
                  <Icon name="trash" size={13} /> Clear all
                </button>
              </>
            )}
          </div>
        </div>

        <div className="relative min-h-0 flex-1">
          <canvas
            ref={canvasRef}
            className="h-full w-full touch-none"
            style={{ cursor: canDraw ? cursorFor[tool] : "not-allowed" }}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            onDoubleClick={handleDoubleClick}
          />

          {/* Everyone else's pen. Seeing where the others are is most of what
              makes a shared board feel shared rather than turn-based. */}
          {cursors.map((cursor) => (
            <div
              key={cursor.connectionId}
              className="pointer-events-none absolute z-10 flex items-center gap-1 transition-[left,top] duration-75 ease-linear"
              style={{ left: rect.left + cursor.x * rect.width, top: rect.top + cursor.y * rect.height }}
            >
              <span className="drop-shadow" style={{ color: cursor.color }}>
                <Icon name="cursor" size={16} />
              </span>
              <span
                className="rounded px-1 py-0.5 text-[10px] font-semibold text-white"
                style={{ background: cursor.color }}
              >
                {cursor.by}
              </span>
            </div>
          ))}

          {draft && draftStyle && (
            <textarea
              ref={editorRef}
              value={draft.text}
              onChange={(event) => setDraft({ ...draft, text: event.target.value })}
              onBlur={commitDraft}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  setDraft(null);
                } else if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                  event.preventDefault();
                  commitDraft();
                }
              }}
              placeholder={draft.kind === "note" ? "Note…" : "Type…"}
              className={`absolute z-20 resize-none rounded leading-tight outline-none ring-2 ring-zoom-blue ${
                draft.kind === "note" ? "p-[0.5em] text-ink-900 shadow-lg" : "bg-white/95 text-ink-900"
              }`}
              style={{
                left: draftStyle.left,
                top: draftStyle.top,
                width: draftStyle.width,
                height: draftStyle.height,
                fontSize: draftStyle.fontSize,
                background: draft.kind === "note" ? draft.color : undefined,
                color: draft.kind === "note" ? "#1f2937" : draft.color,
              }}
            />
          )}

          {!canDraw && (
            <div className="pointer-events-none absolute inset-x-0 top-2 flex justify-center">
              <span className="rounded-full bg-ink-900/90 px-3 py-1 text-[11px] font-medium text-amber-300 ring-1 ring-white/10">
                The host has locked the whiteboard
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
