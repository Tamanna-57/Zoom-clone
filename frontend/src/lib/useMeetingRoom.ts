"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { getToken } from "./api";
import { WS_URL } from "./config";
import type { ChatMessage, PeerInfo, ServerEvent, TranscriptSegment } from "./types";

export interface RemotePeer extends PeerInfo {
  stream: MediaStream | null;
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
  onRecordingChanged: (state: "started" | "ready", recordingId: number, by: string) => void;
  onForceMute: (by: string) => void;
  onRemoved: (participantId: number, by: string) => void;
  /** The same account opened this meeting somewhere else and took the seat. */
  onReplaced: () => void;
  selfParticipantId: number | null;
}

/** Close code the server uses when a newer socket for this account supersedes us. */
const WS_REPLACED_ELSEWHERE = 4409;

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
  onReplaced,
  selfParticipantId,
}: Options) {
  const [connected, setConnected] = useState(false);
  const [self, setSelf] = useState<PeerInfo | null>(null);
  const [peers, setPeers] = useState<Record<string, RemotePeer>>({});
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [segments, setSegments] = useState<TranscriptSegment[]>([]);
  const [reactions, setReactions] = useState<FloatingReaction[]>([]);

  const socketRef = useRef<WebSocket | null>(null);
  const connectionsRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const pendingIceRef = useRef<Map<string, RTCIceCandidateInit[]>>(new Map());
  const streamRef = useRef<MediaStream | null>(null);
  // A track can arrive before the roster entry it belongs to. Park it here so a
  // late peer record still gets its video instead of rendering a frozen avatar.
  const pendingStreamsRef = useRef<Map<string, MediaStream>>(new Map());

  // Callbacks live in a ref so the socket effect never re-subscribes on rerender.
  const handlersRef = useRef({ onMeetingEnded, onRecordingChanged, onForceMute, onRemoved, onReplaced, selfParticipantId });
  // Offering is defined after the connection factory that needs it.
  const offerRef = useRef<(connectionId: string) => Promise<void>>(async () => undefined);

  useEffect(() => {
    streamRef.current = localStream;
  }, [localStream]);

  useEffect(() => {
    handlersRef.current = { onMeetingEnded, onRecordingChanged, onForceMute, onRemoved, onReplaced, selfParticipantId };
  }, [onMeetingEnded, onRecordingChanged, onForceMute, onRemoved, onReplaced, selfParticipantId]);

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
        stream.getTracks().forEach((track) => connection.addTrack(track, stream));
      } else {
        // View-only participant: still negotiate two receiving transceivers.
        connection.addTransceiver("video", { direction: "recvonly" });
        connection.addTransceiver("audio", { direction: "recvonly" });
      }

      connection.onicecandidate = (event) => {
        if (event.candidate) send({ type: "signal", to: connectionId, data: { candidate: event.candidate.toJSON() } });
      };

      connection.ontrack = (event) => {
        const [remoteStream] = event.streams;
        if (!remoteStream) return;
        // ontrack fires once per stream. If the roster has not caught up yet,
        // dropping it here would lose the peer's media for the whole call.
        pendingStreamsRef.current.set(connectionId, remoteStream);
        setPeers((current) => {
          const peer = current[connectionId];
          if (!peer) return current;
          return { ...current, [connectionId]: { ...peer, stream: remoteStream } };
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

    const socket = new WebSocket(`${WS_URL}/ws/meetings/${code}?token=${token}`);
    socketRef.current = socket;

    socket.onopen = () => setConnected(true);
    socket.onclose = (event) => {
      setConnected(false);
      if (event.code === WS_REPLACED_ELSEWHERE) handlersRef.current.onReplaced();
    };

    socket.onmessage = (event) => {
      const message = JSON.parse(event.data as string) as ServerEvent;

      switch (message.type) {
        case "welcome": {
          setSelf(message.self);
          setPeers(
            Object.fromEntries(
              message.peers.map((peer) => [
                peer.connectionId,
                { ...peer, stream: pendingStreamsRef.current.get(peer.connectionId) ?? null },
              ]),
            ),
          );
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

    // Some proxies drop idle sockets; a slow heartbeat keeps the call alive.
    const heartbeat = window.setInterval(() => send({ type: "ping" }), 25_000);

    const connections = connectionsRef.current;
    const pendingIce = pendingIceRef.current;
    const pendingStreams = pendingStreamsRef.current;

    return () => {
      window.clearInterval(heartbeat);
      socket.close();
      socketRef.current = null;
      connections.forEach((connection) => connection.close());
      connections.clear();
      pendingIce.clear();
      pendingStreams.clear();
      setPeers({});
      setConnected(false);
    };
  }, [code, enabled, closeConnection, handleSignal, offerTo, send]);

  /** Swap the outgoing video (camera <-> screen) without renegotiating. */
  const replaceVideoTrack = useCallback((track: MediaStreamTrack | null) => {
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
      replaceVideoTrack,
      seedMessages: (initial: ChatMessage[]) => setMessages(initial),
      seedSegments: (initial: TranscriptSegment[]) => setSegments(initial),
    }),
    [send, replaceVideoTrack],
  );

  return { connected, self, peers: Object.values(peers), messages, segments, reactions, ...api };
}
