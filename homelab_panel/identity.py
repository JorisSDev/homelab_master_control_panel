"""Plex identity document.

Only the MediaContainer version and claimed flag are kept. The XML declaration
is not the server version. Every other attribute is discarded.
"""

from __future__ import annotations

import re

VERSION = re.compile(r"[0-9]+(?:\.[0-9]+)+(?:-[A-Za-z0-9._-]+)?")


def minimum_status(version, minimum):
    if not VERSION.fullmatch(version):
        return "unknown"
    if not minimum:
        return "no-minimum"
    if not VERSION.fullmatch(minimum):
        return "unknown"
    current, required = version_tuple(version), version_tuple(minimum)
    width = max(len(current), len(required))
    current += (0,) * (width - len(current))
    required += (0,) * (width - len(required))
    return "below" if current < required else "meets"


def version_tuple(value):
    nums = []
    for part in str(value).split("-", 1)[0].split("."):
        number = ""
        for char in part:
            if char.isdigit():
                number += char
            else:
                break
        nums.append(int(number or "0"))
    return tuple(nums)


def parse_identity(xml):
    tag = re.search(r"<MediaContainer\b([^>]*)>", xml or "")
    attrs = tag.group(1) if tag else ""
    version = re.search(r'\bversion="([^"]*)"', attrs)
    claimed = re.search(r'\bclaimed="([^"]*)"', attrs)
    return {
        "version": version.group(1) if version else "",
        "claimed": claimed.group(1) if claimed else "",
    }
