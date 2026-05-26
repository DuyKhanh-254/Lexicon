from __future__ import annotations

import shutil
import uuid
from pathlib import Path

import pytest


@pytest.fixture
def tmp_path(request):
    root = Path.cwd() / ".tmp" / "test-runs"
    root.mkdir(parents=True, exist_ok=True)
    path = root / f"{request.node.name}-{uuid.uuid4().hex}"
    path.mkdir(parents=True, exist_ok=False)
    try:
        yield path
    finally:
        shutil.rmtree(path, ignore_errors=True)
