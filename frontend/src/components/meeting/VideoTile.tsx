"use client";

import { useEffect, useRef, useState } from "react";

import { Avatar } from "@/components/ui/Avatar";
import { Icon } from "@/components/ui/Icon";

/**
 * Lights the tile border while someone is actually talking, which is how Zoom
 * shows the active speaker. Measured locally from the stream's audio track.
 */
function useSpeaking(stream: MediaStream | null, muted: boolean): boolean {
  const [speaking, setSpeaking] = useState(false);

  useEffect(() => {
    if (!stream || muted || stream.getAudioTracks().length === 0) {
      setSpeaking(false);
      return;
    }
    let raf = 0;
    let context: AudioContext | null = null;
    try {
      context = new AudioContext();
      const source = context.createMediaStreamSource(stream);
      const analyser = context.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);

      const tick = () => {
        analyser.getByteTimeDomainData(data);
        let peak = 0;
        for (const value of data) peak = Math.max(peak, Math.abs(value - 128));
        setSpeaking(peak > 12);
        raf = window.requestAnimationFrame(tick);
      };
      tick();
    } catch {
      setSpeaking(false);
    }
    return () => {
      window.cancelAnimationFrame(raf);
      void context?.close();
    };
  }, [stream, muted]);

  return speaking;
}

export function VideoTile({
  stream,
  name,
  color,
  isSelf = false,
  isMuted,
  isVideoOn,
  isHandRaised,
  isSharing,
  role,
  mirror = true,
  className = "",
  spotlight = false,
}: {
  stream: MediaStream | null;
  name: string;
  color: string;
  isSelf?: boolean;
  isMuted: boolean;
  isVideoOn: boolean;
  isHandRaised: boolean;
  isSharing: boolean;
  role: string;
  mirror?: boolean;
  className?: string;
  spotlight?: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const speaking = useSpeaking(stream, isMuted);

  useEffect(() => {
    const element = videoRef.current;
    if (!element || element.srcObject === stream) return;
    element.srcObject = stream;
    // A stream attached after mount does not always resume on its own, and a
    // paused remote tile is silent as well as still. Autoplay is permitted here
    // because joining the call was a user gesture.
    if (stream) void element.play().catch(() => undefined);
  }, [stream]);

  return (
    <div
      className={`group relative overflow-hidden rounded-xl bg-ink-850 transition ${
        speaking ? "ring-2 ring-zoom-green" : "ring-1 ring-white/5"
      } ${className}`}
    >
      <video
        ref={videoRef}
        autoPlay
        playsInline
        // Never play your own audio back — that is what causes echo.
        muted={isSelf}
        className={`h-full w-full object-cover ${isVideoOn ? "" : "invisible"} ${
          mirror && isSelf && !isSharing ? "-scale-x-100" : ""
        }`}
      />

      {!isVideoOn && (
        <div className="absolute inset-0 grid place-items-center bg-ink-850">
          <Avatar name={name} color={color} size={spotlight ? "xl" : "lg"} />
        </div>
      )}

      {isHandRaised && (
        <span className="absolute left-2 top-2 grid h-8 w-8 place-items-center rounded-lg bg-amber-400 text-ink-900">
          <Icon name="hand" size={16} />
        </span>
      )}

      {isSharing && (
        <span className="absolute right-2 top-2 flex items-center gap-1 rounded-md bg-zoom-green px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-white">
          <Icon name="screen" size={12} /> Presenting
        </span>
      )}

      <div className="absolute bottom-0 left-0 right-0 flex items-center gap-1.5 bg-gradient-to-t from-black/70 to-transparent px-2.5 py-2">
        <span className={isMuted ? "text-zoom-red" : "text-white/90"}>
          <Icon name={isMuted ? "mic-off" : "mic"} size={14} />
        </span>
        <span className="truncate text-xs font-medium text-white">
          {name}
          {isSelf && " (you)"}
        </span>
        {role !== "participant" && (
          <span className="rounded bg-white/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-white/90">
            {role}
          </span>
        )}
      </div>
    </div>
  );
}
