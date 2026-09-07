"use client";

import { useState } from "react";

import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import type { Poll } from "@/lib/types";

/**
 * In-call polls.
 *
 * Hosts and co-hosts write the question; everyone votes. Tallies are computed
 * server side from a set of voter ids per option, so switching your answer moves
 * the count rather than adding to it.
 */
export function PollsPanel({
  polls,
  canManage,
  onCreate,
  onVote,
  onClose,
}: {
  polls: Poll[];
  canManage: boolean;
  onCreate: (question: string, options: string[]) => void;
  onVote: (pollId: string, choice: number) => void;
  onClose: (pollId: string) => void;
}) {
  const [composing, setComposing] = useState(false);
  const [question, setQuestion] = useState("");
  const [options, setOptions] = useState(["", ""]);

  const filled = options.map((o) => o.trim()).filter(Boolean);
  const canSubmit = question.trim().length > 0 && filled.length >= 2;

  function submit() {
    if (!canSubmit) return;
    onCreate(question.trim(), filled);
    setQuestion("");
    setOptions(["", ""]);
    setComposing(false);
  }

  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto">
      {polls.length === 0 && !composing && (
        <p className="mt-6 text-center text-sm text-ink-300">
          No polls yet.
          {canManage ? " Create one to ask the room a question." : " The host has not started one."}
        </p>
      )}

      {polls.map((poll) => {
        const total = poll.counts.reduce((sum, n) => sum + n, 0);
        return (
          <div key={poll.id} className="rounded-lg bg-ink-850 p-3 ring-1 ring-white/10">
            <div className="flex items-start gap-2">
              <p className="flex-1 text-sm font-semibold text-white">{poll.question}</p>
              {!poll.isOpen && (
                <span className="rounded bg-white/10 px-1.5 py-0.5 text-[9px] font-bold uppercase text-ink-300">
                  Closed
                </span>
              )}
            </div>

            <div className="mt-3 space-y-2">
              {poll.options.map((option, index) => {
                const count = poll.counts[index] ?? 0;
                const pct = total ? Math.round((count / total) * 100) : 0;
                const mine = poll.myVote === index;
                return (
                  <button
                    key={index}
                    disabled={!poll.isOpen}
                    onClick={() => onVote(poll.id, index)}
                    className={`relative w-full overflow-hidden rounded-md px-2.5 py-2 text-left text-xs transition ${
                      poll.isOpen ? "hover:bg-white/10" : "cursor-default"
                    } ${mine ? "ring-1 ring-zoom-blue" : "ring-1 ring-white/10"}`}
                  >
                    <span
                      aria-hidden
                      className="absolute inset-y-0 left-0 bg-zoom-blue/25 transition-all"
                      style={{ width: `${pct}%` }}
                    />
                    <span className="relative flex items-center justify-between gap-2">
                      <span className="truncate text-white">
                        {mine && "✓ "}
                        {option}
                      </span>
                      <span className="shrink-0 text-ink-300">
                        {count} · {pct}%
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>

            <p className="mt-2 text-[11px] text-ink-400">
              {total} vote{total === 1 ? "" : "s"} · by {poll.createdBy}
            </p>

            {canManage && poll.isOpen && (
              <button
                onClick={() => onClose(poll.id)}
                className="mt-2 text-[11px] font-semibold text-ink-300 transition hover:text-white"
              >
                Close voting
              </button>
            )}
          </div>
        );
      })}

      {canManage && !composing && (
        <Button variant="secondary" onClick={() => setComposing(true)} className="mt-1 w-full">
          <Icon name="plus" size={14} /> New poll
        </Button>
      )}

      {composing && (
        <div className="rounded-lg bg-ink-850 p-3 ring-1 ring-white/10">
          <input
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            placeholder="Ask a question"
            maxLength={200}
            className="w-full rounded-md bg-ink-900 px-2.5 py-2 text-sm text-white outline-none ring-1 ring-white/10 focus:ring-zoom-blue"
          />
          <div className="mt-2 space-y-2">
            {options.map((option, index) => (
              <input
                key={index}
                value={option}
                onChange={(event) => {
                  const next = [...options];
                  next[index] = event.target.value;
                  setOptions(next);
                }}
                placeholder={`Option ${index + 1}`}
                maxLength={80}
                className="w-full rounded-md bg-ink-900 px-2.5 py-1.5 text-xs text-white outline-none ring-1 ring-white/10 focus:ring-zoom-blue"
              />
            ))}
          </div>
          {options.length < 6 && (
            <button
              onClick={() => setOptions([...options, ""])}
              className="mt-2 text-[11px] font-semibold text-ink-300 transition hover:text-white"
            >
              + Add option
            </button>
          )}
          <div className="mt-3 flex gap-2">
            <Button onClick={submit} disabled={!canSubmit} className="flex-1">
              Launch
            </Button>
            <Button variant="ghost" onClick={() => setComposing(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
