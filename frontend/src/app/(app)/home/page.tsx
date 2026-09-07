"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { JoinModal } from "@/components/home/JoinModal";
import { MeetingCard } from "@/components/home/MeetingCard";
import { ScheduleModal } from "@/components/home/ScheduleModal";
import { Icon, type IconName } from "@/components/ui/Icon";
import { EmptyState, Spinner } from "@/components/ui/Spinner";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatMeetingId } from "@/lib/format";
import { useToast } from "@/lib/toast";
import type { Meeting } from "@/lib/types";

/** The four square actions that define Zoom's home screen. */
const TILES: { id: string; label: string; sub: string; icon: IconName; tone: string }[] = [
  { id: "new", label: "New Meeting", sub: "Start an instant meeting", icon: "video", tone: "bg-zoom-orange" },
  { id: "join", label: "Join", sub: "Enter a meeting ID", icon: "plus", tone: "bg-zoom-blue" },
  { id: "schedule", label: "Schedule", sub: "Book it for later", icon: "calendar", tone: "bg-zoom-blue" },
  { id: "share", label: "Share screen", sub: "Start and present", icon: "screen", tone: "bg-zoom-blue" },
];

export default function HomePage() {
  const { user } = useAuth();
  const router = useRouter();
  const { notify } = useToast();

  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [showJoin, setShowJoin] = useState(false);
  const [showSchedule, setShowSchedule] = useState(false);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const load = useCallback(async () => {
    try {
      setMeetings(await api.meetings("upcoming"));
    } catch {
      notify({ kind: "error", title: "Could not load your meetings" });
    } finally {
      setLoading(false);
    }
  }, [notify]);

  useEffect(() => {
    void load();
  }, [load]);

  async function startInstant(share = false) {
    setStarting(true);
    try {
      const meeting = await api.createMeeting({
        topic: `${user?.display_name ?? "My"}'s Zoomeet Meeting`,
        start_now: true,
        passcode_required: false,
        mute_on_entry: false,
        auto_record: true,
      });
      router.push(`/meeting/${meeting.code}${share ? "?share=1" : ""}`);
    } catch (caught) {
      notify({ kind: "error", title: "Could not start the meeting", detail: caught instanceof Error ? caught.message : undefined });
      setStarting(false);
    }
  }

  function onTile(id: string) {
    if (id === "new") void startInstant();
    else if (id === "share") void startInstant(true);
    else if (id === "join") setShowJoin(true);
    else setShowSchedule(true);
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
      <section>
        <h1 className="text-xl font-bold text-body">
          Good {now.getHours() < 12 ? "morning" : now.getHours() < 18 ? "afternoon" : "evening"},{" "}
          {user?.display_name.split(" ")[0]}
        </h1>
        <p className="mt-1 text-sm text-muted">Start, join or schedule a meeting — the AI notetaker joins with you.</p>

        <div className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-2 xl:grid-cols-4">
          {TILES.map((tile) => (
            <button
              key={tile.id}
              disabled={starting}
              onClick={() => onTile(tile.id)}
              className="group flex aspect-square flex-col items-center justify-center gap-3 rounded-2xl border border-line bg-surface p-4 transition hover:-translate-y-0.5 hover:border-zoom-blue/40 hover:shadow-lg disabled:opacity-60"
            >
              <span className={`grid h-14 w-14 place-items-center rounded-2xl text-white transition group-hover:scale-105 ${tile.tone}`}>
                {starting && (tile.id === "new" || tile.id === "share") ? <Spinner /> : <Icon name={tile.icon} size={26} />}
              </span>
              <span className="text-center">
                <span className="block text-sm font-semibold text-body">{tile.label}</span>
                <span className="mt-0.5 block text-[11px] text-muted">{tile.sub}</span>
              </span>
            </button>
          ))}
        </div>

        <div className="mt-8 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-body">Upcoming</h2>
          <button onClick={() => router.push("/meetings")} className="text-xs font-semibold text-zoom-blue hover:underline">
            View all
          </button>
        </div>

        <div className="mt-3 space-y-2.5">
          {loading && <div className="grid h-24 place-items-center text-muted"><Spinner /></div>}
          {!loading && meetings.length === 0 && (
            <EmptyState title="Nothing scheduled" detail="Use Schedule to put a meeting on the calendar." />
          )}
          {meetings.slice(0, 5).map((meeting) => (
            <MeetingCard key={meeting.id} meeting={meeting} />
          ))}
        </div>
      </section>

      <aside className="space-y-4">
        <div className="rounded-2xl border border-line bg-surface p-6 text-center">
          <p className="text-4xl font-bold tabular-nums text-body">
            {now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </p>
          <p className="mt-1 text-sm text-muted">
            {now.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" })}
          </p>
        </div>

        <div className="rounded-2xl border border-line bg-surface p-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">Personal Meeting ID</p>
          <p className="mt-2 font-mono text-lg font-semibold text-body">
            {formatMeetingId(user?.personal_meeting_id ?? "")}
          </p>
          <div className="mt-3 flex gap-2">
            <button
              onClick={() => router.push(`/meeting/${user?.personal_meeting_id}`)}
              className="flex-1 rounded-lg bg-zoom-blue px-3 py-2 text-xs font-semibold text-white transition hover:bg-zoom-blue-dark"
            >
              Start with PMI
            </button>
            <button
              onClick={async () => {
                await navigator.clipboard.writeText(`${window.location.origin}/meeting/${user?.personal_meeting_id}`);
                notify({ kind: "success", title: "Personal room link copied" });
              }}
              className="rounded-lg border border-line px-3 py-2 text-xs font-semibold text-body transition hover:bg-surface-2"
            >
              <Icon name="copy" size={14} />
            </button>
          </div>
        </div>

        <div className="rounded-2xl border border-line bg-surface p-5">
          <div className="flex items-center gap-2">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-zoom-blue-soft text-zoom-blue">
              <Icon name="sparkles" size={16} />
            </span>
            <p className="text-sm font-semibold text-body">AI Notetaker</p>
          </div>
          <p className="mt-2 text-xs leading-relaxed text-muted">
            When recording is on, Zoomeet transcribes the call live and writes a recap — TL;DR, decisions,
            risks and action items — the moment you stop.
          </p>
          <button onClick={() => router.push("/recordings")} className="mt-3 text-xs font-semibold text-zoom-blue hover:underline">
            Browse past recaps →
          </button>
        </div>
      </aside>

      <JoinModal open={showJoin} onClose={() => setShowJoin(false)} />
      <ScheduleModal open={showSchedule} onClose={() => setShowSchedule(false)} onScheduled={() => void load()} />
    </div>
  );
}
