import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

type SourceMode = "text" | "file" | "url";
type KnowledgeFolder = "concepts" | "guidelines" | "references";

type Settings = {
  provider: string;
  model: string;
  api_key_env: string | null;
  base_url: string | null;
  default_knowledge_mode: string;
  mineru_endpoint: string | null;
  mineru_timeout_seconds: number;
  url_extractor: string;
  file_extractor: string;
};

type Doctor = {
  provider: string;
  model: string;
  base_url: string | null;
  api_key_env: string | null;
  api_key_set: boolean;
  url_extractor: string;
  file_extractor: string;
  mineru_endpoint: string | null;
  mineru_timeout_seconds: number;
  dependencies: Record<string, string>;
  services: Record<string, string>;
};

type InboxItem = {
  index: number;
  path: string;
  title: string;
  source: string;
  filename: string;
  suggested_folder: string;
  confidence: number;
  warnings: string[];
  body_preview: string;
};

type DecayItem = {
  path: string;
  title: string;
  status: string;
  expires_at: string;
  reviewed_at: string;
  days_until_expiry: number | null;
};

function App() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [doctor, setDoctor] = useState<Doctor | null>(null);
  const [vaultPath, setVaultPath] = useState(() => localStorage.getItem("lexicon.vaultPath") ?? "");
  const [inbox, setInbox] = useState<InboxItem[]>([]);
  const [decay, setDecay] = useState<DecayItem[]>([]);
  const [selectedReview, setSelectedReview] = useState<InboxItem | null>(null);
  const [reviewFolder, setReviewFolder] = useState<KnowledgeFolder>("concepts");
  const [sourceMode, setSourceMode] = useState<SourceMode>("file");
  const [sourceTitle, setSourceTitle] = useState("");
  const [sourceText, setSourceText] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [sourceFile, setSourceFile] = useState("");
  const [sourceNote, setSourceNote] = useState("");
  const [mineruEndpoint, setMineruEndpoint] = useState("");
  const [mineruTimeoutSeconds, setMineruTimeoutSeconds] = useState("900");
  const [ingestResult, setIngestResult] = useState<string | null>(null);
  const [reviewBusy, setReviewBusy] = useState(false);
  const [ingestBusy, setIngestBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const staleCount = decay.filter((item) => item.status === "expired").length;
  const dueSoonCount = decay.filter((item) => item.status === "due-soon").length;
  const mineruReady = Boolean(settings?.mineru_endpoint) && doctor?.dependencies.requests === "ok";
  const selectedFileIsPdf = sourceFile.toLowerCase().endsWith(".pdf");

  const dependencyRows = useMemo(() => {
    if (!doctor) return [];
    return Object.entries(doctor.dependencies).map(([name, status]) => ({ name, status }));
  }, [doctor]);

  const serviceRows = useMemo(() => {
    if (!doctor) return [];
    return Object.entries(doctor.services ?? {}).map(([name, status]) => ({ name, status }));
  }, [doctor]);

  function reportError(err: unknown) {
    const raw = err instanceof Error ? err.message : String(err);
    setError(raw.replace(/^Error:\s*/, ""));
  }

  async function refreshAppHealth() {
    const [settingsResult, doctorResult] = await Promise.all([
      window.lexicon.run("settings", ["--json"]),
      window.lexicon.run("doctor", ["--json"])
    ]);
    setSettings(settingsResult.settings);
    setDoctor(doctorResult.doctor);
    setMineruEndpoint(settingsResult.settings.mineru_endpoint ?? "http://localhost:8888");
    setMineruTimeoutSeconds(String(settingsResult.settings.mineru_timeout_seconds ?? 900));
  }

  async function refreshVault() {
    if (!vaultPath.trim()) {
      setInbox([]);
      setDecay([]);
      return;
    }
    localStorage.setItem("lexicon.vaultPath", vaultPath);
    setLoading(true);
    setError(null);
    try {
      const [inboxResult, decayResult] = await Promise.all([
        window.lexicon.run("inbox", ["--vault", vaultPath, "--json"]),
        window.lexicon.run("decay", ["--vault", vaultPath, "--json"])
      ]);
      setInbox(inboxResult.items ?? []);
      setDecay(decayResult.items ?? []);
      if (selectedReview && !inboxResult.items?.some((item: InboxItem) => item.filename === selectedReview.filename)) {
        setSelectedReview(null);
      }
    } catch (err) {
      reportError(err);
    } finally {
      setLoading(false);
    }
  }

  async function saveMineruEndpoint() {
    setError(null);
    setIngestBusy(true);
    try {
      const endpoint = mineruEndpoint.trim();
      await window.lexicon.run("settings", [
        "--mineru-endpoint",
        endpoint,
        "--mineru-timeout-seconds",
        mineruTimeoutSeconds.trim() || "900",
        "--json"
      ]);
      await refreshAppHealth();
      setIngestResult(endpoint ? `MinerU endpoint saved: ${endpoint}` : "MinerU endpoint cleared.");
    } catch (err) {
      reportError(err);
    } finally {
      setIngestBusy(false);
    }
  }

  async function chooseSourceFile() {
    const selected = await window.lexicon.selectFile();
    if (selected) {
      setSourceFile(selected);
      if (!sourceTitle.trim()) {
        const filename = selected.split(/[\\/]/).pop() ?? "";
        setSourceTitle(filename.replace(/\.[^.]+$/, ""));
      }
    }
  }

  function ingestArgs(): string[] {
    const args = ["--vault", vaultPath, "--json"];
    if (sourceTitle.trim()) args.push("--title", sourceTitle.trim());
    if (sourceNote.trim()) args.push("--note", sourceNote.trim());
    if (sourceMode === "text") args.push("--text", sourceText.trim());
    if (sourceMode === "url") args.push("--url", sourceUrl.trim());
    if (sourceMode === "file") args.push("--file", sourceFile.trim());
    return args;
  }

  function canIngest() {
    if (!vaultPath.trim() || ingestBusy) return false;
    if (sourceMode === "text") return Boolean(sourceText.trim());
    if (sourceMode === "url") return Boolean(sourceUrl.trim());
    return Boolean(sourceFile.trim());
  }

  async function ingestSource() {
    if (!canIngest()) return;
    setError(null);
    setIngestResult(null);
    setIngestBusy(true);
    try {
      if (sourceMode === "file" && selectedFileIsPdf && mineruEndpoint.trim() !== (settings?.mineru_endpoint ?? "")) {
        await window.lexicon.run("settings", [
          "--mineru-endpoint",
          mineruEndpoint.trim(),
          "--mineru-timeout-seconds",
          mineruTimeoutSeconds.trim() || "900",
          "--json"
        ]);
        await refreshAppHealth();
      }
      const result = await window.lexicon.run("ingest", ingestArgs());
      setIngestResult(`Created review item: ${result.filename}`);
      await refreshVault();
    } catch (err) {
      reportError(err);
    } finally {
      setIngestBusy(false);
    }
  }

  async function selectReviewItem(item: InboxItem) {
    if (!vaultPath.trim()) return;
    setReviewBusy(true);
    setError(null);
    try {
      const result = await window.lexicon.run("inbox", ["--vault", vaultPath, "--show", String(item.index), "--json"]);
      setSelectedReview(result.item);
      setReviewFolder((result.item.suggested_folder || "concepts") as KnowledgeFolder);
    } catch (err) {
      reportError(err);
    } finally {
      setReviewBusy(false);
    }
  }

  async function approveSelectedReview() {
    if (!selectedReview || !vaultPath.trim()) return;
    setReviewBusy(true);
    setError(null);
    try {
      await window.lexicon.run("inbox", [
        "--vault",
        vaultPath,
        "--approve",
        String(selectedReview.index),
        "--folder",
        reviewFolder,
        "--json"
      ]);
      await window.lexicon.run("scan", ["--vault", vaultPath, "--json"]);
      setSelectedReview(null);
      await refreshVault();
    } catch (err) {
      reportError(err);
    } finally {
      setReviewBusy(false);
    }
  }

  async function rejectSelectedReview() {
    if (!selectedReview || !vaultPath.trim()) return;
    setReviewBusy(true);
    setError(null);
    try {
      await window.lexicon.run("inbox", ["--vault", vaultPath, "--reject", String(selectedReview.index), "--json"]);
      setSelectedReview(null);
      await refreshVault();
    } catch (err) {
      reportError(err);
    } finally {
      setReviewBusy(false);
    }
  }

  useEffect(() => {
    refreshAppHealth().catch((err) => {
      reportError(err);
    });
  }, []);

  useEffect(() => {
    refreshVault().catch((err) => {
      reportError(err);
    });
  }, []);

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">L</div>
          <div>
            <h1>Lexicon</h1>
            <span>Local knowledge workspace</span>
          </div>
        </div>
        <nav className="nav-list" aria-label="Primary">
          <button className="active">Dashboard</button>
          <button disabled>Workspace</button>
          <button disabled>Review</button>
          <button disabled>Settings</button>
        </nav>
      </aside>

      <section className="content">
        <header className="topbar">
          <div>
            <p className="eyebrow">Standalone Desktop Shell</p>
            <h2>Vault Dashboard</h2>
          </div>
          <button className="primary" onClick={() => void Promise.all([refreshAppHealth(), refreshVault()])} disabled={loading || ingestBusy}>
            {loading ? "Refreshing" : "Refresh"}
          </button>
        </header>

        {error ? <div className="error-panel">{error}</div> : null}
        {ingestResult ? <div className="success-panel">{ingestResult}</div> : null}

        <section className="vault-control">
          <label htmlFor="vaultPath">Vault path</label>
          <div className="input-row">
            <input
              id="vaultPath"
              value={vaultPath}
              onChange={(event) => setVaultPath(event.target.value)}
              placeholder="D:\Lexicon\.tmp\e2e-vault"
              spellCheck={false}
            />
            <button onClick={() => void refreshVault()} disabled={loading}>Load</button>
          </div>
        </section>

        <section className="metric-grid">
          <Metric label="Inbox" value={inbox.length} note="pending review" />
          <Metric label="Expired" value={staleCount} note="needs review" tone={staleCount > 0 ? "warn" : "ok"} />
          <Metric label="Due soon" value={dueSoonCount} note="decay window" />
          <Metric label="AI Provider" value={settings?.provider ?? "-"} note={settings?.model ?? "not loaded"} />
        </section>

        <section className="dashboard-grid">
          <Panel title="System Health">
            <dl className="kv-list">
              <div>
                <dt>Provider</dt>
                <dd>{doctor?.provider ?? "-"}</dd>
              </div>
              <div>
                <dt>Base URL</dt>
                <dd>{doctor?.base_url ?? "n/a"}</dd>
              </div>
              <div>
                <dt>API key</dt>
                <dd>{doctor?.api_key_set ? `${doctor.api_key_env} set` : "not set"}</dd>
              </div>
              <div>
                <dt>MinerU</dt>
                <dd>{doctor?.mineru_endpoint ?? "not configured"}</dd>
              </div>
              <div>
                <dt>Timeout</dt>
                <dd>{doctor?.mineru_timeout_seconds ?? 900}s</dd>
              </div>
            </dl>
            <div className="dependency-list">
              {dependencyRows.map((row) => (
                <span key={row.name} className={row.status === "ok" ? "pill ok" : "pill muted"}>
                  {row.name}: {row.status}
                </span>
              ))}
            </div>
            <div className="dependency-list service-list">
              {serviceRows.map((row) => (
                <span key={row.name} className={row.status === "ok" ? "pill ok" : "pill danger"}>
                  {row.name}: {row.status}
                </span>
              ))}
            </div>
          </Panel>

          <section className="panel ingest-workbench">
            <div className="panel-header">
              <h3>Ingest Source</h3>
              <span className={mineruReady ? "status ready" : "status danger"}>{mineruReady ? "MinerU ready" : "MinerU not ready"}</span>
            </div>

            <div className="segmented">
              <button className={sourceMode === "file" ? "active" : ""} onClick={() => setSourceMode("file")}>File</button>
              <button className={sourceMode === "text" ? "active" : ""} onClick={() => setSourceMode("text")}>Text</button>
              <button className={sourceMode === "url" ? "active" : ""} onClick={() => setSourceMode("url")}>URL</button>
            </div>

            <div className="form-grid">
              <label>
                Title
                <input value={sourceTitle} onChange={(event) => setSourceTitle(event.target.value)} placeholder="Optional source title" />
              </label>
              <label>
                MinerU endpoint
                <div className="input-row compact-row">
                  <input value={mineruEndpoint} onChange={(event) => setMineruEndpoint(event.target.value)} placeholder="http://localhost:8888" />
                  <button onClick={() => void saveMineruEndpoint()} disabled={ingestBusy}>Save</button>
                </div>
              </label>
              <label>
                MinerU timeout seconds
                <input value={mineruTimeoutSeconds} onChange={(event) => setMineruTimeoutSeconds(event.target.value)} inputMode="numeric" />
              </label>
            </div>

            {sourceMode === "file" ? (
              <label className="full-width">
                Source file
                <div className="input-row compact-row">
                  <input value={sourceFile} onChange={(event) => setSourceFile(event.target.value)} placeholder="Select a PDF, Markdown, text, Office, HTML, or CSV file" />
                  <button onClick={() => void chooseSourceFile()}>Browse</button>
                </div>
              </label>
            ) : null}

            {sourceMode === "text" ? (
              <label className="full-width">
                Source text
                <textarea value={sourceText} onChange={(event) => setSourceText(event.target.value)} placeholder="Paste source text to normalize into a vault note" />
              </label>
            ) : null}

            {sourceMode === "url" ? (
              <label className="full-width">
                Source URL
                <input value={sourceUrl} onChange={(event) => setSourceUrl(event.target.value)} placeholder="https://example.com/source" />
              </label>
            ) : null}

            <label className="full-width">
              Processing note
              <textarea className="small-textarea" value={sourceNote} onChange={(event) => setSourceNote(event.target.value)} placeholder="Optional instruction for the AI processor" />
            </label>

            <div className="ingest-status">
              <span>PDF files use MinerU when the endpoint is configured; otherwise the core falls back to pdftotext.</span>
              {selectedFileIsPdf && !mineruReady ? <strong>Configure MinerU + requests before ingesting scanned PDFs.</strong> : null}
            </div>

            <div className="button-row">
              <button className="primary" onClick={() => void ingestSource()} disabled={!canIngest()}>
                {ingestBusy ? "Ingesting" : "Create Review Item"}
              </button>
            </div>
          </section>

          <Panel title="Review Queue">
            {inbox.length === 0 ? (
              <p className="empty">No pending review items.</p>
            ) : (
              <div className="table-list">
                {inbox.slice(0, 6).map((item) => (
                  <button
                    key={item.filename}
                    className={selectedReview?.filename === item.filename ? "row-card selected" : "row-card"}
                    onClick={() => void selectReviewItem(item)}
                    disabled={reviewBusy}
                  >
                    <div>
                      <strong>{item.title}</strong>
                      <span>{item.suggested_folder} / confidence {item.confidence.toFixed(2)}</span>
                    </div>
                    {item.warnings.length > 0 ? <span className="flag">!</span> : null}
                  </button>
                ))}
              </div>
            )}
          </Panel>

          <section className="panel review-workbench">
            <div className="panel-header">
              <h3>Review Detail</h3>
              {selectedReview ? <span className="status">{selectedReview.filename}</span> : null}
            </div>
            {!selectedReview ? (
              <p className="empty">Select an inbox item to review extracted content and commit it to the vault.</p>
            ) : (
              <div className="review-detail">
                <dl className="kv-list compact">
                  <div>
                    <dt>Title</dt>
                    <dd>{selectedReview.title}</dd>
                  </div>
                  <div>
                    <dt>Source</dt>
                    <dd>{selectedReview.source}</dd>
                  </div>
                  <div>
                    <dt>Confidence</dt>
                    <dd>{selectedReview.confidence.toFixed(2)}</dd>
                  </div>
                </dl>

                {selectedReview.warnings.length > 0 ? (
                  <div className="warning-list">
                    {selectedReview.warnings.map((warning) => (
                      <div key={warning}>{warning}</div>
                    ))}
                  </div>
                ) : null}

                <pre className="preview-box">{selectedReview.body_preview}</pre>

                <div className="review-actions">
                  <label>
                    Folder
                    <select value={reviewFolder} onChange={(event) => setReviewFolder(event.target.value as KnowledgeFolder)} disabled={reviewBusy}>
                      <option value="concepts">concepts</option>
                      <option value="guidelines">guidelines</option>
                      <option value="references">references</option>
                    </select>
                  </label>
                  <div className="button-row">
                    <button onClick={() => void rejectSelectedReview()} disabled={reviewBusy}>Reject</button>
                    <button className="primary" onClick={() => void approveSelectedReview()} disabled={reviewBusy}>
                      {reviewBusy ? "Working" : "Approve"}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </section>

          <Panel title="Knowledge Decay">
            {decay.length === 0 ? (
              <p className="empty">No expired or due-soon notes.</p>
            ) : (
              <div className="table-list">
                {decay.slice(0, 6).map((item) => (
                  <article key={item.path} className="row-card">
                    <div>
                      <strong>{item.title}</strong>
                      <span>{item.path}</span>
                    </div>
                    <span className={item.status === "expired" ? "status danger" : "status"}>{item.status}</span>
                  </article>
                ))}
              </div>
            )}
          </Panel>
        </section>
      </section>
    </main>
  );
}

function Metric({ label, value, note, tone }: { label: string; value: number | string; note: string; tone?: "ok" | "warn" }) {
  return (
    <article className={`metric ${tone ?? ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{note}</small>
    </article>
  );
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="panel">
      <h3>{title}</h3>
      {children}
    </section>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
