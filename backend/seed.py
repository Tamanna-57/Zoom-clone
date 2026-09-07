"""Seed the SQLite database with a demo workspace.

Run with:  python seed.py [--fresh]

Creates six colleagues, an address book, upcoming and past meetings, in-call
chat, and three fully transcribed recordings whose AI recaps are produced by the
real summariser (not hard-coded), so the Fathom pages are populated on first run.
"""
from __future__ import annotations

import argparse
import sys
from datetime import datetime, timedelta, timezone

from app.database import Base, SessionLocal, engine
from app.models import (
    ChatMessage,
    Contact,
    Highlight,
    Invitee,
    Meeting,
    MeetingStatus,
    Participant,
    ParticipantRole,
    Recording,
    RecordingStatus,
    TranscriptSegment,
    User,
)
from app.routers.auth import color_for
from app.routers.recordings import generate_summary
from app.security import hash_password, new_meeting_code, new_passcode, new_share_token
from app.serializers import refresh_talk_time

PASSWORD = "password123"

PEOPLE = [
    ("priya@zoomeet.dev", "Priya Nair", "VP Product", "1002003001"),
    ("arjun@zoomeet.dev", "Arjun Mehta", "Staff Engineer", "1002003002"),
    ("dev@zoomeet.dev", "Dev Sharma", "Design Lead", "1002003003"),
    ("meera@zoomeet.dev", "Meera Iyer", "Engineering Manager", "1002003004"),
    ("rahul@zoomeet.dev", "Rahul Verma", "Data Analyst", "1002003005"),
    ("sara@zoomeet.dev", "Sara Khan", "Customer Success", "1002003006"),
]

# (speaker index, text) — timings are generated from word counts.
LAUNCH_REVIEW = [
    (0, "Alright, let's kick off the Q3 launch review. I want to leave with a firm date."),
    (1, "Before we start — can everyone see the burndown board I shared?"),
    (2, "Yes, it's coming through clearly on my end."),
    (0, "Good. Arjun, where does the checkout rewrite stand?"),
    (1, "Backend is done and deployed to staging. The client is blocked on the payments SDK upgrade, which is a risk for the Friday date."),
    (0, "How big is that upgrade, realistically?"),
    (1, "Two days if the sandbox keys arrive today. Four if we have to rebuild the webhook handlers."),
    (2, "The design side is ready. I finished the new pricing page yesterday and handed the specs to engineering."),
    (0, "We agreed last sprint that the pricing page ships first, so that's on track at least."),
    (3, "One concern from my side: we have no rollback plan if checkout regresses in production."),
    (0, "That's fair. Meera, can you write up a rollback runbook by Thursday?"),
    (3, "Yes, I'll draft the rollback runbook and put it in the launch doc by Thursday."),
    (1, "I'll chase the sandbox keys with the payments vendor this afternoon."),
    (2, "Do we need legal sign-off on the new pricing copy before it goes live?"),
    (0, "Good catch. I'll send the pricing copy to legal today and ask for a 48-hour turnaround."),
    (3, "If legal slips, do we still launch the checkout without the new pricing?"),
    (0, "No. The plan is that pricing and checkout ship together, or neither ships."),
    (1, "Understood. Then Friday is only realistic if the keys land today."),
    (0, "Let's decide on Wednesday. If the keys aren't in by Wednesday morning we move the launch to the following Tuesday."),
    (2, "I'll prepare both sets of marketing assets so either date works."),
    (3, "One more risk: our staging environment is running an old database schema, so the migration is untested."),
    (1, "I'll run the migration against a staging clone tomorrow and report back."),
    (0, "Great. To summarise: keys today, rollback runbook Thursday, legal in parallel, go/no-go Wednesday morning."),
    (2, "Works for me."),
    (3, "Same here. I'll circle back once the runbook draft is up."),
]

DESIGN_CRIT = [
    (2, "Thanks for joining the design critique. I want feedback on the new meeting recap layout."),
    (0, "Screen looks good. My first reaction is that the action items are buried below the fold."),
    (2, "That's the tension — the summary is what people scan, but the action items are what they act on."),
    (4, "From the usage data, seventy percent of recap views scroll past the summary within eight seconds."),
    (0, "That settles it. Let's move action items above the transcript."),
    (2, "Agreed. I'll rework the recap layout so action items sit directly under the TL;DR."),
    (4, "Can you also add a filter for items assigned to me? That's the most requested thing in support tickets."),
    (5, "Confirming that — I get at least three tickets a week asking for a personal task view."),
    (2, "Noted. I'll add an assignee filter to the action items panel."),
    (0, "What about the transcript search? Is it fast enough on a two hour call?"),
    (4, "It's fine up to about nine hundred segments, then it gets sluggish."),
    (0, "That's a problem for enterprise calls. We should paginate or virtualise that list."),
    (2, "I'll spec the virtualised transcript and hand it to Arjun next week."),
    (5, "One thing customers keep asking for is a shareable recap link that doesn't require an account."),
    (0, "We already have share tokens on the backend. Dev, can you design the public recap view?"),
    (2, "Yes, I'll design the public recap view and share a prototype by Monday."),
    (4, "I'll pull the numbers on how many recaps get shared externally today."),
    (0, "Perfect. Let's regroup next week with the prototype and the data."),
]

WEEKLY_SYNC = [
    (3, "Morning everyone. Quick weekly sync, twenty minutes, then we're done."),
    (1, "Platform update: the signaling service is stable, no dropped connections since Tuesday's fix."),
    (3, "Good. What caused it?"),
    (1, "A race condition when two peers joined within the same tick. It's fixed and covered by a test now."),
    (4, "Analytics side, meeting minutes are up eighteen percent week over week."),
    (5, "Support volume is flat, but three customers asked about recording retention limits."),
    (3, "Do we have a documented retention policy?"),
    (5, "Not one I can point a customer to. Can someone write that up?"),
    (3, "I'll write the retention policy draft and send it round by Wednesday."),
    (1, "I'm blocked on the load test environment — I need a bigger staging box."),
    (3, "I'll raise the infra request today so you're unblocked."),
    (4, "One risk: we still have no alerting on transcript failures, so we only find out from users."),
    (1, "That's a real gap. I'll add alerting on transcript failures this sprint."),
    (3, "Anything else? No? Then let's wrap up early."),
]


def words_ms(text: str) -> int:
    """Rough utterance duration: 400ms per word, floored at one second."""
    return max(len(text.split()) * 400, 1000)


def build_transcript(recording: Recording, users: list[User], script, db) -> None:
    cursor = 0
    for speaker_index, text in script:
        speaker = users[speaker_index]
        duration = words_ms(text)
        db.add(
            TranscriptSegment(
                recording_id=recording.id,
                speaker_id=speaker.id,
                speaker_name=speaker.display_name,
                start_ms=cursor,
                end_ms=cursor + duration,
                text=text,
            )
        )
        # A beat of silence between speakers keeps the timeline believable.
        cursor += duration + 600
    recording.duration_seconds = cursor // 1000
    db.flush()


def make_meeting(db, *, host, topic, start, minutes, participants, status, agenda=None):
    meeting = Meeting(
        code=new_meeting_code(),
        topic=topic,
        passcode=new_passcode(),
        host_id=host.id,
        status=status,
        scheduled_start=start,
        duration_minutes=minutes,
        agenda=agenda,
        auto_record=True,
        started_at=start if status != MeetingStatus.scheduled else None,
        ended_at=start + timedelta(minutes=minutes) if status == MeetingStatus.ended else None,
    )
    db.add(meeting)
    db.flush()
    for user in participants:
        db.add(Invitee(meeting_id=meeting.id, user_id=user.id))
        if status != MeetingStatus.scheduled:
            db.add(
                Participant(
                    meeting_id=meeting.id,
                    user_id=user.id,
                    display_name=user.display_name,
                    role=ParticipantRole.host if user.id == host.id else ParticipantRole.participant,
                    is_online=status == MeetingStatus.live,
                    is_muted=user.id != host.id,
                    joined_at=start,
                    left_at=None if status == MeetingStatus.live else start + timedelta(minutes=minutes),
                )
            )
    db.flush()
    return meeting


def record_meeting(db, meeting, users, script, started_at):
    recording = Recording(
        meeting_id=meeting.id,
        title=meeting.topic,
        status=RecordingStatus.processing,
        started_at=started_at,
        ended_at=started_at + timedelta(minutes=meeting.duration_minutes),
        share_token=new_share_token(),
    )
    db.add(recording)
    db.flush()
    build_transcript(recording, users, script, db)
    db.commit()

    generate_summary(db, recording)
    refresh_talk_time(db, recording)
    recording.status = RecordingStatus.ready
    db.commit()
    return recording


def seed(fresh: bool) -> None:
    if fresh:
        Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)

    db = SessionLocal()
    try:
        if db.query(User).count():
            print("Database already has users. Re-run with --fresh to rebuild it.")
            return

        users: list[User] = []
        for email, name, title, pmi in PEOPLE:
            user = User(
                email=email,
                display_name=name,
                job_title=title,
                password_hash=hash_password(PASSWORD),
                avatar_color=color_for(email),
                personal_meeting_id=pmi,
                is_verified=True,
            )
            db.add(user)
            users.append(user)
        db.flush()

        # Everyone knows everyone; the first two are starred for each user.
        for owner in users:
            for index, other in enumerate(u for u in users if u.id != owner.id):
                db.add(Contact(owner_id=owner.id, contact_id=other.id, starred=index < 2))
        db.flush()

        priya, arjun, dev, meera, rahul, sara = users
        now = datetime.now(timezone.utc).replace(tzinfo=None, microsecond=0)

        # ---------------------------------------------------------- past meetings
        launch = make_meeting(
            db, host=priya, topic="Q3 Launch Review",
            start=now - timedelta(days=2, hours=3), minutes=45,
            participants=[priya, arjun, dev, meera], status=MeetingStatus.ended,
            agenda="Checkout rewrite status, pricing page, go/no-go date.",
        )
        record_meeting(db, launch, users, LAUNCH_REVIEW, launch.started_at)

        crit = make_meeting(
            db, host=dev, topic="Design Critique — Meeting Recap",
            start=now - timedelta(days=1, hours=5), minutes=30,
            participants=[dev, priya, rahul, sara], status=MeetingStatus.ended,
            agenda="Walk through the recap layout and gather feedback.",
        )
        record_meeting(db, crit, users, DESIGN_CRIT, crit.started_at)

        weekly = make_meeting(
            db, host=meera, topic="Weekly Engineering Sync",
            start=now - timedelta(hours=20), minutes=20,
            participants=[meera, arjun, rahul, sara], status=MeetingStatus.ended,
            agenda="Round-table status and blockers.",
        )
        weekly_recording = record_meeting(db, weekly, users, WEEKLY_SYNC, weekly.started_at)

        db.add_all(
            [
                Highlight(
                    recording_id=weekly_recording.id, created_by_id=meera.id,
                    created_by_name=meera.display_name, label="Signaling race condition fix",
                    at_ms=12_000, note="Worth repeating in the release notes.",
                ),
                Highlight(
                    recording_id=weekly_recording.id, created_by_id=rahul.id,
                    created_by_name=rahul.display_name, label="No alerting on transcript failures",
                    at_ms=95_000, note="Biggest gap raised this week.",
                ),
            ]
        )

        # --------------------------------------------------------- in-call chat
        db.add_all(
            [
                ChatMessage(meeting_id=launch.id, sender_id=dev.id, sender_name=dev.display_name,
                            body="Sharing the pricing page Figma in a sec.",
                            created_at=launch.started_at + timedelta(minutes=4)),
                ChatMessage(meeting_id=launch.id, sender_id=meera.id, sender_name=meera.display_name,
                            body="Rollback runbook template: /docs/runbooks/rollback",
                            created_at=launch.started_at + timedelta(minutes=12)),
                ChatMessage(meeting_id=launch.id, sender_id=arjun.id, sender_name=arjun.display_name,
                            recipient_id=priya.id, recipient_name=priya.display_name,
                            body="Privately — I think Friday is optimistic.",
                            created_at=launch.started_at + timedelta(minutes=15)),
                ChatMessage(meeting_id=crit.id, sender_id=sara.id, sender_name=sara.display_name,
                            body="Ticket references: #4412, #4487, #4501",
                            created_at=crit.started_at + timedelta(minutes=9)),
            ]
        )

        # ------------------------------------------------------- live + upcoming
        live = make_meeting(
            db, host=arjun, topic="Incident Review — Signaling Drops",
            start=now - timedelta(minutes=8), minutes=30,
            participants=[arjun, meera, rahul], status=MeetingStatus.live,
            agenda="Timeline, root cause and follow-ups for Tuesday's incident.",
        )
        db.add(
            Recording(
                meeting_id=live.id, title=live.topic, status=RecordingStatus.recording,
                started_at=live.started_at, share_token=new_share_token(),
            )
        )

        make_meeting(
            db, host=priya, topic="Roadmap Planning — Q4",
            start=now + timedelta(hours=3), minutes=60,
            participants=[priya, dev, meera, rahul], status=MeetingStatus.scheduled,
            agenda="Shape the Q4 themes and pick the top three bets.",
        )
        make_meeting(
            db, host=sara, topic="Customer Onboarding — Northwind",
            start=now + timedelta(days=1, hours=2), minutes=45,
            participants=[sara, priya, arjun], status=MeetingStatus.scheduled,
            agenda="Walk Northwind through setup and answer security questions.",
        )
        make_meeting(
            db, host=meera, topic="1:1 — Meera & Arjun",
            start=now + timedelta(days=2), minutes=30,
            participants=[meera, arjun], status=MeetingStatus.scheduled,
        )

        # Personal meeting rooms, so "Start with PMI" works right away.
        for user in users:
            db.add(
                Meeting(
                    code=user.personal_meeting_id,
                    topic=f"{user.display_name}'s Personal Meeting Room",
                    passcode=new_passcode(),
                    host_id=user.id,
                    is_personal_room=True,
                    status=MeetingStatus.scheduled,
                )
            )

        db.commit()

        print("Seeded successfully.")
        print(f"  users:      {db.query(User).count()} (password for all: {PASSWORD})")
        print(f"  meetings:   {db.query(Meeting).count()}")
        print(f"  recordings: {db.query(Recording).count()}")
        print(f"  segments:   {db.query(TranscriptSegment).count()}")
        print("\nSign in with any of:")
        for email, name, *_ in PEOPLE:
            print(f"  {email:24} {name}")
    finally:
        db.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Seed the Zoomeet demo database.")
    parser.add_argument("--fresh", action="store_true", help="drop every table first")
    args = parser.parse_args()
    seed(args.fresh)
    sys.exit(0)
