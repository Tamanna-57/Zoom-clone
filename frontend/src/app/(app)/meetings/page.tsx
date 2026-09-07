"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { MeetingCard } from "@/components/home/MeetingCard";
import { ScheduleModal } from "@/components/home/ScheduleModal";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { Modal } from "@/components/ui/Modal";
import { EmptyState, Spinner } from "@/components/ui/Spinner";
import { inputClass } from "@/components/ui/Field";
import { api } from "@/lib/api";
import { formatDayHeading } from "@/lib/format";
import { useToast } from "@/lib/toast";
import type { Meeting } from "@/lib/types";

type Tab = "upcoming" | "previous" | "personal";

const TABS: { id: Tab; label: string }[] = [
  { id: "upcoming", label: "Upcoming" },
  { id: "previous", label: "Previous" },
  { id: "personal", label: "Personal Room" },
];

export default function MeetingsPage() {
  const { notify } = useToast();
  const [tab, setTab] = useState<Tab>("upcoming");
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [personal, setPersonal] = useState<Meeting | null>(null);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [showSchedule, setShowSchedule] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<Meeting | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      if (tab === "personal") setPersonal(await api.personalRoom());
      else setMeetings(await api.meetings(tab));
    } catch {
      notify({ kind: "error", title: "Could not load meetings" });
    } finally {
      setLoading(false);
    }
  }, [tab, notify]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return meetings;
    return meetings.filter(
      (meeting) =>
        meeting.topic.toLowerCase().includes(needle) ||
        meeting.code.includes(needle.replace(/\D/g, "")) ||
        meeting.host.display_name.toLowerCase().includes(needle),
    );
  }, [meetings, query]);

  /** Group by calendar day, the way the desktop client lists meetings. */
  const grouped = useMemo(() => {
    const groups = new Map<string, Meeting[]>();
    for (const meeting of filtered) {
      const anchor = meeting.scheduled_start ?? meeting.started_at ?? meeting.created_at;
      const key = new Date(anchor).toDateString();
      groups.set(key, [...(groups.get(key) ?? []), meeting]);
    }
    return [...groups.entries()];
  }, [filtered]);

  async function confirmDelete() {
    if (!pendingDelete) return;
    try {
      await api.deleteMeeting(pendingDelete.code);
      notify({ kind: "success", title: "Meeting deleted" });
      setPendingDelete(null);
      void load();
    } catch (caught) {
      notify({ kind: "error", title: "Delete failed", detail: caught instanceof Error ? caught.message : undefined });
    }
  }

  return (
    <div className="mx-auto max-w-4xl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold text-body">Meetings</h1>
        <Button onClick={() => setShowSchedule(true)}>
          <Icon name="plus" size={16} /> Schedule
        </Button>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <div className="flex rounded-xl border border-line bg-surface p-1">
          {TABS.map((item) => (
            <button
              key={item.id}
              onClick={() => setTab(item.id)}
              className={`rounded-lg px-3.5 py-1.5 text-sm font-medium transition ${
                tab === item.id ? "bg-zoom-blue text-white" : "text-muted hover:text-body"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>

        {tab !== "personal" && (
          <div className="relative min-w-[200px] flex-1">
            <Icon name="search" size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search by topic, host or ID"
              className={`${inputClass} pl-9`}
            />
          </div>
        )}
      </div>

      <div className="mt-5 space-y-6">
        {loading && <div className="grid h-32 place-items-center text-muted"><Spinner /></div>}

        {!loading && tab === "personal" && personal && (
          <div className="space-y-4">
            <MeetingCard meeting={personal} />
            <div className="rounded-xl border border-line bg-surface p-5 text-sm text-muted">
              <p className="font-semibold text-body">About your Personal Meeting Room</p>
              <p className="mt-1 leading-relaxed">
                This room never expires and always uses the same ID, so you can hand the link to anyone who
                needs to reach you. Its passcode is fixed too — rotate it from Settings when you need to.
              </p>
            </div>
          </div>
        )}

        {!loading && tab !== "personal" && grouped.length === 0 && (
          <EmptyState
            title={tab === "upcoming" ? "No upcoming meetings" : "No past meetings yet"}
            detail={tab === "upcoming" ? "Schedule one and it will show up here." : "Meetings appear here once they end."}
          />
        )}

        {!loading &&
          tab !== "personal" &&
          grouped.map(([day, items]) => (
            <section key={day}>
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">{formatDayHeading(day)}</h2>
              <div className="space-y-2.5">
                {items.map((meeting) => (
                  <MeetingCard key={meeting.id} meeting={meeting} onDelete={setPendingDelete} />
                ))}
              </div>
            </section>
          ))}
      </div>

      <ScheduleModal open={showSchedule} onClose={() => setShowSchedule(false)} onScheduled={() => void load()} />

      <Modal
        open={Boolean(pendingDelete)}
        onClose={() => setPendingDelete(null)}
        title="Delete this meeting?"
        footer={
          <>
            <Button variant="secondary" onClick={() => setPendingDelete(null)}>Cancel</Button>
            <Button variant="danger" onClick={confirmDelete}>Delete</Button>
          </>
        }
      >
        <p className="text-sm text-muted">
          <span className="font-semibold text-body">{pendingDelete?.topic}</span> and its chat, transcript and
          AI recap will be removed for everyone. This cannot be undone.
        </p>
      </Modal>
    </div>
  );
}
