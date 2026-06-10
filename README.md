# Lexicon

Lexicon là ứng dụng quản lý tri thức **local-first**. Người dùng có thể đưa tài liệu, ảnh, URL hoặc ghi chú thô vào hệ thống; AI chuẩn hóa thành Markdown; người dùng review trước khi commit vào vault; sau đó có thể search, chat, kiểm tra decay và tiếp tục lưu tri thức mới vào vault.

Lexicon hiện đi theo hướng **desktop app độc lập**. Python core chỉ là engine/CLI JSON bridge cho Electron UI.

## Tính năng hiện tại

- Desktop app Electron + React: Setup, Vault Manager, Dashboard, Workspace, Chat, Review, Decay, Settings.
- Vault Manager: tạo/register vault, xem trạng thái từng vault, gỡ entry khỏi registry, load nhanh vào dashboard/workspace.
- Add Source: URL, PDF/file, Image, Note.
- MinerU integration cho PDF scan và image OCR.
- MinerU runtime control: cấu hình command local, start/stop MinerU API từ desktop app.
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

Trong desktop app, có thể vào `Settings` -> `MinerU runtime` để cấu hình command, ví dụ:

```text
Command: D:\MinerU\.venv\Scripts\mineru-api.exe
Arguments: --host 127.0.0.1 --port 8888
Working directory: D:\MinerU
```

Sau đó bấm `Start MinerU`. Tính năng này chỉ start/stop MinerU đã được cài sẵn, không tự cài MinerU hoặc tự download model.

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

1. Mở tab `Setup`.
2. Nhập vault path, ví dụ `D:\Lexicon\.tmp\e2e-vault`.
3. Bấm `Create vault` nếu tạo mới, hoặc `Load existing` nếu dùng vault đã có.
4. Trong Setup, cấu hình AI endpoint/API key env và bấm `Save settings`.
5. Bấm `Run doctor` để kiểm tra `ai_provider`, `mineru`, `requests`.
6. Tạo hoặc load `agent.md`, chỉnh rule nếu cần, rồi bấm `Save agent.md`.
7. Vào `Vaults` để xem các vault đã đăng ký, tạo/register vault mới, hoặc chuyển active vault.
8. Vào `Dashboard` hoặc `Review`, dùng Add Source để ingest text/file/image/url.
9. Vào `Review`, sửa Markdown, xử lý duplicate, rồi approve.
10. Vào `Workspace` để đọc/search note đã commit.
11. Vào `Chat` để hỏi vault và có thể lưu answer vào review queue.
12. Vào `Decay` để kiểm tra/cập nhật note quá hạn.

## Inter-vault reference

Mot vault co the doc them vault khac theo che do read-only neu khai bao trong `agent.md`:

```markdown
## Connected vaults
- Epidemiology: D:\Knowledge\Epidemiology (read-only)
- D:\Knowledge\Pharmacology (read-only)
```

Khi search trong Workspace, Lexicon co the hien ket qua tu vault lien ket voi path dang `vault:Name/folder/note.md`.
Trong Chat, neu dung context tu vault lien ket, citation se co dang `[[vault:Name/folder/note.md]]`.
Vault lien ket chi dung lam nguon tham khao read-only; approve/review/ingest van chi ghi vao active vault.

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
npm.cmd run clean
npm.cmd run typecheck
npm.cmd run build
npm.cmd start
```
