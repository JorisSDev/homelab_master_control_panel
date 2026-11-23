"""Host configuration. Live addresses stay in this file, on the host."""

from __future__ import annotations

import json
from pathlib import Path

REFUSED_HOSTS = {"", "0.0.0.0", "::", "[::]"}


class ConfigError(ValueError):
    pass


def load_config(path):
    file = Path(path)
    try:
        data = json.loads(file.read_text())
    except (OSError, json.JSONDecodeError) as exc:
        raise ConfigError(f"could not read config: {exc}") from exc
    if not isinstance(data, dict):
        raise ConfigError("config must be an object")
    host, port = parse_bind(data.get("bind") or "")
    data["bind_host"] = host
    data["bind_port"] = port
    return data


def parse_bind(value):
    if not isinstance(value, str) or ":" not in value:
        raise ConfigError("bind must be host:port")
    host, _, port_text = value.rpartition(":")
    host = host.strip()
    if host in REFUSED_HOSTS:
        raise ConfigError("bind must be a single address")
    try:
        port = int(port_text)
    except ValueError as exc:
        raise ConfigError("bind port must be a number") from exc
    if port < 1 or port > 65535:
        raise ConfigError("bind port is out of range")
    return host, port
