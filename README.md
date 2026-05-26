# Lexicon

Lexicon là ứng dụng quản lý tri thức local-first. Người dùng có thể ingest tài liệu, đưa qua AI để chuẩn hóa thành note Markdown, review trước khi commit vào vault, rồi chat/search dựa trên nội dung vault.

Trạng thái hiện tại:

- Core Python CLI: `ingest`, `inbox`, `scan`, `chat`, `decay`, `doctor`.
- Desktop app Electron + React: dashboard, ingestion UI, MinerU integration, review workflow.
- MinerU dùng để parse/OCR PDF scan trước khi đưa nội dung vào AI processor.
- Vault là thư mục Markdown local; app config/index nằm ngoài vault.

## Không commit gì?

Không đưa các thư mục/file local này lên GitHub:

- `.env`: chứa API key thật.
- `.lexicon/`: config local, registry vault, index local.
- `.tmp/`: vault test và dữ liệu thử.
- `.venv/`, `node_modules/`, build output.
- Folder cài MinerU local như `D:\MinerU`.

**Không cần up folder MinerU.** MinerU là service runtime riêng. Người dùng clone repo sẽ tự cài và chạy MinerU API local nếu cần OCR PDF.

## Yêu cầu hệ thống

- Python 3.10+ cho Lexicon core. Dự án hiện chạy tốt với Python 3.13.
- Node.js + npm cho desktop app.
- API AI OpenAI-compatible hoặc local LLM endpoint.
- MinerU riêng nếu muốn parse/OCR PDF scan.

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

Lexicon không lưu API key trực tiếp trong config. Key nên để trong biến môi trường hoặc file `.env` local không commit.

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
mineru-api --host 127.0.0.1 --port 8888
```

Để terminal MinerU mở. Mở PowerShell khác để kiểm tra:

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

Terminal 1: chạy AI local nếu dùng local endpoint, ví dụ:

```text
http://localhost:20128/v1
```

Terminal 2: chạy MinerU nếu ingest PDF scan:

```powershell
cd D:\MinerU
.\.venv\Scripts\Activate.ps1
mineru-api --host 127.0.0.1 --port 8888
```

Terminal 3: chạy Lexicon desktop:

```powershell
cd D:\Lexicon\desktop-app
npm.cmd install
npm.cmd run dev
```

Trong app:

1. Nhập vault path.
2. Bấm `Load`.
3. Kiểm tra System Health: `ai_provider: ok`, `mineru: ok` nếu dùng MinerU, `requests: ok`.
4. Ingest file/text/url.
5. Review item trong Review Queue.
6. Chọn folder `concepts`, `guidelines`, hoặc `references`.
7. Approve để commit vào vault và rebuild index.

## CLI workflow nhanh

Tạo vault:

```powershell
python -m lexicon.cli init-vault .\demo-vault --name "Demo Vault"
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
Source file/text/url
  -> Extractor Router
  -> MinerU / pdftotext / MarkItDown / HTTP fallback
  -> Raw Markdown
  -> AI Processor + agent.md
  -> _inbox review item
  -> Human review
  -> Commit to vault
  -> Rebuild index
  -> Chat/Search/Decay
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
|- vault.py                # thao tác filesystem vault
|- ingestion.py            # source -> review item
|- review.py               # inbox approve/reject/show
|- chat.py                 # vault chat orchestration
|- search.py               # local chunk index + retrieval
|- decay.py                # stale/expired knowledge scan
|- ai/                     # AI provider adapters
`- extractors/             # text/url/pdf/MinerU/MarkItDown adapters

desktop-app/               # Electron + React UI
docs/                      # architecture notes
tests/                     # Python tests
obsidian-plugin/           # optional compatibility scaffold
```

## Người khác clone về cần làm gì?

1. Clone repo.
2. Tạo Python venv và chạy `pip install -e .[dev]`.
3. Tạo `.env` từ `.env.example`.
4. Cấu hình API AI hoặc local LLM endpoint.
5. Nếu dùng PDF scan, cài MinerU riêng và chạy `mineru-api`.
6. Cài desktop dependencies bằng `npm.cmd install`.
7. Chạy `npm.cmd run dev` trong `desktop-app`.

Không cần clone/copy folder MinerU từ máy người phát triển. MinerU là runtime service riêng, giống database/service local.

## Kiểm tra trước khi commit

```powershell
pytest -q
cd desktop-app
npm.cmd run typecheck
npm.cmd run build
```
