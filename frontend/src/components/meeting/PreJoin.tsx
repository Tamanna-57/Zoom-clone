"use client";

import { useEffect, useRef, useState } from "react";

import { Avatar } from "@/components/ui/Avatar";
import { Icon } from "@/components/ui/Icon";
import { Spinner } from "@/components/ui/Spinner";
import { formatMeetingId } from "@/lib/format";
import type { Meeting } from "@/lib/types";

/** Zoom's "Join with video?" screen: camera preview, device toggles, passcode. */
export function PreJoin({
  meeting,
  code,
  displayName,
  avatarColor,
  stream,
  mediaError,
  micOn,
  cameraOn,
  needsPasscode,
  passcode,
  joining,
  error,
  onToggleMic,
  onToggleCamera,
  onPasscodeChange,
  onJoin,
  onCancel,
}: {
  meeting: Meeting | null;
  code: string;
  displayName: string;
  avatarColor: string;
  stream: MediaStream | null;
  mediaError?: string;
  micOn: boolean;
  cameraOn: boolean;
  needsPasscode: boolean;
  passcode: string;
  joining: boolean;
  error: string;
  onToggleMic: () => void;
  onToggleCamera: () => void;
  onPasscodeChange: (value: string) => void;
  onJoin: () => void;
  onCancel: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);

  useEffect(() => {
    if (videoRef.current) videoRef.current.srcObject = stream;
  }, [stream]);

  useEffect(() => {
    navigator.mediaDevices?.enumerateDevices?.().then(setDevices).catch(() => setDevices([]));
  }, [stream]);

  const cameras = devices.filter((device) => device.kind === "videoinput");
  const mics = devices.filter((device) => device.kind === "audioinput");

  return (
    <div className="grid min-h-screen place-items-center bg-ink-950 px-4 py-8 text-white">
      <div className="w-full max-w-4xl">
        <button onClick={onCancel} className="mb-4 flex items-center gap-2 text-sm text-ink-300 transition hover:text-white">
          <Icon name="arrow-left" size={16} /> Back
        </button>

        <div className="grid gap-6 rounded-2xl border border-white/8 bg-ink-900 p-6 md:grid-cols-[1.3fr_1fr]">
          <div>
            <div className="relative aspect-video overflow-hidden rounded-xl bg-ink-850">
              <video ref={videoRef} autoPlay playsInline muted className={`h-full w-full -scale-x-100 object-cover ${cameraOn ? "" : "invisible"}`} />
              {!cameraOn && (
                <div className="absolute inset-0 grid place-items-center">
                  <Avatar name={displayName} color={avatarColor} size="xl" />
                </div>
              )}
              <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 gap-2">
                <button
                  onClick={onToggleMic}
                  className={`grid h-11 w-11 place-items-center rounded-full transition ${micOn ? "bg-white/12 text-white hover:bg-white/20" : "bg-zoom-red text-white"}`}
                  aria-label={micOn ? "Mute microphone" : "Unmute microphone"}
                >
                  <Icon name={micOn ? "mic" : "mic-off"} size={19} />
                </button>
                <button
                  onClick={onToggleCamera}
                  className={`grid h-11 w-11 place-items-center rounded-full transition ${cameraOn ? "bg-white/12 text-white hover:bg-white/20" : "bg-zoom-red text-white"}`}
                  aria-label={cameraOn ? "Stop video" : "Start video"}
                >
                  <Icon name={cameraOn ? "video" : "video-off"} size={19} />
                </button>
              </div>
            </div>

            {mediaError && (
              <p className="mt-3 flex items-start gap-2 rounded-lg bg-amber-400/10 px-3 py-2 text-xs text-amber-300">
                <Icon name="info" size={14} className="mt-0.5 shrink-0" /> {mediaError}
              </p>
            )}

            <div className="mt-3 grid gap-2 text-xs text-ink-300 sm:grid-cols-2">
              <div className="flex items-center gap-2 truncate rounded-lg border border-white/8 px-3 py-2">
                <Icon name="video" size={14} />
                <span className="truncate">{cameras[0]?.label || "Default camera"}</span>
              </div>
              <div className="flex items-center gap-2 truncate rounded-lg border border-white/8 px-3 py-2">
                <Icon name="mic" size={14} />
                <span className="truncate">{mics[0]?.label || "Default microphone"}</span>
              </div>
            </div>
          </div>

          <div className="flex flex-col">
            <p className="text-xs uppercase tracking-wide text-ink-300">You&apos;re about to join</p>
            <h1 className="mt-1 text-2xl font-bold">{meeting?.topic ?? "Zoomeet Meeting"}</h1>
            <p className="mt-1 font-mono text-sm text-ink-300">{formatMeetingId(code)}</p>

            {meeting && (
              <div className="mt-4 flex items-center gap-2 text-sm text-ink-300">
                <Avatar name={meeting.host.display_name} color={meeting.host.avatar_color} size="sm" />
                <span>Hosted by {meeting.host.display_name}</span>
              </div>
            )}

            {meeting?.agenda && (
              <p className="mt-4 rounded-lg border border-white/8 bg-white/4 p-3 text-xs leading-relaxed text-ink-300">
                {meeting.agenda}
              </p>
            )}

            {needsPasscode && (
              <label className="mt-4 block">
                <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-ink-300">Passcode</span>
                <input
                  value={passcode}
                  onChange={(event) => onPasscodeChange(event.target.value.replace(/\D/g, ""))}
                  maxLength={6}
                  inputMode="numeric"
                  placeholder="••••••"
                  className="w-full rounded-lg border border-white/10 bg-ink-800 px-3 py-2.5 text-center text-lg tracking-[0.4em] text-white outline-none focus:border-zoom-blue"
                />
              </label>
            )}

            {error && <p className="mt-3 rounded-lg bg-zoom-red/15 px-3 py-2 text-xs font-medium text-zoom-red">{error}</p>}

            <button
              onClick={onJoin}
              disabled={joining}
              className="mt-auto flex w-full items-center justify-center gap-2 rounded-xl bg-zoom-blue py-3 text-sm font-semibold text-white transition hover:bg-zoom-blue-dark disabled:opacity-60"
            >
              {joining ? <Spinner /> : <Icon name="video" size={17} />} Join now
            </button>

            <p className="mt-3 text-center text-[11px] leading-relaxed text-ink-300">
              By joining you agree that this meeting may be recorded and transcribed by the AI notetaker.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
