"""Tracker registry. A tracker is one file in pawtrack/trackers/ that calls @register."""
import importlib
import pkgutil
from dataclasses import dataclass
from typing import Callable

TRACKERS: dict[str, "Tracker"] = {}


@dataclass
class Tracker:
    id: str
    name: str
    roi: str  # "box" | "points" | "box_or_points" | "none"
    params: list[dict]
    track: Callable  # track(frames, roi, params) -> iter of (t_ms, value, overlay)
    channels: list[str]  # named raw signals the tracker yields (dict form); [] for scalar trackers


def param(key, label, type, default, min=None, max=None, choices=None, hint=None):
    """hint (optional, PROTOCOL v4.10): the explanation behind a short label; only present when given."""
    return {"key": key, "label": label, "type": type, "default": default,
            "min": min, "max": max, "choices": choices, **({"hint": hint} if hint else {})}


def register(id, name, roi, params, channels=()):
    """channels: names of the raw signals yielded in the dict form. Such a tracker also declares a
    "primary" choice param (its default = the default primary channel)."""
    def deco(fn):
        TRACKERS[id] = Tracker(id, name, roi, params, fn, list(channels))
        return fn
    return deco


def load():
    """Import every module in pawtrack.trackers (files starting with '_' are skipped).
    Trackers must import heavy deps (torch, ...) inside track(), so this stays fast."""
    from pawtrack import trackers
    for m in pkgutil.iter_modules(trackers.__path__):
        if not m.name.startswith("_"):
            importlib.import_module(f"pawtrack.trackers.{m.name}")
    return TRACKERS


def coerce(schema, given):
    """Merge request params over schema defaults, type-check, clamp to min/max."""
    given = dict(given or {})
    out = {}
    for p in schema:
        k = p["key"]
        v = given.pop(k, p["default"])
        if p["type"] == "bool":
            if not isinstance(v, bool):
                raise ValueError(f"param {k}: expected bool, got {v!r}")
        elif p["type"] == "choice":
            if v not in p["choices"]:
                raise ValueError(f"param {k}: {v!r} not in {p['choices']}")
        else:
            if isinstance(v, bool) or not isinstance(v, (int, float)):
                raise ValueError(f"param {k}: expected number, got {v!r}")
            v = int(round(v)) if p["type"] == "int" else float(v)
            if p["min"] is not None:
                v = max(p["min"], v)
            if p["max"] is not None:
                v = min(p["max"], v)
        out[k] = v
    if given:
        raise ValueError(f"unknown params: {sorted(given)}")
    return out
