from __future__ import annotations

import math
from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np

from app.models import bounded


@dataclass
class CropPoint:
    time: float
    center_x: float
    detected: bool = False


def smooth_centers(values: list[float], alpha: float = 0.2) -> list[float]:
    if not values:
        return []
    result = [values[0]]
    for value in values[1:]:
        result.append(result[-1] + alpha * (value - result[-1]))
    return result


def interpolate(points: list[CropPoint], timestamp: float, fallback: float) -> float:
    if not points:
        return fallback
    if timestamp <= points[0].time:
        return points[0].center_x
    for first, second in zip(points, points[1:]):
        if timestamp <= second.time:
            ratio = (timestamp - first.time) / max(0.001, second.time - first.time)
            return first.center_x + (second.center_x - first.center_x) * ratio
    return points[-1].center_x


def track(source: Path, start: float, end: float, width: int, strategy: str, context=None) -> list[CropPoint]:
    if strategy in {"center", "manual"}:
        return []
    cap = cv2.VideoCapture(str(source))
    if not cap.isOpened():
        return []
    cascade = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_frontalface_default.xml")
    if cascade.empty():
        cap.release()
        return []
    duration = end - start
    step = max(0.5, duration / 240)
    samples = max(1, math.ceil(duration / step))
    points = []
    last_center = width / 2
    previous_mouths = {}
    try:
        for index in range(samples + 1):
            if context:
                context.check_cancelled()
            timestamp = min(duration, index * step)
            cap.set(cv2.CAP_PROP_POS_MSEC, (start + timestamp) * 1000)
            ok, frame = cap.read()
            if not ok:
                continue
            scale = min(1, 640 / frame.shape[1])
            gray = cv2.cvtColor(cv2.resize(frame, None, fx=scale, fy=scale), cv2.COLOR_BGR2GRAY)
            faces = cascade.detectMultiScale(gray, scaleFactor=1.15, minNeighbors=5, minSize=(35, 35))
            selected = None
            best = -1.0
            mouths = {}
            for x, y, w, h in faces:
                center = (x + w / 2) / scale
                proximity = 1 - min(1, abs(center - last_center) / max(1, width))
                score = float(w * h) * (0.7 + 0.3 * proximity)
                if strategy == "active-speaker":
                    # Visual mouth-motion heuristic only, not audio diarization.
                    mouth = gray[y + int(h * 0.62):y + int(h * 0.92), x + int(w * 0.2):x + int(w * 0.8)]
                    if mouth.size:
                        normalized = cv2.resize(mouth, (32, 16))
                        identity = round(center / max(1, width) * 8)
                        previous = previous_mouths.get(identity)
                        motion = float(np.mean(cv2.absdiff(normalized, previous))) if previous is not None else 0
                        score *= 1 + min(2, motion / 20)
                        mouths[identity] = normalized
                if score > best:
                    best, selected = score, center
            previous_mouths = mouths
            last_center = selected if selected is not None else last_center + 0.1 * (width / 2 - last_center)
            points.append(CropPoint(timestamp, last_center, selected is not None))
            if context and index % 5 == 0:
                context.update(1 + 13 * min(1, (index + 1) / samples), "Tracking faces · smoothing the crop")
    finally:
        cap.release()
    smoothed = smooth_centers([p.center_x for p in points], alpha=0.28)
    return [CropPoint(point.time, center, point.detected) for point, center in zip(points, smoothed)]


def crop_dimensions(width: int, height: int, target_width: int, target_height: int) -> tuple[int, int]:
    ratio = target_width / target_height
    if width / height >= ratio:
        crop_w, crop_h = min(width, height * ratio), height
    else:
        crop_w, crop_h = width, min(height, width / ratio)
    return max(2, int(crop_w) // 2 * 2), max(2, int(crop_h) // 2 * 2)


def crop_expression(points: list[CropPoint], source_width: int, crop_width: int, duration: float,
                    manual: float | None = None) -> str:
    maximum = max(0, source_width - crop_width)
    if manual is not None:
        return f"{manual * maximum:.3f}"
    if not points:
        return f"{maximum / 2:.3f}"
    # Bound expression size and use piecewise linear interpolation, not jump cuts.
    count = min(48, max(2, math.ceil(duration / 2)))
    keyframes = [(i * duration / (count - 1), bounded(interpolate(points, i * duration / (count - 1), source_width / 2) - crop_width / 2, 0, maximum)) for i in range(count)]
    expression = f"{keyframes[-1][1]:.3f}"
    for (t0, x0), (t1, x1) in reversed(list(zip(keyframes, keyframes[1:]))):
        value = f"{x0:.3f}+({x1 - x0:.3f})*(t-{t0:.3f})/{max(0.001, t1 - t0):.3f}"
        expression = f"if(lt(t,{t1:.3f}),{value},{expression})"
    return expression
