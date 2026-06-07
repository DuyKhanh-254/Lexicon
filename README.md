# Lexicon

Lexicon là ứng dụng quản lý tri thức **local-first**. Người dùng có thể đưa tài liệu, ảnh, URL hoặc ghi chú thô vào hệ thống; AI chuẩn hóa thành Markdown; người dùng review trước khi commit vào vault; sau đó có thể search, chat, kiểm tra decay và tiếp tục lưu tri thức mới vào vault.

Lexicon hiện đi theo hướng **desktop app độc lập**. Python core chỉ là engine/CLI JSON bridge cho Electron UI.

## Tính năng hiện tại

- Desktop app Electron + React: Dashboard, Workspace, Chat, Review, Decay, Settings.
- Add Source: URL, PDF/file, Image, Note.
- MinerU integration cho PDF scan và image OCR.
- Human Review Gate: sửa Markdown, xem preview, approve/reject.
- Duplicate workflow: Keep new, Link related, Merge into existing.
- Workspace: browse notes, search chunks, đọc Markdown đã render, mở wikilink.
- Chat/RAG: hỏi theo vault, citation qua `[[...]]`, lưu câu trả lời vào review queue.
- Knowledge Decay: phát hiện note expired/due soon và cập nhật metadata.
- Vault Agent: đọc/sửa/lưu `agent.md` để định nghĩa vai trò, scope và rule cho từng vault.

## Yêu cầu hệ thống

- Python 3.10+ cho Lexicon core. Dự án đang chạy tốt với Python 3.13.
- Node.js + npm cho desktop app.
- API AI OpenAI-compatible hoặc local LLM endpoint.
- MinerU nếu muốn OCR PDF scan hoặc ảnh.

Lưu ý: MinerU trên Windows nên chạy bằng Python 3.10-3.12 trong virtualenv riêng. Không nên cài MinerU vào `.venv` của Lexicon nếu Lexicon đang dùng Python 3.13.

## Cài Lexicon core

```powershell
cd D:\Lexicon
py -3.13 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install -e .[dev]
```

Kiểm tra:

```powershell
pytest -q
python -m lexicon.cli doctor
```

## Cấu hình AI

Lexicon không lưu API key trực tiếp trong config. Key nên đặt trong biến môi trường hoặc file `.env` local không commit.

Tạo `.env`:

```powershell
Copy-Item .env.example .env
```

Ví dụ `.env`:

```env
LEXICON_HOME=.lexicon
LEXICON_API_KEY=replace-with-your-api-key
```

Cấu hình local OpenAI-compatible endpoint:

```powershell
python -m lexicon.cli settings `
  --provider openai-compatible `
  --base-url http://localhost:20128/v1 `
  --api-key-env LEXICON_API_KEY `
  --model best
```

Nếu dùng OpenAI chính thức:

```powershell
$env:OPENAI_API_KEY="replace-with-your-openai-key"
python -m lexicon.cli settings `
  --provider openai `
  --model gpt-4.1-mini `
  --api-key-env OPENAI_API_KEY
```

Kiểm tra:

```powershell
python -m lexicon.cli doctor --json
```

## Cài và chạy MinerU

MinerU không nằm trong repo này. Cài MinerU riêng, ví dụ trên Windows:

```powershell
mkdir D:\MinerU
cd D:\MinerU
py -3.12 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install uv
uv pip install -U "mineru[all]"
```

Chạy MinerU API:

```powershell
cd D:\MinerU
.\.venv\Scripts\Activate.ps1
mineru-api --host 127.0.0.1 --port 8888
```

Giữ terminal MinerU mở. Mở PowerShell khác để kiểm tra:

```powershell
Test-NetConnection localhost -Port 8888
```

Cần thấy:

```text
TcpTestSucceeded : True
```

Cấu hình Lexicon gọi MinerU:

```powershell
cd D:\Lexicon
.\.venv\Scripts\Activate.ps1
python -m lexicon.cli settings `
  --mineru-endpoint http://127.0.0.1:8888 `
  --mineru-timeout-seconds 900
```

Lexicon gọi MinerU qua:

```text
POST http://127.0.0.1:8888/file_parse
```

## Chạy desktop app

Terminal 1: chạy AI local nếu dùng local endpoint.

```text
http://localhost:20128/v1
```

Terminal 2: chạy MinerU nếu ingest PDF scan hoặc ảnh.

```powershell
cd D:\MinerU
.\.venv\Scripts\Activate.ps1
mineru-api --host 127.0.0.1 --port 8888
```

Terminal 3: chạy Lexicon desktop.

```powershell
cd D:\Lexicon\desktop-app
npm.cmd install
npm.cmd run dev
```

Lưu ý: `npm.cmd install` và `npm.cmd run dev` phải chạy trong `desktop-app`, không chạy ở root `D:\Lexicon`.

## Sử dụng trong app

1. Nhập vault path, ví dụ `D:\Lexicon\.tmp\e2e-vault`.
2. Bấm `Load`.
3. Vào `Settings` kiểm tra System Health:
   - `ai_provider: ok` nếu AI endpoint hoạt động.
   - `mineru: ok` nếu MinerU đang chạy.
   - `requests: ok`.
4. Vào `Settings` -> `Vault Agent`, bấm `Reload agent.md` hoặc `Create/load template`.
5. Vào `Dashboard` hoặc `Review`, dùng Add Source để ingest text/file/image/url.
6. Vào `Review`, sửa Markdown, xử lý duplicate, rồi approve.
7. Vào `Workspace` để đọc/search note đã commit.
8. Vào `Chat` để hỏi vault và có thể lưu answer vào review queue.
9. Vào `Decay` để kiểm tra/cập nhật note quá hạn.

## CLI workflow nhanh

Tạo vault:

```powershell
python -m lexicon.cli init-vault .\demo-vault --name "Demo Vault"
```

Đọc hoặc sửa agent:

```powershell
python -m lexicon.cli agent --vault .\demo-vault --json
```

Ingest text:

```powershell
python -m lexicon.cli ingest `
  --vault .\demo-vault `
  --text "Vancomycin requires renal dose adjustment." `
  --title "Vancomycin Dosing"
```

Xem inbox:

```powershell
python -m lexicon.cli inbox --vault .\demo-vault
python -m lexicon.cli inbox --vault .\demo-vault --show 1
```

Approve:

```powershell
python -m lexicon.cli inbox --vault .\demo-vault --approve 1 --folder concepts
python -m lexicon.cli scan --vault .\demo-vault
```

Chat:

```powershell
python -m lexicon.cli chat `
  --vault .\demo-vault `
  --mode vault-only `
  "What does the vault say about vancomycin?"
```

Decay check:

```powershell
python -m lexicon.cli decay --vault .\demo-vault
```

## Kiến trúc

```text
Source file/text/url/image
  -> Extractor Router
  -> MinerU / pdftotext / MarkItDown / HTTP fallback
  -> Raw Markdown
  -> AI Processor + agent.md
  -> _inbox review item
  -> Human review
  -> Duplicate decision
  -> Commit or merge into vault
  -> Rebuild index
  -> Workspace / Chat / Decay
```

Desktop app không xử lý domain logic trực tiếp:

```text
Electron/React UI
  -> preload IPC
  -> Python CLI --json
  -> lexicon core
```

## Cấu trúc dự án

```text
src/lexicon/
|- cli.py                  # CLI + JSON bridge cho desktop app
|- config.py               # app config, vault registry
|- vault.py                # thao tác filesystem vault + agent.md
|- ingestion.py            # source -> review item
|- review.py               # inbox approve/reject/merge/show
|- chat.py                 # vault chat orchestration
|- search.py               # local chunk index + retrieval
|- decay.py                # stale/expired knowledge scan
|- workspace.py            # list/read/search committed notes
|- ai/                     # AI provider adapters
`- extractors/             # text/url/pdf/image/MinerU adapters

desktop-app/               # Electron + React UI
docs/                      # architecture notes
tests/                     # Python tests
```

## Người khác clone về cần làm gì?

1. Clone repo.
2. Tạo Python venv và chạy `pip install -e .[dev]`.
3. Tạo `.env` từ `.env.example`.
4. Cấu hình API AI hoặc local LLM endpoint.
5. Nếu dùng PDF/image OCR, cài MinerU riêng và chạy `mineru-api`.
6. Cài desktop dependencies bằng `npm.cmd install` trong `desktop-app`.
7. Chạy `npm.cmd run dev` trong `desktop-app`.

Không cần clone/copy folder MinerU từ máy người phát triển. MinerU là runtime service riêng, giống database/service local.

## Kiểm tra trước khi commit

```powershell
cd D:\Lexicon
pytest -q

cd D:\Lexicon\desktop-app
npm.cmd run typecheck
npm.cmd run build
```
