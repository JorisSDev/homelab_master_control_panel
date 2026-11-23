"""Host configuration. Live addresses stay in this file, on the host."""

from __future__ import annotations

import json
import os
from pathlib import Path

REFUSED_HOSTS = {"", "0.0.0.0", "::", "[::]"}
ROOT = Path(__file__).resolve().parents[1]


class ConfigError(ValueError):
    pass


def load_dotenv(path=None):
    file = Path(path) if path is not None else ROOT / ".env"
    try:
        lines = file.read_text().splitlines()
    except OSError:
        return
    for raw in lines:
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        if not key or key in os.environ:
            continue
        os.environ[key] = value.strip().strip('"').strip("'")


def load_config(path):
    load_dotenv()
    file = Path(path)
    try:
        data = json.loads(file.read_text())
    except (OSError, json.JSONDecodeError) as exc:
        raise ConfigError(f"could not read config: {exc}") from exc
    if not isinstance(data, dict):
        raise ConfigError("config must be an object")
    host, port = parse_bind(os.environ.get("BIND") or data.get("bind") or "")
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
