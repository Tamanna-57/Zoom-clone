"use client";

import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { AiNotesPanel } from "@/components/meeting/AiNotesPanel";
import { ChatPanel } from "@/components/meeting/ChatPanel";
import { MeetingToolbar } from "@/components/meeting/MeetingToolbar";
import { ParticipantsPanel } from "@/components/meeting/ParticipantsPanel";
import { PollsPanel } from "@/components/meeting/PollsPanel";
import { PreJoin } from "@/components/meeting/PreJoin";
import { SidePanel } from "@/components/meeting/SidePanel";
import { VideoTile } from "@/components/meeting/VideoTile";
import { Whiteboard } from "@/components/meeting/Whiteboard";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { Modal } from "@/components/ui/Modal";
import { FullPageSpinner } from "@/components/ui/Spinner";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatDuration, formatMeetingId } from "@/lib/format";
import { getLocalMedia } from "@/lib/media";
import { useSpeechTranscription } from "@/lib/speech";
import { useToast } from "@/lib/toast";
import { useMeetingRoom } from "@/lib/useMeetingRoom";
import type { JoinResponse, Meeting } from "@/lib/types";

type Phase = "loading" | "prejoin" | "live" | "over";
type Panel = "chat" | "people" | "notes" | "whiteboard" | "polls" | null;

/** One video square: the local camera or one remote peer. */
interface Tile {
  id: string;
  stream: MediaStream | null;
  name: string;
  color: string;
  isMuted: boolean;
  isVideoOn: boolean;
  isHandRaised: boolean;
  isSharing: boolean;
  role: string;
}

export default function MeetingPage() {
  const { code } = useParams<{ code: string }>();
  const search = useSearchParams();
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const { notify } = useToast();

  const [phase, setPhase] = useState<Phase>("loading");
  const [meeting, setMeeting] = useState<Meeting | null>(null);
  const [joinData, setJoinData] = useState<JoinResponse | null>(null);
  const [loadError, setLoadError] = useState("");
  const [joinError, setJoinError] = useState("");
  const [joining, setJoining] = useState(false);
  const [passcode, setPasscode] = useState("");
  const [endedBy, setEndedBy] = useState<string | null>(null);

  const [stream, setStream] = useState<MediaStream | null>(null);
  const [mediaError, setMediaError] = useState<string>();
  const [micOn, setMicOn] = useState(search.get("mic") !== "off");
  const [cameraOn, setCameraOn] = useState(search.get("cam") !== "off");
  const [isSharing, setIsSharing] = useState(false);
  const [handRaised, setHandRaised] = useState(false);

  const [panel, setPanel] = useState<Panel>(null);
  const [layout, setLayout] = useState<"gallery" | "speaker">("gallery");
  const [unread, setUnread] = useState(0);
  const [showInfo, setShowInfo] = useState(false);
  const [comingSoon, setComingSoon] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);

  const [recordingId, setRecordingId] = useState<number | null>(null);
  const recordingStartRef = useRef<number>(0);
  const cameraTrackRef = useRef<MediaStreamTrack | null>(null);

  const isHost = Boolean(meeting && user && meeting.host.id === user.id);

  // ---------------------------------------------------------------- bootstrap
  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      router.replace(`/login?next=/meeting/${code}`);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const loaded = await api.meeting(code);
        if (cancelled) return;
        setMeeting(loaded);
        setPhase(loaded.status === "ended" ? "over" : "prejoin");
        if (loaded.status === "ended") setEndedBy(loaded.host.display_name);
      } catch (caught) {
        if (!cancelled) {
          setLoadError(caught instanceof Error ? caught.message : "Meeting not found");
          setPhase("over");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [code, user, authLoading, router]);

  useEffect(() => {
    let active = true;
    let acquired: MediaStream | null = null;
    (async () => {
      const media = await getLocalMedia(true, true);
      if (!active) {
        media.stream.getTracks().forEach((track) => track.stop());
        return;
      }
      acquired = media.stream;
      cameraTrackRef.current = media.stream.getVideoTracks()[0] ?? null;
      media.stream.getAudioTracks().forEach((track) => (track.enabled = micOn));
      media.stream.getVideoTracks().forEach((track) => (track.enabled = cameraOn));
      setStream(media.stream);
      setMediaError(media.error);
    })();
    return () => {
      active = false;
      acquired?.getTracks().forEach((track) => track.stop());
    };
    // Device acquisition happens once; toggles below flip `enabled` instead.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ------------------------------------------------------------- realtime room
  const handleMeetingEnded = useCallback(
    (by: string) => {
      setEndedBy(by);
      setPhase("over");
    },
    [],
  );

  const handleRecordingChanged = useCallback(
    (state: "started" | "ready", id: number, by: string) => {
      if (state === "started") {
        setRecordingId(id);
        recordingStartRef.current = Date.now();
        notify({ kind: "info", title: "Recording started", detail: `${by} started the AI notetaker.` });
      } else {
        setRecordingId(null);
        notify({ kind: "success", title: "AI recap is ready", detail: "Open AI Notes to read the summary." });
      }
    },
    [notify],
  );

  const handleForceMute = useCallback(
    (by: string) => {
      stream?.getAudioTracks().forEach((track) => (track.enabled = false));
      setMicOn(false);
      notify({ kind: "info", title: "You were muted", detail: `${by} muted you.` });
    },
    [stream, notify],
  );

  const handleRemoved = useCallback(
    (participantId: number, by: string) => {
      if (participantId !== joinData?.participant.id) return;
      notify({ kind: "error", title: "Removed from the meeting", detail: `${by} removed you.` });
      setEndedBy(by);
      setPhase("over");
    },
    [joinData, notify],
  );

  const handleReplaced = useCallback(() => {
    notify({
      kind: "error",
      title: "You joined from somewhere else",
      detail: "This meeting is now open in another tab or device.",
    });
    setEndedBy(null);
    setPhase("over");
  }, [notify]);

  const room = useMeetingRoom({
    code,
    localStream: stream,
    iceServers: joinData?.ice_servers ?? [],
    enabled: phase === "live" && Boolean(stream),
    onMeetingEnded: handleMeetingEnded,
    onRecordingChanged: handleRecordingChanged,
    onForceMute: handleForceMute,
    onRemoved: handleRemoved,
    onReplaced: handleReplaced,
    selfParticipantId: joinData?.participant.id ?? null,
  });

  const { sendTranscript } = room;
  const pushTranscript = useCallback(
    (text: string) => {
      const startMs = recordingStartRef.current ? Date.now() - recordingStartRef.current : 0;
      sendTranscript(text, Math.max(startMs - text.split(" ").length * 400, 0), startMs);
    },
    [sendTranscript],
  );

  const captions = useSpeechTranscription(pushTranscript);

  // The server starts each participant from whatever the meeting's entry policy
  // says, but the pre-join screen is what the user actually chose. Without this
  // the other side renders a camera-on peer as an avatar (or vice versa) and the
  // video element stays hidden even though media is flowing.
  const { connected: roomConnected, sendState } = room;
  useEffect(() => {
    if (!roomConnected) return;
    sendState({ isMuted: !micOn, isVideoOn: cameraOn, isHandRaised: handRaised, isSharing });
  }, [roomConnected, micOn, cameraOn, handRaised, isSharing, sendState]);

  // A muted microphone must not feed the notetaker. The recogniser opens its own
  // capture, so disabling the outgoing track is not enough to silence it.
  const { supported: captionsSupported, enable: enableCaptions, disable: disableCaptions } = captions;
  useEffect(() => {
    if (!captionsSupported || phase !== "live") return;
    if (micOn) enableCaptions();
    else disableCaptions();
  }, [micOn, phase, captionsSupported, enableCaptions, disableCaptions]);

  // Unread badge while the chat panel is closed.
  const lastSeenRef = useRef(0);
  useEffect(() => {
    if (panel === "chat") {
      lastSeenRef.current = room.messages.length;
      setUnread(0);
    } else {
      setUnread(Math.max(room.messages.length - lastSeenRef.current, 0));
    }
  }, [room.messages.length, panel]);

  // Call timer.
  useEffect(() => {
    if (phase !== "live") return;
    const started = Date.now();
    const timer = window.setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, [phase]);

  // A shared screen takes over the stage, exactly like the desktop client.
  const sharingPeer = room.peers.find((peer) => peer.isSharing) ?? null;
  useEffect(() => {
    if (sharingPeer || isSharing) setLayout("speaker");
  }, [sharingPeer, isSharing]);

  // -------------------------------------------------------------------- actions
  async function join() {
    setJoining(true);
    setJoinError("");
    try {
      const response = await api.joinMeeting(code, { passcode: passcode || undefined });
      setJoinData(response);
      setMeeting(response.meeting);
      setPhase("live");

      const history = await api.messages(code).catch(() => []);
      room.seedMessages(history);

      const alreadyRecording = response.meeting.active_recording_id;
      if (alreadyRecording) {
        setRecordingId(alreadyRecording);
        recordingStartRef.current = Date.now();
      } else if (response.meeting.auto_record && response.meeting.host.id === user?.id) {
        await startRecording();
      }
      if (search.get("share") === "1") void toggleShare();
    } catch (caught) {
      setJoinError(caught instanceof Error ? caught.message : "Could not join this meeting");
    } finally {
      setJoining(false);
    }
  }

  async function startRecording() {
    try {
      const recording = await api.startRecording(code);
      setRecordingId(recording.id);
      recordingStartRef.current = Date.now();
    } catch {
      notify({ kind: "error", title: "Could not start recording" });
    }
  }

  async function stopRecording() {
    if (!recordingId) return;
    const id = recordingId;
    setRecordingId(null);
    try {
      await api.stopRecording(id);
      notify({ kind: "success", title: "AI recap generated", detail: "Find it under AI Notes." });
    } catch {
      notify({ kind: "error", title: "Could not finish the recording" });
    }
  }

  function toggleMic() {
    const next = !micOn;
    setMicOn(next);
    stream?.getAudioTracks().forEach((track) => (track.enabled = next));
    room.sendState({ isMuted: !next });
  }

  function toggleCamera() {
    const next = !cameraOn;
    setCameraOn(next);
    stream?.getVideoTracks().forEach((track) => (track.enabled = next));
    room.sendState({ isVideoOn: next });
  }

  function toggleHand() {
    const next = !handRaised;
    setHandRaised(next);
    room.sendState({ isHandRaised: next });
    if (next) notify({ kind: "info", title: "Hand raised" });
  }

  async function toggleShare() {
    if (isSharing) {
      room.replaceVideoTrack(cameraTrackRef.current);
      setIsSharing(false);
      room.sendState({ isSharing: false });
      return;
    }
    try {
      const display = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      const [track] = display.getVideoTracks();
      room.replaceVideoTrack(track);
      setIsSharing(true);
      room.sendState({ isSharing: true });
      // The browser's own "Stop sharing" bar has to put the camera back.
      track.onended = () => {
        room.replaceVideoTrack(cameraTrackRef.current);
        setIsSharing(false);
        room.sendState({ isSharing: false });
      };
    } catch {
      notify({ kind: "error", title: "Screen share was cancelled" });
    }
  }

  async function highlightMoment() {
    if (!recordingId) return;
    const atMs = Date.now() - recordingStartRef.current;
    try {
      await api.addHighlight(recordingId, { at_ms: atMs, label: `Highlighted by ${user?.display_name}` });
      notify({ kind: "success", title: "Moment highlighted", detail: formatDuration(atMs / 1000) });
    } catch {
      notify({ kind: "error", title: "Could not save that highlight" });
    }
  }

  const leave = useCallback(async () => {
    await api.leaveMeeting(code).catch(() => undefined);
    stream?.getTracks().forEach((track) => track.stop());
    router.push("/home");
  }, [code, stream, router]);

  async function endForAll() {
    const finished = recordingId;
    if (finished) await stopRecording();
    await api.endMeeting(code).catch(() => undefined);
    stream?.getTracks().forEach((track) => track.stop());
    // Land on the recap that was just written, which is what a host wants next.
    router.push(finished ? `/recordings/${finished}` : "/home");
  }

  // Zoom's in-meeting shortcuts.
  useEffect(() => {
    if (phase !== "live") return;
    const onKey = (event: KeyboardEvent) => {
      if (!event.altKey || event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
      const key = event.key.toLowerCase();
      if (key === "a") { event.preventDefault(); toggleMic(); }
      if (key === "v") { event.preventDefault(); toggleCamera(); }
      if (key === "s") { event.preventDefault(); void toggleShare(); }
      if (key === "h") { event.preventDefault(); setPanel((current) => (current === "chat" ? null : "chat")); }
      if (key === "u") { event.preventDefault(); setPanel((current) => (current === "people" ? null : "people")); }
      if (key === "y") { event.preventDefault(); toggleHand(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // ---------------------------------------------------------------- rendering
  const selfTile = useMemo<Tile>(
    () => ({
      id: "self",
      stream,
      name: user?.display_name ?? "You",
      color: user?.avatar_color ?? "#2D8CFF",
      isMuted: !micOn,
      isVideoOn: cameraOn || isSharing,
      isHandRaised: handRaised,
      isSharing,
      role: joinData?.participant.role ?? "participant",
    }),
    [stream, user, micOn, cameraOn, handRaised, isSharing, joinData],
  );

  if (phase === "loading" || authLoading) return <FullPageSpinner label="Opening the meeting" />;

  if (phase === "over") {
    return (
      <div className="grid min-h-screen place-items-center bg-ink-950 px-4 text-center text-white">
        <div className="max-w-sm">
          <span className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-white/8">
            <Icon name="hangup" size={28} />
          </span>
          <h1 className="mt-5 text-xl font-bold">{loadError || "This meeting has ended"}</h1>
          <p className="mt-2 text-sm text-ink-300">
            {loadError
              ? "Check the meeting ID and try again."
              : `${endedBy ?? "The host"} ended the meeting. The AI recap is generated automatically.`}
          </p>
          <div className="mt-6 flex justify-center gap-2">
            <Button variant="secondary" onClick={() => router.push("/home")}>Back to home</Button>
            {meeting?.latest_recording_id && (
              <Button onClick={() => router.push(`/recordings/${meeting.latest_recording_id}`)}>
                <Icon name="sparkles" size={15} /> View AI notes
              </Button>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (phase === "prejoin") {
    return (
      <PreJoin
        meeting={meeting}
        code={code}
        displayName={user?.display_name ?? "You"}
        avatarColor={user?.avatar_color ?? "#2D8CFF"}
        stream={stream}
        mediaError={mediaError}
        micOn={micOn}
        cameraOn={cameraOn}
        needsPasscode={Boolean(meeting?.passcode) && meeting?.host.id !== user?.id}
        passcode={passcode}
        joining={joining}
        error={joinError}
        onToggleMic={() => {
          const next = !micOn;
          setMicOn(next);
          stream?.getAudioTracks().forEach((track) => (track.enabled = next));
        }}
        onToggleCamera={() => {
          const next = !cameraOn;
          setCameraOn(next);
          stream?.getVideoTracks().forEach((track) => (track.enabled = next));
        }}
        onPasscodeChange={setPasscode}
        onJoin={() => void join()}
        onCancel={() => router.push("/home")}
      />
    );
  }

  const tiles: Tile[] = [
    selfTile,
    ...room.peers.map((peer) => ({
      id: peer.connectionId,
      stream: peer.stream,
      name: peer.displayName,
      color: peer.avatarColor,
      isMuted: peer.isMuted,
      isVideoOn: peer.isVideoOn,
      isHandRaised: peer.isHandRaised,
      isSharing: peer.isSharing,
      role: peer.role,
    })),
  ];

  // Whoever is presenting owns the stage; otherwise it is the first tile.
  const stageTile = tiles.find((tile) => tile.id === sharingPeer?.connectionId) ?? tiles[0];

  // Zoom keeps every gallery tile at 16:9 and centres the block, rather than
  // stretching tiles to fill the stage.
  const gridColumns =
    tiles.length <= 1 ? "grid-cols-1" : tiles.length <= 4 ? "grid-cols-1 sm:grid-cols-2" : "grid-cols-2 lg:grid-cols-3";
  const tileWidth =
    tiles.length <= 1 ? "max-w-5xl" : tiles.length <= 4 ? "max-w-6xl" : "max-w-7xl";

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-ink-950 text-white">
      <header className="flex items-center gap-3 border-b border-white/5 bg-ink-900 px-4 py-2.5">
        <span className="grid h-8 w-8 place-items-center rounded-lg bg-zoom-blue">
          <Icon name="video" size={16} />
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{meeting?.topic}</p>
          <p className="text-[11px] text-ink-300">
            <span className="font-mono">{formatMeetingId(code)}</span> · {formatDuration(elapsed)}
            {room.connected ? "" : " · reconnecting…"}
          </p>
        </div>

        {recordingId && (
          <span className="ml-2 flex items-center gap-1.5 rounded-full bg-zoom-red/15 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-zoom-red">
            <span className="h-2 w-2 animate-pulse rounded-full bg-zoom-red" /> Rec
          </span>
        )}

        <div className="ml-auto flex items-center gap-1">
          <button
            onClick={() => setLayout(layout === "gallery" ? "speaker" : "gallery")}
            title={layout === "gallery" ? "Switch to speaker view" : "Switch to gallery view"}
            className="rounded-lg p-2 text-ink-300 transition hover:bg-white/10 hover:text-white"
          >
            <Icon name={layout === "gallery" ? "spotlight" : "grid"} size={17} />
          </button>
          <button onClick={() => setShowInfo(true)} title="Meeting information" className="rounded-lg p-2 text-ink-300 transition hover:bg-white/10 hover:text-white">
            <Icon name="info" size={17} />
          </button>
        </div>
      </header>

      <div className="relative flex min-h-0 flex-1">
        <main className="relative min-w-0 flex-1 p-3">
          {layout === "gallery" ? (
            <div className="grid h-full place-content-center">
              <div className={`grid w-full gap-3 ${gridColumns} ${tileWidth}`}>
                {tiles.map((tile) => (
                  <VideoTile key={tile.id} {...tile} isSelf={tile.id === "self"} className="aspect-video" />
                ))}
              </div>
            </div>
          ) : (
            <div className="flex h-full flex-col gap-3">
              <VideoTile {...stageTile} isSelf={stageTile.id === "self"} spotlight className="min-h-0 flex-1" />
              {tiles.length > 1 && (
                <div className="flex h-28 shrink-0 gap-3 overflow-x-auto">
                  {tiles
                    .filter((tile) => tile.id !== stageTile.id)
                    .map((tile) => (
                      <VideoTile
                        key={tile.id}
                        {...tile}
                        isSelf={tile.id === "self"}
                        className="aspect-video h-full shrink-0"
                      />
                    ))}
                </div>
              )}
            </div>
          )}

          {/* Floating reactions, Zoom-style. */}
          <div className="pointer-events-none absolute bottom-4 left-1/2 flex -translate-x-1/2 gap-4">
            {room.reactions.map((reaction) => (
              <span key={reaction.id} className="animate-float-up text-4xl drop-shadow-lg">
                {reaction.emoji}
              </span>
            ))}
          </div>

          {captions.interim && (
            <div className="pointer-events-none absolute bottom-4 left-1/2 max-w-2xl -translate-x-1/2 rounded-lg bg-black/70 px-4 py-2 text-center text-sm">
              {captions.interim}
            </div>
          )}
        </main>

        {panel && (
          <div className="absolute inset-0 z-30 md:static md:z-auto">
            {panel === "chat" && (
              <ChatPanel
                messages={room.messages}
                peers={room.peers}
                selfUserId={user?.id ?? 0}
                onSend={(body, recipientId) => room.sendChat(body, recipientId)}
                onClose={() => setPanel(null)}
              />
            )}
            {panel === "people" && (
              <ParticipantsPanel
                peers={room.peers}
                self={room.self}
                isHost={isHost}
                invited={(meeting?.invitees ?? []).map((person) => ({
                  id: person.id,
                  name: person.display_name,
                  color: person.avatar_color,
                }))}
                onClose={() => setPanel(null)}
                onMute={(id) => void api.muteParticipant(code, id)}
                onRemove={(id) => void api.removeParticipant(code, id)}
                onCohost={(id) => void api.toggleCohost(code, id)}
                onInvite={() => setShowInfo(true)}
              />
            )}
            {panel === "whiteboard" && (
              <SidePanel title="Whiteboard" onClose={() => setPanel(null)}>
                <div className="h-[70vh] p-3 md:h-full">
                  <Whiteboard
                    strokes={room.strokes}
                    onStroke={room.sendStroke}
                    onClear={room.clearBoard}
                    canClear={isHost || joinData?.participant.role === "cohost"}
                  />
                </div>
              </SidePanel>
            )}
            {panel === "polls" && (
              <SidePanel title="Polls" onClose={() => setPanel(null)}>
                <div className="p-3">
                  <PollsPanel
                    polls={room.polls}
                    canManage={isHost || joinData?.participant.role === "cohost"}
                    onCreate={room.createPoll}
                    onVote={room.votePoll}
                    onClose={room.closePoll}
                  />
                </div>
              </SidePanel>
            )}
            {panel === "notes" && (
              <AiNotesPanel
                segments={room.segments}
                interim={captions.interim}
                isRecording={Boolean(recordingId)}
                captionsOn={captions.listening}
                captionsSupported={captions.supported}
                onClose={() => setPanel(null)}
                onHighlight={() => void highlightMoment()}
                onToggleCaptions={() => (captions.listening ? captions.disable() : captions.enable())}
                onStartRecording={() => void startRecording()}
              />
            )}
          </div>
        )}
      </div>

      <MeetingToolbar
        isMuted={!micOn}
        isVideoOn={cameraOn}
        isSharing={isSharing}
        isRecording={Boolean(recordingId)}
        isHandRaised={handRaised}
        captionsOn={captions.listening}
        captionsSupported={captions.supported}
        chatUnread={unread}
        participantCount={tiles.length}
        panel={panel}
        isHost={isHost}
        onToggleMute={toggleMic}
        onToggleVideo={toggleCamera}
        onToggleShare={() => void toggleShare()}
        onToggleRecording={() => (recordingId ? void stopRecording() : void startRecording())}
        onToggleHand={toggleHand}
        onToggleCaptions={() => (captions.listening ? captions.disable() : captions.enable())}
        onReaction={(emoji) => room.sendReaction(emoji)}
        onOpenWhiteboard={() => setPanel((current) => (current === "whiteboard" ? null : "whiteboard"))}
        onOpenPolls={() => setPanel((current) => (current === "polls" ? null : "polls"))}
        onOpenPanel={(next) => setPanel((current) => (current === next ? null : next))}
        onLeave={() => void leave()}
        onEnd={() => void endForAll()}
        onComingSoon={setComingSoon}
      />

      <Modal open={showInfo} onClose={() => setShowInfo(false)} title="Meeting information">
        <dl className="space-y-3 text-sm">
          <div>
            <dt className="text-xs uppercase tracking-wide text-muted">Topic</dt>
            <dd className="font-medium text-body">{meeting?.topic}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-muted">Meeting ID</dt>
            <dd className="font-mono text-body">{formatMeetingId(code)}</dd>
          </div>
          {meeting?.passcode && (
            <div>
              <dt className="text-xs uppercase tracking-wide text-muted">Passcode</dt>
              <dd className="font-mono text-body">{meeting.passcode}</dd>
            </div>
          )}
          <div>
            <dt className="text-xs uppercase tracking-wide text-muted">Invite link</dt>
            <dd className="break-all text-body">
              {typeof window !== "undefined" ? `${window.location.origin}/meeting/${code}` : ""}
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-muted">Encryption</dt>
            <dd className="text-body">
              Media is encrypted in transit by WebRTC (DTLS-SRTP). End-to-end encryption is simulated in this build.
            </dd>
          </div>
        </dl>
        <Button
          className="mt-4 w-full"
          onClick={async () => {
            await navigator.clipboard.writeText(
              `Join my Zoomeet meeting\n${window.location.origin}/meeting/${code}\nMeeting ID: ${formatMeetingId(code)}${
                meeting?.passcode ? `\nPasscode: ${meeting.passcode}` : ""
              }`,
            );
            notify({ kind: "success", title: "Invitation copied" });
          }}
        >
          <Icon name="copy" size={15} /> Copy invitation
        </Button>
      </Modal>

      <Modal open={Boolean(comingSoon)} onClose={() => setComingSoon(null)} title={comingSoon ?? ""}>
        <div className="py-6 text-center">
          <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-surface-3 text-muted">
            <Icon name="grid" size={24} />
          </span>
          <p className="mt-4 text-sm font-semibold text-body">{comingSoon} is coming soon</p>
          <p className="mx-auto mt-1 max-w-xs text-xs text-muted">
            This build focuses on real-time video, chat and the AI notetaker. {comingSoon} is a placeholder.
          </p>
        </div>
      </Modal>
    </div>
  );
}
