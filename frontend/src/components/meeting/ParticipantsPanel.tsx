"use client";

import { useState } from "react";

import { Avatar } from "@/components/ui/Avatar";
import { Icon } from "@/components/ui/Icon";
import type { PeerInfo, WaitingParticipant } from "@/lib/types";

import { SidePanel } from "./SidePanel";

export function ParticipantsPanel({
  peers,
  self,
  isHost,
  invited,
  waiting,
  onClose,
  onMute,
  onRemove,
  onCohost,
  onAdmit,
  onDeny,
  onInvite,
  onAdmitAll,
  waitingRoomOn,
  onToggleWaitingRoom,
}: {
  peers: PeerInfo[];
  self: PeerInfo | null;
  isHost: boolean;
  invited: { id: number; name: string; color: string }[];
  /** People the waiting room is holding. Only ever populated for a host. */
  waiting: WaitingParticipant[];
  onClose: () => void;
  onMute: (participantId: number) => void;
  onRemove: (participantId: number) => void;
  onCohost: (participantId: number) => void;
  onAdmit: (participantId: number) => void;
  onDeny: (participantId: number) => void;
  onInvite: () => void;
  onAdmitAll: () => void;
  /** Whether the meeting is holding newcomers at all. Host-only control. */
  waitingRoomOn: boolean;
  onToggleWaitingRoom: (on: boolean) => void;
}) {
  const [menu, setMenu] = useState<string | null>(null);
  const everyone = [...(self ? [self] : []), ...peers];
  const onlineUserIds = new Set(everyone.map((peer) => peer.userId));
  const absent = invited.filter((person) => !onlineUserIds.has(person.id));

  return (
    <SidePanel
      title={
        isHost && waiting.length > 0
          ? `Participants (${everyone.length}) · ${waiting.length} waiting`
          : `Participants (${everyone.length})`
      }
      onClose={onClose}
      footer={
        <button
          onClick={onInvite}
          className="flex w-full items-center justify-center gap-2 rounded-lg border border-white/12 py-2.5 text-sm font-semibold text-white transition hover:bg-white/10"
        >
          <Icon name="user-plus" size={16} /> Invite
        </button>
      }
    >
      <div className="px-2 py-2">
        {isHost && (
          <div className="mb-3 rounded-xl border border-amber-400/30 bg-amber-400/8 p-2">
            <div className="flex items-center gap-2 px-1 pb-1.5">
              <p className="flex-1 text-[11px] font-semibold uppercase tracking-wide text-amber-300">
                Waiting room{waiting.length > 0 ? ` (${waiting.length})` : ""}
              </p>
              {waiting.length > 1 && (
                <button
                  onClick={onAdmitAll}
                  className="rounded-lg px-2 py-0.5 text-xs font-semibold text-amber-200 transition hover:bg-white/10"
                >
                  Admit all
                </button>
              )}
              {/* The host can drop the rope mid-meeting, the way Zoom lets them. */}
              <button
                role="switch"
                aria-checked={waitingRoomOn}
                aria-label="Hold newcomers in the waiting room"
                onClick={() => onToggleWaitingRoom(!waitingRoomOn)}
                className={`relative h-5 w-9 shrink-0 rounded-full transition ${
                  waitingRoomOn ? "bg-zoom-blue" : "bg-white/20"
                }`}
              >
                <span
                  className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${
                    waitingRoomOn ? "left-[18px]" : "left-0.5"
                  }`}
                />
              </button>
            </div>
            {waiting.length === 0 && (
              <p className="px-1 pb-1 text-xs text-ink-300">
                {waitingRoomOn ? "No one is waiting." : "Off — guests join straight away."}
              </p>
            )}
            {waiting.map((person) => (
              <div key={person.participant_id} className="flex items-center gap-2 rounded-lg px-1 py-1.5">
                <Avatar name={person.display_name} color={person.avatar_color} size="sm" online={false} />
                <span className="min-w-0 flex-1 truncate text-sm text-white">{person.display_name}</span>
                <button
                  onClick={() => onAdmit(person.participant_id)}
                  className="rounded-lg bg-zoom-blue px-2.5 py-1 text-xs font-semibold text-white transition hover:brightness-110"
                >
                  Admit
                </button>
                <button
                  onClick={() => onDeny(person.participant_id)}
                  className="rounded-lg px-2 py-1 text-xs font-semibold text-ink-300 transition hover:bg-white/10 hover:text-white"
                >
                  Deny
                </button>
              </div>
            ))}
          </div>
        )}

        {everyone.map((peer) => {
          const isSelf = peer.connectionId === self?.connectionId;
          return (
            <div key={peer.connectionId} className="relative flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-white/6">
              <Avatar name={peer.displayName} color={peer.avatarColor} size="sm" online />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5">
                  <span className="truncate text-sm text-white">
                    {peer.displayName}
                    {isSelf && " (you)"}
                  </span>
                  {peer.role !== "participant" && (
                    <span className="rounded bg-white/12 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-ink-300">
                      {peer.role}
                    </span>
                  )}
                </span>
              </span>

              {peer.isHandRaised && <Icon name="hand" size={15} className="text-amber-400" />}
              {peer.isSharing && <Icon name="screen" size={15} className="text-zoom-green" />}
              <Icon name={peer.isMuted ? "mic-off" : "mic"} size={15} className={peer.isMuted ? "text-zoom-red" : "text-ink-300"} />
              <Icon name={peer.isVideoOn ? "video" : "video-off"} size={15} className={peer.isVideoOn ? "text-ink-300" : "text-zoom-red"} />

              {isHost && !isSelf && (
                <button
                  onClick={() => setMenu(menu === peer.connectionId ? null : peer.connectionId)}
                  className="rounded p-1 text-ink-300 transition hover:bg-white/10 hover:text-white"
                  aria-label={`Manage ${peer.displayName}`}
                >
                  <Icon name="more" size={15} />
                </button>
              )}

              {menu === peer.connectionId && (
                <div className="animate-slide-in absolute right-2 top-10 z-20 w-44 rounded-xl border border-white/10 bg-ink-800 p-1.5 text-sm shadow-2xl">
                  <button onClick={() => { onMute(peer.participantId); setMenu(null); }} className="w-full rounded-lg px-3 py-2 text-left text-white transition hover:bg-white/10">
                    Mute
                  </button>
                  <button onClick={() => { onCohost(peer.participantId); setMenu(null); }} className="w-full rounded-lg px-3 py-2 text-left text-white transition hover:bg-white/10">
                    {peer.role === "cohost" ? "Remove co-host" : "Make co-host"}
                  </button>
                  <button onClick={() => { onRemove(peer.participantId); setMenu(null); }} className="w-full rounded-lg px-3 py-2 text-left text-zoom-red transition hover:bg-zoom-red/15">
                    Remove
                  </button>
                </div>
              )}
            </div>
          );
        })}

        {absent.length > 0 && (
          <>
            <p className="mt-4 px-2 text-[11px] font-semibold uppercase tracking-wide text-ink-300">Invited · not here</p>
            {absent.map((person) => (
              <div key={person.id} className="flex items-center gap-3 rounded-lg px-2 py-2 opacity-60">
                <Avatar name={person.name} color={person.color} size="sm" online={false} />
                <span className="truncate text-sm text-white">{person.name}</span>
              </div>
            ))}
          </>
        )}
      </div>
    </SidePanel>
  );
}
