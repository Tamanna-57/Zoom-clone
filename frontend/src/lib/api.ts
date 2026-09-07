import { API_URL } from "./config";
import type {
  ActionItem,
  AuthResponse,
  ChatMessage,
  Contact,
  JoinResponse,
  Meeting,
  Participant,
  Recording,
  RecordingDetail,
  User,
} from "./types";

const TOKEN_KEY = "zoomeet.token";

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null) {
  if (typeof window === "undefined") return;
  if (token) window.localStorage.setItem(TOKEN_KEY, token);
  else window.localStorage.removeItem(TOKEN_KEY);
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getToken();

  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(init.headers ?? {}),
      },
      cache: "no-store",
    });
  } catch {
    // fetch only rejects when the request never reached the server: the backend
    // is down, the URL is wrong, or the browser blocked it. Say which.
    throw new ApiError(
      0,
      `Cannot reach the Zoomeet API at ${API_URL}. Start the backend, or set NEXT_PUBLIC_API_URL for this deployment.`,
    );
  }

  if (response.status === 204) return undefined as T;

  const raw = await response.text();
  const body = raw ? JSON.parse(raw) : null;

  if (!response.ok) {
    const detail = body?.detail;
    const message =
      typeof detail === "string"
        ? detail
        : Array.isArray(detail)
          ? (detail[0]?.msg ?? "Request failed")
          : "Something went wrong. Please try again.";
    throw new ApiError(response.status, message);
  }
  return body as T;
}

const get = <T,>(path: string) => request<T>(path);
const post = <T,>(path: string, body?: unknown) =>
  request<T>(path, { method: "POST", body: body === undefined ? "{}" : JSON.stringify(body) });
const patch = <T,>(path: string, body: unknown) =>
  request<T>(path, { method: "PATCH", body: JSON.stringify(body) });
const del = (path: string) => request<void>(path, { method: "DELETE" });

export const api = {
  // auth ---------------------------------------------------------------------
  register: (body: { email: string; display_name: string; password: string; job_title?: string }) =>
    post<AuthResponse>("/api/auth/register", body),
  verify: (body: { email: string; code: string }) => post<AuthResponse>("/api/auth/verify", body),
  login: (body: { email: string; password: string }) => post<AuthResponse>("/api/auth/login", body),
  logout: () => post<void>("/api/auth/logout"),
  me: () => get<User>("/api/auth/me"),
  updateProfile: (body: Partial<Pick<User, "display_name" | "job_title" | "avatar_color" | "timezone">>) =>
    patch<User>("/api/me", body),

  // directory ----------------------------------------------------------------
  searchUsers: (q = "") => get<User[]>(`/api/users?q=${encodeURIComponent(q)}`),
  contacts: () => get<Contact[]>("/api/contacts"),
  addContact: (email: string) => post<Contact>("/api/contacts", { email }),
  starContact: (id: number) => post<Contact>(`/api/contacts/${id}/star`),
  removeContact: (id: number) => del(`/api/contacts/${id}`),

  // meetings -----------------------------------------------------------------
  meetings: (scope: "upcoming" | "previous" | "live" | "all" = "upcoming") =>
    get<Meeting[]>(`/api/meetings?scope=${scope}`),
  personalRoom: () => get<Meeting>("/api/meetings/personal"),
  meeting: (code: string) => get<Meeting>(`/api/meetings/${code}`),
  createMeeting: (body: {
    topic: string;
    scheduled_start?: string | null;
    duration_minutes?: number;
    agenda?: string | null;
    passcode_required?: boolean;
    waiting_room?: boolean;
    mute_on_entry?: boolean;
    video_on_entry?: boolean;
    auto_record?: boolean;
    invitee_ids?: number[];
    start_now?: boolean;
  }) => post<Meeting>("/api/meetings", body),
  updateMeeting: (code: string, body: Record<string, unknown>) => patch<Meeting>(`/api/meetings/${code}`, body),
  deleteMeeting: (code: string) => del(`/api/meetings/${code}`),
  joinMeeting: (code: string, body: { passcode?: string; display_name?: string }) =>
    post<JoinResponse>(`/api/meetings/${code}/join`, body),
  leaveMeeting: (code: string) => post<void>(`/api/meetings/${code}/leave`),
  endMeeting: (code: string) => post<Meeting>(`/api/meetings/${code}/end`),
  muteParticipant: (code: string, participantId: number) =>
    post<Participant>(`/api/meetings/${code}/participants/${participantId}/mute`),
  removeParticipant: (code: string, participantId: number) =>
    post<void>(`/api/meetings/${code}/participants/${participantId}/remove`),
  toggleCohost: (code: string, participantId: number) =>
    post<Participant>(`/api/meetings/${code}/participants/${participantId}/cohost`),

  // chat ---------------------------------------------------------------------
  messages: (code: string) => get<ChatMessage[]>(`/api/meetings/${code}/messages`),
  sendMessage: (code: string, body: { body: string; recipient_id?: number | null }) =>
    post<ChatMessage>(`/api/meetings/${code}/messages`, body),

  // recordings / AI notes ----------------------------------------------------
  startRecording: (code: string) => post<Recording>(`/api/meetings/${code}/recording/start`),
  stopRecording: (id: number) => post<RecordingDetail>(`/api/recordings/${id}/stop`),
  regenerateSummary: (id: number) => post<RecordingDetail>(`/api/recordings/${id}/regenerate`),
  recordings: (q = "") => get<Recording[]>(`/api/recordings?q=${encodeURIComponent(q)}`),
  recording: (id: number) => get<RecordingDetail>(`/api/recordings/${id}`),
  sharedRecording: (token: string) => get<RecordingDetail>(`/api/shared/recordings/${token}`),
  addHighlight: (id: number, body: { at_ms: number; label?: string; note?: string }) =>
    post<{ id: number }>(`/api/recordings/${id}/highlights`, body),
  addActionItem: (id: number, body: { text: string; assignee_name?: string | null; due_hint?: string | null }) =>
    post<ActionItem>(`/api/recordings/${id}/action-items`, body),
  updateActionItem: (id: number, body: { text?: string; assignee_name?: string | null; status?: "open" | "done" }) =>
    patch<ActionItem>(`/api/action-items/${id}`, body),
  deleteActionItem: (id: number) => del(`/api/action-items/${id}`),
};
