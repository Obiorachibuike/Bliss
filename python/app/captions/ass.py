from __future__ import annotations

import math

from app.models import RenderSettings, Word


def timestamp(value: float) -> str:
    centiseconds = max(0, round(value * 100))
    seconds, centiseconds = divmod(centiseconds, 100)
    minutes, seconds = divmod(seconds, 60)
    hours, minutes = divmod(minutes, 60)
    return f"{hours}:{minutes:02d}:{seconds:02d}.{centiseconds:02d}"


def color(value: str, alpha: str = "00") -> str:
    value = value.lstrip("#")
    return f"&H{alpha}{value[4:6]}{value[2:4]}{value[0:2]}"


def escape(value: str) -> str:
    # Strip ASS override-control syntax from user text; braces/backslashes must not inject tags.
    return value.replace("\\", "＼").replace("{", "(").replace("}", ")").replace("\n", " ").replace("\r", " ")


def group_words(words: list[Word], maximum: int) -> list[list[Word]]:
    groups, current = [], []
    for word in words:
        if current and (len(current) >= maximum or word.start - current[-1].end > 0.6):
            groups.append(current)
            current = []
        current.append(word)
        if word.word.endswith((".", "?", "!")):
            groups.append(current)
            current = []
    if current:
        groups.append(current)
    return groups


def alignment(position: str, horizontal: str = "center") -> int:
    row = {"bottom": 0, "center": 3, "top": 6}[position]
    return row + {"left": 1, "center": 2, "right": 3}[horizontal]


def build_ass(settings: RenderSettings) -> str:
    caption = settings.caption_settings
    headline = settings.headline_settings
    # Font settings use 1080px design units, consistent with the preview scaling.
    scale = settings.width / 1080
    size = round(caption.font_size * scale)
    safe_x = round(settings.width * 0.08)
    safe_y = round(settings.height * 0.14)
    bold = -1 if caption.style in {"bold", "creator", "karaoke", "highlight"} else 0
    outline = max(1, round(3 * scale)) if caption.style not in {"minimal", "clean"} else 1
    border = 3 if caption.style in {"classic", "highlight"} else 1
    header = f"""[Script Info]
ScriptType: v4.00+
PlayResX: {settings.width}
PlayResY: {settings.height}
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Caption,{caption.font},{size},{color(caption.color)},{color(caption.highlight_color)},{color(caption.background, '40')},{color(caption.background, '80')},{bold},0,0,0,100,100,0,0,{border},{outline},0,{alignment(caption.position)},{safe_x},{safe_x},{safe_y},1
Style: Headline,{headline.font},{round(headline.font_size * scale)},{color(headline.color)},&H00FFFFFF,{color(headline.background, '20')},{color(headline.background, '20')},-1,0,0,0,100,100,0,0,3,{max(2, round(10 * scale))},0,{alignment(headline.position, headline.alignment)},{safe_x},{safe_x},{round(settings.height * 0.08)},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""
    events = []
    duration = settings.end_time - settings.start_time
    if headline.enabled and headline.text.strip():
        events.append(f"Dialogue: 1,{timestamp(0)},{timestamp(duration)},Headline,,0,0,0,,{escape(headline.text)}")
    if caption.enabled:
        for group in group_words(settings.words, caption.max_words):
            for index, word in enumerate(group):
                start = max(0, word.start - settings.start_time)
                # Hold each word through its trailing pause until the next word in this group.
                end = min(duration, (group[index + 1].start if index + 1 < len(group) else word.end) - settings.start_time)
                if end <= start:
                    continue
                chunks = []
                for other in group:
                    text = escape(other.word)
                    if caption.style in {"bold", "creator", "karaoke"}:
                        text = text.upper()
                    tint = caption.highlight_color if other.id == word.id and caption.style in {"creator", "karaoke", "highlight"} else caption.color
                    chunks.append(f"{{\\c{color(tint)}&}}{text}")
                animation = ""
                if caption.animation == "fade":
                    animation = "{\\fad(45,0)}"
                elif caption.animation == "pop":
                    milliseconds = min(90, max(10, math.floor((end - start) * 500)))
                    animation = f"{{\\fscx95\\fscy95\\t(0,{milliseconds},\\fscx100\\fscy100)}}"
                events.append(f"Dialogue: 2,{timestamp(start)},{timestamp(end)},Caption,,0,0,0,,{animation}{' '.join(chunks)}")
    return header + "\n".join(events) + "\n"
