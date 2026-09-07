"use client";

import { useEffect, useRef, useState } from "react";

import { Icon } from "@/components/ui/Icon";
import { formatTime } from "@/lib/format";
import type { ChatMessage, PeerInfo } from "@/lib/types";

import { SidePanel } from "./SidePanel";

export function ChatPanel({
  messages,
  peers,
  selfUserId,
  onSend,
  onClose,
}: {
  messages: ChatMessage[];
  peers: PeerInfo[];
  selfUserId: number;
  onSend: (body: string, recipientId: number | null) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState("");
  const [recipient, setRecipient] = useState<number | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const body = draft.trim();
    if (!body) return;
    onSend(body, recipient);
    setDraft("");
  }

  return (
    <SidePanel title="Chat" onClose={onClose}>
      <div className="space-y-3 px-4 py-3">
        {messages.length === 0 && (
          <p className="py-10 text-center text-xs text-ink-300">
            Messages sent here are visible to everyone in the meeting and saved with the recap.
          </p>
        )}

        {messages.map((message) => {
          const mine = message.sender_id === selfUserId;
          const direct = message.recipient_id !== null;
          return (
            <div key={message.id} className={`flex flex-col ${mine ? "items-end" : "items-start"}`}>
              <div className="mb-0.5 flex items-center gap-1.5 text-[11px] text-ink-300">
                <span className="font-semibold text-white/80">{mine ? "You" : message.sender_name}</span>
                {direct && (
                  <span className="rounded bg-amber-400/20 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-amber-300">
                    {mine ? `to ${message.recipient_name}` : "direct"}
                  </span>
                )}
                <span>{formatTime(message.created_at)}</span>
              </div>
              <p
                className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm leading-relaxed ${
                  mine ? "rounded-br-md bg-zoom-blue text-white" : "rounded-bl-md bg-ink-700 text-white/90"
                }`}
              >
                {message.body}
              </p>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      <form onSubmit={submit} className="sticky bottom-0 border-t border-white/8 bg-ink-850 p-3">
        <div className="mb-2 flex items-center gap-2 text-[11px] text-ink-300">
          To:
          <select
            value={recipient ?? ""}
            onChange={(event) => setRecipient(event.target.value ? Number(event.target.value) : null)}
            className="rounded-md border border-white/10 bg-ink-800 px-2 py-1 text-white outline-none"
          >
            <option value="">Everyone</option>
            {peers
              .filter((peer) => peer.userId !== selfUserId)
              .map((peer) => (
                <option key={peer.connectionId} value={peer.userId}>
                  {peer.displayName} (direct)
                </option>
              ))}
          </select>
        </div>
        <div className="flex items-end gap-2">
          <textarea
            rows={1}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                submit(event);
              }
            }}
            placeholder="Type a message…"
            className="max-h-24 flex-1 resize-none rounded-lg border border-white/10 bg-ink-800 px-3 py-2 text-sm text-white outline-none placeholder:text-ink-300 focus:border-zoom-blue"
          />
          <button
            type="submit"
            disabled={!draft.trim()}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-zoom-blue text-white transition hover:bg-zoom-blue-dark disabled:opacity-40"
            aria-label="Send message"
          >
            <Icon name="chevron-right" size={17} />
          </button>
        </div>
      </form>
    </SidePanel>
  );
}
