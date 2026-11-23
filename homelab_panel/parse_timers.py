"""systemd timer timestamps.

``systemctl list-timers --all --output=json`` reports ``next`` and ``last`` as
Unix microseconds. Values above 1e10 are microseconds. The ``left`` field is
not a duration and is ignored.
"""

from __future__ import annotations

import datetime

MICROSECOND_THRESHOLD = 10_000_000_000


def stamp(value):
    if not value:
        return None
    seconds = value / 1_000_000 if value > MICROSECOND_THRESHOLD else value
    return datetime.datetime.fromtimestamp(seconds).astimezone()


def parse_timers(rows):
    found = []
    for row in rows or []:
        if not isinstance(row, dict):
            continue
        found.append(
            {
                "unit": row.get("unit") or "",
                "next": stamp(row.get("next") or 0),
                "last": stamp(row.get("last") or 0),
            }
        )
    return found


def format_when(moment, empty):
    if moment is None:
        return empty
    return moment.strftime("%a %d %b %H:%M")
