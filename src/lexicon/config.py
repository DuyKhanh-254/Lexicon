from __future__ import annotations

import json
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any


APP_DIR_ENV = "LEXICON_HOME"


def app_dir() -> Path:
    load_dotenv()
    return Path(os.environ.get(APP_DIR_ENV, Path.home() / ".lexicon")).expanduser()


def load_dotenv(path: Path | None = None) -> None:
    env_path = path or Path.cwd() / ".env"
    if not env_path.exists():
        return
    for raw_line in env_path.read_text(encoding="utf-8-sig").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        os.environ.setdefault(key, value)


def ensure_app_dir() -> Path:
    root = app_dir()
    (root / "embeddings").mkdir(parents=True, exist_ok=True)
    return root


def _read_json(path: Path, default: Any) -> Any:
    if not path.exists():
        return default
    return json.loads(path.read_text(encoding="utf-8-sig"))


def _write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


@dataclass
class AppConfig:
    provider: str = "local"
    model: str = "local-summary"
    api_key_env: str | None = None
    base_url: str | None = None
    default_knowledge_mode: str = "vault+model"
    mineru_endpoint: str | None = None
    mineru_timeout_seconds: int = 900
    url_extractor: str = "http"
    file_extractor: str = "auto"

    @classmethod
    def load(cls) -> "AppConfig":
        data = _read_json(ensure_app_dir() / "app-config.json", {})
        return cls(**{**cls().__dict__, **data})

    def save(self) -> None:
        _write_json(ensure_app_dir() / "app-config.json", self.__dict__)

    @property
    def api_key(self) -> str | None:
        if not self.api_key_env:
            return None
        return os.environ.get(self.api_key_env)


class VaultRegistry:
    def __init__(self) -> None:
        self.path = ensure_app_dir() / "vaults-registry.json"
        self.data: dict[str, str] = _read_json(self.path, {})

    def add(self, name: str, vault_path: Path) -> None:
        self.data[name] = str(vault_path.expanduser().resolve())
        _write_json(self.path, self.data)

    def list(self) -> dict[str, str]:
        return dict(self.data)
