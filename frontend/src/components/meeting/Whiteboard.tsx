"use client";

import { useEffect, useRef, useState } from "react";

import { Icon } from "@/components/ui/Icon";
import type { Stroke } from "@/lib/types";

const COLORS = ["#ffffff", "#f87171", "#facc15", "#4ade80", "#60a5fa", "#c084fc"];

/**
 * A shared drawing surface over the call.
 *
 * Points are normalised to 0..1 before they go on the wire, so everyone draws
 * the same picture regardless of window size. A stroke is sent once, on pointer
 * up, rather than per move: the board stays in sync without flooding the socket.
 */
export function Whiteboard({
  strokes,
  onStroke,
  onClear,
  canClear,
}: {
  strokes: Stroke[];
  onStroke: (stroke: Stroke) => void;
  onClear: () => void;
  canClear: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [color, setColor] = useState(COLORS[0]);
  const [width, setWidth] = useState(3);
  const drawingRef = useRef<[number, number][] | null>(null);

  // Repaint everything whenever the board changes or the canvas is resized.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const paint = () => {
      const rect = canvas.getBoundingClientRect();
      const ratio = window.devicePixelRatio || 1;
      canvas.width = Math.max(rect.width * ratio, 1);
      canvas.height = Math.max(rect.height * ratio, 1);
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.scale(ratio, ratio);
      ctx.clearRect(0, 0, rect.width, rect.height);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";

      const drawStroke = (stroke: Stroke) => {
        if (stroke.points.length < 2) return;
        ctx.strokeStyle = stroke.color;
        ctx.lineWidth = stroke.width;
        ctx.beginPath();
        stroke.points.forEach(([x, y], index) => {
          const px = x * rect.width;
          const py = y * rect.height;
          if (index === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        });
        ctx.stroke();
      };

      strokes.forEach(drawStroke);
      // The line under the cursor is not on the wire yet; draw it locally so
      // the pen feels immediate instead of lagging a round trip.
      const live = drawingRef.current;
      if (live) drawStroke({ points: live, color, width });
    };

    paint();
    const observer = new ResizeObserver(paint);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [strokes, color, width]);

  function positionOf(event: React.PointerEvent<HTMLCanvasElement>): [number, number] {
    const rect = event.currentTarget.getBoundingClientRect();
    return [
      Math.min(Math.max((event.clientX - rect.left) / rect.width, 0), 1),
      Math.min(Math.max((event.clientY - rect.top) / rect.height, 0), 1),
    ];
  }

  function repaintLive() {
    const canvas = canvasRef.current;
    const live = drawingRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !live || !ctx || live.length < 2) return;
    const rect = canvas.getBoundingClientRect();
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    const [ax, ay] = live[live.length - 2];
    const [bx, by] = live[live.length - 1];
    ctx.beginPath();
    ctx.moveTo(ax * rect.width, ay * rect.height);
    ctx.lineTo(bx * rect.width, by * rect.height);
    ctx.stroke();
  }

  return (
    <div className="flex h-full flex-col gap-2">
      <div className="flex items-center gap-2">
        {COLORS.map((swatch) => (
          <button
            key={swatch}
            onClick={() => setColor(swatch)}
            aria-label={`Pen colour ${swatch}`}
            className={`h-6 w-6 rounded-full ring-2 transition ${
              color === swatch ? "ring-white" : "ring-transparent"
            }`}
            style={{ background: swatch }}
          />
        ))}
        <input
          type="range"
          min={1}
          max={20}
          value={width}
          onChange={(event) => setWidth(Number(event.target.value))}
          className="ml-1 w-20"
          aria-label="Pen width"
        />
        {canClear && (
          <button
            onClick={onClear}
            className="ml-auto flex items-center gap-1 rounded-md bg-white/10 px-2 py-1 text-xs text-white transition hover:bg-white/20"
          >
            <Icon name="trash" size={13} /> Clear
          </button>
        )}
      </div>

      <canvas
        ref={canvasRef}
        className="min-h-0 w-full flex-1 touch-none rounded-lg bg-ink-850 ring-1 ring-white/10"
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          drawingRef.current = [positionOf(event)];
        }}
        onPointerMove={(event) => {
          if (!drawingRef.current) return;
          drawingRef.current.push(positionOf(event));
          repaintLive();
        }}
        onPointerUp={() => {
          const points = drawingRef.current;
          drawingRef.current = null;
          if (points && points.length >= 2) onStroke({ points, color, width });
        }}
        onPointerCancel={() => {
          drawingRef.current = null;
        }}
      />
    </div>
  );
}
