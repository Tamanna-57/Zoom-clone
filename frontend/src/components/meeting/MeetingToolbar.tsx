"use client";

import { useEffect, useRef, useState } from "react";

import { Icon, type IconName } from "@/components/ui/Icon";

const REACTIONS = ["👍", "👏", "❤️", "😂", "😮", "🎉", "🙌", "☕"];

function ToolButton({
  icon,
  label,
  active,
  danger,
  badge,
  onClick,
  disabled,
  caret,
}: {
  icon: IconName;
  label: string;
  active?: boolean;
  danger?: boolean;
  badge?: number;
  onClick?: () => void;
  disabled?: boolean;
  caret?: React.ReactNode;
}) {
  return (
    <div className="relative flex flex-col items-center">
      <button
        onClick={onClick}
        disabled={disabled}
        title={label}
        aria-label={label}
        className={`flex h-[52px] w-[68px] flex-col items-center justify-center gap-1 rounded-lg text-[11px] font-medium transition disabled:opacity-40 ${
          danger
            ? "text-zoom-red hover:bg-zoom-red/15"
            : active
              ? "bg-white/12 text-white"
              : "text-ink-300 hover:bg-white/10 hover:text-white"
        }`}
      >
        <span className="relative">
          <Icon name={icon} size={20} />
          {badge ? (
            <span className="absolute -right-2.5 -top-1.5 grid h-4 min-w-4 place-items-center rounded-full bg-zoom-red px-1 text-[9px] font-bold text-white">
              {badge > 9 ? "9+" : badge}
            </span>
          ) : null}
        </span>
        {label}
      </button>
      {caret}
    </div>
  );
}

export function MeetingToolbar({
  isMuted,
  isVideoOn,
  isSharing,
  isRecording,
  isHandRaised,
  captionsOn,
  captionsSupported,
  chatUnread,
  participantCount,
  panel,
  isHost,
  onToggleMute,
  onToggleVideo,
  onToggleShare,
  onToggleRecording,
  onToggleHand,
  onToggleCaptions,
  onReaction,
  onOpenPanel,
  onLeave,
  onEnd,
  onComingSoon,
}: {
  isMuted: boolean;
  isVideoOn: boolean;
  isSharing: boolean;
  isRecording: boolean;
  isHandRaised: boolean;
  captionsOn: boolean;
  captionsSupported: boolean;
  chatUnread: number;
  participantCount: number;
  panel: string | null;
  isHost: boolean;
  onToggleMute: () => void;
  onToggleVideo: () => void;
  onToggleShare: () => void;
  onToggleRecording: () => void;
  onToggleHand: () => void;
  onToggleCaptions: () => void;
  onReaction: (emoji: string) => void;
  onOpenPanel: (panel: "chat" | "people" | "notes") => void;
  onLeave: () => void;
  onEnd: () => void;
  onComingSoon: (feature: string) => void;
}) {
  const [reactionsOpen, setReactionsOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const barRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (barRef.current && !barRef.current.contains(event.target as Node)) {
        setReactionsOpen(false);
        setMoreOpen(false);
        setLeaveOpen(false);
      }
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  return (
    <div ref={barRef} className="relative flex items-center justify-center gap-1 border-t border-white/5 bg-ink-900 px-3 py-2">
      <div className="flex items-center gap-1">
        <ToolButton icon={isMuted ? "mic-off" : "mic"} label={isMuted ? "Unmute" : "Mute"} danger={isMuted} onClick={onToggleMute} />
        <ToolButton icon={isVideoOn ? "video" : "video-off"} label={isVideoOn ? "Stop video" : "Start video"} danger={!isVideoOn} onClick={onToggleVideo} />
      </div>

      <span className="mx-2 hidden h-8 w-px bg-white/10 sm:block" />

      <div className="hidden items-center gap-1 sm:flex">
        <ToolButton icon="people" label="Participants" badge={participantCount} active={panel === "people"} onClick={() => onOpenPanel("people")} />
        <ToolButton icon="chat" label="Chat" badge={chatUnread} active={panel === "chat"} onClick={() => onOpenPanel("chat")} />
        <ToolButton icon="screen" label={isSharing ? "Stop share" : "Share"} active={isSharing} onClick={onToggleShare} />
        <ToolButton icon="record" label={isRecording ? "Stop rec" : "Record"} active={isRecording} danger={isRecording} onClick={onToggleRecording} />
        <ToolButton icon="sparkles" label="AI notes" active={panel === "notes"} onClick={() => onOpenPanel("notes")} />

        <div className="relative">
          <ToolButton icon="smile" label="React" active={reactionsOpen} onClick={() => setReactionsOpen((open) => !open)} />
          {reactionsOpen && (
            <div className="animate-slide-in absolute bottom-16 left-1/2 flex -translate-x-1/2 gap-1 rounded-2xl border border-white/10 bg-ink-800 p-2 shadow-2xl">
              {REACTIONS.map((emoji) => (
                <button
                  key={emoji}
                  onClick={() => {
                    onReaction(emoji);
                    setReactionsOpen(false);
                  }}
                  className="grid h-10 w-10 place-items-center rounded-xl text-xl transition hover:scale-110 hover:bg-white/10"
                >
                  {emoji}
                </button>
              ))}
              <span className="mx-1 w-px bg-white/10" />
              <button
                onClick={() => {
                  onToggleHand();
                  setReactionsOpen(false);
                }}
                className={`grid h-10 w-10 place-items-center rounded-xl transition hover:bg-white/10 ${isHandRaised ? "text-amber-400" : "text-white"}`}
                title={isHandRaised ? "Lower hand" : "Raise hand"}
              >
                <Icon name="hand" size={18} />
              </button>
            </div>
          )}
        </div>

        <div className="relative">
          <ToolButton icon="more" label="More" active={moreOpen} onClick={() => setMoreOpen((open) => !open)} />
          {moreOpen && (
            <div className="animate-slide-in absolute bottom-16 right-0 w-60 rounded-xl border border-white/10 bg-ink-800 p-1.5 text-sm text-white shadow-2xl">
              <button
                onClick={() => {
                  onToggleCaptions();
                  setMoreOpen(false);
                }}
                disabled={!captionsSupported}
                className="flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 transition hover:bg-white/10 disabled:opacity-40"
              >
                <span className="flex items-center gap-2.5">
                  <Icon name="list" size={15} /> Live captions
                </span>
                <span className="text-[10px] uppercase text-ink-300">{captionsSupported ? (captionsOn ? "On" : "Off") : "N/A"}</span>
              </button>
              {["Breakout Rooms", "Whiteboard", "Polls", "Virtual background", "Live streaming"].map((feature) => (
                <button
                  key={feature}
                  onClick={() => {
                    onComingSoon(feature);
                    setMoreOpen(false);
                  }}
                  className="flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 transition hover:bg-white/10"
                >
                  <span className="flex items-center gap-2.5">
                    <Icon name="grid" size={15} /> {feature}
                  </span>
                  <span className="rounded bg-white/10 px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-ink-300">Soon</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="ml-auto flex items-center gap-1 sm:ml-4">
        <div className="relative">
          <button
            onClick={() => setLeaveOpen((open) => !open)}
            className="rounded-lg bg-zoom-red px-4 py-2.5 text-sm font-semibold text-white transition hover:brightness-110"
          >
            Leave
          </button>
          {leaveOpen && (
            <div className="animate-slide-in absolute bottom-14 right-0 w-52 rounded-xl border border-white/10 bg-ink-800 p-1.5 shadow-2xl">
              {isHost && (
                <button onClick={onEnd} className="w-full rounded-lg px-3 py-2 text-left text-sm font-semibold text-zoom-red transition hover:bg-zoom-red/15">
                  End meeting for all
                </button>
              )}
              <button onClick={onLeave} className="w-full rounded-lg px-3 py-2 text-left text-sm text-white transition hover:bg-white/10">
                Leave meeting
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
