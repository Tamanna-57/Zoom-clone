"use client";

import { useMemo, useState } from "react";

import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { inputClass } from "@/components/ui/Field";
import { formatClock, formatDate, formatDuration, formatTime } from "@/lib/format";
import type { ActionItem, RecordingDetail } from "@/lib/types";

type Tab = "summary" | "transcript" | "highlights";

/**
 * The post-meeting recap, shared by the private page and the public share link.
 * `readOnly` drops every mutating control so a shared recap cannot be edited.
 */
export function RecapView({
  recording,
  readOnly = false,
  onToggleItem,
  onAddItem,
  onDeleteItem,
  onRegenerate,
  onShare,
  regenerating = false,
}: {
  recording: RecordingDetail;
  readOnly?: boolean;
  onToggleItem?: (item: ActionItem) => void;
  onAddItem?: (text: string) => void;
  onDeleteItem?: (item: ActionItem) => void;
  onRegenerate?: () => void;
  onShare?: () => void;
  regenerating?: boolean;
}) {
  const [tab, setTab] = useState<Tab>("summary");
  const [query, setQuery] = useState("");
  const [newItem, setNewItem] = useState("");
  const [copied, setCopied] = useState(false);

  const filteredSegments = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return recording.segments;
    return recording.segments.filter(
      (segment) => segment.text.toLowerCase().includes(needle) || segment.speaker_name.toLowerCase().includes(needle),
    );
  }, [recording.segments, query]);

  const open = recording.action_items.filter((item) => item.status === "open");
  const done = recording.action_items.filter((item) => item.status === "done");

  async function copyRecap() {
    const summary = recording.summary;
    const lines = [
      `# ${recording.title}`,
      `${formatDate(recording.started_at)} · ${formatDuration(recording.duration_seconds)} · ${recording.participant_names.join(", ")}`,
      "",
      summary ? `## TL;DR\n${summary.tldr}` : "",
      ...(summary?.sections ?? []).map((section) => `\n## ${section.title}\n${section.bullets.map((b) => `- ${b}`).join("\n")}`),
      recording.action_items.length ? `\n## Action items\n${recording.action_items.map((item) => `- [${item.status === "done" ? "x" : " "}] ${item.assignee_name ? `${item.assignee_name}: ` : ""}${item.text}`).join("\n")}` : "",
    ].filter(Boolean);
    await navigator.clipboard.writeText(lines.join("\n"));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="mx-auto max-w-5xl">
      <header className="rounded-2xl border border-line bg-surface p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="grid h-9 w-9 place-items-center rounded-xl bg-zoom-blue-soft text-zoom-blue">
                <Icon name="sparkles" size={18} />
              </span>
              <span className="rounded-full bg-surface-3 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-muted">
                AI recap
              </span>
              {recording.status !== "ready" && (
                <span className="rounded-full bg-amber-400/15 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-amber-500">
                  {recording.status}
                </span>
              )}
            </div>
            <h1 className="mt-3 text-2xl font-bold text-body">{recording.title}</h1>
            <p className="mt-1 text-sm text-muted">
              {formatDate(recording.started_at)} · {formatTime(recording.started_at)} ·{" "}
              {formatDuration(recording.duration_seconds)} · hosted by {recording.host_name}
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {recording.participant_names.map((name) => (
                <span key={name} className="flex items-center gap-1.5 rounded-full bg-surface-2 py-1 pl-1 pr-2.5 text-xs text-body">
                  <Avatar name={name} size="xs" />
                  {name}
                </span>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" onClick={copyRecap}>
              <Icon name={copied ? "check" : "copy"} size={14} /> {copied ? "Copied" : "Copy recap"}
            </Button>
            {!readOnly && onShare && (
              <Button variant="secondary" size="sm" onClick={onShare}>
                <Icon name="link" size={14} /> Share link
              </Button>
            )}
            {!readOnly && onRegenerate && (
              <Button size="sm" onClick={onRegenerate} disabled={regenerating}>
                <Icon name="sparkles" size={14} /> {regenerating ? "Regenerating…" : "Regenerate"}
              </Button>
            )}
          </div>
        </div>

        {recording.summary?.keywords.length ? (
          <div className="mt-4 flex flex-wrap gap-1.5 border-t border-line pt-4">
            {recording.summary.keywords.map((keyword) => (
              <span key={keyword} className="rounded-full bg-zoom-blue-soft px-2.5 py-1 text-[11px] font-medium text-zoom-blue">
                #{keyword}
              </span>
            ))}
          </div>
        ) : null}
      </header>

      <nav className="mt-5 flex gap-1 rounded-xl border border-line bg-surface p-1">
        {([
          ["summary", "Summary", "sparkles"],
          ["transcript", `Transcript (${recording.segments.length})`, "list"],
          ["highlights", `Highlights (${recording.highlights.length})`, "star"],
        ] as const).map(([id, label, icon]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition ${
              tab === id ? "bg-zoom-blue text-white" : "text-muted hover:text-body"
            }`}
          >
            <Icon name={icon} size={15} /> {label}
          </button>
        ))}
      </nav>

      {tab === "summary" && (
        <div className="mt-5 grid gap-5 lg:grid-cols-[1.6fr_1fr]">
          <div className="space-y-4">
            <section className="rounded-2xl border border-line bg-surface p-5">
              <h2 className="text-xs font-bold uppercase tracking-wide text-muted">TL;DR</h2>
              <p className="mt-2 text-[15px] leading-relaxed text-body">
                {recording.summary?.tldr ?? "No summary yet — this recording has no transcript."}
              </p>
              {recording.summary && (
                <p className="mt-3 text-[11px] text-muted">Generated by {recording.summary.generator}</p>
              )}
            </section>

            {(recording.summary?.sections ?? []).map((section) => (
              <section key={section.title} className="rounded-2xl border border-line bg-surface p-5">
                <h2 className="text-xs font-bold uppercase tracking-wide text-muted">{section.title}</h2>
                <ul className="mt-3 space-y-2">
                  {section.bullets.map((bullet, index) => (
                    <li key={index} className="flex gap-2.5 text-sm leading-relaxed text-body">
                      <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-zoom-blue" />
                      {bullet}
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>

          <div className="space-y-4">
            <section className="rounded-2xl border border-line bg-surface p-5">
              <div className="flex items-center justify-between">
                <h2 className="text-xs font-bold uppercase tracking-wide text-muted">Action items</h2>
                <span className="text-[11px] text-muted">{open.length} open</span>
              </div>

              <ul className="mt-3 space-y-2">
                {[...open, ...done].map((item) => (
                  <li key={item.id} className="group flex items-start gap-2.5 rounded-lg p-2 transition hover:bg-surface-2">
                    <button
                      disabled={readOnly}
                      onClick={() => onToggleItem?.(item)}
                      aria-label={item.status === "done" ? "Reopen" : "Mark done"}
                      className={`mt-0.5 grid h-4.5 w-4.5 shrink-0 place-items-center rounded border transition ${
                        item.status === "done" ? "border-zoom-green bg-zoom-green text-white" : "border-line hover:border-zoom-blue"
                      } ${readOnly ? "cursor-default" : ""}`}
                      style={{ height: 18, width: 18 }}
                    >
                      {item.status === "done" && <Icon name="check" size={11} strokeWidth={3} />}
                    </button>
                    <span className="min-w-0 flex-1">
                      <span className={`block text-sm leading-snug ${item.status === "done" ? "text-muted line-through" : "text-body"}`}>
                        {item.text}
                      </span>
                      <span className="mt-1 flex flex-wrap items-center gap-1.5">
                        {item.assignee_name && (
                          <span className="rounded-full bg-surface-3 px-2 py-0.5 text-[10px] font-medium text-muted">
                            {item.assignee_name}
                          </span>
                        )}
                        {item.due_hint && (
                          <span className="rounded-full bg-amber-400/15 px-2 py-0.5 text-[10px] font-medium text-amber-600">
                            {item.due_hint}
                          </span>
                        )}
                      </span>
                    </span>
                    {!readOnly && onDeleteItem && (
                      <button
                        onClick={() => onDeleteItem(item)}
                        aria-label="Delete action item"
                        className="opacity-0 transition group-hover:opacity-100 hover:text-zoom-red"
                      >
                        <Icon name="trash" size={14} />
                      </button>
                    )}
                  </li>
                ))}
                {recording.action_items.length === 0 && (
                  <li className="py-4 text-center text-xs text-muted">No commitments were detected.</li>
                )}
              </ul>

              {!readOnly && onAddItem && (
                <form
                  className="mt-3 flex gap-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (!newItem.trim()) return;
                    onAddItem(newItem.trim());
                    setNewItem("");
                  }}
                >
                  <input
                    value={newItem}
                    onChange={(event) => setNewItem(event.target.value)}
                    placeholder="Add an action item"
                    className={`${inputClass} py-2 text-xs`}
                  />
                  <Button type="submit" size="sm" disabled={!newItem.trim()}>
                    <Icon name="plus" size={14} />
                  </Button>
                </form>
              )}
            </section>

            <section className="rounded-2xl border border-line bg-surface p-5">
              <h2 className="text-xs font-bold uppercase tracking-wide text-muted">Talk time</h2>
              <ul className="mt-3 space-y-3">
                {recording.speaker_stats.map((stat) => (
                  <li key={stat.speaker_name}>
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-medium text-body">{stat.speaker_name}</span>
                      <span className="text-muted">
                        {stat.percent}% · {formatDuration(stat.seconds)}
                      </span>
                    </div>
                    <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-3">
                      <div className="h-full rounded-full bg-zoom-blue" style={{ width: `${stat.percent}%` }} />
                    </div>
                  </li>
                ))}
                {recording.speaker_stats.length === 0 && <li className="text-xs text-muted">No speech captured.</li>}
              </ul>
            </section>
          </div>
        </div>
      )}

      {tab === "transcript" && (
        <div className="mt-5 rounded-2xl border border-line bg-surface p-5">
          <div className="relative">
            <Icon name="search" size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search the transcript"
              className={`${inputClass} pl-9`}
            />
          </div>

          <div className="mt-4 space-y-4">
            {filteredSegments.map((segment) => (
              <div key={segment.id} className="grid grid-cols-[64px_1fr] gap-3">
                <span className="pt-0.5 text-right font-mono text-[11px] text-muted">{formatClock(segment.start_ms)}</span>
                <div>
                  <p className="text-xs font-semibold text-body">{segment.speaker_name}</p>
                  <p className="mt-0.5 text-sm leading-relaxed text-body/90">
                    {highlightMatch(segment.text, query)}
                  </p>
                </div>
              </div>
            ))}
            {filteredSegments.length === 0 && (
              <p className="py-10 text-center text-sm text-muted">
                {recording.segments.length === 0 ? "This recording has no transcript." : "No lines match that search."}
              </p>
            )}
          </div>
        </div>
      )}

      {tab === "highlights" && (
        <div className="mt-5 space-y-3">
          {recording.highlights.map((highlight) => (
            <article key={highlight.id} className="rounded-2xl border border-line bg-surface p-5">
              <div className="flex items-center gap-2">
                <span className="grid h-8 w-8 place-items-center rounded-lg bg-amber-400/15 text-amber-500">
                  <Icon name="star" size={15} />
                </span>
                <div>
                  <p className="text-sm font-semibold text-body">{highlight.label}</p>
                  <p className="text-[11px] text-muted">
                    {highlight.created_by_name} · at {formatClock(highlight.at_ms)}
                  </p>
                </div>
              </div>
              {highlight.note && <p className="mt-3 text-sm leading-relaxed text-body">{highlight.note}</p>}
              <p className="mt-3 rounded-lg bg-surface-2 p-3 text-sm italic leading-relaxed text-muted">
                {nearestLine(recording, highlight.at_ms)}
              </p>
            </article>
          ))}
          {recording.highlights.length === 0 && (
            <p className="rounded-2xl border border-dashed border-line bg-surface py-14 text-center text-sm text-muted">
              Nobody starred a moment in this meeting.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/** Bold the search term inside a transcript line. */
function highlightMatch(text: string, query: string): React.ReactNode {
  const needle = query.trim();
  if (!needle) return text;
  const parts = text.split(new RegExp(`(${needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "ig"));
  return parts.map((part, index) =>
    part.toLowerCase() === needle.toLowerCase() ? (
      <mark key={index} className="rounded bg-amber-300/40 px-0.5 text-body">
        {part}
      </mark>
    ) : (
      part
    ),
  );
}

function nearestLine(recording: RecordingDetail, atMs: number): string {
  const segment =
    recording.segments.find((candidate) => candidate.start_ms <= atMs && candidate.end_ms >= atMs) ??
    [...recording.segments].reverse().find((candidate) => candidate.start_ms <= atMs);
  return segment ? `“${segment.text}” — ${segment.speaker_name}` : "No transcript around this moment.";
}
