"""The "AI" behind the Fathom-style recap.

This is a deterministic, dependency-free extractive summariser: it scores
sentences against keyword salience, classifies utterances into decisions,
questions, risks and next steps, and pulls action items out of commitment
phrases. Swapping it for a real LLM means replacing `summarise()` only — the
`SummaryDraft` contract and everything downstream stay the same.
"""
from __future__ import annotations

import re
from collections import Counter
from dataclasses import dataclass, field

STOPWORDS = {
    "a", "about", "actually", "after", "again", "all", "also", "am", "an", "and", "any",
    "are", "as", "at", "back", "be", "because", "been", "before", "being", "but", "by", "can",
    "could", "did", "do", "does", "doing", "done", "down", "for", "from", "get", "getting", "go",
    "going", "good", "got", "had", "has", "have", "he", "her", "here", "hey", "him", "his", "how",
    "i", "if", "in", "into", "is", "it", "its", "just", "kind", "know", "like", "look", "lot",
    "make", "many", "maybe", "me", "mean", "more", "most", "much", "my", "no", "not", "now", "of",
    "off", "ok", "okay", "on", "one", "only", "or", "other", "our", "out", "over", "really",
    "right", "said", "say", "see", "she", "should", "so", "some", "sort", "still", "sure", "take",
    "than", "that", "the", "their", "them", "then", "there", "these", "they", "thing", "things",
    "think", "this", "those", "through", "to", "too", "two", "up", "us", "use", "very", "want",
    "was", "way", "we", "well", "were", "what", "when", "where", "which", "while", "who", "why",
    "will", "with", "would", "yeah", "yes", "you", "your",
    # Contractions and filler that survive tokenisation but carry no topic signal.
    "i'll", "we'll", "you'll", "it's", "that's", "let's", "don't", "doesn't", "can't", "won't",
    "i'm", "we're", "you're", "there's", "here's", "we've", "i've", "gonna", "alright", "thanks",
}

COMMITMENT_PATTERNS = [
    r"\bi(?:'| wi)?ll\b", r"\bwe(?:'| wi)?ll\b", r"\bi am going to\b", r"\bi'm going to\b",
    r"\bwe are going to\b", r"\blet's\b", r"\bcan you\b", r"\bcould you\b", r"\bplease\b",
    r"\baction item\b", r"\bfollow up\b", r"\btake (?:this|that) on\b", r"\bi'll own\b",
    r"\bneed to\b", r"\bhas to\b", r"\bshould (?:send|share|write|ship|draft|prepare|review)\b",
    r"\bi'll (?:send|share|write|ship|draft|prepare|review|set up|sync)\b",
]

DECISION_PATTERNS = [
    r"\bwe(?:'ve| have)? decided\b", r"\bdecision is\b", r"\blet's go with\b", r"\bwe agreed\b",
    r"\bagreed\b", r"\bwe're going with\b", r"\bfinal call\b", r"\bsign(?:ed)? off\b",
    r"\bapproved\b", r"\bthe plan is\b",
]

RISK_PATTERNS = [
    r"\bblocked\b", r"\bblocker\b", r"\brisk\b", r"\bconcern(?:ed|s)?\b", r"\bworried\b",
    r"\bslip(?:ping|page)?\b", r"\bbehind schedule\b", r"\bproblem\b", r"\bissue\b",
    r"\bbug\b", r"\bfail(?:ing|ed|ure)\b", r"\bdelay(?:ed)?\b",
]

# Small talk that matches a commitment pattern but is not an action item.
SMALL_TALK_PATTERNS = [
    r"\blet's (?:kick off|start|begin|get started|dive in|jump in|wrap up|move on)\b",
    r"\bcan you hear me\b", r"\bcan you see (?:my|the) screen\b",
    r"\blet's give (?:it|them) a (?:minute|moment)\b",
]

NEXT_STEP_PATTERNS = [
    r"\bnext week\b", r"\btomorrow\b", r"\bby (?:monday|tuesday|wednesday|thursday|friday|eod|end of)\b",
    r"\bnext step\b", r"\bnext time\b", r"\bfollow up\b", r"\bcircle back\b", r"\bsync (?:on|again)\b",
]

DUE_PATTERNS = [
    r"\bby (?:end of day|eod|eow|end of week|monday|tuesday|wednesday|thursday|friday|saturday|sunday|tonight|tomorrow|next week|friday)\b",
    r"\bthis (?:afternoon|week|sprint)\b", r"\bnext (?:week|sprint|month)\b", r"\btomorrow\b",
]

_SENTENCE_SPLIT = re.compile(r"(?<=[.!?])\s+")


@dataclass
class ActionItemDraft:
    text: str
    assignee_name: str | None
    due_hint: str | None
    source_segment_index: int


@dataclass
class SectionDraft:
    title: str
    bullets: list[str]


@dataclass
class SummaryDraft:
    headline: str
    tldr: str
    keywords: list[str]
    sections: list[SectionDraft] = field(default_factory=list)
    action_items: list[ActionItemDraft] = field(default_factory=list)
    generator: str = "rule-based-v1"


def _matches(text: str, patterns: list[str]) -> bool:
    lowered = text.lower()
    return any(re.search(p, lowered) for p in patterns)


def _due_hint(text: str) -> str | None:
    lowered = text.lower()
    for pattern in DUE_PATTERNS:
        match = re.search(pattern, lowered)
        if match:
            return match.group(0).strip()
    return None


def _tokens(text: str) -> list[str]:
    return [w for w in re.findall(r"[a-zA-Z][a-zA-Z'-]{2,}", text.lower()) if w not in STOPWORDS]


def _keywords(texts: list[str], limit: int = 8) -> list[str]:
    counter = Counter()
    for text in texts:
        counter.update(set(_tokens(text)))
    return [word for word, count in counter.most_common(limit) if count > 1] or [
        word for word, _ in counter.most_common(limit)
    ]


def _sentences(text: str) -> list[str]:
    return [s.strip() for s in _SENTENCE_SPLIT.split(text.strip()) if len(s.strip()) > 2]


def _clean(text: str) -> str:
    text = re.sub(r"\s+", " ", text).strip()
    if text and text[-1] not in ".!?":
        text += "."
    return text[0].upper() + text[1:] if text else text


def _assignee(text: str, speaker: str, known_names: list[str]) -> str | None:
    """"Can you ..., Priya" assigns to Priya; "I'll ..." assigns to the speaker."""
    lowered = text.lower()
    for name in known_names:
        first = name.split()[0].lower()
        if len(first) > 2 and re.search(rf"\b{re.escape(first)}\b", lowered):
            if re.search(r"\b(can|could|would|please|will)\b", lowered):
                return name
    if re.search(r"\b(i'll|i will|i'm going to|i am going to)\b", lowered):
        return speaker
    if re.search(r"\b(we'll|we will|let's)\b", lowered):
        return None
    return speaker


def summarise(
    utterances: list[tuple[str, str]],
    topic: str,
    participant_names: list[str] | None = None,
) -> SummaryDraft:
    """Summarise `(speaker_name, text)` pairs in transcript order."""
    participant_names = participant_names or []
    texts = [text for _, text in utterances]

    if not texts:
        return SummaryDraft(
            headline=topic or "Meeting recap",
            tldr="No speech was captured for this meeting, so there is nothing to summarise yet.",
            keywords=[],
            sections=[SectionDraft("Notes", ["Recording contains no transcript."])],
        )

    keywords = _keywords(texts)
    salience = {word: rank for rank, word in enumerate(reversed(keywords), start=1)}

    decisions: list[str] = []
    questions: list[str] = []
    risks: list[str] = []
    next_steps: list[str] = []
    scored: list[tuple[float, str]] = []
    action_items: list[ActionItemDraft] = []
    seen_actions: set[str] = set()

    for index, (speaker, text) in enumerate(utterances):
        for sentence in _sentences(text):
            score = sum(salience.get(word, 0) for word in _tokens(sentence))
            score += min(len(sentence.split()), 25) * 0.1
            scored.append((score, _clean(sentence)))

            if _matches(sentence, DECISION_PATTERNS):
                decisions.append(f"{speaker}: {_clean(sentence)}")
            if sentence.rstrip().endswith("?") and len(sentence.split()) > 3:
                questions.append(f"{speaker}: {_clean(sentence)}")
            if _matches(sentence, RISK_PATTERNS):
                risks.append(f"{speaker}: {_clean(sentence)}")
            if _matches(sentence, NEXT_STEP_PATTERNS):
                next_steps.append(f"{speaker}: {_clean(sentence)}")

            if (
                _matches(sentence, COMMITMENT_PATTERNS)
                and not _matches(sentence, SMALL_TALK_PATTERNS)
                and len(sentence.split()) >= 4
            ):
                key = re.sub(r"\W+", "", sentence.lower())[:60]
                if key not in seen_actions:
                    seen_actions.add(key)
                    action_items.append(
                        ActionItemDraft(
                            text=_clean(sentence),
                            assignee_name=_assignee(sentence, speaker, participant_names),
                            due_hint=_due_hint(sentence),
                            source_segment_index=index,
                        )
                    )

    scored.sort(key=lambda pair: pair[0], reverse=True)
    top = [sentence for _, sentence in scored[:5]]
    tldr = " ".join(top[:3])

    speakers = list(dict.fromkeys(speaker for speaker, _ in utterances))
    headline = topic.strip() or "Meeting recap"

    sections: list[SectionDraft] = [
        SectionDraft(
            "Overview",
            [
                f"{len(speakers)} speaker(s): {', '.join(speakers)}.",
                f"{len(utterances)} spoken segments captured.",
                f"Main themes: {', '.join(keywords[:5])}." if keywords else "No dominant theme detected.",
            ],
        ),
        SectionDraft("Key points", top[:5]),
    ]
    if decisions:
        sections.append(SectionDraft("Decisions", _dedupe(decisions)[:5]))
    if risks:
        sections.append(SectionDraft("Risks & blockers", _dedupe(risks)[:5]))
    if questions:
        sections.append(SectionDraft("Open questions", _dedupe(questions)[:5]))
    if next_steps:
        sections.append(SectionDraft("Next steps", _dedupe(next_steps)[:5]))

    return SummaryDraft(
        headline=headline,
        tldr=tldr,
        keywords=keywords,
        sections=sections,
        action_items=action_items[:12],
    )


def _dedupe(values: list[str]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for value in values:
        key = re.sub(r"\W+", "", value.lower())
        if key not in seen:
            seen.add(key)
            result.append(value)
    return result
