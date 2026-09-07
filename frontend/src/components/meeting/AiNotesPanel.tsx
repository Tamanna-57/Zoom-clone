"use client";

import { useEffect, useRef } from "react";

import { Icon } from "@/components/ui/Icon";
import { formatClock } from "@/lib/format";
import type { TranscriptSegment } from "@/lib/types";

import { SidePanel } from "./SidePanel";

/**
 * The in-meeting half of the notetaker: what has been heard so far, plus the
 * one-click "highlight this moment" that Fathom is known for. The actual recap
 * is generated server-side when recording stops.
 */
export function AiNotesPanel({
  segments,
  interim,
  isRecording,
  captionsOn,
  captionsSupported,
  onClose,
  onHighlight,
  onToggleCaptions,
  onStartRecording,
}: {
  segments: TranscriptSegment[];
  interim: string;
  isRecording: boolean;
  captionsOn: boolean;
  captionsSupported: boolean;
  onClose: () => void;
  onHighlight: () => void;
  onToggleCaptions: () => void;
  onStartRecording: () => void;
}) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [segments.length, interim]);

  return (
    <SidePanel
      title="AI Notes"
      onClose={onClose}
      footer={
        <button
          onClick={onHighlight}
          disabled={!isRecording}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-zoom-blue py-2.5 text-sm font-semibold text-white transition hover:bg-zoom-blue-dark disabled:opacity-40"
        >
          <Icon name="star" size={16} /> Highlight this moment
        </button>
      }
      actions={
        <button
          onClick={onToggleCaptions}
          disabled={!captionsSupported}
          title={captionsSupported ? "Toggle live captions" : "This browser has no speech recognition"}
          className={`rounded-md px-2 py-1 text-[10px] font-bold uppercase tracking-wide transition disabled:opacity-40 ${
            captionsOn ? "bg-zoom-green/20 text-zoom-green" : "bg-white/10 text-ink-300"
          }`}
        >
          {captionsOn ? "Mic on" : "Mic off"}
        </button>
      }
    >
      <div className="px-4 py-3">
        <div
          className={`mb-4 flex items-start gap-3 rounded-xl border p-3 ${
            isRecording ? "border-zoom-red/40 bg-zoom-red/10" : "border-white/10 bg-white/5"
          }`}
        >
          <span className={`mt-0.5 ${isRecording ? "text-zoom-red" : "text-ink-300"}`}>
            <Icon name={isRecording ? "record" : "sparkles"} size={18} />
          </span>
          <div className="min-w-0">
            <p className="text-xs font-semibold text-white">
              {isRecording ? "Recording · notetaker is listening" : "Notetaker is idle"}
            </p>
            <p className="mt-1 text-[11px] leading-relaxed text-ink-300">
              {isRecording
                ? "The recap — TL;DR, decisions, risks and action items — is written the moment recording stops."
                : "Start recording to capture a transcript and get an automatic recap."}
            </p>
            {!isRecording && (
              <button onClick={onStartRecording} className="mt-2 text-[11px] font-semibold text-zoom-blue hover:underline">
                Start recording
              </button>
            )}
          </div>
        </div>

        {!captionsSupported && (
          <p className="mb-4 rounded-lg bg-amber-400/10 px-3 py-2 text-[11px] leading-relaxed text-amber-300">
            This browser has no Web Speech API, so your own speech is not transcribed. Chrome or Edge will
            capture it; you still see everyone else&apos;s lines.
          </p>
        )}

        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-ink-300">
          Live transcript · {segments.length} lines
        </p>

        <div className="space-y-3">
          {segments.length === 0 && !interim && (
            <p className="py-8 text-center text-xs text-ink-300">Nothing captured yet. Say something.</p>
          )}

          {segments.map((segment) => (
            <div key={segment.id} className="text-sm">
              <p className="flex items-center gap-2 text-[11px] text-ink-300">
                <span className="font-semibold text-white/80">{segment.speaker_name}</span>
                <span className="tabular-nums">{formatClock(segment.start_ms)}</span>
              </p>
              <p className="mt-0.5 leading-relaxed text-white/85">{segment.text}</p>
            </div>
          ))}

          {interim && (
            <p className="text-sm italic leading-relaxed text-ink-300">
              {interim}
              <span className="ml-1 inline-block h-3 w-1 animate-pulse bg-ink-300 align-middle" />
            </p>
          )}
          <div ref={bottomRef} />
        </div>
      </div>
    </SidePanel>
  );
}
