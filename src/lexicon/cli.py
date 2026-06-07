from __future__ import annotations

import argparse
import base64
import importlib.util
import json
import socket
import shutil
import sys
from pathlib import Path
from urllib.parse import urlparse

from .chat import answer, save_answer_to_inbox
from .config import AppConfig, VaultRegistry
from .decay import DecayInfo, scan_decay, update_decay_metadata
from .ingestion import ingest
from .models import SourceInput
from .review import InboxItem, approve, get_inbox_detail, inbox_details, merge_inbox_into_note, reject, replace_inbox_body
from .search import rebuild_index
from .vault import DEFAULT_AGENT, Vault
from .workspace import WorkspaceNote, list_notes, read_note, search_notes


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="lexicon")
    sub = parser.add_subparsers(dest="command", required=True)

    init = sub.add_parser("init-vault")
    init.add_argument("path")
    init.add_argument("--name")
    init.add_argument("--json", action="store_true")

    settings = sub.add_parser("settings")
    settings.add_argument("--provider")
    settings.add_argument("--model")
    settings.add_argument("--base-url")
    settings.add_argument("--api-key-env")
    settings.add_argument("--mineru-endpoint")
    settings.add_argument("--mineru-timeout-seconds", type=int)
    settings.add_argument("--default-knowledge-mode")
    settings.add_argument("--url-extractor", choices=["http", "playwright", "markitdown"])
    settings.add_argument("--file-extractor", choices=["auto", "markitdown"])
    settings.add_argument("--json", action="store_true")

    agent = sub.add_parser("agent")
    agent.add_argument("--vault", required=True)
    agent.add_argument("--init", action="store_true")
    agent.add_argument("--body-file")
    agent.add_argument("--body-base64")
    agent.add_argument("--json", action="store_true")

    ingest_cmd = sub.add_parser("ingest")
    ingest_cmd.add_argument("--vault", required=True)
    group = ingest_cmd.add_mutually_exclusive_group(required=True)
    group.add_argument("--url")
    group.add_argument("--file")
    group.add_argument("--text")
    ingest_cmd.add_argument("--title")
    ingest_cmd.add_argument("--note")
    ingest_cmd.add_argument("--json", action="store_true")

    inbox = sub.add_parser("inbox")
    inbox.add_argument("--vault", required=True)
    inbox.add_argument("--approve", type=int)
    inbox.add_argument("--reject", type=int)
    inbox.add_argument("--show", type=int)
    inbox.add_argument("--replace-body", type=int)
    inbox.add_argument("--merge-into", type=int)
    inbox.add_argument("--target")
    inbox.add_argument("--body-file")
    inbox.add_argument("--body-base64")
    inbox.add_argument("--folder")
    inbox.add_argument("--json", action="store_true")

    chat = sub.add_parser("chat")
    chat.add_argument("--vault", required=True)
    chat.add_argument("--mode", choices=["vault-only", "vault+model", "vault+web"])
    chat.add_argument("--save", action="store_true")
    chat.add_argument("--title")
    chat.add_argument("--json", action="store_true")
    chat.add_argument("question", nargs="+")

    scan = sub.add_parser("scan")
    scan.add_argument("--vault", required=True)
    scan.add_argument("--json", action="store_true")

    workspace = sub.add_parser("workspace")
    workspace.add_argument("--vault", required=True)
    workspace.add_argument("--query")
    workspace.add_argument("--search")
    workspace.add_argument("--read")
    workspace.add_argument("--limit", type=int, default=10)
    workspace.add_argument("--json", action="store_true")

    decay = sub.add_parser("decay")
    decay.add_argument("--vault", required=True)
    decay.add_argument("--days", type=int, default=30)
    decay.add_argument("--all", action="store_true")
    decay.add_argument("--update")
    decay.add_argument("--reviewed-at")
    decay.add_argument("--expires-at")
    decay.add_argument("--extend-days", type=int)
    decay.add_argument("--json", action="store_true")

    doctor = sub.add_parser("doctor")
    doctor.add_argument("--json", action="store_true")

    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        if args.command == "init-vault":
            vault = Vault.init(args.path, name=args.name)
            VaultRegistry().add(args.name or vault.path.name, vault.path)
            if args.json:
                print_json({"ok": True, "vault": str(vault.path), "name": args.name or vault.path.name})
                return 0
            print(f"Initialized vault: {vault.path}")
            return 0
        if args.command == "settings":
            config = AppConfig.load()
            changed = False
            for field in [
                "provider",
                "model",
                "base_url",
                "api_key_env",
                "mineru_endpoint",
                "mineru_timeout_seconds",
                "default_knowledge_mode",
                "url_extractor",
                "file_extractor",
            ]:
                value = getattr(args, field)
                if value is not None:
                    setattr(config, field, value)
                    changed = True
            if changed:
                config.save()
                if args.json:
                    print_json({"ok": True, "settings": config_to_dict(config)})
                    return 0
                print("Saved settings.")
            else:
                if args.json:
                    print_json({"ok": True, "settings": config_to_dict(config)})
                else:
                    print_json(config_to_dict(config))
            return 0
        if args.command == "agent":
            vault = _open_vault_for_agent(args.vault, init=args.init)
            if args.body_base64 or args.body_file:
                if args.body_base64:
                    body = base64.b64decode(args.body_base64.encode("ascii")).decode("utf-8")
                else:
                    body = Path(args.body_file).read_text(encoding="utf-8-sig")
                target = vault.write_agent(body)
                payload = {"ok": True, "agent": agent_to_dict(vault), "updated": str(target)}
                if args.json:
                    print_json(payload)
                    return 0
                print(f"Updated agent: {target}")
                return 0
            payload = {"ok": True, "agent": agent_to_dict(vault)}
            if args.json:
                print_json(payload)
                return 0
            print(vault.read_agent())
            return 0
        if args.command == "ingest":
            vault = Vault.open(args.vault)
            if args.url:
                source = SourceInput("url", args.url, args.title, args.note)
            elif args.file:
                source = SourceInput("file", args.file, args.title, args.note)
            else:
                source = SourceInput("text", args.text, args.title, args.note)
            target = ingest(vault, source)
            if args.json:
                print_json({"ok": True, "created": str(target), "filename": target.name})
                return 0
            print(f"Created review item: {target}")
            return 0
        if args.command == "inbox":
            vault = Vault.open(args.vault)
            if args.replace_body:
                if args.body_base64:
                    body = base64.b64decode(args.body_base64.encode("ascii")).decode("utf-8")
                elif args.body_file:
                    body = Path(args.body_file).read_text(encoding="utf-8-sig")
                else:
                    raise ValueError("--body-file or --body-base64 is required with --replace-body")
                target = replace_inbox_body(vault, args.replace_body, body)
                item = get_inbox_detail(vault, args.replace_body)
                if args.json:
                    print_json({"ok": True, "updated": str(target), "item": inbox_item_to_dict(item)})
                    return 0
                print(f"Updated: {target}")
                return 0
            if args.show:
                item = get_inbox_detail(vault, args.show)
                if args.json:
                    print_json({"ok": True, "item": inbox_item_to_dict(item)})
                    return 0
                print(format_inbox_detail(item))
                return 0
            if args.approve:
                item = get_inbox_detail(vault, args.approve)
                target = approve(vault, args.approve, folder=args.folder)
                folder_note = args.folder or item.suggested_folder
                if args.json:
                    print_json(
                        {
                            "ok": True,
                            "approved": str(target),
                            "folder": folder_note,
                            "item": inbox_item_to_dict(item),
                        }
                    )
                    return 0
                print(f"Approved: {target}")
                print(f"Folder: {folder_note}")
                return 0
            if args.merge_into:
                if not args.target:
                    raise ValueError("--target is required with --merge-into")
                item = get_inbox_detail(vault, args.merge_into)
                target = merge_inbox_into_note(vault, args.merge_into, args.target)
                if args.json:
                    print_json(
                        {
                            "ok": True,
                            "merged": str(target),
                            "target": target.relative_to(vault.path).as_posix(),
                            "item": inbox_item_to_dict(item),
                        }
                    )
                    return 0
                print(f"Merged: {item.path.name} -> {target}")
                return 0
            if args.reject:
                item = get_inbox_detail(vault, args.reject)
                target = reject(vault, args.reject)
                if args.json:
                    print_json({"ok": True, "rejected": str(target), "item": inbox_item_to_dict(item)})
                    return 0
                print(f"Rejected: {target}")
                return 0
            items = inbox_details(vault)
            if args.json:
                print_json({"ok": True, "items": [inbox_item_to_dict(item) for item in items]})
                return 0
            if not items:
                print("Inbox is empty.")
                return 0
            print(format_inbox_list(items))
            return 0
        if args.command == "chat":
            vault = Vault.open(args.vault)
            question = " ".join(args.question)
            response = answer(vault, question, mode=args.mode)
            saved_target = None
            if args.save:
                saved_target = save_answer_to_inbox(vault, question, response, title=args.title, mode=args.mode)
            if args.json:
                print_json(
                    {
                        "ok": True,
                        "question": question,
                        "mode": args.mode or AppConfig.load().default_knowledge_mode,
                        "answer": response,
                        "saved": saved_target,
                    }
                )
                return 0
            print(response)
            if saved_target:
                print("")
                print(f"Saved answer for review: {saved_target}")
            return 0
        if args.command == "scan":
            vault = Vault.open(args.vault)
            target = rebuild_index(vault)
            vault.rebuild_index()
            if args.json:
                print_json({"ok": True, "index": str(target)})
                return 0
            print(f"Rebuilt index: {target}")
            return 0
        if args.command == "workspace":
            vault = Vault.open(args.vault)
            if args.read:
                note = read_note(vault, args.read)
                if args.json:
                    print_json({"ok": True, "note": note})
                    return 0
                print(format_workspace_note(note))
                return 0
            if args.search:
                hits = search_notes(vault, args.search, limit=args.limit)
                if args.json:
                    print_json({"ok": True, "hits": hits})
                    return 0
                print(format_workspace_hits(hits))
                return 0
            notes = list_notes(vault, query=args.query)
            if args.json:
                print_json({"ok": True, "notes": [workspace_note_to_dict(note) for note in notes]})
                return 0
            print(format_workspace_list(notes))
            return 0
        if args.command == "decay":
            vault = Vault.open(args.vault)
            if args.update:
                info = update_decay_metadata(
                    vault,
                    args.update,
                    reviewed_at=args.reviewed_at,
                    expires_at=args.expires_at,
                    extend_days=args.extend_days,
                )
                warnings = []
                try:
                    rebuild_index(vault)
                    vault.rebuild_index()
                except Exception as exc:
                    warnings.append(f"Decay metadata updated, but index rebuild failed: {exc}")
                if args.json:
                    print_json({"ok": True, "item": decay_info_to_dict(info), "warnings": warnings})
                    return 0
                print(f"Updated decay metadata: {info.path}")
                for warning in warnings:
                    print(f"Warning: {warning}")
                return 0
            rows = scan_decay(vault, due_soon_days=args.days, include_fresh=args.all)
            if args.json:
                print_json({"ok": True, "items": [decay_info_to_dict(row) for row in rows]})
                return 0
            print(format_decay(rows))
            return 0
        if args.command == "doctor":
            config = AppConfig.load()
            if args.json:
                print_json({"ok": True, "doctor": doctor_to_dict(config)})
                return 0
            print(format_doctor(config))
            return 0
    except Exception as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1
    return 1


def format_inbox_list(items: list[InboxItem]) -> str:
    lines = ["#  Confidence  Folder      Title"]
    for item in items:
        confidence = "n/a" if item.confidence is None else f"{item.confidence:.2f}"
        warning = " !" if item.warnings else ""
        lines.append(f"{item.index:<2} {confidence:<10} {item.suggested_folder:<11} {item.title}{warning}")
    lines.append("")
    lines.append("Use: lexicon inbox --vault <path> --show <#>")
    lines.append("Approve: lexicon inbox --vault <path> --approve <#> [--folder concepts|guidelines|references]")
    return "\n".join(lines)


def print_json(data: dict) -> None:
    payload = json.dumps(data, ensure_ascii=False, indent=2) + "\n"
    try:
        sys.stdout.buffer.write(payload.encode("utf-8"))
    except AttributeError:
        print(payload, end="")


def config_to_dict(config: AppConfig) -> dict:
    return {
        "provider": config.provider,
        "model": config.model,
        "api_key_env": config.api_key_env,
        "base_url": config.base_url,
        "default_knowledge_mode": config.default_knowledge_mode,
        "mineru_endpoint": config.mineru_endpoint,
        "mineru_timeout_seconds": config.mineru_timeout_seconds,
        "url_extractor": config.url_extractor,
        "file_extractor": config.file_extractor,
    }


def agent_to_dict(vault: Vault) -> dict:
    agent_path = vault.path / "agent.md"
    body = vault.read_agent()
    return {
        "path": str(agent_path),
        "filename": agent_path.name,
        "exists": agent_path.exists(),
        "body": body,
        "line_count": len(body.splitlines()),
        "vault": str(vault.path),
    }


def inbox_item_to_dict(item: InboxItem) -> dict:
    return {
        "index": item.index,
        "path": str(item.path),
        "filename": item.path.name,
        "title": item.title,
        "source": item.source,
        "suggested_folder": item.suggested_folder,
        "confidence": item.confidence,
        "warnings": item.warnings,
        "body_preview": item.body_preview,
        "body": item.body,
    }


def workspace_note_to_dict(note: WorkspaceNote) -> dict:
    return {
        "path": note.path,
        "title": note.title,
        "folder": note.folder,
        "size": note.size,
        "modified_at": note.modified_at,
        "preview": note.preview,
    }


def format_inbox_detail(item: InboxItem) -> str:
    confidence = "n/a" if item.confidence is None else f"{item.confidence:.2f}"
    warnings = "\n".join(f"- {warning}" for warning in item.warnings) if item.warnings else "- None"
    return f"""Inbox item #{item.index}
File: {item.path.name}
Title: {item.title}
Source: {item.source}
Suggested folder: {item.suggested_folder}
Confidence: {confidence}

Warnings:
{warnings}

Preview:
{item.body_preview}
"""


def format_workspace_list(notes: list[WorkspaceNote]) -> str:
    if not notes:
        return "No workspace notes."
    lines = ["Folder       Note"]
    for note in notes:
        lines.append(f"{note.folder or '-':<12} {note.path}")
    return "\n".join(lines)


def format_workspace_note(note: dict) -> str:
    frontmatter = note.get("frontmatter") or {}
    meta = "\n".join(f"{key}: {value}" for key, value in frontmatter.items())
    return f"""Title: {note.get("title")}
Path: {note.get("path")}
Folder: {note.get("folder")}

{meta}

{note.get("body", "")}
"""


def format_workspace_hits(hits: list[dict]) -> str:
    if not hits:
        return "No search hits."
    lines = ["Score   Note"]
    for hit in hits:
        lines.append(f"{hit.get('score', 0):<7} {hit.get('path', '')} :: {hit.get('heading', '')}")
    return "\n".join(lines)


def format_doctor(config: AppConfig) -> str:
    doctor = doctor_to_dict(config)
    checks = doctor["dependencies"]
    lines = [
        "Lexicon doctor",
        f"Provider: {doctor['provider']}",
        f"Model: {doctor['model']}",
        f"Base URL: {doctor['base_url'] or 'n/a'}",
        f"API key env: {doctor['api_key_env'] or 'n/a'} ({'set' if doctor['api_key_set'] else 'not set'})",
        f"URL extractor: {doctor['url_extractor']}",
        f"File extractor: {doctor['file_extractor']}",
        f"MinerU endpoint: {doctor['mineru_endpoint'] or 'n/a'}",
        f"MinerU timeout: {doctor['mineru_timeout_seconds']}s",
        "",
        "Dependencies:",
    ]
    lines.extend(f"- {name}: {status}" for name, status in checks.items())
    lines.append("")
    lines.append("Services:")
    lines.extend(f"- {name}: {status}" for name, status in doctor["services"].items())
    return "\n".join(lines)


def doctor_to_dict(config: AppConfig) -> dict:
    return {
        "provider": config.provider,
        "model": config.model,
        "base_url": config.base_url,
        "api_key_env": config.api_key_env,
        "api_key_set": bool(config.api_key),
        "url_extractor": config.url_extractor,
        "file_extractor": config.file_extractor,
        "mineru_endpoint": config.mineru_endpoint,
        "mineru_timeout_seconds": config.mineru_timeout_seconds,
        "dependencies": {
            "pdftotext": "ok" if shutil.which("pdftotext") else "missing",
            "markitdown": "ok" if importlib.util.find_spec("markitdown") else "missing",
            "playwright": "ok" if importlib.util.find_spec("playwright") else "missing",
            "requests": "ok" if importlib.util.find_spec("requests") else "missing",
        },
        "services": {
            "ai_provider": _tcp_service_status(config.base_url),
            "mineru": _tcp_service_status(config.mineru_endpoint),
        },
    }


def format_decay(rows: list[DecayInfo]) -> str:
    if not rows:
        return "No expired or due-soon notes."
    lines = ["Status     Expires      Reviewed     Days   Note"]
    for row in rows:
        days = "n/a" if row.days_until_expiry is None else str(row.days_until_expiry)
        lines.append(
            f"{row.status:<10} {row.expires_at or '-':<12} {row.reviewed_at or '-':<12} {days:<6} {row.path}"
        )
    return "\n".join(lines)


def decay_info_to_dict(row: DecayInfo) -> dict:
    return {
        "path": row.path,
        "title": row.title,
        "status": row.status,
        "expires_at": row.expires_at,
        "reviewed_at": row.reviewed_at,
        "days_until_expiry": row.days_until_expiry,
    }


def _tcp_service_status(url: str | None) -> str:
    if not url:
        return "not configured"
    parsed = urlparse(url)
    host = parsed.hostname
    if not host:
        return "invalid URL"
    if parsed.port:
        port = parsed.port
    elif parsed.scheme == "https":
        port = 443
    else:
        port = 80
    try:
        with socket.create_connection((host, port), timeout=1.5):
            return "ok"
    except OSError as exc:
        return f"unreachable: {exc}"


def _open_vault_for_agent(vault_path: str, init: bool = False) -> Vault:
    path = Path(vault_path).expanduser().resolve()
    if init:
        path.mkdir(parents=True, exist_ok=True)
        agent_path = path / "agent.md"
        if not agent_path.exists():
            title = path.name or "vault"
            agent_path.write_text(DEFAULT_AGENT.replace("# Agent", f"# Agent - {title}"), encoding="utf-8")
    return Vault.open(path)


if __name__ == "__main__":
    raise SystemExit(main())
