"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { formatMeetingId, formatTime, relativeDay } from "@/lib/format";
import { useToast } from "@/lib/toast";
import type { Meeting } from "@/lib/types";

export function MeetingCard({
  meeting,
  onDelete,
  compact = false,
}: {
  meeting: Meeting;
  onDelete?: (meeting: Meeting) => void;
  compact?: boolean;
}) {
  const { notify } = useToast();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const live = meeting.status === "live";

  const copyInvite = async () => {
    const lines = [
      `${meeting.host.display_name} is inviting you to a Zoomeet meeting.`,
      ``,
      `Topic: ${meeting.topic}`,
      meeting.scheduled_start ? `Time: ${new Date(meeting.scheduled_start).toLocaleString()}` : "",
      ``,
      `Join link: ${window.location.origin}/meeting/${meeting.code}`,
      `Meeting ID: ${formatMeetingId(meeting.code)}`,
      meeting.passcode ? `Passcode: ${meeting.passcode}` : "",
    ].filter(Boolean);
    await navigator.clipboard.writeText(lines.join("\n"));
    notify({ kind: "success", title: "Invitation copied" });
  };

  return (
    <article
      className={`group rounded-xl border border-line bg-surface p-4 transition hover:border-zoom-blue/40 hover:shadow-sm ${
        live ? "ring-1 ring-zoom-green/40" : ""
      }`}
    >
      <div className="flex items-start gap-3">
        <div
          className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl ${
            live ? "bg-zoom-green/15 text-zoom-green" : "bg-zoom-blue-soft text-zoom-blue"
          }`}
        >
          <Icon name={live ? "video" : "calendar"} size={19} />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-sm font-semibold text-body">{meeting.topic}</h3>
            {live && (
              <span className="rounded-full bg-zoom-green/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-zoom-green">
                Live
              </span>
            )}
            {meeting.is_personal_room && (
              <span className="rounded-full bg-surface-3 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted">
                Personal room
              </span>
            )}
          </div>

          <p className="mt-0.5 text-xs text-muted">
            {meeting.scheduled_start
              ? `${relativeDay(meeting.scheduled_start)} · ${formatTime(meeting.scheduled_start)} · ${meeting.duration_minutes} min`
              : "No fixed time"}
            {" · "}
            <span className="font-mono">{formatMeetingId(meeting.code)}</span>
          </p>

          {!compact && (
            <div className="mt-3 flex items-center gap-2">
              <div className="flex -space-x-2">
                <Avatar name={meeting.host.display_name} color={meeting.host.avatar_color} size="xs" className="ring-2 ring-surface" />
                {meeting.invitees.slice(0, 4).map((person) => (
                  <Avatar key={person.id} name={person.display_name} color={person.avatar_color} size="xs" className="ring-2 ring-surface" />
                ))}
              </div>
              {meeting.invitees.length > 4 && (
                <span className="text-[11px] text-muted">+{meeting.invitees.length - 4}</span>
              )}
              <span className="text-[11px] text-muted">· hosted by {meeting.host.display_name}</span>
            </div>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          <Button size="sm" variant={live ? "primary" : "secondary"} onClick={() => router.push(`/meeting/${meeting.code}`)}>
            {live ? "Join" : "Start"}
          </Button>
          <div className="relative">
            <button
              onClick={() => setOpen((value) => !value)}
              onBlur={() => window.setTimeout(() => setOpen(false), 150)}
              className="rounded-lg p-2 text-muted transition hover:bg-surface-3 hover:text-body"
              aria-label="More options"
            >
              <Icon name="more" size={16} />
            </button>
            {open && (
              <div className="animate-slide-in absolute right-0 top-10 z-20 w-52 overflow-hidden rounded-xl border border-line bg-surface p-1.5 shadow-xl">
                <button onMouseDown={copyInvite} className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition hover:bg-surface-2">
                  <Icon name="copy" size={15} /> Copy invitation
                </button>
                {meeting.latest_recording_id && (
                  <Link href={`/recordings/${meeting.latest_recording_id}`} className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition hover:bg-surface-2">
                    <Icon name="sparkles" size={15} /> Open AI notes
                  </Link>
                )}
                {onDelete && !meeting.is_personal_room && (
                  <button
                    onMouseDown={() => onDelete(meeting)}
                    className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-zoom-red transition hover:bg-zoom-red/10"
                  >
                    <Icon name="trash" size={15} /> Delete meeting
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </article>
  );
}
