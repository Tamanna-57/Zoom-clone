"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { Avatar } from "@/components/ui/Avatar";
import { Icon } from "@/components/ui/Icon";
import { inputClass } from "@/components/ui/Field";
import { EmptyState, Spinner } from "@/components/ui/Spinner";
import { api } from "@/lib/api";
import { formatDate, formatDuration, relativeDay } from "@/lib/format";
import { useToast } from "@/lib/toast";
import type { Recording } from "@/lib/types";

export default function RecordingsPage() {
  const params = useSearchParams();
  const { notify } = useToast();
  const [query, setQuery] = useState(params.get("q") ?? "");
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(
    async (search: string) => {
      setLoading(true);
      try {
        setRecordings(await api.recordings(search));
      } catch {
        notify({ kind: "error", title: "Could not load recordings" });
      } finally {
        setLoading(false);
      }
    },
    [notify],
  );

  // Search hits the API (it also matches transcript text), so it is debounced.
  useEffect(() => {
    const timer = window.setTimeout(() => void load(query), query ? 350 : 0);
    return () => window.clearTimeout(timer);
  }, [query, load]);

  return (
    <div className="mx-auto max-w-4xl">
      <div className="flex items-center gap-2">
        <span className="grid h-9 w-9 place-items-center rounded-xl bg-zoom-blue-soft text-zoom-blue">
          <Icon name="sparkles" size={18} />
        </span>
        <div>
          <h1 className="text-xl font-bold text-body">AI Notes</h1>
          <p className="text-xs text-muted">Every recorded meeting, summarised and searchable.</p>
        </div>
      </div>

      <div className="relative mt-5">
        <Icon name="search" size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search titles, participants and what was said"
          className={`${inputClass} pl-9`}
        />
      </div>

      {loading ? (
        <div className="mt-12 grid place-items-center text-muted"><Spinner /></div>
      ) : recordings.length === 0 ? (
        <div className="mt-5">
          <EmptyState
            title={query ? "Nothing matches that search" : "No recordings yet"}
            detail={query ? "Try another phrase — transcripts are searched too." : "Record a meeting and its recap appears here."}
          />
        </div>
      ) : (
        <div className="mt-5 space-y-2.5">
          {recordings.map((recording) => (
            <Link
              key={recording.id}
              href={`/recordings/${recording.id}`}
              className="flex items-start gap-4 rounded-xl border border-line bg-surface p-4 transition hover:border-zoom-blue/40 hover:shadow-sm"
            >
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-zoom-blue-soft text-zoom-blue">
                <Icon name="film" size={19} />
              </span>

              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="truncate text-sm font-semibold text-body">{recording.title}</h2>
                  {recording.status !== "ready" && (
                    <span className="rounded-full bg-amber-400/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-500">
                      {recording.status}
                    </span>
                  )}
                </div>
                <p className="mt-0.5 text-xs text-muted">
                  {relativeDay(recording.started_at)} · {formatDate(recording.started_at)} ·{" "}
                  {formatDuration(recording.duration_seconds)}
                </p>

                <div className="mt-2.5 flex flex-wrap items-center gap-3 text-[11px] text-muted">
                  <span className="flex -space-x-1.5">
                    {recording.participant_names.slice(0, 4).map((name) => (
                      <Avatar key={name} name={name} size="xs" className="ring-2 ring-surface" />
                    ))}
                  </span>
                  <span className="flex items-center gap-1">
                    <Icon name="list" size={12} /> {recording.segment_count} lines
                  </span>
                  <span className="flex items-center gap-1">
                    <Icon name="check" size={12} /> {recording.action_item_count} action items
                  </span>
                  <span className="flex items-center gap-1">
                    <Icon name="star" size={12} /> {recording.highlight_count}
                  </span>
                </div>
              </div>

              <Icon name="chevron-right" size={16} className="mt-2 shrink-0 text-muted" />
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
