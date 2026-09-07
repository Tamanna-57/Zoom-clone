"use client";

import { useState } from "react";

import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { Field, Toggle, inputClass } from "@/components/ui/Field";
import { Icon, type IconName } from "@/components/ui/Icon";
import { useAuth } from "@/lib/auth";
import { api } from "@/lib/api";
import { formatMeetingId } from "@/lib/format";
import { useTheme } from "@/lib/theme";
import { useToast } from "@/lib/toast";

const SECTIONS = [
  { id: "profile", label: "Profile", icon: "settings" },
  { id: "appearance", label: "Appearance", icon: "sun" },
  { id: "audio-video", label: "Audio & Video", icon: "video" },
  { id: "notifications", label: "Notifications", icon: "bell" },
  { id: "privacy", label: "Privacy & Security", icon: "shield" },
  { id: "devices", label: "Linked devices", icon: "monitor" },
] as const;

type SectionId = (typeof SECTIONS)[number]["id"];

const PALETTE = ["#2D8CFF", "#0E71EB", "#F97316", "#8B5CF6", "#10B981", "#EF4444", "#EC4899", "#14B8A6"];

export default function SettingsPage() {
  const { user, setUser } = useAuth();
  const { theme, setTheme } = useTheme();
  const { notify } = useToast();

  const [section, setSection] = useState<SectionId>("profile");
  const [name, setName] = useState(user?.display_name ?? "");
  const [title, setTitle] = useState(user?.job_title ?? "");
  const [color, setColor] = useState(user?.avatar_color ?? PALETTE[0]);
  const [saving, setSaving] = useState(false);

  // Local-only preferences: this build has no server-side settings store.
  const [prefs, setPrefs] = useState({
    muteOnJoin: true,
    videoOnJoin: true,
    mirror: true,
    hd: false,
    chatSound: true,
    joinSound: true,
    desktopAlerts: false,
    autoTranscribe: true,
    shareRecaps: true,
  });

  async function saveProfile() {
    setSaving(true);
    try {
      const updated = await api.updateProfile({ display_name: name.trim(), job_title: title.trim(), avatar_color: color });
      setUser(updated);
      notify({ kind: "success", title: "Profile updated" });
    } catch (caught) {
      notify({ kind: "error", title: "Could not save", detail: caught instanceof Error ? caught.message : undefined });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto grid max-w-4xl gap-6 md:grid-cols-[220px_1fr]">
      <aside>
        <h1 className="mb-3 text-xl font-bold text-body">Settings</h1>
        <nav className="space-y-1">
          {SECTIONS.map((item) => (
            <button
              key={item.id}
              onClick={() => setSection(item.id)}
              className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition ${
                section === item.id ? "bg-zoom-blue text-white" : "text-muted hover:bg-surface-3 hover:text-body"
              }`}
            >
              <Icon name={item.icon as IconName} size={16} />
              {item.label}
            </button>
          ))}
        </nav>
      </aside>

      <section className="rounded-2xl border border-line bg-surface p-6">
        {section === "profile" && (
          <div className="space-y-5">
            <div className="flex items-center gap-4">
              <Avatar name={name || "?"} color={color} size="lg" />
              <div>
                <p className="text-sm font-semibold text-body">{user?.email}</p>
                <p className="text-xs text-muted">Personal Meeting ID · {formatMeetingId(user?.personal_meeting_id ?? "")}</p>
              </div>
            </div>

            <Field label="Display name">
              <input value={name} onChange={(event) => setName(event.target.value)} className={inputClass} />
            </Field>
            <Field label="Job title">
              <input value={title} onChange={(event) => setTitle(event.target.value)} className={inputClass} placeholder="Product Engineer" />
            </Field>

            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Avatar colour</p>
              <div className="flex flex-wrap gap-2">
                {PALETTE.map((value) => (
                  <button
                    key={value}
                    onClick={() => setColor(value)}
                    aria-label={`Use ${value}`}
                    className={`h-9 w-9 rounded-full transition ${color === value ? "ring-2 ring-zoom-blue ring-offset-2 ring-offset-surface" : ""}`}
                    style={{ backgroundColor: value }}
                  />
                ))}
              </div>
            </div>

            <Button onClick={saveProfile} disabled={saving}>Save changes</Button>
          </div>
        )}

        {section === "appearance" && (
          <div className="space-y-4">
            <p className="text-sm font-semibold text-body">Theme</p>
            <div className="grid grid-cols-2 gap-3">
              {(["light", "dark"] as const).map((option) => (
                <button
                  key={option}
                  onClick={() => setTheme(option)}
                  className={`rounded-xl border p-4 text-left transition ${
                    theme === option ? "border-zoom-blue ring-2 ring-zoom-blue/20" : "border-line hover:bg-surface-2"
                  }`}
                >
                  <span className={`mb-3 block h-16 rounded-lg ${option === "light" ? "bg-[#f4f6f9]" : "bg-ink-850"}`} />
                  <span className="flex items-center gap-2 text-sm font-medium capitalize text-body">
                    <Icon name={option === "light" ? "sun" : "moon"} size={15} /> {option}
                  </span>
                </button>
              ))}
            </div>
            <p className="text-xs text-muted">Meetings always use the dark theme, exactly like the Zoom client.</p>
          </div>
        )}

        {section === "audio-video" && (
          <div className="space-y-1">
            <p className="mb-3 text-sm font-semibold text-body">Meeting defaults</p>
            <Toggle checked={prefs.muteOnJoin} onChange={(v) => setPrefs({ ...prefs, muteOnJoin: v })} label="Mute my microphone when joining" />
            <Toggle checked={prefs.videoOnJoin} onChange={(v) => setPrefs({ ...prefs, videoOnJoin: v })} label="Turn on my video when joining" />
            <Toggle checked={prefs.mirror} onChange={(v) => setPrefs({ ...prefs, mirror: v })} label="Mirror my video" />
            <Toggle checked={prefs.hd} onChange={(v) => setPrefs({ ...prefs, hd: v })} label="Enable HD" description="Placeholder — this build streams at the camera's default resolution." />
            <p className="mt-4 rounded-lg bg-surface-2 px-3 py-2 text-xs text-muted">
              Device pickers live on the pre-join screen; these toggles are stored in this browser only.
            </p>
          </div>
        )}

        {section === "notifications" && (
          <div className="space-y-1">
            <Toggle checked={prefs.chatSound} onChange={(v) => setPrefs({ ...prefs, chatSound: v })} label="Play a sound for new chat messages" />
            <Toggle checked={prefs.joinSound} onChange={(v) => setPrefs({ ...prefs, joinSound: v })} label="Play a sound when someone joins" />
            <Toggle checked={prefs.desktopAlerts} onChange={(v) => setPrefs({ ...prefs, desktopAlerts: v })} label="Desktop alerts" description="Coming soon." />
          </div>
        )}

        {section === "privacy" && (
          <div className="space-y-4">
            <div className="rounded-xl border border-line bg-surface-2 p-4">
              <p className="flex items-center gap-2 text-sm font-semibold text-body">
                <Icon name="lock" size={15} /> Encryption
              </p>
              <p className="mt-1 text-xs leading-relaxed text-muted">
                Media travels directly between browsers over DTLS-SRTP, which WebRTC encrypts by default.
                End-to-end encrypted meetings with per-meeting keys are simulated in this build, not implemented.
              </p>
            </div>
            <Toggle checked={prefs.autoTranscribe} onChange={(v) => setPrefs({ ...prefs, autoTranscribe: v })} label="Let the AI notetaker transcribe my speech" />
            <Toggle checked={prefs.shareRecaps} onChange={(v) => setPrefs({ ...prefs, shareRecaps: v })} label="Allow recap links to be shared outside the meeting" />
          </div>
        )}

        {section === "devices" && (
          <ComingSoon
            icon="monitor"
            title="Linked devices"
            detail="Signing in on a phone or tablet and moving a call between devices is not part of this build."
          />
        )}
      </section>
    </div>
  );
}

export function ComingSoon({ icon, title, detail }: { icon: IconName; title: string; detail: string }) {
  return (
    <div className="grid place-items-center py-14 text-center">
      <span className="grid h-14 w-14 place-items-center rounded-2xl bg-surface-3 text-muted">
        <Icon name={icon} size={24} />
      </span>
      <p className="mt-4 text-sm font-semibold text-body">{title}</p>
      <p className="mt-1 max-w-xs text-xs text-muted">{detail}</p>
      <span className="mt-4 rounded-full bg-zoom-blue-soft px-3 py-1 text-[11px] font-bold uppercase tracking-wide text-zoom-blue">
        Coming soon
      </span>
    </div>
  );
}
