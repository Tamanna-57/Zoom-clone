"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { getToken } from "./api";
import { WS_URL } from "./config";
import type { BoardCursor, BoardItem, ChatMessage, PeerInfo, Poll, ServerEvent, TranscriptSegment } from "./types";

/** The room-wide whiteboard share: who put the board up, if anyone. */
export interface WhiteboardSession {
  open: boolean;
  by: string | null;
  byConnection: string | null;
  /** Zoom's "who can annotate": while on, only hosts may change the board. */
  locked: boolean;
}

/** Someone else's pen, with the moment we last heard from it. */
export interface LiveCursor extends BoardCursor {
  at: number;
}

/** A cursor nobody has moved for this long has stopped meaning anything. */
const CURSOR_TTL_MS = 4_000;

export interface RemotePeer extends PeerInfo {
  stream: MediaStream | null;
  /** Bumped as tracks land so a tile re-renders when Safari adds audio late. */
  streamRevision?: number;
}

export interface FloatingReaction {
  id: number;
  emoji: string;
  displayName: string;
}

interface Options {
  code: string;
  localStream: MediaStream | null;
  iceServers: RTCIceServer[];
  enabled: boolean;
  onMeetingEnded: (by: string) => void;
  /**
   * `processing` lands when someone stops the recording — the recap is queued,
   * not written yet — and `ready`/`failed` when the worker is done with it.
   */
  onRecordingChanged: (
    state: "started" | "processing" | "ready" | "failed",
    recordingId: number,
    by: string,
  ) => void;
  onForceMute: (by: string) => void;
  onRemoved: (participantId: number, by: string) => void;
  /** The host let this person out of the waiting room and into the call. */
  onAdmitted: (by: string) => void;
  /** The same account opened this meeting somewhere else and took the seat. */
  onReplaced: () => void;
  selfParticipantId: number | null;
}

export interface WaitingKnock {
  participant_id: number;
  user_id: number | null;
  display_name: string;
  avatar_color: string;
}

/** Close code the server uses when a newer socket for this account supersedes us. */
const WS_REPLACED_ELSEWHERE = 4409;
/** The waiting room still holds this person, or the host ejected them. */
const WS_NOT_ADMITTED = 4403;
/** A normal `socket.close()` from our own cleanup — never worth retrying. */
const WS_NORMAL = 1000;

/** Backoff between reconnect attempts, in ms. The last value repeats. */
const RETRY_DELAYS = [500, 1_000, 2_000, 4_000, 8_000, 15_000];

/**
 * One mesh call.
 *
 * Every participant holds an RTCPeerConnection to every other participant. The
 * server only relays SDP/ICE. To avoid offer glare, exactly one side of each
 * pair offers: the peer that was already in the room when the other joined.
 */
export function useMeetingRoom({
  code,
  localStream,
  iceServers,
  enabled,
  onMeetingEnded,
  onRecordingChanged,
  onForceMute,
  onRemoved,
  onAdmitted,
  onReplaced,
  selfParticipantId,
}: Options) {
  const [connected, setConnected] = useState(false);
  const [self, setSelf] = useState<PeerInfo | null>(null);
  const [peers, setPeers] = useState<Record<string, RemotePeer>>({});
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [segments, setSegments] = useState<TranscriptSegment[]>([]);
  const [reactions, setReactions] = useState<FloatingReaction[]>([]);
  const [boardItems, setBoardItems] = useState<BoardItem[]>([]);
  const [boardCursors, setBoardCursors] = useState<Record<string, LiveCursor>>({});
  // Who, if anyone, is currently sharing the whiteboard with the room. Held
  // server-side so every tab agrees and late joiners land on the open board.
  const [whiteboard, setWhiteboard] = useState<WhiteboardSession>({
    open: false,
    by: null,
    byConnection: null,
    locked: false,
  });
  const [polls, setPolls] = useState<Poll[]>([]);
  const [waiting, setWaiting] = useState<WaitingKnock[]>([]);

  const socketRef = useRef<WebSocket | null>(null);
  // Reconnect bookkeeping. A dropped socket is the normal case on a flaky
  // network, so the call has to climb back by itself instead of sitting on
  // "reconnecting…" until the user reloads the page.
  const retryTimerRef = useRef<number | null>(null);
  const retryCountRef = useRef(0);
  const connectionsRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const pendingIceRef = useRef<Map<string, RTCIceCandidateInit[]>>(new Map());
  const streamRef = useRef<MediaStream | null>(null);
  // The video track actually being sent right now: the camera normally, the
  // display capture while screen sharing. `replaceTrack` only rewires senders
  // that already exist, so without this a peer who joins mid-presentation is
  // offered the camera and never sees the shared screen.
  const outgoingVideoRef = useRef<MediaStreamTrack | null>(null);
  // A track can arrive before the roster entry it belongs to. Park it here so a
  // late peer record still gets its video instead of rendering a frozen avatar.
  const pendingStreamsRef = useRef<Map<string, MediaStream>>(new Map());

  // Callbacks live in a ref so the socket effect never re-subscribes on rerender.
  const handlersRef = useRef({ onMeetingEnded, onRecordingChanged, onForceMute, onRemoved, onAdmitted, onReplaced, selfParticipantId });
  // Offering is defined after the connection factory that needs it.
  const offerRef = useRef<(connectionId: string) => Promise<void>>(async () => undefined);

  useEffect(() => {
    streamRef.current = localStream;
  }, [localStream]);

  useEffect(() => {
    handlersRef.current = { onMeetingEnded, onRecordingChanged, onForceMute, onRemoved, onAdmitted, onReplaced, selfParticipantId };
  }, [onMeetingEnded, onRecordingChanged, onForceMute, onRemoved, onAdmitted, onReplaced, selfParticipantId]);

  const send = useCallback((payload: Record<string, unknown>) => {
    const socket = socketRef.current;
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(payload));
  }, []);

  const closeConnection = useCallback((connectionId: string) => {
    const connection = connectionsRef.current.get(connectionId);
    connection?.close();
    connectionsRef.current.delete(connectionId);
    pendingIceRef.current.delete(connectionId);
    pendingStreamsRef.current.delete(connectionId);
  }, []);

  const createConnection = useCallback(
    (connectionId: string, initiator: boolean) => {
      const existing = connectionsRef.current.get(connectionId);
      if (existing) return existing;

      const connection = new RTCPeerConnection({ iceServers });
      connectionsRef.current.set(connectionId, connection);

      const stream = streamRef.current;
      if (stream) {
        const shared = outgoingVideoRef.current;
        stream.getAudioTracks().forEach((track) => connection.addTrack(track, stream));
        const video = shared ?? stream.getVideoTracks()[0];
        if (video) connection.addTrack(video, stream);
      } else {
        // View-only participant: still negotiate two receiving transceivers.
        connection.addTransceiver("video", { direction: "recvonly" });
        connection.addTransceiver("audio", { direction: "recvonly" });
      }

      connection.onicecandidate = (event) => {
        if (event.candidate) send({ type: "signal", to: connectionId, data: { candidate: event.candidate.toJSON() } });
      };

      connection.ontrack = (event) => {
        // Safari fires ontrack with an empty `streams` list, one event per track,
        // so a Chrome-shaped `event.streams[0]` read silently drops everything a
        // Mac sends. Fall back to assembling the stream from the tracks instead.
        //
        // Build a *new* MediaStream each time rather than adding to one in
        // place. Chrome will render a track appended to a stream that is
        // already attached to a <video>; Safari will not, so the audio track
        // (which arrives second) stayed silent. Changing the object identity is
        // what makes the tile re-attach it.
        let remoteStream = event.streams[0] as MediaStream | undefined;
        if (!remoteStream) {
          const previous = pendingStreamsRef.current.get(connectionId);
          const tracks = previous?.getTracks() ?? [];
          remoteStream = tracks.some((track) => track.id === event.track.id)
            ? previous!
            : new MediaStream([...tracks, event.track]);
        }
        // ontrack fires once per stream. If the roster has not caught up yet,
        // dropping it here would lose the peer's media for the whole call.
        pendingStreamsRef.current.set(connectionId, remoteStream);
        const settled = remoteStream;
        setPeers((current) => {
          const peer = current[connectionId];
          if (!peer) return current;
          // Same object identity on a second track would not re-render the tile.
          return { ...current, [connectionId]: { ...peer, stream: settled, streamRevision: settled.getTracks().length } };
        });
      };

      connection.onconnectionstatechange = () => {
        if (connection.connectionState === "failed") {
          // A failed pair is recoverable: drop it and let the offerer rebuild.
          closeConnection(connectionId);
          if (initiator) void offerRef.current(connectionId);
        }
      };

      return connection;
    },
    [iceServers, send, closeConnection],
  );

  const offerTo = useCallback(
    async (connectionId: string) => {
      const connection = createConnection(connectionId, true);
      const offer = await connection.createOffer();
      await connection.setLocalDescription(offer);
      send({ type: "signal", to: connectionId, data: connection.localDescription?.toJSON() });
    },
    [createConnection, send],
  );

  useEffect(() => {
    offerRef.current = offerTo;
  }, [offerTo]);

  const handleSignal = useCallback(
    async (from: string, data: RTCSessionDescriptionInit | { candidate: RTCIceCandidateInit }) => {
      if (!data) return;

      if ("candidate" in data && !("type" in data)) {
        const connection = connectionsRef.current.get(from);
        const candidate = (data as { candidate: RTCIceCandidateInit }).candidate;
        if (!connection || !connection.remoteDescription) {
          // Candidates can beat the answer; hold them until the description lands.
          pendingIceRef.current.set(from, [...(pendingIceRef.current.get(from) ?? []), candidate]);
          return;
        }
        await connection.addIceCandidate(new RTCIceCandidate(candidate)).catch(() => undefined);
        return;
      }

      const description = data as RTCSessionDescriptionInit;
      const connection = createConnection(from, false);

      if (description.type === "offer") {
        await connection.setRemoteDescription(new RTCSessionDescription(description));
        const answer = await connection.createAnswer();
        await connection.setLocalDescription(answer);
        send({ type: "signal", to: from, data: connection.localDescription?.toJSON() });
      } else if (description.type === "answer") {
        if (connection.signalingState === "have-local-offer") {
          await connection.setRemoteDescription(new RTCSessionDescription(description));
        }
      }

      const queued = pendingIceRef.current.get(from);
      if (queued?.length) {
        for (const candidate of queued) {
          await connection.addIceCandidate(new RTCIceCandidate(candidate)).catch(() => undefined);
        }
        pendingIceRef.current.delete(from);
      }
    },
    [createConnection, send],
  );

  useEffect(() => {
    if (!enabled || !code) return;
    const token = getToken();
    if (!token) return;

    // `stopped` is the difference between "we are leaving" and "the network
    // blinked": only the latter should be retried.
    let stopped = false;

    const scheduleRetry = () => {
      if (stopped || retryTimerRef.current !== null) return;
      const delay = RETRY_DELAYS[Math.min(retryCountRef.current, RETRY_DELAYS.length - 1)];
      retryCountRef.current += 1;
      retryTimerRef.current = window.setTimeout(() => {
        retryTimerRef.current = null;
        connect();
      }, delay);
    };

    function connect() {
      if (stopped) return;
      const socket = new WebSocket(`${WS_URL}/ws/meetings/${code}?token=${token}`);
      socketRef.current = socket;

      socket.onopen = () => {
        retryCountRef.current = 0;
        setConnected(true);
      };
      socket.onclose = (event) => {
        setConnected(false);
        if (socketRef.current === socket) socketRef.current = null;
        if (event.code === WS_REPLACED_ELSEWHERE) {
          // Another tab took the seat: reconnecting would just fight it.
          stopped = true;
          handlersRef.current.onReplaced();
          return;
        }
        if (event.code === WS_NOT_ADMITTED || event.code === WS_NORMAL) {
          stopped = true;
          return;
        }
        scheduleRetry();
      };
      // An error is always followed by `onclose`, which is where retrying lives.
      socket.onerror = () => undefined;

      socket.onmessage = (event) => {
      const message = JSON.parse(event.data as string) as ServerEvent;

      switch (message.type) {
        case "welcome": {
          // A reconnect gets a brand-new connection id, and so does everyone
          // else's view of us. Every peer connection from the previous socket
          // is addressed to ids that no longer exist, so start the mesh over.
          connectionsRef.current.forEach((connection) => connection.close());
          connectionsRef.current.clear();
          pendingIceRef.current.clear();
          pendingStreamsRef.current.clear();

          setSelf(message.self);
          setPeers(
            Object.fromEntries(
              message.peers.map((peer) => [peer.connectionId, { ...peer, stream: null }]),
            ),
          );
          setBoardItems(message.whiteboard ?? []);
          setWhiteboard({
            open: Boolean(message.whiteboardOpen),
            by: message.whiteboardBy ?? null,
            byConnection: message.whiteboardByConnection ?? null,
            locked: Boolean(message.whiteboardLocked),
          });
          setPolls(message.polls ?? []);
          setWaiting(message.waiting ?? []);
          // The peers who were already here offer to the newcomer, so there is
          // nothing to send: answering their offers rebuilds every pair.
          break;
        }
        case "waiting-room": {
          setWaiting(message.waiting);
          break;
        }
        case "admitted": {
          if (message.participantId === handlersRef.current.selfParticipantId) {
            handlersRef.current.onAdmitted(message.by);
          }
          break;
        }
        case "peer-joined": {
          setPeers((current) => ({
            ...current,
            [message.peer.connectionId]: {
              ...message.peer,
              stream: pendingStreamsRef.current.get(message.peer.connectionId) ?? null,
            },
          }));
          // We were here first, so we make the offer.
          void offerTo(message.peer.connectionId);
          break;
        }
        case "peer-left": {
          closeConnection(message.connectionId);
          setPeers((current) => {
            const next = { ...current };
            delete next[message.connectionId];
            return next;
          });
          // Their pen went with them; leaving it on the board would strand a
          // name over a mark nobody is drawing.
          setBoardCursors((current) => {
            if (!(message.connectionId in current)) return current;
            const next = { ...current };
            delete next[message.connectionId];
            return next;
          });
          break;
        }
        case "peer-state": {
          setSelf((current) => (current && current.connectionId === message.peer.connectionId ? { ...message.peer } : current));
          setPeers((current) => {
            const peer = current[message.peer.connectionId];
            if (!peer) return current;
            return { ...current, [message.peer.connectionId]: { ...peer, ...message.peer } };
          });
          break;
        }
        case "signal": {
          void handleSignal(message.from, message.data as RTCSessionDescriptionInit);
          break;
        }
        case "chat": {
          setMessages((current) => (current.some((m) => m.id === message.message.id) ? current : [...current, message.message]));
          break;
        }
        case "transcript": {
          const segment = message.segment;
          setSegments((current) => [
            ...current,
            {
              id: segment.id,
              speaker_id: segment.speakerId,
              speaker_name: segment.speakerName,
              start_ms: segment.startMs,
              end_ms: segment.endMs,
              text: segment.text,
            },
          ]);
          break;
        }
        case "whiteboard": {
          switch (message.action) {
            case "add": {
              const item = message.item;
              // Our own marks are already on screen optimistically; the echo is
              // what makes them real, so replace rather than append.
              setBoardItems((current) => [...current.filter((mark) => mark.id !== item.id), item]);
              break;
            }
            case "move": {
              setBoardItems((current) =>
                current.map((mark) => (mark.id === message.id ? { ...mark, points: message.points } : mark)),
              );
              break;
            }
            case "delete": {
              const gone = new Set(message.ids);
              setBoardItems((current) => current.filter((mark) => !gone.has(mark.id)));
              break;
            }
            case "clear":
              setBoardItems([]);
              break;
            case "lock":
              setWhiteboard((current) => ({ ...current, locked: message.locked }));
              break;
            case "open":
              setWhiteboard({
                open: true,
                by: message.by,
                byConnection: message.byConnection,
                locked: false,
              });
              break;
            case "close":
              setWhiteboard({ open: false, by: null, byConnection: null, locked: false });
              // The server wipes the board when the share ends, so drop the
              // marks here too instead of flashing them on the next share.
              setBoardItems([]);
              setBoardCursors({});
              break;
            case "cursor":
              setBoardCursors((current) => ({
                ...current,
                [message.connectionId]: {
                  connectionId: message.connectionId,
                  by: message.by,
                  color: message.color,
                  x: message.x,
                  y: message.y,
                  at: Date.now(),
                },
              }));
              break;
          }
          break;
        }
        case "poll": {
          setPolls((current) => {
            const index = current.findIndex((p) => p.id === message.poll.id);
            if (index === -1) return [...current, message.poll];
            const next = [...current];
            next[index] = message.poll;
            return next;
          });
          break;
        }
        case "reaction": {
          const id = Date.now() + Math.random();
          setReactions((current) => [...current, { id, emoji: message.emoji, displayName: message.displayName }]);
          window.setTimeout(() => setReactions((current) => current.filter((r) => r.id !== id)), 2500);
          break;
        }
        case "recording": {
          handlersRef.current.onRecordingChanged(message.state, message.recordingId, message.by);
          break;
        }
        case "force-mute": {
          if (message.participantId === handlersRef.current.selfParticipantId) handlersRef.current.onForceMute(message.by);
          break;
        }
        case "removed": {
          handlersRef.current.onRemoved(message.participantId, message.by);
          break;
        }
        case "meeting-ended": {
          handlersRef.current.onMeetingEnded(message.by);
          break;
        }
        default:
          break;
      }
      };
    }

    connect();

    // Some proxies drop idle sockets; a slow heartbeat keeps the call alive.
    const heartbeat = window.setInterval(() => send({ type: "ping" }), 25_000);

    const connections = connectionsRef.current;
    const pendingIce = pendingIceRef.current;
    const pendingStreams = pendingStreamsRef.current;

    return () => {
      stopped = true;
      window.clearInterval(heartbeat);
      if (retryTimerRef.current !== null) {
        window.clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
      retryCountRef.current = 0;
      socketRef.current?.close();
      socketRef.current = null;
      connections.forEach((connection) => connection.close());
      connections.clear();
      pendingIce.clear();
      pendingStreams.clear();
      setPeers({});
      setBoardItems([]);
      setBoardCursors({});
      setWhiteboard({ open: false, by: null, byConnection: null, locked: false });
      setPolls([]);
      setWaiting([]);
      setConnected(false);
    };
  }, [code, enabled, closeConnection, handleSignal, offerTo, send]);

  // Closing the tab is a departure too. `pagehide` is the last moment a
  // message still gets out, and it fires where `beforeunload` does not (mobile
  // Safari, bfcache), so the room learns immediately either way.
  useEffect(() => {
    if (!enabled) return;
    const announce = () => {
      const socket = socketRef.current;
      if (socket?.readyState !== WebSocket.OPEN) return;
      socket.send(JSON.stringify({ type: "leave" }));
      socket.close(WS_NORMAL);
    };
    window.addEventListener("pagehide", announce);
    return () => window.removeEventListener("pagehide", announce);
  }, [enabled]);

  // A pen that stopped moving is not a pen that is still there: someone can
  // switch tabs, or their last cursor message can be the last thing we hear
  // before a drop. Age them out rather than leaving a name parked on the board.
  useEffect(() => {
    const sweep = window.setInterval(() => {
      const cutoff = Date.now() - CURSOR_TTL_MS;
      setBoardCursors((current) => {
        const live = Object.entries(current).filter(([, cursor]) => cursor.at > cutoff);
        // Same object when nothing expired, so this does not re-render the board.
        return live.length === Object.keys(current).length ? current : Object.fromEntries(live);
      });
    }, 1_500);
    return () => window.clearInterval(sweep);
  }, []);

  /** Swap the outgoing video (camera <-> screen) without renegotiating. */
  const replaceVideoTrack = useCallback((track: MediaStreamTrack | null) => {
    // Remembered so peers that connect *after* this point are given the same
    // track, rather than whatever the camera happens to be sending.
    outgoingVideoRef.current = track;
    connectionsRef.current.forEach((connection) => {
      const sender = connection.getSenders().find((candidate) => candidate.track?.kind === "video");
      if (sender) void sender.replaceTrack(track);
    });
  }, []);

  const api = useMemo(
    () => ({
      sendState: (state: Partial<Pick<PeerInfo, "isMuted" | "isVideoOn" | "isHandRaised" | "isSharing">>) =>
        send({ type: "state", ...state }),
      sendChat: (body: string, recipientId?: number | null) =>
        send({ type: "chat", body, recipientId: recipientId ?? null }),
      sendReaction: (emoji: string) => send({ type: "reaction", emoji }),
      sendTranscript: (text: string, startMs: number, endMs: number) =>
        send({ type: "transcript", text, startMs, endMs }),
      addBoardItem: (item: BoardItem) => send({ type: "whiteboard", action: "add", item }),
      moveBoardItem: (id: string, dx: number, dy: number) =>
        send({ type: "whiteboard", action: "move", id, dx, dy }),
      deleteBoardItems: (ids: string[]) => send({ type: "whiteboard", action: "delete", ids }),
      clearBoard: () => send({ type: "whiteboard", action: "clear" }),
      lockBoard: (locked: boolean) => send({ type: "whiteboard", action: "lock", locked }),
      sendBoardCursor: (x: number, y: number) => send({ type: "whiteboard", action: "cursor", x, y }),
      /** Announce the departure and hang up now, rather than letting the socket
       *  die on its own during navigation: the other grids drop the tile as
       *  soon as the server hears it, not a few seconds later. */
      leaveNow: () => {
        send({ type: "leave" });
        const socket = socketRef.current;
        socketRef.current = null;
        socket?.close(WS_NORMAL);
        connectionsRef.current.forEach((connection) => connection.close());
        connectionsRef.current.clear();
      },
      openBoard: () => send({ type: "whiteboard", action: "open" }),
      closeBoard: () => send({ type: "whiteboard", action: "close" }),
      createPoll: (question: string, options: string[]) =>
        send({ type: "poll", action: "create", question, options }),
      votePoll: (pollId: string, choice: number) =>
        send({ type: "poll", action: "vote", pollId, choice }),
      closePoll: (pollId: string) => send({ type: "poll", action: "close", pollId }),
      replaceVideoTrack,
      seedMessages: (initial: ChatMessage[]) => setMessages(initial),
      seedSegments: (initial: TranscriptSegment[]) => setSegments(initial),
    }),
    [send, replaceVideoTrack],
  );

  return {
    connected,
    self,
    peers: Object.values(peers),
    messages,
    segments,
    reactions,
    boardItems,
    boardCursors,
    whiteboard,
    polls,
    waiting,
    ...api,
  };
}
