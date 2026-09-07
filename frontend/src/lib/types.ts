/** Mirrors the Pydantic schemas in `backend/app/schemas.py`. */

export type MeetingStatus = "scheduled" | "live" | "ended";
export type ParticipantRole = "host" | "cohost" | "participant";
export type RecordingStatus = "recording" | "processing" | "ready";
export type ActionItemStatus = "open" | "done";

export interface User {
  id: number;
  email: string;
  display_name: string;
  avatar_url: string | null;
  avatar_color: string;
  job_title: string | null;
  timezone: string;
  personal_meeting_id: string;
  is_verified: boolean;
  last_seen_at: string;
}

export interface AuthResponse {
  access_token: string;
  token_type: string;
  user: User;
}

export interface Contact {
  id: number;
  starred: boolean;
  contact: User;
}

export interface Participant {
  id: number;
  user_id: number | null;
  display_name: string;
  role: ParticipantRole;
  is_online: boolean;
  is_muted: boolean;
  is_video_on: boolean;
  is_hand_raised: boolean;
  is_sharing: boolean;
  joined_at: string | null;
  left_at: string | null;
  talk_seconds: number;
  avatar_color: string;
}

export interface Meeting {
  id: number;
  code: string;
  topic: string;
  passcode: string | null;
  status: MeetingStatus;
  host: User;
  scheduled_start: string | null;
  duration_minutes: number;
  is_personal_room: boolean;
  waiting_room: boolean;
  mute_on_entry: boolean;
  video_on_entry: boolean;
  auto_record: boolean;
  agenda: string | null;
  started_at: string | null;
  ended_at: string | null;
  created_at: string;
  participants: Participant[];
  invitees: User[];
  active_recording_id: number | null;
  latest_recording_id: number | null;
  join_url: string;
}

export interface JoinResponse {
  meeting: Meeting;
  participant: Participant;
  ice_servers: RTCIceServer[];
  ws_url: string;
}

export interface ChatMessage {
  id: number;
  meeting_id: number;
  sender_id: number | null;
  sender_name: string;
  recipient_id: number | null;
  recipient_name: string | null;
  body: string;
  created_at: string;
}

export interface TranscriptSegment {
  id: number;
  speaker_id: number | null;
  speaker_name: string;
  start_ms: number;
  end_ms: number;
  text: string;
}

export interface SummarySection {
  title: string;
  position: number;
  bullets: string[];
}

export interface Summary {
  id: number;
  headline: string;
  tldr: string;
  generator: string;
  keywords: string[];
  created_at: string;
  sections: SummarySection[];
}

export interface ActionItem {
  id: number;
  text: string;
  assignee_name: string | null;
  assignee_id: number | null;
  due_hint: string | null;
  status: ActionItemStatus;
  source_segment_id: number | null;
}

export interface Highlight {
  id: number;
  created_by_id: number | null;
  created_by_name: string;
  label: string;
  at_ms: number;
  note: string | null;
  created_at: string;
}

export interface SpeakerStat {
  speaker_name: string;
  seconds: number;
  percent: number;
  words: number;
}

export interface Recording {
  id: number;
  meeting_id: number;
  meeting_code: string;
  title: string;
  status: RecordingStatus;
  started_at: string;
  ended_at: string | null;
  duration_seconds: number;
  share_token: string;
  host_name: string;
  participant_names: string[];
  segment_count: number;
  action_item_count: number;
  highlight_count: number;
}

export interface RecordingDetail extends Recording {
  segments: TranscriptSegment[];
  summary: Summary | null;
  action_items: ActionItem[];
  highlights: Highlight[];
  speaker_stats: SpeakerStat[];
}

/** Messages pushed down the meeting WebSocket. */
export interface PeerInfo {
  connectionId: string;
  userId: number;
  participantId: number;
  displayName: string;
  avatarColor: string;
  role: ParticipantRole;
  isMuted: boolean;
  isVideoOn: boolean;
  isHandRaised: boolean;
  isSharing: boolean;
}

/** One freehand line on the shared whiteboard, in 0..1 canvas coordinates. */
export interface Stroke {
  points: [number, number][];
  color: string;
  width: number;
  by?: string;
}

export interface Poll {
  id: string;
  question: string;
  options: string[];
  createdBy: string;
  isOpen: boolean;
  counts: number[];
  myVote: number | null;
}

export type ServerEvent =
  | { type: "welcome"; self: PeerInfo; peers: PeerInfo[]; whiteboard?: Stroke[]; polls?: Poll[] }
  | { type: "whiteboard"; action: "stroke"; stroke: Stroke }
  | { type: "whiteboard"; action: "clear" }
  | { type: "poll"; poll: Poll }
  | { type: "peer-joined"; peer: PeerInfo }
  | { type: "peer-left"; connectionId: string; userId: number }
  | { type: "peer-state"; peer: PeerInfo }
  | { type: "signal"; from: string; data: RTCSessionDescriptionInit | RTCIceCandidateInit | { candidate: RTCIceCandidateInit } }
  | { type: "chat"; message: ChatMessage }
  | { type: "reaction"; connectionId: string; displayName: string; emoji: string }
  | { type: "transcript"; segment: { id: number; speakerId: number | null; speakerName: string; startMs: number; endMs: number; text: string } }
  | { type: "recording"; state: "started" | "ready"; recordingId: number; by: string }
  | { type: "highlight"; by: string; atMs: number }
  | { type: "force-mute"; participantId: number; by: string }
  | { type: "removed"; participantId: number; by: string }
  | { type: "meeting-ended"; by: string }
  | { type: "pong" };
