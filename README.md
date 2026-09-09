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

## Live demo

**<https://zoom-clone-six-wine.vercel.app>**

**Continue with Google**, or create an account with an e-mail address. To see real
peer-to-peer video, sign in as a second user in another browser profile and join the
same meeting ID.

The backend runs on a free Render instance that sleeps after ~15 minutes idle and takes
~50 seconds to wake, so the first sign-in after a quiet spell can hang briefly. Load the
site once before you demo it.

---

## Table of contents

- [Live demo](#live-demo)
- [Features](#features)
- [Tech stack](#tech-stack)
- [Running it locally](#running-it-locally)
- [Signing in](#signing-in)
- [Database migrations](#database-migrations)
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
- **Continue with Google** — Google Identity Services on the client, ID-token
  verification against Google's JWKS on the server. Signing in with a Google address
  that already has a password account links the two rather than creating a second one.
- Register with e-mail, display name, job title and password.
- Two-step sign-up with a **mocked** verification code (fixed OTP, `123456`); Google
  accounts skip it, because Google has already verified the address.
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
| Auth | JWT (PyJWT) + PBKDF2-SHA256, Google Identity Services | Standard-library hashing; Google ID tokens verified locally against Google's JWKS |
| Schema | Alembic migrations | The schema is versioned and applied by `alembic upgrade head`, never created at boot |

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

cp .env.example .env                 # optional; every value has a working default
alembic upgrade head                 # create/update the database schema
uvicorn app.main:app --reload --port 8000
```

The database starts **empty** — create the first account through the sign-up screen.

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
sign in as two different users, start a meeting in one and paste its meeting ID
into **Join** in the other. Both windows need camera/microphone permission. Chrome or
Edge is recommended — live captions use the Web Speech API, which Firefox and Safari
do not implement (everything else works there).

---

## Signing in

Two ways in, and they end at the same account:

| Method | What happens |
| --- | --- |
| E-mail + password | Sign up, then enter the verification code. Passwords are PBKDF2-HMAC-SHA256 with a per-user salt. |
| Continue with Google | Google returns a signed ID token, the backend verifies it against Google's published keys and issues a Zoomeet token. |

An account created with Google has **no password**, so a password sign-in for that
address is refused with a message pointing at the Google button. Signing in with Google
using an address that already registered with a password **links** the Google identity
to that account instead of creating a duplicate — after which either method works.

### Turning on Google Sign-In

1. In the [Google Cloud console](https://console.cloud.google.com/apis/credentials),
   create an **OAuth 2.0 Client ID** of type *Web application*.
2. Add your site to **Authorised JavaScript origins** — `http://localhost:3000` for
   local development, and your deployed origin (e.g.
   `https://zoom-clone-six-wine.vercel.app`) for production. No redirect URI is needed;
   Google Identity Services never leaves the page.
3. Set `GOOGLE_CLIENT_ID` on the **backend** and restart it.

The browser reads the client id from `GET /api/config`, so rotating the credential is a
backend environment change with no frontend rebuild. With `GOOGLE_CLIENT_ID` unset the
button is simply not rendered and e-mail sign-in carries on working.

Google users are trusted for their **e-mail address only**. The display name and
profile picture are copied on first sign-in; everything else (personal meeting ID,
avatar colour) is generated exactly as it is for a password account.

---

## Database migrations

The schema is owned by [Alembic](https://alembic.sqlalchemy.org/), not by the
application: nothing creates tables at boot, because `create_all()` cannot apply a
change to a database that already exists — it silently leaves the old columns in place
and the app fails at the first query.

```bash
cd backend
alembic upgrade head                                   # apply everything
alembic revision --autogenerate -m "add x to y"        # after editing app/models.py
alembic downgrade -1                                   # step back one revision
alembic current                                        # what is applied right now
```

| Revision | What it does |
| --- | --- |
| `0001` | The initial schema — eleven tables. |
| `0002` | Google Sign-In: `users.google_sub`, and `users.password_hash` becomes nullable. |

`migrations/env.py` reads `DATABASE_URL` from the application settings, so migrations
always run against the same database the app talks to, and autogenerate compares
against the real models. SQLite cannot `ALTER` a column in place, so migrations run in
batch mode — the same revision applies on SQLite and on Postgres.

**Upgrading a database created by an older build** (one that made its own tables at
startup): tell Alembic that revision is already there, then upgrade.

```bash
alembic stamp 0001 && alembic upgrade head
```

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
- `services/google.py` — Google ID-token verification; the only code that trusts Google.
- `services/jobs.py` — the background worker; `enqueue()` is the only entry point.
- `migrations/` — Alembic revisions; the schema is applied from here, never at boot.
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
| `users` | `email` (unique), `display_name`, `password_hash` (NULL for Google-only accounts), `google_sub` (unique, NULL), `avatar_color`, `personal_meeting_id` (unique), `is_verified`, `last_seen_at` | `last_seen_at` powers the presence dot; `google_sub` is matched before e-mail, because a Google account can change its address but never its subject id |
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
| POST | `/api/auth/google` | Exchange a Google ID token for a Zoomeet token |
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
| POST | `/api/recordings/{id}/stop` | Stop and **queue** the recap; returns immediately with `status: processing` |
| POST | `/api/recordings/{id}/regenerate` | Re-run the summariser (also the recovery path for a failed recap job) |
| GET | `/api/recordings?q=` | List; `q` also searches transcript text |
| GET | `/api/recordings/{id}` | Full recap: summary, sections, action items, transcript, highlights, talk time |
| GET | `/api/shared/recordings/{share_token}` | Same payload, **no authentication** |
| POST | `/api/recordings/{id}/segments` | Append a transcript line (REST fallback) |
| POST | `/api/recordings/{id}/action-items` | Add an action item |
| PATCH/DELETE | `/api/action-items/{id}` | Edit / tick off / delete |
| POST | `/api/recordings/{id}/highlights` | Star a moment |
| DELETE | `/api/highlights/{id}` | Remove a highlight |

### Meta
`GET /api/health`, `GET /api/config` (ICE servers, the mock OTP for the UI hint, and
the Google client id — served rather than baked into the frontend build so the Google
credentials can be rotated without redeploying the frontend).

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

`recording` carries a `state`: `started`, then `processing` when someone stops it
(the recap is queued, not written yet), then `ready` — or `failed` if the job could
not produce a recap, which leaves the recording `processing` for a Regenerate.

The hub is in-process (`ws/hub.py`), which is why the backend runs as a single
worker. Scaling horizontally means replacing that one class with Redis pub/sub;
nothing else in the codebase knows how fan-out happens.

---

## How the AI notetaker works

1. **Capture.** While recording, each browser runs the Web Speech API. Final results
   are sent over the socket as `transcript` messages and stored as
   `transcript_segments` attributed to the speaker who sent them — so speaker
   diarisation is exact rather than guessed.
2. **Summarise.** Stopping the recording marks it `processing`, queues the work in
   `services/jobs.py` and returns — the request never waits for a summary. The worker
   then runs `services/summarizer.py` over the segments:
   - keyword salience over a stopword-filtered bag of words;
   - sentence scoring (keyword weight + length) for the TL;DR and key points;
   - regex classifiers for **decisions**, **risks/blockers**, **open questions** and
     **next steps**;
   - commitment detection ("I'll…", "can you…", "let's…", "action item") for action
     items, with small-talk filtered out, an assignee resolved from the sentence
     (named person, or the speaker for "I'll"), and a due hint ("by Friday").
3. **Store.** `summaries`, `summary_sections`, `action_items` are written in one
   transaction, and `talk_seconds` is rolled up onto each participant. The recording
   flips to `ready` and the meeting is told over its WebSocket; the recap page polls
   the same status for anyone who navigated there before the worker finished.

   The queue is in-process, like the WebSocket hub: one worker task, started with the
   app, running the blocking summariser in a thread so the event loop keeps serving
   sockets. A job still queued when the process stops is lost, and `regenerate` is the
   way back. Moving to Celery or RQ means replacing `JobQueue` and nothing else.

`summarise()` is pure — it takes `(speaker, text)` pairs plus the topic and returns a
`SummaryDraft`. Swapping in an LLM means reimplementing that one function; the
routers, schema and UI stay as they are.

---

## What is mocked

Per the brief, these are deliberately simulated:

- **Phone/e-mail verification** — one fixed OTP (`MOCK_OTP`, default `123456`). Nothing
  is sent, so the sign-up screen shows the code. Google sign-in is *not* mocked: those
  addresses are verified by Google. Wiring a mail provider and dropping `MOCK_OTP` is
  the one change left before password sign-up is production-grade.
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
- **Test coverage is partial.** `backend/tests/` covers the sign-in paths, including
  Google ID-token verification; the meeting, WebSocket and recap paths are still
  verified by hand (see below). A Playwright suite is the next thing to add.

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
Start:          alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port $PORT --workers 1
Health check:   /api/health
```

The start command runs `alembic upgrade head` before uvicorn, so a deploy that changes
the schema applies it exactly once and a failed migration stops the release instead of
booting against the wrong tables.

Note the service URL it gives you (e.g. `https://zoomeet-api.onrender.com`) and check
`https://<that-url>/api/health` returns `{"status":"ok"}` before moving on.

Any other host works the same way; only two things matter:

- **one worker** — the WebSocket hub is in-process, so a second worker would split the room;
- **durable storage** — the free Render tier has **no persistent disk**, so the default
  SQLite file is lost on every restart and every account with it. For real use, attach
  a disk and set `DATABASE_URL=sqlite:////var/data/zoomeet.db`, or point `DATABASE_URL`
  at Postgres (the models are plain SQLAlchemy and the migrations run unchanged).

Environment:

| Variable | Why it matters |
| --- | --- |
| `JWT_SECRET` | Signs access tokens. Leave it at the development default and anyone can mint a token for any account — the API logs a warning at startup if you do. `render.yaml` generates one. |
| `DATABASE_URL` | See above. The default SQLite file is fine locally and wrong on a disk-less host. |
| `GOOGLE_CLIENT_ID` | Turns on "Continue with Google". Unset, the button is hidden. |
| `CORS_ORIGINS` | Only needed for custom domains — every `*.vercel.app` origin is already allowed by `app/main.py`. |

### 2. Frontend (Vercel)

The deployed frontend lives at **<https://zoom-clone-six-wine.vercel.app>**.

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

1. Open the site and create an account (or **Continue with Google**).
2. **New Meeting**, allow camera and microphone.
3. In a second browser profile, sign in as a second user and join the same
   meeting ID. Both tiles should show live video.
4. Stop the recording — the recap appears under **AI Notes**.

Both halves must be HTTPS: browsers only grant camera and microphone access on a
secure origin, and an HTTPS page can only open a `wss://` socket.

**One caveat for a live demo:** free Render instances sleep after ~15 minutes idle and
take ~50 seconds to wake, which drops WebSocket connections. Load the site once before
demoing, or use a paid instance.

## Verification

```bash
cd backend
pip install -r requirements.txt -r requirements-dev.txt
pytest                # 16 tests: sign-in paths, and the queued-recap flow
```

The suite builds its database by running the real Alembic migrations, so a broken
revision fails the tests. The Google tests sign their own ID tokens with a throwaway
RSA key and point the verifier at it, exercising the real signature, audience, issuer
and expiry checks without calling Google. They cover: a new Google account arriving
verified; repeat sign-in reusing the account; a Google identity linking to an existing
password account without dropping its password; password sign-in refused on a
Google-only account; and rejection of unverified e-mail, wrong audience, wrong issuer,
expired tokens and unparseable credentials. The recording tests cover the queued
recap end to end: `stop` returning `processing` with no summary, the worker publishing
a `ready` recap with talk time, a failed job broadcasting `failed` and leaving the
recording `processing` rather than claiming a recap that does not exist, and
`regenerate` recovering it.

Also checked: `alembic upgrade head` → `alembic check` reports no drift between the
migrations and `app/models.py`, and `alembic downgrade base` → `upgrade head` round
trips cleanly. On the frontend, `npm run build` and `npx tsc --noEmit` succeed and
`npx eslint .` reports no errors.

What was exercised by hand:

- **Backend smoke test** — register → mocked OTP → login, wrong password rejected,
  scheduling, wrong passcode rejected, two participants joining, WebSocket welcome /
  peer-joined / SDP relay / state broadcast / chat / transcript ingest, recap
  generation, highlights, manual action items, the public share link, and rejoining a
  meeting that has ended (409).
- **Two-browser Playwright run** — two users signed in, scheduled a meeting
  through the modal, started an instant meeting, both joined, and the second video
  element on each side reported live remote frames (`videoWidth > 0`), proving the
  peer-to-peer connection carried media. Chat crossed the mesh, a reaction fired, a
  moment was highlighted, the host ended the meeting for all, and the generated recap
  rendered with TL;DR, sections, action items and talk time.

These two predate the move off demo data and were run against the seeded workspace;
the code paths they cover are unchanged.
