/**
 * The whiteboard's geometry and painting, kept out of the component.
 *
 * Two ideas carry the whole thing:
 *
 *   * The board has a coordinate space of its own — a 16:9 rectangle addressed
 *     0..1 on both axes — that is letterboxed inside whatever room the layout
 *     gives it. Everyone's board therefore has the same shape, so a circle is
 *     still a circle on the next person's narrower window, and an exported PNG
 *     matches what was on screen. A plain "fraction of the element" space would
 *     squash every shape by the viewer's aspect ratio.
 *   * Nothing is stored as pixels. Weights and font sizes are per-mille of the
 *     board's height, so the same mark renders at 1080p, on a phone filmstrip
 *     and in the export without carrying a second set of numbers.
 */
import type { BoardItem, BoardKind } from "./types";

export const BOARD_ASPECT = 16 / 9;

/** Ink for pens, shapes and text. Dark, because the board itself is paper-white. */
export const BOARD_COLORS = ["#1f2937", "#e11d48", "#ea580c", "#16a34a", "#2563eb", "#9333ea"];
/** Sticky notes are the paper, not the ink, so they get their own pale palette. */
export const NOTE_COLORS = ["#fde68a", "#fecaca", "#bbf7d0", "#bfdbfe", "#e9d5ff", "#fed7aa"];

/** Default weight per tool, in per-mille of board height. */
export const DEFAULT_WIDTH: Record<BoardKind, number> = {
  pen: 4,
  highlighter: 22,
  line: 4,
  arrow: 4,
  rect: 4,
  ellipse: 4,
  text: 38,
  note: 28,
};

/** How big a sticky note starts, in board units. */
export const NOTE_SIZE: [number, number] = [0.17, 0.155];
/** How wide a new text box wraps at, in board units. */
export const TEXT_WIDTH = 0.3;

export interface BoardRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Where the 16:9 board sits inside an element of the given CSS size.
 *
 * The element is almost never 16:9 itself, so the board is centred and the
 * leftover is margin — the same letterboxing a shared screen gets.
 */
export function boardRect(elementWidth: number, elementHeight: number): BoardRect {
  const width = Math.max(Math.min(elementWidth, elementHeight * BOARD_ASPECT), 1);
  const height = width / BOARD_ASPECT;
  return {
    left: (elementWidth - width) / 2,
    top: (elementHeight - height) / 2,
    width,
    height,
  };
}

/** An element-relative CSS point, in board coordinates. Outside 0..1 is possible. */
export function toBoard(rect: BoardRect, x: number, y: number): [number, number] {
  return [(x - rect.left) / rect.width, (y - rect.top) / rect.height];
}

export function clampPoint([x, y]: [number, number]): [number, number] {
  return [Math.min(Math.max(x, 0), 1), Math.min(Math.max(y, 0), 1)];
}

/** The axis-aligned box a mark occupies, in board coordinates. */
export function boundsOf(item: BoardItem) {
  const xs = item.points.map((p) => p[0]);
  const ys = item.points.map((p) => p[1]);
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}

function distanceToSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  // A zero-length segment is a dot; fall back to the distance to the point.
  const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSquared));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/**
 * Is (x, y) on this mark?
 *
 * Lines are grabbed by their ink; everything with a body — shapes, text, notes
 * — is grabbed anywhere inside it, which is what people expect from a box and
 * what makes a thin outline usable without a pixel-perfect click.
 */
export function hitTest(item: BoardItem, x: number, y: number, tolerance: number): boolean {
  const slack = tolerance + item.width / 2000;
  if (item.kind === "pen" || item.kind === "highlighter" || item.kind === "line" || item.kind === "arrow") {
    for (let i = 1; i < item.points.length; i += 1) {
      const [ax, ay] = item.points[i - 1];
      const [bx, by] = item.points[i];
      if (distanceToSegment(x, y, ax, ay, bx, by) <= slack) return true;
    }
    return false;
  }
  const { x0, y0, x1, y1 } = boundsOf(item);
  return x >= x0 - slack && x <= x1 + slack && y >= y0 - slack && y <= y1 + slack;
}

/** The topmost mark under the pointer, since later marks draw over earlier ones. */
export function itemAt(items: BoardItem[], x: number, y: number, tolerance: number): BoardItem | null {
  for (let i = items.length - 1; i >= 0; i -= 1) {
    if (hitTest(items[i], x, y, tolerance)) return items[i];
  }
  return null;
}

export function movedBy(item: BoardItem, dx: number, dy: number): BoardItem {
  const xs = item.points.map((p) => p[0]);
  const ys = item.points.map((p) => p[1]);
  // Clamp the move, not the points: clamping each point on its own would
  // flatten the mark against the edge instead of stopping it there. This
  // mirrors what the server does, so the optimistic local copy matches the echo.
  const clampedX = Math.min(Math.max(dx, -Math.min(...xs)), 1 - Math.max(...xs));
  const clampedY = Math.min(Math.max(dy, -Math.min(...ys)), 1 - Math.max(...ys));
  return {
    ...item,
    points: item.points.map(([x, y]) => [x + clampedX, y + clampedY] as [number, number]),
  };
}

export const BOARD_FONT =
  'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

/** Break text into lines that fit `maxWidth`, honouring the breaks already in it. */
export function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    let line = "";
    for (const word of paragraph.split(/\s+/)) {
      if (!word) continue;
      const candidate = line ? `${line} ${word}` : word;
      if (ctx.measureText(candidate).width <= maxWidth || !line) {
        line = candidate;
      } else {
        lines.push(line);
        line = word;
      }
    }
    lines.push(line);
  }
  return lines;
}

function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

/** Paint one mark onto a context already positioned over the board rectangle. */
export function drawItem(ctx: CanvasRenderingContext2D, item: BoardItem, rect: BoardRect) {
  const px = (x: number) => rect.left + x * rect.width;
  const py = (y: number) => rect.top + y * rect.height;
  // Weights are per-mille of the board's height, so they scale with the board.
  const weight = Math.max((item.width / 1000) * rect.height, 1);

  ctx.save();
  ctx.strokeStyle = item.color;
  ctx.fillStyle = item.color;
  ctx.lineWidth = weight;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  switch (item.kind) {
    case "highlighter":
      // Translucent and flat-ended, so overlapping passes build up like ink
      // rather than stacking into an opaque blob.
      ctx.globalAlpha = 0.3;
      ctx.lineCap = "butt";
    // falls through
    case "pen": {
      ctx.beginPath();
      item.points.forEach(([x, y], index) => {
        if (index === 0) ctx.moveTo(px(x), py(y));
        else ctx.lineTo(px(x), py(y));
      });
      ctx.stroke();
      break;
    }
    case "line": {
      const [[ax, ay], [bx, by]] = item.points;
      ctx.beginPath();
      ctx.moveTo(px(ax), py(ay));
      ctx.lineTo(px(bx), py(by));
      ctx.stroke();
      break;
    }
    case "arrow": {
      const [[ax, ay], [bx, by]] = item.points;
      const x1 = px(ax);
      const y1 = py(ay);
      const x2 = px(bx);
      const y2 = py(by);
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
      // The head grows with the line's weight but is capped against the shaft,
      // so a short thick arrow stays an arrow instead of becoming a triangle.
      const head = Math.min(weight * 4 + 6, Math.hypot(x2 - x1, y2 - y1) * 0.5);
      const angle = Math.atan2(y2 - y1, x2 - x1);
      ctx.beginPath();
      ctx.moveTo(x2, y2);
      ctx.lineTo(x2 - head * Math.cos(angle - Math.PI / 7), y2 - head * Math.sin(angle - Math.PI / 7));
      ctx.lineTo(x2 - head * Math.cos(angle + Math.PI / 7), y2 - head * Math.sin(angle + Math.PI / 7));
      ctx.closePath();
      ctx.fill();
      break;
    }
    case "rect": {
      const { x0, y0, x1, y1 } = boundsOf(item);
      ctx.strokeRect(px(x0), py(y0), (x1 - x0) * rect.width, (y1 - y0) * rect.height);
      break;
    }
    case "ellipse": {
      const { x0, y0, x1, y1 } = boundsOf(item);
      ctx.beginPath();
      ctx.ellipse(
        px((x0 + x1) / 2),
        py((y0 + y1) / 2),
        Math.max(((x1 - x0) / 2) * rect.width, 1),
        Math.max(((y1 - y0) / 2) * rect.height, 1),
        0,
        0,
        Math.PI * 2,
      );
      ctx.stroke();
      break;
    }
    case "note": {
      const { x0, y0, x1, y1 } = boundsOf(item);
      const left = px(x0);
      const top = py(y0);
      const width = (x1 - x0) * rect.width;
      const height = (y1 - y0) * rect.height;
      ctx.fillStyle = item.color;
      ctx.shadowColor = "rgba(0,0,0,0.18)";
      ctx.shadowBlur = rect.height * 0.012;
      ctx.shadowOffsetY = rect.height * 0.004;
      roundedRect(ctx, left, top, width, height, rect.height * 0.012);
      ctx.fill();
      ctx.shadowColor = "transparent";
      ctx.shadowBlur = 0;
      ctx.shadowOffsetY = 0;
      // Notes carry their own paper colour, so the writing is always dark.
      ctx.fillStyle = "#1f2937";
      const size = (item.width / 1000) * rect.height;
      ctx.font = `500 ${size}px ${BOARD_FONT}`;
      ctx.textBaseline = "top";
      const padding = size * 0.5;
      wrapText(ctx, item.text ?? "", width - padding * 2).forEach((line, index) => {
        const lineTop = top + padding + index * size * 1.25;
        // Clip rather than spill: a note is a fixed square of paper.
        if (lineTop + size <= top + height) ctx.fillText(line, left + padding, lineTop);
      });
      break;
    }
    case "text": {
      const [[x0, y0], [x1]] = item.points;
      const size = (item.width / 1000) * rect.height;
      ctx.font = `500 ${size}px ${BOARD_FONT}`;
      ctx.textBaseline = "top";
      ctx.fillStyle = item.color;
      const maxWidth = Math.max((x1 - x0) * rect.width, size);
      wrapText(ctx, item.text ?? "", maxWidth).forEach((line, index) => {
        ctx.fillText(line, px(x0), py(y0) + index * size * 1.25);
      });
      break;
    }
  }
  ctx.restore();
}

/** The paper, then every mark on it, oldest first. */
export function drawBoard(ctx: CanvasRenderingContext2D, items: BoardItem[], rect: BoardRect) {
  ctx.save();
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(rect.left, rect.top, rect.width, rect.height);
  ctx.restore();
  items.forEach((item) => drawItem(ctx, item, rect));
}

/** A fresh id for a mark. `randomUUID` needs a secure context; this does not. */
export function newItemId(): string {
  return `m${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}
