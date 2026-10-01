from __future__ import annotations

import re
import uuid
from dataclasses import dataclass

from app.models import AnalyzeOptions, Candidate, Transcript, Word, bounded

STOP = set("a an the and or but to of in is it this that with for as at be on are was were i you we they he she my your our have has had do does not from so if then can could would should will just very really".split())
HOOK = re.compile(r"\b(why|how|what if|secret|mistake|nobody|never|most people|here's|the truth|imagine|actually|surprising|stop|don't)\b", re.I)
EDUCATION = re.compile(r"\b(learn|step|tip|because|means|example|explain|understand|practice|first|second|lesson|strategy|how to)\b", re.I)
STORY = re.compile(r"\b(i remember|years ago|one day|when i|last year|my first|i realized|we started|there was)\b", re.I)
EMOTION = re.compile(r"\b(love|afraid|terrified|heart|cry|proud|pain|hope|excited|lost everything)\b", re.I)
CONCLUSION = re.compile(r"\b(so that's|that's why|in short|the lesson|bottom line|remember|the point|finally|that's how|in the end)\b", re.I)
ABBREVIATIONS = {"mr.", "mrs.", "dr.", "prof.", "e.g.", "i.e.", "vs.", "etc."}


@dataclass
class Sentence:
    start: float
    end: float
    text: str
    words: list[Word]
    pause_after: float = 0.0
    complete: bool = True


def words_of(transcript: Transcript) -> list[Word]:
    return sorted([word for segment in transcript.segments for word in segment.words], key=lambda word: (word.start, word.end))


def sentences_of(transcript: Transcript) -> list[Sentence]:
    words = words_of(transcript)
    sentences = []
    current = []
    for index, word in enumerate(words):
        current.append(word)
        pause = max(0, words[index + 1].start - word.end) if index + 1 < len(words) else 1.0
        punctuation = bool(re.search(r"[.!?…][\"'”’]*$", word.word)) and word.word.lower() not in ABBREVIATIONS
        if punctuation or pause >= 0.9 or index == len(words) - 1:
            sentences.append(Sentence(current[0].start, current[-1].end, " ".join(w.word for w in current), current,
                                      pause_after=pause, complete=punctuation or pause >= 0.9))
            current = []
    return sentences


def keywords(text: str) -> set[str]:
    return {token.lower() for token in re.findall(r"\b\w+\b", text) if token.lower() not in STOP and len(token) > 2}


def headline_options(sentences: list[Sentence]) -> list[str]:
    if not sentences:
        return []
    options = []
    ranked = sorted(sentences, key=lambda s: len(keywords(s.text)) + 8 * bool(HOOK.search(s.text)), reverse=True)
    for sentence in [sentences[0], *ranked[:3]]:
        tokens = sentence.text.split()
        title = " ".join(tokens[:12]).strip(' .,!')
        if len(tokens) > 12:
            title += "…"
        if title and title not in options:
            options.append(title[0].upper() + title[1:])
    return options[:4]


def score_window(window: list[Sentence], min_duration: float, max_duration: float) -> tuple[float, list[str], list[str]]:
    first, last = window[0], window[-1]
    text = " ".join(s.text for s in window)
    word_count = sum(len(s.words) for s in window)
    duration = last.end - first.start
    opening_hook = bool(HOOK.search(first.text)) or "?" in first.text
    education = bool(EDUCATION.search(text))
    story = bool(STORY.search(text))
    emotion = bool(EMOTION.search(text))
    conclusion = bool(CONCLUSION.search(last.text))
    content_density = len(keywords(text)) / max(1, word_count)
    lexical_cohesion = sum(len(keywords(a.text) & keywords(b.text)) > 0 for a, b in zip(window, window[1:])) / max(1, len(window) - 1)
    # Transparent, deterministic local v1. This is a recommendation score, not a virality prediction.
    score = 4.0 + 1.15 * opening_hook + 0.65 * education + 0.4 * story + 0.3 * emotion
    score += min(1.2, content_density * 2.6) + 0.45 * lexical_cohesion + 0.55 * conclusion
    score += 0.5 * last.complete + 0.35 * (last.pause_after > 0.3)
    if re.match(r"^(and|but|so|then|because|which|that)\b", first.text, re.I):
        score -= 0.45
    midpoint = (min_duration + max_duration) / 2
    score += 0.4 * (1 - abs(duration - midpoint) / max(midpoint, 1))
    reasons = ["Starts at a sentence boundary", "Ends at a natural speech boundary"]
    if opening_hook:
        reasons.insert(0, "Opening question or strong hook language")
    if education:
        reasons.append("Contains explanatory or actionable language")
    if content_density > 0.38:
        reasons.append("High ratio of content words")
    if conclusion:
        reasons.append("Ends with a concluding statement")
    if story:
        reasons.append("Contains a personal storytelling cue")
    reasons.append(f"{round(duration)} seconds · within your preferred range")
    categories = []
    if opening_hook:
        categories.append("hook")
    if education:
        categories.append("educational")
    if story:
        categories.append("story")
    if emotion:
        categories.append("emotional")
    if re.search(r"\b(laugh|funny|hilarious|joke)\b", text, re.I):
        categories.append("funny")
    if re.search(r"\b(disagree|unpopular|controversial|everyone is wrong)\b", text, re.I):
        categories.append("controversial")
    if conclusion:
        categories.append("quotable")
    if not categories:
        categories.append("insight")
    return round(bounded(score, 0, 9.8), 1), reasons[:6], categories


def intersection_ratio(a: Candidate, b: Candidate) -> float:
    intersection = max(0, min(a.end_time, b.end_time) - max(a.start_time, b.start_time))
    return intersection / max(0.01, min(a.duration, b.duration))


def discover(transcript: Transcript, project_id: str, options: AnalyzeOptions, context=None) -> list[Candidate]:
    sentences = sentences_of(transcript)
    windows = []
    for index, first in enumerate(sentences):
        if context and index % 30 == 0:
            context.check_cancelled()
            context.update(75 + 12 * (index + 1) / max(1, len(sentences)), "Ranking sentence-aligned clip opportunities")
        for end in range(index, min(len(sentences), index + 100)):
            window = sentences[index:end + 1]
            duration = window[-1].end - first.start
            if duration > options.max_duration:
                break
            if duration < options.min_duration:
                continue
            # Limit candidates to meaningful ends, not arbitrary 30/60-second cuts.
            if not window[-1].complete:
                continue
            score, reasons, categories = score_window(window, options.min_duration, options.max_duration)
            headlines = headline_options(window)
            start = max(0, first.start - 0.08)
            stop = min(transcript.duration, window[-1].end + min(0.12, window[-1].pause_after / 2))
            windows.append(Candidate(
                id=uuid.uuid4().hex, project_id=project_id, start_time=round(start, 3), end_time=round(stop, 3),
                duration=round(stop - start, 3), title=headlines[0] if headlines else first.text[:80],
                hook=first.text, score=score, reasons=reasons, transcript=" ".join(s.text for s in window),
                categories=categories, headlines=headlines,
            ))
    selected = []
    for candidate in sorted(windows, key=lambda c: c.score, reverse=True):
        if all(intersection_ratio(candidate, existing) < 0.35 for existing in selected):
            selected.append(candidate)
        if len(selected) >= 24:
            break
    return selected


def align_api_candidates(raw: list[dict], transcript: Transcript, project_id: str, options: AnalyzeOptions) -> list[Candidate]:
    sentences = sentences_of(transcript)
    candidates = []
    if not sentences:
        return []
    for item in raw[:40]:
        try:
            start = float(item["startTime"])
            end = float(item["endTime"])
            if not 0 <= start < end <= transcript.duration + 1:
                continue
            first = min(range(len(sentences)), key=lambda i: abs(sentences[i].start - start))
            last = min(range(len(sentences)), key=lambda i: abs(sentences[i].end - end))
            if last < first:
                continue
            window = sentences[first:last + 1]
            duration = window[-1].end - window[0].start
            if not options.min_duration <= duration <= options.max_duration:
                continue
            score, reasons, categories = score_window(window, options.min_duration, options.max_duration)
            title = str(item.get("title", window[0].text))[:120]
            generated = item.get("headlines", [])
            headlines = [str(x)[:160] for x in generated[:4]] if isinstance(generated, list) else []
            candidate = Candidate(
                id=uuid.uuid4().hex, project_id=project_id, start_time=window[0].start, end_time=window[-1].end,
                duration=round(duration, 3), title=title, hook=window[0].text,
                score=round(bounded(float(item.get("score", score)), 0, 10), 1),
                reasons=["Selected by your transcript-only provider", *reasons[:4]],
                transcript=" ".join(s.text for s in window), categories=categories,
                headlines=list(dict.fromkeys([title, *headlines, *headline_options(window)]))[:4],
            )
            if all(intersection_ratio(candidate, existing) < 0.5 for existing in candidates):
                candidates.append(candidate)
        except (ValueError, TypeError, KeyError):
            continue
    return sorted(candidates, key=lambda c: c.score, reverse=True)[:24]
