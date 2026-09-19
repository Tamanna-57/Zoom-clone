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
  streamRevision,
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
  isPinned = false,
  isSpotlit = false,
  onTogglePin,
  onToggleSpotlight,
}: {
  stream: MediaStream | null;
  /** Bumped as tracks land, so a stream that gained audio re-attaches. */
  streamRevision?: number;
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
  /** Renders this tile as the stage (bigger avatar), not "is spotlit". */
  spotlight?: boolean;
  /** Pinned by this viewer, for this viewer only. */
  isPinned?: boolean;
  /** Spotlit by the host, so everyone is looking at it. */
  isSpotlit?: boolean;
  onTogglePin?: () => void;
  onToggleSpotlight?: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const speaking = useSpeaking(stream, isMuted);
  const [blocked, setBlocked] = useState(false);

  useEffect(() => {
    const element = videoRef.current;
    if (!element) return;
    // Re-attach on a changed track count as well as a changed stream: Safari
    // does not render a track that was added after srcObject was assigned, so
    // "same object, now with audio" still has to be re-attached.
    element.srcObject = stream;
    if (!stream) return;

    // A stream attached after mount does not always resume on its own, and a
    // paused remote tile is silent as well as still. Safari additionally refuses
    // to autoplay audible media, so fall back to a muted start (which it does
    // allow) and offer the viewer one click to turn the sound on, rather than
    // showing a frozen tile with no explanation.
    let cancelled = false;
    element.play().catch(() => {
      if (cancelled || isSelf) return;
      element.muted = true;
      element.play().then(
        () => !cancelled && setBlocked(true),
        () => undefined,
      );
    });
    return () => {
      cancelled = true;
    };
  }, [stream, streamRevision, isSelf]);

  function unblockAudio() {
    const element = videoRef.current;
    if (!element) return;
    element.muted = false;
    void element.play().catch(() => undefined);
    setBlocked(false);
  }

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

      {blocked && (
        <button
          onClick={unblockAudio}
          className="absolute inset-x-0 top-0 z-10 bg-zoom-blue/90 px-2 py-1.5 text-[11px] font-semibold text-white"
        >
          Tap to turn on sound
        </button>
      )}

      {(onTogglePin || onToggleSpotlight) && (
        <div className="absolute right-2 top-2 z-10 flex gap-1 opacity-0 transition group-hover:opacity-100 focus-within:opacity-100">
          {onToggleSpotlight && (
            <button
              onClick={onToggleSpotlight}
              title={isSpotlit ? "Remove spotlight" : "Spotlight for everyone"}
              aria-label={isSpotlit ? "Remove spotlight" : "Spotlight for everyone"}
              className={`grid h-7 w-7 place-items-center rounded-md backdrop-blur transition ${
                isSpotlit ? "bg-amber-400 text-ink-900" : "bg-black/60 text-white hover:bg-black/80"
              }`}
            >
              <Icon name="spotlight" size={14} />
            </button>
          )}
          {onTogglePin && (
            <button
              onClick={onTogglePin}
              title={isPinned ? "Unpin" : "Pin for me"}
              aria-label={isPinned ? "Unpin" : "Pin for me"}
              className={`grid h-7 w-7 place-items-center rounded-md backdrop-blur transition ${
                isPinned ? "bg-zoom-blue text-white" : "bg-black/60 text-white hover:bg-black/80"
              }`}
            >
              <Icon name="pin" size={14} />
            </button>
          )}
        </div>
      )}

      {/* Why this tile is on the stage, so it never looks arbitrary. */}
      {(isSpotlit || isPinned) && (
        <span
          className={`absolute left-2 top-2 z-10 flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
            isSpotlit ? "bg-amber-400 text-ink-900" : "bg-zoom-blue text-white"
          } ${isHandRaised ? "translate-x-10" : ""}`}
        >
          <Icon name={isSpotlit ? "spotlight" : "pin"} size={11} />
          {isSpotlit ? "Spotlight" : "Pinned"}
        </span>
      )}

      {isHandRaised && (
        <span className="absolute left-2 top-2 grid h-8 w-8 place-items-center rounded-lg bg-amber-400 text-ink-900">
          <Icon name="hand" size={16} />
        </span>
      )}

      {isSharing && (
        <span className="absolute right-2 top-11 flex items-center gap-1 rounded-md bg-zoom-green px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-white">
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
