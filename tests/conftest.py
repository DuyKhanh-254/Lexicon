from __future__ import annotations

import shutil
import uuid
from pathlib import Path

import pytest


@pytest.fixture
def tmp_path(request):
    root = _writable_test_root()
    path = root / f"{request.node.name}-{uuid.uuid4().hex}"
    path.mkdir(parents=True, exist_ok=False)
    try:
        yield path
    finally:
        shutil.rmtree(path, ignore_errors=True)


def _writable_test_root() -> Path:
    candidates = [Path.cwd() / "test-runs", Path.cwd() / ".tmp" / "test-runs", Path("C:/tmp/lexicon-test-runs")]
    for root in candidates:
        try:
            root.mkdir(parents=True, exist_ok=True)
            probe = root / f".write-probe-{uuid.uuid4().hex}"
            probe.mkdir()
            probe.rmdir()
            return root
        except OSError:
            continue
    raise PermissionError("No writable temporary directory is available for tests.")
