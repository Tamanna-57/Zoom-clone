# Zoomeet — a Zoom clone with a Fathom-style AI notetaker

Zoomeet recreates the Zoom meeting experience — home screen, scheduling, pre-join,
gallery/speaker video, in-call chat, reactions, host controls — and adds the thing
Fathom is known for: the moment a call ends, the meeting is already written up as a
TL;DR, decisions, risks, open questions and assigned action items, on top of a
searchable transcript.

Video is **real**: browsers connect peer-to-peer over WebRTC (mesh), and the backend
only relays signalling. The AI recap is produced by a deterministic extractive
summariser that runs server-side with no external API key.

<p align="center">
  <em>Next.js (TypeScript) · FastAPI · SQLite · WebSockets · WebRTC</em>
</p>

---

## Table of contents

- [Features](#features)
- [Tech stack](#tech-stack)
- [Running it locally](#running-it-locally)
- [Seeded demo accounts](#seeded-demo-accounts)
- [Architecture](#architecture)
- [Database schema](#database-schema)
- [API overview](#api-overview)
- [WebSocket protocol](#websocket-protocol)
- [How the AI notetaker works](#how-the-ai-notetaker-works)
- [What is mocked](#what-is-mocked)
- [Assumptions and trade-offs](#assumptions-and-trade-offs)
- [Deployment](#deployment)
- [Verification](#verification)

---

## Features

### Authentication and onboarding
- Register with e-mail, display name, job title and password.
- Two-step sign-up with a **mocked** verification code (fixed OTP, `123456`).
- JWT access token persisted in the browser; session survives reloads.
- Login / logout, profile editing, avatar colour picker, personal meeting ID.

### Home and meetings
- Zoom's four home actions — **New Meeting**, **Join**, **Schedule**, **Share screen** —
  plus a live clock, Personal Meeting ID card and the upcoming list.
- Schedule with topic, time, duration, agenda, invitees, passcode, waiting room,
  mute-on-entry and auto-record.
- Meetings tab: Upcoming / Previous / Personal Room, grouped by day, searchable.
- Copy-invitation text in Zoom's format (topic, time, link, meeting ID, passcode).
- Contacts directory with starring, presence dots and one-click "Meet now".

### In-meeting (real WebRTC)
- Pre-join screen with camera preview, device names and mic/camera toggles.
- Peer-to-peer mesh video and audio; gallery view and speaker view.
- Screen sharing via `getDisplayMedia`, swapped in with `replaceTrack` (no renegotiation).
- Mute / unmute, camera on/off, raise hand, emoji reactions that float over the stage.
- Active-speaker highlighting measured from each stream's audio.
- In-call chat: to everyone or a direct message to one participant; persisted.
- Host controls: mute a participant, promote to co-host, remove, end meeting for all.
- Recording toggle that drives the notetaker, with a live REC indicator.
- Live captions and live transcript from the browser's Web Speech API.
- Keyboard shortcuts: `Alt+A` mute, `Alt+V` video, `Alt+S` share, `Alt+H` chat,
  `Alt+U` participants, `Alt+Y` raise hand.

### AI notes (the Fathom half)
- Recording start/stop with automatic recap generation on stop.
- Recap page: TL;DR, Overview, Key points, Decisions, Risks & blockers, Open questions,
  Next steps — plus keyword chips.
- Action items extracted from commitment phrases with **assignee** and **due hint**
  ("by Friday", "tomorrow"); tick them off, add your own, delete them.
- Talk-time breakdown per speaker (seconds, percentage, word count).
- Full transcript with search and match highlighting, timestamped by speaker.
- "Highlight this moment" during the call; highlights are listed with the line
  that was being said at that timestamp.
- Public share link (`/shared/<token>`) that needs no account, read-only.
- Regenerate the recap after editing, and copy the whole recap as Markdown.

### Polish
- Light and dark theme (meetings are always dark, like the Zoom client).
- Toasts, modals, empty states, loading states, responsive layout.
- "Coming soon" placeholders for breakout rooms, whiteboard, polls, virtual
  backgrounds, live streaming and linked devices.

---

## Tech stack

| Layer | Choice | Why |
| --- | --- | --- |
| Frontend | Next.js 16 (App Router, TypeScript), Tailwind CSS v4 | Required stack; App Router keeps the meeting route client-side where WebRTC lives |
| Backend | FastAPI (Python 3.11) | Required stack; one framework serves both REST and the meeting WebSocket |
| Database | SQLite via SQLAlchemy 2.0 ORM | Required stack; WAL mode and foreign keys enabled |
| Realtime | Native WebSockets | Signalling, presence, chat, reactions and transcript on one socket per participant |
| Media | WebRTC mesh (`RTCPeerConnection`) | Real peer-to-peer audio/video; the server never touches media |
| Transcription | Web Speech API (browser) | No API key, no audio upload |
| Summarisation | Rule-based extractive summariser (`app/services/summarizer.py`) | Deterministic, offline, swappable for an LLM behind one function |
| Auth | JWT (PyJWT) + PBKDF2-SHA256 | Pure standard library hashing; installs anywhere |

No state management library: React context for auth/theme/toasts, local state elsewhere.

---

## Running it locally

Requirements: **Python 3.11+** and **Node 20+**.

### 1. Backend

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate            # Windows: .venv\Scripts\activate
pip install -r requirements.txt

python seed.py --fresh               # seeds users, meetings, transcripts, recaps
uvicorn app.main:app --reload --port 8000
```

API docs (Swagger): <http://localhost:8000/docs>

### 2. Frontend

```bash
cd frontend
npm install
cp .env.example .env.local           # defaults already point at localhost:8000
npm run dev
```

Open <http://localhost:3000>.

### Trying a real two-person call

Open the app in two different browser profiles (or one normal + one incognito window),
sign in as two different seeded users, start a meeting in one and paste its meeting ID
into **Join** in the other. Both windows need camera/microphone permission. Chrome or
Edge is recommended — live captions use the Web Speech API, which Firefox and Safari
do not implement (everything else works there).

---

## Seeded demo accounts

`python seed.py --fresh` creates six colleagues. **Password for all: `password123`.**

| Email | Name | Role |
| --- | --- | --- |
| `priya@zoomeet.dev` | Priya Nair | VP Product — hosts the launch review |
| `arjun@zoomeet.dev` | Arjun Mehta | Staff Engineer — hosts a live incident review |
| `dev@zoomeet.dev` | Dev Sharma | Design Lead — hosts the design critique |
| `meera@zoomeet.dev` | Meera Iyer | Engineering Manager — hosts the weekly sync |
| `rahul@zoomeet.dev` | Rahul Verma | Data Analyst |
| `sara@zoomeet.dev` | Sara Khan | Customer Success |

The seed also creates three finished meetings with full transcripts and generated
recaps, one meeting that is live right now, three scheduled meetings, in-call chat,
highlights and a personal room per user. The mocked verification code is `123456`.

---

## Architecture

```
┌──────────────────────────── browser A ────────────────────────────┐
│  Next.js app                                                      │
│   • REST via lib/api.ts (JWT bearer)                              │
│   • one WebSocket per meeting (lib/useMeetingRoom.ts)             │
│   • RTCPeerConnection per remote participant                      │
│   • Web Speech API -> transcript lines                            │
└───────────────┬───────────────────────────────┬───────────────────┘
                │ REST + WS                     │ media (SRTP), direct
                ▼                               ▼
┌──────────────────────────────────┐   ┌────────────────────────────┐
│  FastAPI                         │   │        browser B           │
│   routers/  auth users meetings  │   │  (same client, mirrored)   │
│             recordings           │   └────────────────────────────┘
│   ws/       hub.py signaling.py  │
│   services/ summarizer.py        │
│   serializers.py  models.py      │
└───────────────┬──────────────────┘
                ▼
           SQLite (SQLAlchemy)
```

**Request flow for a call**

1. `POST /api/meetings/{code}/join` validates the passcode, creates/reuses the
   `Participant` row, flips the meeting to `live`, and returns ICE servers.
2. The client opens `ws://…/ws/meetings/{code}?token=…`. The server replies with
   `welcome` (self + everyone already in the room).
3. Each **existing** peer receives `peer-joined` and creates the offer; the newcomer
   only answers. One offerer per pair means no glare, no perfect-negotiation rollback.
4. SDP and ICE are relayed verbatim through the hub. Media never touches the server.
5. Media/presence changes are sent as `state` and fan out as `peer-state`, and are
   also written to the `Participant` row so a page reload sees the truth.

**Separation of concerns (backend)**

- `models.py` — schema only.
- `schemas.py` — the API contract (Pydantic), including UTC normalisation.
- `routers/` — HTTP endpoints; thin, no serialisation logic.
- `serializers.py` — ORM → schema conversion in one place.
- `services/summarizer.py` — pure functions, no database and no framework imports.
- `ws/hub.py` — connection registry and fan-out; `ws/signaling.py` — the protocol.

**Separation of concerns (frontend)**

- `lib/api.ts` — the only place that talks HTTP.
- `lib/useMeetingRoom.ts` — all WebRTC and socket state; components stay declarative.
- `lib/auth.tsx`, `lib/theme.tsx`, `lib/toast.tsx` — cross-cutting providers.
- `components/ui/` — primitives (Button, Modal, Avatar, Icon set, Field, Spinner).
- `components/meeting/` — in-call surfaces; `components/recap/` — the recap, shared
  by the private page and the public share link (`readOnly` flag).

---

## Database schema

Eleven tables. `→` is a foreign key.

```
users ─┬─< contacts (owner_id →users, contact_id →users, starred)
       ├─< meetings (host_id →users)
       │      ├─< meeting_invitees (meeting_id, user_id →users)      [unique pair]
       │      ├─< meeting_participants (meeting_id, user_id →users)  [unique pair]
       │      ├─< chat_messages (sender_id →users, recipient_id →users NULL = everyone)
       │      └─< recordings
       │             ├─< transcript_segments (speaker_id →users)
       │             ├─── summaries (1:1)
       │             │        └─< summary_sections
       │             ├─< action_items (assignee_id →users, source_segment_id →segments)
       │             └─< highlights (created_by_id →users)
```

| Table | Key columns | Notes |
| --- | --- | --- |
| `users` | `email` (unique), `display_name`, `password_hash`, `avatar_color`, `personal_meeting_id` (unique), `is_verified`, `last_seen_at` | `last_seen_at` powers the presence dot |
| `contacts` | `owner_id`, `contact_id`, `starred` | Directional; unique on the pair |
| `meetings` | `code` (unique, 11 digits), `topic`, `passcode`, `host_id`, `status` (scheduled/live/ended), `scheduled_start`, `duration_minutes`, `is_personal_room`, `waiting_room`, `mute_on_entry`, `video_on_entry`, `auto_record`, `agenda`, `started_at`, `ended_at` | The personal room is a meeting flagged `is_personal_room` whose code is the user's PMI |
| `meeting_invitees` | `meeting_id`, `user_id` | Invited but maybe never attended |
| `meeting_participants` | `meeting_id`, `user_id`, `role` (host/cohost/participant), `is_online`, `is_muted`, `is_video_on`, `is_hand_raised`, `is_sharing`, `joined_at`, `left_at`, `talk_seconds` | One row per person per meeting; rejoining reuses it |
| `chat_messages` | `meeting_id`, `sender_id`, `sender_name`, `recipient_id`, `body`, `created_at` | `recipient_id IS NULL` means "Everyone" |
| `recordings` | `meeting_id`, `title`, `status` (recording/processing/ready), `started_at`, `ended_at`, `duration_seconds`, `share_token` (unique) | The anchor for every AI artefact; `share_token` is the public link credential |
| `transcript_segments` | `recording_id`, `speaker_id`, `speaker_name`, `start_ms`, `end_ms`, `text` | Offsets are ms from the start of the recording |
| `summaries` | `recording_id` (unique), `headline`, `tldr`, `generator`, `keywords` | `generator` records which summariser wrote it |
| `summary_sections` | `summary_id`, `title`, `position`, `bullets` | One bullet per line (SQLite has no array type) |
| `action_items` | `recording_id`, `text`, `assignee_name`, `assignee_id`, `due_hint`, `status`, `source_segment_id` | `source_segment_id` lets the UI jump to the moment |
| `highlights` | `recording_id`, `created_by_id`, `label`, `at_ms`, `note` | Starred moments |

**Design decisions**

- Timestamps are stored **naive UTC** (SQLite has no timezone type) and the API
  re-attaches `+00:00` on the way out, so the browser renders local time correctly.
- Participants are a join table with state, not a many-to-many list, because the
  meeting UI needs per-person mute/camera/hand/talk-time.
- Everything AI-generated hangs off `recordings`, not `meetings`, so a meeting that is
  recorded twice gets two independent recaps.
- Deleting a meeting cascades to participants, chat, recordings, transcript, summary,
  action items and highlights.

---

## API overview

All routes are JSON. Authenticated routes take `Authorization: Bearer <token>`.

### Auth
| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/api/auth/register` | Create an account, returns a token |
| POST | `/api/auth/verify` | Mocked OTP verification |
| POST | `/api/auth/login` | Email + password |
| GET | `/api/auth/me` | Current user |
| POST | `/api/auth/logout` | Records sign-out (tokens are stateless) |

### Users and contacts
| Method | Path | Purpose |
| --- | --- | --- |
| PATCH | `/api/me` | Update display name, title, avatar colour, timezone |
| GET | `/api/users?q=` | Search the directory |
| GET/POST | `/api/contacts` | List / add a contact |
| POST | `/api/contacts/{id}/star` | Toggle starred |
| DELETE | `/api/contacts/{id}` | Remove |

### Meetings
| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/api/meetings` | Create (instant with `start_now`, or scheduled) |
| GET | `/api/meetings?scope=upcoming\|previous\|live\|all` | List meetings you host, were invited to or attended |
| GET | `/api/meetings/personal` | Get or create your personal room |
| GET/PATCH/DELETE | `/api/meetings/{code}` | Read / edit / delete (host only) |
| POST | `/api/meetings/{code}/join` | Validate passcode, join, get ICE servers |
| POST | `/api/meetings/{code}/leave` | Mark yourself offline |
| POST | `/api/meetings/{code}/end` | End for everyone (host) |
| POST | `/api/meetings/{code}/participants/{id}/mute` | Host mute |
| POST | `/api/meetings/{code}/participants/{id}/remove` | Host remove |
| POST | `/api/meetings/{code}/participants/{id}/cohost` | Toggle co-host |
| POST | `/api/meetings/{code}/invite` | Add invitees |
| GET/POST | `/api/meetings/{code}/messages` | Chat history / send |

### Recordings and AI notes
| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/api/meetings/{code}/recording/start` | Start recording (idempotent) |
| POST | `/api/recordings/{id}/stop` | Stop **and generate the recap** |
| POST | `/api/recordings/{id}/regenerate` | Re-run the summariser |
| GET | `/api/recordings?q=` | List; `q` also searches transcript text |
| GET | `/api/recordings/{id}` | Full recap: summary, sections, action items, transcript, highlights, talk time |
| GET | `/api/shared/recordings/{share_token}` | Same payload, **no authentication** |
| POST | `/api/recordings/{id}/segments` | Append a transcript line (REST fallback) |
| POST | `/api/recordings/{id}/action-items` | Add an action item |
| PATCH/DELETE | `/api/action-items/{id}` | Edit / tick off / delete |
| POST | `/api/recordings/{id}/highlights` | Star a moment |
| DELETE | `/api/highlights/{id}` | Remove a highlight |

### Meta
`GET /api/health`, `GET /api/config` (ICE servers + the mock OTP for the UI hint).

---

## WebSocket protocol

`ws://<api>/ws/meetings/{code}?token=<jwt>` — the caller must already have joined
over REST, otherwise the socket is closed with `4403`.

**Client → server**

| Type | Payload | Effect |
| --- | --- | --- |
| `signal` | `{to, data}` | Relayed verbatim to that connection (SDP or ICE) |
| `state` | `{isMuted?, isVideoOn?, isHandRaised?, isSharing?}` | Persisted and broadcast |
| `chat` | `{body, recipientId?}` | Stored, then broadcast (or sent to the pair only) |
| `reaction` | `{emoji}` | Broadcast, not stored |
| `transcript` | `{text, startMs, endMs}` | Appended to the active recording and broadcast |
| `ping` | — | Heartbeat, answered with `pong` |

**Server → client**

`welcome`, `peer-joined`, `peer-left`, `peer-state`, `signal`, `chat`, `reaction`,
`transcript`, `recording`, `highlight`, `force-mute`, `removed`, `meeting-ended`.

The hub is in-process (`ws/hub.py`), which is why the backend runs as a single
worker. Scaling horizontally means replacing that one class with Redis pub/sub;
nothing else in the codebase knows how fan-out happens.

---

## How the AI notetaker works

1. **Capture.** While recording, each browser runs the Web Speech API. Final results
   are sent over the socket as `transcript` messages and stored as
   `transcript_segments` attributed to the speaker who sent them — so speaker
   diarisation is exact rather than guessed.
2. **Summarise.** On stop, `services/summarizer.py` runs over the segments:
   - keyword salience over a stopword-filtered bag of words;
   - sentence scoring (keyword weight + length) for the TL;DR and key points;
   - regex classifiers for **decisions**, **risks/blockers**, **open questions** and
     **next steps**;
   - commitment detection ("I'll…", "can you…", "let's…", "action item") for action
     items, with small-talk filtered out, an assignee resolved from the sentence
     (named person, or the speaker for "I'll"), and a due hint ("by Friday").
3. **Store.** `summaries`, `summary_sections`, `action_items` are written in one
   transaction, and `talk_seconds` is rolled up onto each participant.

`summarise()` is pure — it takes `(speaker, text)` pairs plus the topic and returns a
`SummaryDraft`. Swapping in an LLM means reimplementing that one function; the
routers, schema and UI stay as they are.

---

## What is mocked

Per the brief, these are deliberately simulated:

- **Phone/e-mail verification** — one fixed OTP (`MOCK_OTP`, default `123456`).
- **End-to-end encryption** — media is encrypted in transit by WebRTC's DTLS-SRTP,
  which is real, but there is no per-meeting key exchange or E2EE key ratchet.
  The Privacy settings page states this plainly rather than pretending otherwise.
- **Recording storage** — recordings are metadata plus a transcript; no audio or
  video file is written to disk.
- **Waiting room** — the flag is stored and shown, but admission is not enforced.
- **Presence** — derived from `last_seen_at` (two-minute window) and live socket
  membership, not a dedicated presence service.
- **Coming soon** — breakout rooms, whiteboard, polls, virtual backgrounds, live
  streaming, linked devices.

---

## Assumptions and trade-offs

- **Mesh, not SFU.** Every participant sends their stream to every other participant.
  That is the right call for a demo (no media server, real P2P) and holds up to
  roughly 4–6 people; beyond that an SFU would be required.
- **STUN only by default.** Two peers behind symmetric NAT will fail to connect
  without TURN. `TURN_URL`/`TURN_USERNAME`/`TURN_CREDENTIAL` are wired through
  `/api/meetings/{code}/join` if you have a TURN server.
- **Speech recognition is browser-side**, so live transcript works in Chrome and Edge.
  In other browsers the meeting works normally, you just do not contribute lines —
  the UI says so instead of failing silently.
- **Single-process backend.** The WebSocket hub is in-memory; run one uvicorn worker.
- **Passcodes are stored in plain text** because the host has to be able to read and
  share them, which is how Zoom behaves too.
- **Share tokens are the credential** for a public recap: anyone with the URL can read
  it, and nobody can edit it.
- **Guests must have an account.** Anonymous join-by-name was cut in favour of getting
  identity, presence and speaker attribution right.
- **No test suite is committed.** Verification was done with an API/WebSocket smoke
  script and a two-browser Playwright run (see below); a proper pytest + Playwright
  suite is the first thing I would add next.

---

## Deployment

Zoomeet is **two deployables**. Vercel hosts the frontend only — on its own it will
load and then fail every request, because a page served over HTTPS is not allowed to
call `http://localhost:8000`. Deploy the backend first.

### 1. Backend (Render — a blueprint is committed)

`render.yaml` at the repo root defines the service. In Render: **New → Blueprint →**
select this repo → Apply. It uses:

```
Root directory: backend
Build:          pip install -r requirements.txt
Start:          python seed.py && uvicorn app.main:app --host 0.0.0.0 --port $PORT --workers 1
Health check:   /api/health
```

Seeding is idempotent — it fills an empty database and no-ops otherwise — so a cold
start on the free tier reseeds the demo users and meetings automatically.

Note the service URL it gives you (e.g. `https://zoomeet-api.onrender.com`) and check
`https://<that-url>/api/health` returns `{"status":"ok"}` before moving on.

Any other host works the same way; only two things matter:

- **one worker** — the WebSocket hub is in-process, so a second worker would split the room;
- **a writable path for SQLite** — the free Render tier has no persistent disk, so data
  resets on restart. For durable data, attach a disk and set
  `DATABASE_URL=sqlite:////var/data/zoomeet.db`, or point `DATABASE_URL` at Postgres
  (the models are plain SQLAlchemy and need no changes).

Set `JWT_SECRET` to something random in any deployment. `CORS_ORIGINS` only matters for
custom domains — every `*.vercel.app` origin is already allowed by `app/main.py`.

### 2. Frontend (Vercel)

In the Vercel project settings:

| Setting | Value |
| --- | --- |
| Root Directory | `frontend` ← **required**, the repo root has no `package.json` |
| Framework | Next.js (auto-detected) |
| Environment variable | `NEXT_PUBLIC_API_URL = https://<your-render-url>` |

`NEXT_PUBLIC_*` is inlined **at build time**, so after adding or changing it you must
**redeploy** — saving the variable alone changes nothing.

If the backend is missing or the variable is unset, the sign-in page says so explicitly
rather than failing silently.

### 3. Check it end to end

1. Open the site, sign in as `priya@zoomeet.dev` / `password123`.
2. **New Meeting**, allow camera and microphone.
3. In a second browser profile, sign in as `arjun@zoomeet.dev` and join the same
   meeting ID. Both tiles should show live video.
4. Stop the recording — the recap appears under **AI Notes**.

Both halves must be HTTPS: browsers only grant camera and microphone access on a
secure origin, and an HTTPS page can only open a `wss://` socket.

**One caveat for a live demo:** free Render instances sleep after ~15 minutes idle and
take ~50 seconds to wake, which drops WebSocket connections. Load the site once before
demoing, or use a paid instance.

## Verification

What was actually exercised before shipping:

- **Backend smoke test** — register → mocked OTP → login, wrong password rejected,
  scheduling, wrong passcode rejected, two participants joining, WebSocket welcome /
  peer-joined / SDP relay / state broadcast / chat / transcript ingest, recap
  generation, highlights, manual action items, the public share link, and rejoining a
  meeting that has ended (409).
- **Two-browser Playwright run** — two seeded users signed in, scheduled a meeting
  through the modal, started an instant meeting, both joined, and the second video
  element on each side reported live remote frames (`videoWidth > 0`), proving the
  peer-to-peer connection carried media. Chat crossed the mesh, a reaction fired, a
  moment was highlighted, the host ended the meeting for all, and the generated recap
  rendered with TL;DR, sections, action items and talk time.
- `npm run build` and `npx tsc --noEmit` are clean; `npx eslint .` reports no errors.
