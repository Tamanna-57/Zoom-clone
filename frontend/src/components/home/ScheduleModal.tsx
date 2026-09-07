"use client";

import { useEffect, useState } from "react";

import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { Field, Toggle, inputClass } from "@/components/ui/Field";
import { Icon } from "@/components/ui/Icon";
import { Modal } from "@/components/ui/Modal";
import { Spinner } from "@/components/ui/Spinner";
import { api } from "@/lib/api";
import { useToast } from "@/lib/toast";
import type { Meeting, User } from "@/lib/types";

function defaultStart(): string {
  // Next half-hour, formatted for <input type="datetime-local">.
  const date = new Date(Date.now() + 30 * 60_000);
  date.setMinutes(date.getMinutes() >= 30 ? 30 : 0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function ScheduleModal({
  open,
  onClose,
  onScheduled,
}: {
  open: boolean;
  onClose: () => void;
  onScheduled: (meeting: Meeting) => void;
}) {
  const { notify } = useToast();
  const [people, setPeople] = useState<User[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    topic: "",
    start: defaultStart(),
    duration: 30,
    agenda: "",
    passcode: true,
    waitingRoom: false,
    muteOnEntry: true,
    autoRecord: true,
    invitees: [] as number[],
  });

  useEffect(() => {
    if (!open) return;
    setError("");
    setForm((current) => ({ ...current, start: defaultStart() }));
    void api.searchUsers().then(setPeople).catch(() => setPeople([]));
  }, [open]);

  const toggleInvitee = (id: number) =>
    setForm((current) => ({
      ...current,
      invitees: current.invitees.includes(id)
        ? current.invitees.filter((value) => value !== id)
        : [...current.invitees, id],
    }));

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const meeting = await api.createMeeting({
        topic: form.topic.trim() || "Zoomeet Meeting",
        // datetime-local is local wall time; toISOString converts it to UTC.
        scheduled_start: new Date(form.start).toISOString(),
        duration_minutes: Number(form.duration),
        agenda: form.agenda.trim() || null,
        passcode_required: form.passcode,
        waiting_room: form.waitingRoom,
        mute_on_entry: form.muteOnEntry,
        auto_record: form.autoRecord,
        invitee_ids: form.invitees,
      });
      notify({ kind: "success", title: "Meeting scheduled", detail: meeting.topic });
      onScheduled(meeting);
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not schedule the meeting");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Schedule meeting"
      subtitle="Invitees see it in their Meetings tab straight away."
      width="max-w-2xl"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} type="button">Cancel</Button>
          <Button form="schedule-form" type="submit" disabled={busy}>
            {busy ? <Spinner /> : null} Schedule
          </Button>
        </>
      }
    >
      <form id="schedule-form" onSubmit={submit} className="space-y-4">
        <Field label="Topic">
          <input value={form.topic} onChange={(e) => setForm({ ...form, topic: e.target.value })} className={inputClass} placeholder="Weekly product sync" />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Starts">
            <input type="datetime-local" required value={form.start} onChange={(e) => setForm({ ...form, start: e.target.value })} className={inputClass} />
          </Field>
          <Field label="Duration">
            <select value={form.duration} onChange={(e) => setForm({ ...form, duration: Number(e.target.value) })} className={inputClass}>
              {[15, 30, 45, 60, 90, 120].map((minutes) => (
                <option key={minutes} value={minutes}>{minutes} minutes</option>
              ))}
            </select>
          </Field>
        </div>

        <Field label="Agenda" hint="Shown on the meeting card and used as recap context.">
          <textarea rows={2} value={form.agenda} onChange={(e) => setForm({ ...form, agenda: e.target.value })} className={inputClass} placeholder="What are we deciding?" />
        </Field>

        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Invite people</p>
          <div className="grid max-h-44 gap-1 overflow-y-auto rounded-lg border border-line p-1.5 sm:grid-cols-2">
            {people.map((person) => {
              const selected = form.invitees.includes(person.id);
              return (
                <button
                  key={person.id}
                  type="button"
                  onClick={() => toggleInvitee(person.id)}
                  className={`flex items-center gap-2 rounded-lg px-2 py-2 text-left transition ${selected ? "bg-zoom-blue-soft" : "hover:bg-surface-2"}`}
                >
                  <Avatar name={person.display_name} color={person.avatar_color} size="sm" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-body">{person.display_name}</span>
                    <span className="block truncate text-[11px] text-muted">{person.job_title ?? person.email}</span>
                  </span>
                  {selected && <Icon name="check" size={15} className="text-zoom-blue" />}
                </button>
              );
            })}
            {people.length === 0 && <p className="px-2 py-3 text-xs text-muted">No other users yet.</p>}
          </div>
        </div>

        <div className="rounded-xl border border-line p-2">
          <Toggle checked={form.passcode} onChange={(v) => setForm({ ...form, passcode: v })} label="Require passcode" description="A 6-digit code is generated for you." />
          <Toggle checked={form.waitingRoom} onChange={(v) => setForm({ ...form, waitingRoom: v })} label="Enable waiting room" description="Placeholder in this build." />
          <Toggle checked={form.muteOnEntry} onChange={(v) => setForm({ ...form, muteOnEntry: v })} label="Mute participants on entry" />
          <Toggle checked={form.autoRecord} onChange={(v) => setForm({ ...form, autoRecord: v })} label="Record automatically" description="Starts the AI notetaker when the meeting begins." />
        </div>

        {error && <p className="rounded-lg bg-zoom-red/10 px-3 py-2 text-xs font-medium text-zoom-red">{error}</p>}
      </form>
    </Modal>
  );
}
