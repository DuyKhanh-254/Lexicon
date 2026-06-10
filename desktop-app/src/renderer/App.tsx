import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

type SourceMode = "text" | "file" | "image" | "url";
type KnowledgeFolder = "concepts" | "guidelines" | "references";
type ActiveView = "setup" | "vaults" | "dashboard" | "workspace" | "chat" | "review" | "decay" | "settings";
type KnowledgeMode = "vault-only" | "vault+model" | "vault+web";
type DuplicateDecision = "keep" | "link" | "merge";

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
  body: string;
};

type DecayItem = {
  path: string;
  title: string;
  status: string;
  expires_at: string;
  reviewed_at: string;
  days_until_expiry: number | null;
};

type WorkspaceNote = {
  path: string;
  title: string;
  folder: string;
  size: number;
  modified_at: string;
  preview: string;
};

type WorkspaceSearchHit = {
  path: string;
  title: string;
  heading: string;
  score: number;
  snippet: string;
  vault_name?: string;
  vault_path?: string;
  external?: boolean;
};

type WorkspaceSelectedNote = WorkspaceNote & {
  frontmatter: Record<string, string>;
  body: string;
  vault_name?: string;
  vault_path?: string;
  external?: boolean;
};

type ChatResult = {
  question: string;
  mode: KnowledgeMode;
  answer: string;
  saved: string | null;
};

type ChatHistoryItem = ChatResult & {
  id: string;
  createdAt: string;
  citations: string[];
};

type AgentPayload = {
  path: string;
  filename: string;
  exists: boolean;
  body: string;
  line_count: number;
  vault: string;
};

type VaultSummary = {
  name: string;
  path: string;
  exists: boolean;
  agent_exists: boolean;
  notes_count: number;
  inbox_count: number;
  expired_count: number;
  due_soon_count: number;
  status: string;
  error?: string;
};

type MineruRuntimeStatus = {
  running: boolean;
  command: string;
  args: string[];
  cwd: string;
  pid: number | null;
  lastOutput: string;
  lastError: string;
  exitCode: number | null;
};

function lexiconApi() {
  if (!window.lexicon) {
    throw new Error("Lexicon desktop bridge is not loaded. Restart the app after building, then try again.");
  }
  return window.lexicon;
}

function App() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [doctor, setDoctor] = useState<Doctor | null>(null);
  const [activeView, setActiveView] = useState<ActiveView>(() =>
    localStorage.getItem("lexicon.vaultPath") ? "dashboard" : "setup"
  );
  const [vaultPath, setVaultPath] = useState(() => localStorage.getItem("lexicon.vaultPath") ?? "");
  const [setupVaultName, setSetupVaultName] = useState("Lexicon Vault");
  const [setupResult, setSetupResult] = useState<string | null>(null);
  const [vaults, setVaults] = useState<VaultSummary[]>([]);
  const [vaultManagerName, setVaultManagerName] = useState("Lexicon Vault");
  const [vaultManagerPath, setVaultManagerPath] = useState(() => localStorage.getItem("lexicon.vaultPath") ?? "");
  const [vaultManagerResult, setVaultManagerResult] = useState<string | null>(null);
  const [vaultsBusy, setVaultsBusy] = useState(false);
  const [inbox, setInbox] = useState<InboxItem[]>([]);
  const [decay, setDecay] = useState<DecayItem[]>([]);
  const [vaultNoteCount, setVaultNoteCount] = useState<number | null>(null);
  const [workspaceNotes, setWorkspaceNotes] = useState<WorkspaceNote[]>([]);
  const [workspaceHits, setWorkspaceHits] = useState<WorkspaceSearchHit[]>([]);
  const [selectedWorkspaceNote, setSelectedWorkspaceNote] = useState<WorkspaceSelectedNote | null>(null);
  const [workspaceQuery, setWorkspaceQuery] = useState("");
  const [workspaceBusy, setWorkspaceBusy] = useState(false);
  const [chatQuestion, setChatQuestion] = useState("");
  const [chatMode, setChatMode] = useState<KnowledgeMode>("vault-only");
  const [chatSave, setChatSave] = useState(false);
  const [chatTitle, setChatTitle] = useState("");
  const [chatResult, setChatResult] = useState<ChatResult | null>(null);
  const [chatHistory, setChatHistory] = useState<ChatHistoryItem[]>([]);
  const [chatBusy, setChatBusy] = useState(false);
  const [selectedDecay, setSelectedDecay] = useState<DecayItem | null>(null);
  const [selectedDecayNote, setSelectedDecayNote] = useState<WorkspaceSelectedNote | null>(null);
  const [decayReviewedAt, setDecayReviewedAt] = useState("");
  const [decayExpiresAt, setDecayExpiresAt] = useState("");
  const [decayBusy, setDecayBusy] = useState(false);
  const [decayResult, setDecayResult] = useState<string | null>(null);
  const [selectedReview, setSelectedReview] = useState<InboxItem | null>(null);
  const [reviewBody, setReviewBody] = useState("");
  const [reviewFolder, setReviewFolder] = useState<KnowledgeFolder>("concepts");
  const [reviewDirty, setReviewDirty] = useState(false);
  const [reviewSaveStatus, setReviewSaveStatus] = useState<string | null>(null);
  const [duplicateDecision, setDuplicateDecision] = useState<DuplicateDecision>("keep");
  const [duplicateTarget, setDuplicateTarget] = useState("");
  const [sourceMode, setSourceMode] = useState<SourceMode>("file");
  const [sourceTitle, setSourceTitle] = useState("");
  const [sourceText, setSourceText] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [sourceFile, setSourceFile] = useState("");
  const [sourceNote, setSourceNote] = useState("");
  const [settingsProvider, setSettingsProvider] = useState("");
  const [settingsModel, setSettingsModel] = useState("");
  const [settingsBaseUrl, setSettingsBaseUrl] = useState("");
  const [settingsApiKeyEnv, setSettingsApiKeyEnv] = useState("");
  const [settingsDefaultMode, setSettingsDefaultMode] = useState<KnowledgeMode>("vault+model");
  const [settingsUrlExtractor, setSettingsUrlExtractor] = useState("http");
  const [settingsFileExtractor, setSettingsFileExtractor] = useState("auto");
  const [mineruEndpoint, setMineruEndpoint] = useState("");
  const [mineruTimeoutSeconds, setMineruTimeoutSeconds] = useState("900");
  const [mineruCommand, setMineruCommand] = useState(() =>
    localStorage.getItem("lexicon.mineruCommand") ?? "D:\\MinerU\\.venv\\Scripts\\mineru-api.exe"
  );
  const [mineruArgsText, setMineruArgsText] = useState(() =>
    localStorage.getItem("lexicon.mineruArgs") ?? "--host 127.0.0.1 --port 8888"
  );
  const [mineruCwd, setMineruCwd] = useState(() => localStorage.getItem("lexicon.mineruCwd") ?? "D:\\MinerU");
  const [mineruRuntime, setMineruRuntime] = useState<MineruRuntimeStatus | null>(null);
  const [mineruRuntimeResult, setMineruRuntimeResult] = useState<string | null>(null);
  const [ingestResult, setIngestResult] = useState<string | null>(null);
  const [ingestStep, setIngestStep] = useState<string | null>(null);
  const [settingsResult, setSettingsResult] = useState<string | null>(null);
  const [agent, setAgent] = useState<AgentPayload | null>(null);
  const [agentBody, setAgentBody] = useState("");
  const [agentDirty, setAgentDirty] = useState(false);
  const [agentResult, setAgentResult] = useState<string | null>(null);
  const [reviewBusy, setReviewBusy] = useState(false);
  const [ingestBusy, setIngestBusy] = useState(false);
  const [settingsBusy, setSettingsBusy] = useState(false);
  const [agentBusy, setAgentBusy] = useState(false);
  const [mineruRuntimeBusy, setMineruRuntimeBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const staleCount = decay.filter((item) => item.status === "expired").length;
  const dueSoonCount = decay.filter((item) => item.status === "due_soon" || item.status === "due-soon").length;
  const mineruReady = Boolean(settings?.mineru_endpoint) && doctor?.dependencies.requests === "ok";
  const mineruEndpointReachable = doctor?.services?.mineru === "ok";
  const mineruManagedRunning = Boolean(mineruRuntime?.running);
  const selectedFileIsPdf = sourceFile.toLowerCase().endsWith(".pdf");
  const selectedFileIsImage = /\.(png|jpe?g|webp|gif|bmp|tiff?)$/i.test(sourceFile);
  const selectedFileUsesMineru = sourceMode === "image" || selectedFileIsPdf;
  const activeVault = vaults.find((item) => normalizePathKey(item.path) === normalizePathKey(vaultPath));
  const vaultName = activeVault?.name ?? vaultPath.trim().split(/[\\/]/).filter(Boolean).pop() ?? "No vault loaded";
  const viewTitle =
    activeView === "setup"
      ? "First-run setup"
      : activeView === "vaults"
        ? "Vault manager"
      : activeView === "workspace"
      ? "Workspace"
      : activeView === "chat"
        ? "Vault chat"
        : activeView === "review"
          ? "Review queue"
          : activeView === "decay"
            ? "Decay review"
            : activeView === "settings"
              ? "System setup"
              : "Vault dashboard";

  const dependencyRows = useMemo(() => {
    if (!doctor) return [];
    return Object.entries(doctor.dependencies).map(([name, status]) => ({ name, status }));
  }, [doctor]);

  const serviceRows = useMemo(() => {
    if (!doctor) return [];
    return Object.entries(doctor.services ?? {}).map(([name, status]) => ({ name, status }));
  }, [doctor]);

  const workspaceGroups = useMemo(() => {
    const groups = new Map<string, WorkspaceNote[]>();
    for (const note of workspaceNotes) {
      const folder = note.folder || note.path.split("/")[0] || "root";
      groups.set(folder, [...(groups.get(folder) ?? []), note]);
    }
    return Array.from(groups.entries()).sort(([left], [right]) => left.localeCompare(right));
  }, [workspaceNotes]);

  const chatCitations = useMemo(() => extractCitations(chatResult?.answer ?? ""), [chatResult]);
  const currentQuestionAlreadySaved = chatHistory.some(
    (item) => item.saved && item.question.trim().toLowerCase() === chatQuestion.trim().toLowerCase() && item.mode === chatMode
  );
  const selectedDuplicates = useMemo(
    () => parseDuplicateWarnings(selectedReview?.warnings ?? []),
    [selectedReview]
  );
  const setupVaultReady = Boolean(vaultPath.trim()) && vaultNoteCount !== null;
  const setupAiReady = doctor?.services?.ai_provider === "ok";
  const setupMineruReady = doctor?.services?.mineru === "ok";
  const setupAgentReady = Boolean(agentBody.trim());

  function reportError(err: unknown) {
    const raw = err instanceof Error ? err.message : String(err);
    setError(raw.replace(/^Error:\s*/, ""));
  }

  function todayIso() {
    return new Date().toISOString().slice(0, 10);
  }

  async function refreshAppHealth() {
    const [settingsResult, doctorResult] = await Promise.all([
      lexiconApi().run("settings", ["--json"]),
      lexiconApi().run("doctor", ["--json"])
    ]);
    setSettings(settingsResult.settings);
    setDoctor(doctorResult.doctor);
    setSettingsProvider(settingsResult.settings.provider ?? "local");
    setSettingsModel(settingsResult.settings.model ?? "");
    setSettingsBaseUrl(settingsResult.settings.base_url ?? "");
    setSettingsApiKeyEnv(settingsResult.settings.api_key_env ?? "");
    if (["vault-only", "vault+model", "vault+web"].includes(settingsResult.settings.default_knowledge_mode)) {
      setSettingsDefaultMode(settingsResult.settings.default_knowledge_mode as KnowledgeMode);
    }
    setSettingsUrlExtractor(settingsResult.settings.url_extractor ?? "http");
    setSettingsFileExtractor(settingsResult.settings.file_extractor ?? "auto");
    setMineruEndpoint(settingsResult.settings.mineru_endpoint ?? "http://localhost:8888");
    setMineruTimeoutSeconds(String(settingsResult.settings.mineru_timeout_seconds ?? 900));
    if (["vault-only", "vault+model", "vault+web"].includes(settingsResult.settings.default_knowledge_mode)) {
      setChatMode(settingsResult.settings.default_knowledge_mode as KnowledgeMode);
    }
  }

  async function refreshMineruRuntime() {
    try {
      const status = await lexiconApi().mineruStatus();
      setMineruRuntime(mineruEndpointReachable && !status.running ? { ...status, lastError: "" } : status);
    } catch (err) {
      reportError(err);
    }
  }

  function saveMineruRuntimeDefaults() {
    localStorage.setItem("lexicon.mineruCommand", mineruCommand.trim());
    localStorage.setItem("lexicon.mineruArgs", mineruArgsText.trim());
    localStorage.setItem("lexicon.mineruCwd", mineruCwd.trim());
    setMineruRuntimeResult("MinerU runtime command saved locally.");
  }

  async function startMineruRuntime() {
    setMineruRuntimeBusy(true);
    setError(null);
    setMineruRuntimeResult(null);
    try {
      saveMineruRuntimeDefaults();
      const doctorResult = await lexiconApi().run("doctor", ["--json"]);
      setDoctor(doctorResult.doctor);
      if (doctorResult.doctor?.services?.mineru === "ok") {
        const status = await lexiconApi().mineruStatus();
        setMineruRuntime({ ...status, lastError: "" });
        setMineruRuntimeResult("MinerU endpoint is already reachable. Lexicon will use the existing service.");
        return;
      }
      const status = await lexiconApi().mineruStart({
        command: mineruCommand.trim(),
        args: splitCommandArgs(mineruArgsText),
        cwd: mineruCwd.trim() || undefined
      });
      setMineruRuntime(status);
      setMineruRuntimeResult(`MinerU process started${status.pid ? `: PID ${status.pid}` : ""}.`);
      window.setTimeout(() => {
        refreshAppHealth().catch((err) => reportError(err));
        refreshMineruRuntime().catch((err) => reportError(err));
      }, 1200);
    } catch (err) {
      reportError(err);
    } finally {
      setMineruRuntimeBusy(false);
    }
  }

  async function stopMineruRuntime() {
    setMineruRuntimeBusy(true);
    setError(null);
    setMineruRuntimeResult(null);
    try {
      const status = await lexiconApi().mineruStop();
      setMineruRuntime(status);
      setMineruRuntimeResult("MinerU process stopped.");
      await refreshAppHealth();
    } catch (err) {
      reportError(err);
    } finally {
      setMineruRuntimeBusy(false);
    }
  }

  async function refreshVaultRegistry() {
    setVaultsBusy(true);
    setError(null);
    try {
      const result = await lexiconApi().run("vaults", ["--json"]);
      setVaults(result.vaults ?? []);
    } catch (err) {
      reportError(err);
    } finally {
      setVaultsBusy(false);
    }
  }

  async function refreshVault(pathOverride = vaultPath) {
    const targetPath = pathOverride.trim();
    if (!targetPath) {
      setInbox([]);
      setDecay([]);
      setVaultNoteCount(null);
      return;
    }
    localStorage.setItem("lexicon.vaultPath", targetPath);
    setVaultPath(targetPath);
    setVaultManagerPath(targetPath);
    setLoading(true);
    setError(null);
    try {
      const [inboxResult, decayResult, workspaceResult] = await Promise.all([
        lexiconApi().run("inbox", ["--vault", targetPath, "--json"]),
        lexiconApi().run("decay", ["--vault", targetPath, "--json"]),
        lexiconApi().run("workspace", ["--vault", targetPath, "--json"])
      ]);
      setInbox(inboxResult.items ?? []);
      setDecay(decayResult.items ?? []);
      setVaultNoteCount((workspaceResult.notes ?? []).length);
      if (!workspaceQuery.trim()) setWorkspaceNotes(workspaceResult.notes ?? []);
      if (selectedReview && !inboxResult.items?.some((item: InboxItem) => item.filename === selectedReview.filename)) {
        setSelectedReview(null);
        setReviewBody("");
        setReviewDirty(false);
        setReviewSaveStatus(null);
      }
      if (agent && agent.vault !== targetPath) {
        setAgent(null);
        setAgentBody("");
        setAgentDirty(false);
        setAgentResult(null);
      }
    } catch (err) {
      reportError(err);
    } finally {
      setLoading(false);
    }
  }

  async function createOrLoadSetupVault(createVault: boolean) {
    if (!vaultPath.trim()) {
      setError("Set a vault path before continuing setup.");
      return;
    }
    setLoading(true);
    setError(null);
    setSetupResult(null);
    try {
      if (createVault) {
        const args = [vaultPath.trim(), "--json"];
        if (setupVaultName.trim()) args.splice(1, 0, "--name", setupVaultName.trim());
        await lexiconApi().run("init-vault", args);
        await refreshVaultRegistry();
      }
      localStorage.setItem("lexicon.vaultPath", vaultPath.trim());
      await refreshVault(vaultPath.trim());
      await loadVaultAgent(true, vaultPath.trim());
      setSetupResult(createVault ? `Vault created and loaded: ${vaultPath.trim()}` : `Vault loaded: ${vaultPath.trim()}`);
    } catch (err) {
      reportError(err);
    } finally {
      setLoading(false);
    }
  }

  async function createOrRegisterManagedVault() {
    const path = vaultManagerPath.trim();
    if (!path) {
      setError("Set a vault path before creating or registering a vault.");
      return;
    }
    setVaultsBusy(true);
    setError(null);
    setVaultManagerResult(null);
    try {
      const args = [path, "--json"];
      if (vaultManagerName.trim()) args.splice(1, 0, "--name", vaultManagerName.trim());
      const result = await lexiconApi().run("init-vault", args);
      setVaultManagerResult(`Vault registered: ${result.name ?? (vaultManagerName.trim() || path)}`);
      await refreshVaultRegistry();
      await refreshVault(path);
      await loadVaultAgent(true, path);
    } catch (err) {
      reportError(err);
    } finally {
      setVaultsBusy(false);
    }
  }

  async function loadManagedVault(item: VaultSummary, targetView?: ActiveView) {
    if (!item.exists) {
      setError(`Vault path does not exist: ${item.path}`);
      return;
    }
    setVaultPath(item.path);
    setVaultManagerPath(item.path);
    localStorage.setItem("lexicon.vaultPath", item.path);
    setVaultManagerResult(`Loaded vault: ${item.name}`);
    await refreshVault(item.path);
    await loadVaultAgent(false, item.path);
    if (targetView) setActiveView(targetView);
  }

  async function removeManagedVault(item: VaultSummary) {
    setVaultsBusy(true);
    setError(null);
    setVaultManagerResult(null);
    try {
      await lexiconApi().run("vaults", ["--remove", item.name, "--json"]);
      setVaultManagerResult(`Removed registry entry: ${item.name}. Vault folder was not deleted.`);
      await refreshVaultRegistry();
    } catch (err) {
      reportError(err);
    } finally {
      setVaultsBusy(false);
    }
  }

  async function chooseVaultDirectory() {
    const selected = await lexiconApi().selectDirectory();
    if (selected) {
      setVaultManagerPath(selected);
      setVaultPath(selected);
      if (!vaultManagerName.trim()) {
        setVaultManagerName(selected.split(/[\\/]/).filter(Boolean).pop() ?? "Lexicon Vault");
      }
    }
  }

  async function refreshWorkspace(query = workspaceQuery) {
    if (!vaultPath.trim()) {
      setWorkspaceNotes([]);
      setWorkspaceHits([]);
      setSelectedWorkspaceNote(null);
      return;
    }
    setWorkspaceBusy(true);
    setError(null);
    try {
      const cleanQuery = query.trim();
      const args = cleanQuery
        ? ["--vault", vaultPath, "--search", cleanQuery, "--include-connected", "--limit", "12", "--json"]
        : ["--vault", vaultPath, "--json"];
      const result = await lexiconApi().run("workspace", args);
      if (cleanQuery) {
        setWorkspaceHits(result.hits ?? []);
      } else {
        setWorkspaceNotes(result.notes ?? []);
        setWorkspaceHits([]);
      }
    } catch (err) {
      reportError(err);
    } finally {
      setWorkspaceBusy(false);
    }
  }

  async function selectWorkspaceNote(path: string) {
    if (!vaultPath.trim()) return;
    setWorkspaceBusy(true);
    setError(null);
    try {
      const result = await lexiconApi().run("workspace", ["--vault", vaultPath, "--read", path, "--json"]);
      setSelectedWorkspaceNote(result.note);
    } catch (err) {
      reportError(err);
    } finally {
      setWorkspaceBusy(false);
    }
  }

  async function openWorkspaceFromHit(hit: WorkspaceSearchHit) {
    await selectWorkspaceNote(hit.path);
  }

  function navigateWikilink(target: string) {
    const cleanTarget = target.replace(/^\[\[/, "").replace(/\]\]$/, "").split("|")[0].trim();
    if (cleanTarget.startsWith("vault:")) {
      void selectWorkspaceNote(cleanTarget);
      setActiveView("workspace");
      return;
    }
    const normalizedTarget = cleanTarget.replace(/\\/g, "/").replace(/\.md$/i, "").toLowerCase();
    const matched = workspaceNotes.find((note) => {
      const path = note.path.replace(/\\/g, "/").replace(/\.md$/i, "").toLowerCase();
      const title = note.title.toLowerCase();
      const stem = path.split("/").pop() ?? "";
      return path === normalizedTarget || title === normalizedTarget || stem === normalizedTarget;
    });
    if (matched) {
      void selectWorkspaceNote(matched.path);
      setActiveView("workspace");
    } else {
      setError(`Linked note not found in this vault: ${cleanTarget}`);
    }
  }

  async function askVault() {
    if (!vaultPath.trim() || !chatQuestion.trim()) return;
    setChatBusy(true);
    setError(null);
    setIngestResult(null);
    try {
      const args = ["--vault", vaultPath, "--mode", chatMode];
      if (chatSave) args.push("--save");
      const effectiveTitle = chatTitle.trim() || titleFromQuestion(chatQuestion);
      if (chatSave) args.push("--title", effectiveTitle);
      args.push("--json", chatQuestion.trim());
      const result = await lexiconApi().run("chat", args);
      setChatResult(result);
      setChatHistory((items) => [
        {
          ...result,
          id: `${Date.now()}-${items.length}`,
          createdAt: new Date().toLocaleTimeString(),
          citations: extractCitations(result.answer),
        },
        ...items,
      ]);
      if (result.saved) {
        setChatSave(false);
        setChatTitle("");
        setIngestResult(`Saved answer for review: ${result.saved}`);
        await refreshVault();
      }
    } catch (err) {
      reportError(err);
    } finally {
      setChatBusy(false);
    }
  }

  async function selectDecayItem(item: DecayItem) {
    if (!vaultPath.trim()) return;
    setDecayBusy(true);
    setError(null);
    setDecayResult(null);
    try {
      const result = await lexiconApi().run("workspace", ["--vault", vaultPath, "--read", item.path, "--json"]);
      setSelectedDecay(item);
      setSelectedDecayNote(result.note);
      setDecayReviewedAt(item.reviewed_at || todayIso());
      setDecayExpiresAt(item.expires_at || "");
    } catch (err) {
      reportError(err);
    } finally {
      setDecayBusy(false);
    }
  }

  async function updateSelectedDecay() {
    if (!selectedDecay || !vaultPath.trim()) return;
    setDecayBusy(true);
    setError(null);
    setDecayResult(null);
    try {
      const result = await lexiconApi().run("decay", [
        "--vault",
        vaultPath,
        "--update",
        selectedDecay.path,
        "--reviewed-at",
        decayReviewedAt || todayIso(),
        "--expires-at",
        decayExpiresAt,
        "--json"
      ]);
      setSelectedDecay(result.item);
      setDecayReviewedAt(result.item.reviewed_at || decayReviewedAt);
      setDecayExpiresAt(result.item.expires_at || decayExpiresAt);
      setDecayResult(result.warnings?.length ? result.warnings.join("\n") : `Updated: ${result.item.path}`);
      await refreshVault();
      if (activeView === "workspace") await refreshWorkspace();
    } catch (err) {
      reportError(err);
    } finally {
      setDecayBusy(false);
    }
  }

  async function saveMineruEndpoint() {
    setError(null);
    setIngestBusy(true);
    try {
      const endpoint = mineruEndpoint.trim();
      await lexiconApi().run("settings", [
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

  async function saveSystemSettings() {
    setError(null);
    setSettingsResult(null);
    setSettingsBusy(true);
    try {
      const result = await lexiconApi().run("settings", [
        "--provider",
        settingsProvider.trim() || "local",
        "--model",
        settingsModel.trim(),
        "--base-url",
        settingsBaseUrl.trim(),
        "--api-key-env",
        settingsApiKeyEnv.trim(),
        "--mineru-endpoint",
        mineruEndpoint.trim(),
        "--mineru-timeout-seconds",
        mineruTimeoutSeconds.trim() || "900",
        "--default-knowledge-mode",
        settingsDefaultMode,
        "--url-extractor",
        settingsUrlExtractor,
        "--file-extractor",
        settingsFileExtractor,
        "--json"
      ]);
      setSettings(result.settings);
      setSettingsResult("Settings saved. System health refreshed.");
      await refreshAppHealth();
    } catch (err) {
      reportError(err);
    } finally {
      setSettingsBusy(false);
    }
  }

  async function loadVaultAgent(init = false, pathOverride = vaultPath) {
    const targetPath = pathOverride.trim();
    if (!targetPath) return;
    setAgentBusy(true);
    setError(null);
    setAgentResult(null);
    try {
      const args = ["--vault", targetPath, "--json"];
      if (init) args.splice(2, 0, "--init");
      const result = await lexiconApi().run("agent", args);
      setAgent(result.agent);
      setAgentBody(result.agent.body ?? "");
      setAgentDirty(false);
      setAgentResult(init ? "Agent template loaded." : "Agent loaded.");
    } catch (err) {
      reportError(err);
    } finally {
      setAgentBusy(false);
    }
  }

  async function saveVaultAgent() {
    if (!vaultPath.trim()) return;
    setAgentBusy(true);
    setError(null);
    setAgentResult(null);
    try {
      const result = await lexiconApi().run("agent", [
        "--vault",
        vaultPath,
        "--init",
        "--body-base64",
        encodeBase64Utf8(agentBody),
        "--json"
      ]);
      setAgent(result.agent);
      setAgentBody(result.agent.body ?? agentBody);
      setAgentDirty(false);
      setAgentResult("Agent saved. New ingest/chat calls will use the updated vault profile.");
    } catch (err) {
      reportError(err);
    } finally {
      setAgentBusy(false);
    }
  }

  async function chooseSourceFile() {
    const selected = await lexiconApi().selectFile();
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
    if (sourceMode === "file" || sourceMode === "image") args.push("--file", sourceFile.trim());
    return args;
  }

  function canIngest() {
    if (!vaultPath.trim() || ingestBusy) return false;
    if (sourceMode === "text") return Boolean(sourceText.trim());
    if (sourceMode === "url") return Boolean(sourceUrl.trim());
    return Boolean(sourceFile.trim());
  }

  function encodeBase64Utf8(value: string) {
    const bytes = new TextEncoder().encode(value);
    let binary = "";
    const chunkSize = 0x8000;
    for (let index = 0; index < bytes.length; index += chunkSize) {
      const chunk = bytes.slice(index, index + chunkSize);
      binary += String.fromCharCode(...chunk);
    }
    return btoa(binary);
  }

  async function updateReviewBody(item: InboxItem, body = reviewBody) {
    return lexiconApi().run("inbox", [
      "--vault",
      vaultPath,
      "--replace-body",
      String(item.index),
      "--body-base64",
      encodeBase64Utf8(body),
      "--json"
    ]);
  }

  async function ingestSource() {
    if (!canIngest()) return;
    setError(null);
    setIngestResult(null);
    setIngestBusy(true);
    try {
      if (sourceMode === "file" && selectedFileIsPdf && mineruEndpoint.trim() !== (settings?.mineru_endpoint ?? "")) {
        setIngestStep("Saving MinerU settings");
        await lexiconApi().run("settings", [
          "--mineru-endpoint",
          mineruEndpoint.trim(),
          "--mineru-timeout-seconds",
          mineruTimeoutSeconds.trim() || "900",
          "--json"
        ]);
        await refreshAppHealth();
      }
      if (sourceMode === "image" && mineruEndpoint.trim() !== (settings?.mineru_endpoint ?? "")) {
        setIngestStep("Saving MinerU settings");
        await lexiconApi().run("settings", [
          "--mineru-endpoint",
          mineruEndpoint.trim(),
          "--mineru-timeout-seconds",
          mineruTimeoutSeconds.trim() || "900",
          "--json"
        ]);
        await refreshAppHealth();
      }
      setIngestStep(selectedFileUsesMineru ? "Extracting with MinerU and preparing review item" : "Extracting source and preparing review item");
      const result = await lexiconApi().run("ingest", ingestArgs());
      setIngestResult(`Created review item: ${result.filename}`);
      setIngestStep("Review item created");
      await refreshVault();
    } catch (err) {
      reportError(err);
    } finally {
      setIngestBusy(false);
      setTimeout(() => setIngestStep(null), 1200);
    }
  }

  function resetIngestForm() {
    setSourceText("");
    setSourceUrl("");
    setSourceFile("");
    setSourceNote("");
    setIngestResult(null);
    setIngestStep(null);
  }

  async function selectReviewItem(item: InboxItem) {
    if (!vaultPath.trim()) return;
    setReviewBusy(true);
    setError(null);
    try {
      const result = await lexiconApi().run("inbox", ["--vault", vaultPath, "--show", String(item.index), "--json"]);
      setSelectedReview(result.item);
      setReviewBody(result.item.body ?? result.item.body_preview ?? "");
      setReviewFolder((result.item.suggested_folder || "concepts") as KnowledgeFolder);
      setReviewDirty(false);
      setReviewSaveStatus(null);
      const duplicates = parseDuplicateWarnings(result.item.warnings ?? []);
      setDuplicateDecision("keep");
      setDuplicateTarget(duplicates[0]?.path ?? "");
    } catch (err) {
      reportError(err);
    } finally {
      setReviewBusy(false);
    }
  }

  async function saveSelectedReviewBody() {
    if (!selectedReview || !vaultPath.trim()) return null;
    setReviewBusy(true);
    setError(null);
    setReviewSaveStatus(null);
    try {
      const result = await updateReviewBody(selectedReview);
      setSelectedReview(result.item);
      setReviewBody(result.item.body ?? reviewBody);
      setReviewDirty(false);
      setReviewSaveStatus("Saved edits.");
      return result.item as InboxItem;
    } catch (err) {
      reportError(err);
      return null;
    } finally {
      setReviewBusy(false);
    }
  }

  async function approveSelectedReview() {
    if (!selectedReview || !vaultPath.trim()) return;
    setReviewBusy(true);
    setError(null);
    try {
      if (duplicateDecision === "merge" && duplicateTarget) {
        if (reviewDirty) {
          await updateReviewBody(selectedReview);
          setReviewDirty(false);
        }
        const result = await lexiconApi().run("inbox", [
          "--vault",
          vaultPath,
          "--merge-into",
          String(selectedReview.index),
          "--target",
          duplicateTarget,
          "--json"
        ]);
        await lexiconApi().run("scan", ["--vault", vaultPath, "--json"]);
        setSelectedReview(null);
        setReviewBody("");
        setReviewSaveStatus(null);
        setDuplicateDecision("keep");
        setDuplicateTarget("");
        await refreshVault();
        setWorkspaceQuery("");
        setActiveView("workspace");
        await refreshWorkspace("");
        if (result.target) await selectWorkspaceNote(result.target);
        return;
      }
      const finalReviewBody =
        duplicateDecision === "link" && duplicateTarget
          ? bodyWithRelatedNote(reviewBody, duplicateTarget)
          : reviewBody;
      if (reviewDirty) {
        await updateReviewBody(selectedReview, finalReviewBody);
        setReviewDirty(false);
      } else if (finalReviewBody !== reviewBody) {
        await updateReviewBody(selectedReview, finalReviewBody);
      }
      await lexiconApi().run("inbox", [
        "--vault",
        vaultPath,
        "--approve",
        String(selectedReview.index),
        "--folder",
        reviewFolder,
        "--json"
      ]);
      await lexiconApi().run("scan", ["--vault", vaultPath, "--json"]);
      setSelectedReview(null);
      setReviewBody("");
      setReviewSaveStatus(null);
      setDuplicateDecision("keep");
      setDuplicateTarget("");
      await refreshVault();
      setWorkspaceQuery("");
      setActiveView("workspace");
      await refreshWorkspace("");
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
      await lexiconApi().run("inbox", ["--vault", vaultPath, "--reject", String(selectedReview.index), "--json"]);
      setSelectedReview(null);
      setReviewBody("");
      setReviewDirty(false);
      setReviewSaveStatus(null);
      setDuplicateDecision("keep");
      setDuplicateTarget("");
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
    refreshVaultRegistry().catch((err) => {
      reportError(err);
    });
    refreshMineruRuntime().catch((err) => {
      reportError(err);
    });
  }, []);

  useEffect(() => {
    refreshVault().catch((err) => {
      reportError(err);
    });
  }, []);

  useEffect(() => {
    if (activeView === "workspace") {
      refreshWorkspace().catch((err) => {
        reportError(err);
      });
    }
    if (activeView === "decay") {
      refreshVault().catch((err) => {
        reportError(err);
      });
    }
    if (activeView === "review") {
      refreshVault().catch((err) => {
        reportError(err);
      });
    }
  }, [activeView]);

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
        <div className="vault-chip">
          <span>Active vault</span>
          <strong>{vaultName}</strong>
        </div>
        <nav className="nav-list" aria-label="Primary">
          <button className={activeView === "setup" ? "active" : ""} onClick={() => setActiveView("setup")}>Setup</button>
          <button className={activeView === "vaults" ? "active" : ""} onClick={() => setActiveView("vaults")}>Vaults</button>
          <button className={activeView === "dashboard" ? "active" : ""} onClick={() => setActiveView("dashboard")}>Dashboard</button>
          <button className={activeView === "workspace" ? "active" : ""} onClick={() => setActiveView("workspace")}>Workspace</button>
          <button className={activeView === "chat" ? "active" : ""} onClick={() => setActiveView("chat")}>Chat</button>
          <button className={activeView === "review" ? "active" : ""} onClick={() => setActiveView("review")}>Review</button>
          <button className={activeView === "decay" ? "active" : ""} onClick={() => setActiveView("decay")}>Decay</button>
          <button className={activeView === "settings" ? "active" : ""} onClick={() => setActiveView("settings")}>Settings</button>
        </nav>
      </aside>

      <section className="content">
        <header className="topbar">
          <div>
            <p className="eyebrow">Standalone desktop shell</p>
            <h2>{viewTitle}</h2>
            <p className="topbar-copy">
              {activeView === "setup"
                ? "Create or load a vault, verify AI and MinerU, prepare agent.md, then enter the workspace."
                : activeView === "vaults"
                  ? "Create, register, inspect, and switch between local knowledge vaults."
                : activeView === "workspace"
                ? "Browse committed notes, inspect Markdown, and move into chat when a question needs synthesis."
                : activeView === "chat"
                  ? "Ask against indexed vault context, then save useful answers back into review."
                  : activeView === "review"
                    ? "Inspect AI output, compare warnings, edit Markdown, then commit only reviewed knowledge."
                    : activeView === "decay"
                      ? "Review stale knowledge before it silently becomes outdated."
                      : activeView === "settings"
                        ? "Configure AI, extraction, MinerU, and verify local dependencies before serious ingestion."
                        : "Monitor the vault, add sources, review AI output, and keep knowledge fresh."}
            </p>
          </div>
          <button
            className="primary"
            onClick={() => void Promise.all([refreshAppHealth(), refreshMineruRuntime(), refreshVault(), activeView === "workspace" ? refreshWorkspace() : Promise.resolve()])}
            disabled={loading || ingestBusy || workspaceBusy || chatBusy || reviewBusy || decayBusy || settingsBusy || agentBusy || vaultsBusy || mineruRuntimeBusy}
          >
            {loading || workspaceBusy || chatBusy || reviewBusy || decayBusy || settingsBusy || agentBusy || vaultsBusy || mineruRuntimeBusy ? "Refreshing" : "Refresh"}
          </button>
        </header>

        {error ? <div className="error-panel">{error}</div> : null}
        {ingestResult ? <div className="success-panel">{ingestResult}</div> : null}
        {decayResult ? <div className="success-panel">{decayResult}</div> : null}
        {settingsResult ? <div className="success-panel">{settingsResult}</div> : null}
        {agentResult ? <div className="success-panel">{agentResult}</div> : null}
        {setupResult ? <div className="success-panel">{setupResult}</div> : null}
        {vaultManagerResult ? <div className="success-panel">{vaultManagerResult}</div> : null}
        {mineruRuntimeResult ? <div className="success-panel">{mineruRuntimeResult}</div> : null}

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

        {activeView === "vaults" ? (
          <section className="vault-manager-grid">
            <section className="panel vault-create-panel">
              <div className="panel-header">
                <div>
                  <p className="panel-kicker">Vault registry</p>
                  <h3>Create or register vault</h3>
                </div>
                <span className="status">{vaults.length} registered</span>
              </div>
              <div className="form-grid setup-form-grid">
                <label>
                  Vault name
                  <input value={vaultManagerName} onChange={(event) => setVaultManagerName(event.target.value)} placeholder="Clinical Pharmacology" disabled={vaultsBusy} />
                </label>
                <label>
                  Vault path
                  <div className="input-row compact-row">
                    <input value={vaultManagerPath} onChange={(event) => setVaultManagerPath(event.target.value)} placeholder="D:\Lexicon\vaults\clinical-pharmacology" spellCheck={false} disabled={vaultsBusy} />
                    <button onClick={() => void chooseVaultDirectory()} disabled={vaultsBusy}>Browse</button>
                  </div>
                </label>
              </div>
              <p className="inline-help">
                This creates a local Markdown vault if missing, ensures <code>agent.md</code> exists, and registers it for fast switching.
              </p>
              <div className="button-row">
                <button onClick={() => void refreshVaultRegistry()} disabled={vaultsBusy}>Refresh registry</button>
                <button className="primary" onClick={() => void createOrRegisterManagedVault()} disabled={vaultsBusy || !vaultManagerPath.trim()}>
                  {vaultsBusy ? "Working" : "Create / register"}
                </button>
              </div>
            </section>

            <section className="panel vault-registry-panel">
              <div className="panel-header">
                <div>
                  <p className="panel-kicker">Local vaults</p>
                  <h3>Registered vaults</h3>
                </div>
                <span className={vaultsBusy ? "status" : "status ready"}>{vaultsBusy ? "refreshing" : "ready"}</span>
              </div>
              {vaults.length === 0 ? (
                <div className="empty-state">
                  <strong>No registered vaults</strong>
                  <p>Create or register a vault to start managing local knowledge domains.</p>
                </div>
              ) : (
                <div className="vault-card-list">
                  {vaults.map((item) => {
                    const isActive = item.path === vaultPath;
                    return (
                      <article key={`${item.name}:${item.path}`} className={isActive ? "vault-manager-card active" : "vault-manager-card"}>
                        <div className="vault-manager-card-main">
                          <div>
                            <p className="panel-kicker">{isActive ? "Active vault" : item.status}</p>
                            <h3>{item.name}</h3>
                            <span>{item.path}</span>
                            {item.error ? <small>{item.error}</small> : null}
                          </div>
                          <span className={item.status === "ok" ? "status ready" : "status danger"}>{item.status}</span>
                        </div>
                        <div className="vault-metrics-row">
                          <Metric label="Notes" value={item.notes_count} note="committed" />
                          <Metric label="Inbox" value={item.inbox_count} note="pending" tone={item.inbox_count ? "warn" : undefined} />
                          <Metric label="Expired" value={item.expired_count} note="decay" tone={item.expired_count ? "warn" : undefined} />
                          <Metric label="Due soon" value={item.due_soon_count} note="decay" />
                          <Metric label="Agent" value={item.agent_exists ? "yes" : "no"} note="agent.md" tone={item.agent_exists ? "ok" : "warn"} />
                        </div>
                        <div className="button-row vault-manager-actions">
                          <button onClick={() => void removeManagedVault(item)} disabled={vaultsBusy}>
                            Remove
                          </button>
                          <button onClick={() => void loadManagedVault(item)} disabled={vaultsBusy || !item.exists}>
                            {isActive ? "Reload" : "Load"}
                          </button>
                          <button onClick={() => void loadManagedVault(item, "workspace")} disabled={vaultsBusy || !item.exists || !item.agent_exists}>
                            Workspace
                          </button>
                          <button className="primary" onClick={() => void loadManagedVault(item, "dashboard")} disabled={vaultsBusy || !item.exists || !item.agent_exists}>
                            Open dashboard
                          </button>
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </section>
          </section>
        ) : activeView === "setup" ? (
          <section className="setup-flow">
            <section className="panel setup-hero-panel">
              <div className="panel-header">
                <div>
                  <p className="panel-kicker">Setup checklist</p>
                  <h3>Bring the local workspace online</h3>
                </div>
                <span className={setupVaultReady && setupAiReady ? "status ready" : "status"}>{setupVaultReady && setupAiReady ? "ready to ingest" : "needs setup"}</span>
              </div>
              <div className="setup-progress">
                <SetupStep label="Vault" done={setupVaultReady} />
                <SetupStep label="AI" done={setupAiReady} />
                <SetupStep label="MinerU" done={setupMineruReady} />
                <SetupStep label="Agent" done={setupAgentReady} />
              </div>
            </section>

            <section className="setup-grid">
              <section className="panel setup-step-panel">
                <div className="panel-header">
                  <div>
                    <p className="panel-kicker">Step 1</p>
                    <h3>Vault</h3>
                  </div>
                  <span className={setupVaultReady ? "status ready" : "status danger"}>{setupVaultReady ? `${vaultNoteCount} notes` : "not loaded"}</span>
                </div>
                <div className="form-grid setup-form-grid">
                  <label>
                    Vault display name
                    <input value={setupVaultName} onChange={(event) => setSetupVaultName(event.target.value)} placeholder="Lexicon Vault" disabled={loading} />
                  </label>
                  <label>
                    Current path
                    <input value={vaultPath} onChange={(event) => setVaultPath(event.target.value)} placeholder="D:\Lexicon\.tmp\e2e-vault" spellCheck={false} disabled={loading} />
                  </label>
                </div>
                <p className="inline-help">Use Create for a new empty vault, or Load for an existing vault folder.</p>
                <div className="button-row">
                  <button onClick={() => void createOrLoadSetupVault(false)} disabled={loading || !vaultPath.trim()}>Load existing</button>
                  <button className="primary" onClick={() => void createOrLoadSetupVault(true)} disabled={loading || !vaultPath.trim()}>
                    {loading ? "Working" : "Create vault"}
                  </button>
                </div>
              </section>

              <section className="panel setup-step-panel">
                <div className="panel-header">
                  <div>
                    <p className="panel-kicker">Step 2</p>
                    <h3>AI and extraction</h3>
                  </div>
                  <span className={setupAiReady ? "status ready" : "status danger"}>{setupAiReady ? "AI ok" : "check AI"}</span>
                </div>
                <div className="form-grid setup-form-grid">
                  <label>
                    Provider
                    <select value={settingsProvider} onChange={(event) => setSettingsProvider(event.target.value)} disabled={settingsBusy}>
                      <option value="local">local fallback</option>
                      <option value="openai-compatible">openai-compatible</option>
                      <option value="anthropic">anthropic</option>
                      <option value="ollama">ollama</option>
                    </select>
                  </label>
                  <label>
                    Model
                    <input value={settingsModel} onChange={(event) => setSettingsModel(event.target.value)} placeholder="best" disabled={settingsBusy} />
                  </label>
                  <label>
                    Base URL
                    <input value={settingsBaseUrl} onChange={(event) => setSettingsBaseUrl(event.target.value)} placeholder="http://localhost:20128/v1" disabled={settingsBusy} />
                  </label>
                  <label>
                    API key env
                    <input value={settingsApiKeyEnv} onChange={(event) => setSettingsApiKeyEnv(event.target.value)} placeholder="LEXICON_API_KEY" disabled={settingsBusy} />
                  </label>
                  <label>
                    Knowledge mode
                    <select value={settingsDefaultMode} onChange={(event) => setSettingsDefaultMode(event.target.value as KnowledgeMode)} disabled={settingsBusy}>
                      <option value="vault-only">vault-only</option>
                      <option value="vault+model">vault+model</option>
                      <option value="vault+web">vault+web</option>
                    </select>
                  </label>
                  <label>
                    MinerU endpoint
                    <input value={mineruEndpoint} onChange={(event) => setMineruEndpoint(event.target.value)} placeholder="http://127.0.0.1:8888" disabled={settingsBusy} />
                  </label>
                  <label>
                    MinerU timeout seconds
                    <input value={mineruTimeoutSeconds} onChange={(event) => setMineruTimeoutSeconds(event.target.value)} inputMode="numeric" disabled={settingsBusy} />
                  </label>
                </div>
                <div className="button-row">
                  <button onClick={() => void refreshAppHealth()} disabled={settingsBusy}>Run doctor</button>
                  <button className="primary" onClick={() => void saveSystemSettings()} disabled={settingsBusy}>
                    {settingsBusy ? "Saving" : "Save settings"}
                  </button>
                </div>
                <div className="dependency-list setup-health-list">
                  {serviceRows.map((row) => (
                    <span key={row.name} className={row.status === "ok" ? "pill ok" : "pill danger"}>
                      {row.name}: {row.status}
                    </span>
                  ))}
                </div>
                <div className="runtime-mini-panel">
                  <div>
                    <strong>MinerU runtime</strong>
                    <span>
                      {mineruEndpointReachable
                        ? "endpoint reachable"
                        : mineruManagedRunning
                          ? `managed process running${mineruRuntime?.pid ? `, PID ${mineruRuntime.pid}` : ""}`
                          : "not started by Lexicon"}
                    </span>
                  </div>
                  <div className="button-row">
                    <button onClick={() => void startMineruRuntime()} disabled={mineruRuntimeBusy || !mineruCommand.trim() || mineruEndpointReachable || mineruManagedRunning}>
                      Start MinerU
                    </button>
                    <button onClick={() => void stopMineruRuntime()} disabled={mineruRuntimeBusy || !mineruManagedRunning}>
                      Stop
                    </button>
                  </div>
                </div>
              </section>

              <section className="panel setup-step-panel">
                <div className="panel-header">
                  <div>
                    <p className="panel-kicker">Step 3</p>
                    <h3>Vault agent</h3>
                  </div>
                  <span className={setupAgentReady ? "status ready" : "status"}>{setupAgentReady ? "agent ready" : "not loaded"}</span>
                </div>
                <p className="inline-help">Create or load <code>agent.md</code> so ingest and chat use vault-specific rules.</p>
                <div className="agent-toolbar setup-agent-toolbar">
                  <button onClick={() => void loadVaultAgent(false)} disabled={agentBusy || !vaultPath.trim()}>Load agent.md</button>
                  <button onClick={() => void loadVaultAgent(true)} disabled={agentBusy || !vaultPath.trim()}>Create template</button>
                  <button className="primary" onClick={() => void saveVaultAgent()} disabled={agentBusy || !vaultPath.trim() || !agentBody.trim() || !agentDirty}>
                    {agentBusy ? "Saving" : "Save agent.md"}
                  </button>
                </div>
                <label className="markdown-editor setup-agent-editor">
                  Agent Markdown
                  <textarea
                    value={agentBody}
                    onChange={(event) => {
                      setAgentBody(event.target.value);
                      setAgentDirty(true);
                      setAgentResult(null);
                    }}
                    placeholder="Create or load agent.md after a vault is loaded."
                    spellCheck={false}
                    disabled={agentBusy || !vaultPath.trim()}
                  />
                </label>
              </section>

              <section className="panel setup-step-panel setup-finish-panel">
                <div className="panel-header">
                  <div>
                    <p className="panel-kicker">Step 4</p>
                    <h3>Start working</h3>
                  </div>
                  <span className={setupVaultReady ? "status ready" : "status"}>{setupVaultReady ? "vault loaded" : "waiting"}</span>
                </div>
                <ul className="setup-list">
                  <li>Add PDF/image/text sources from Dashboard.</li>
                  <li>Review AI output before committing notes.</li>
                  <li>Use Workspace and Chat only after the vault is indexed.</li>
                </ul>
                <div className="button-row">
                  <button onClick={() => setActiveView("dashboard")} disabled={!setupVaultReady}>Open dashboard</button>
                  <button className="primary" onClick={() => setActiveView("workspace")} disabled={!setupVaultReady}>Open workspace</button>
                </div>
              </section>
            </section>
          </section>
        ) : activeView === "settings" ? (
          <section className="settings-grid">
            <section className="panel settings-form-panel">
              <div className="panel-header">
                <div>
                  <p className="panel-kicker">App-level config</p>
                  <h3>AI and extraction settings</h3>
                </div>
                <span className={doctor?.api_key_set ? "status ready" : "status danger"}>{doctor?.api_key_set ? "API key ready" : "API key missing"}</span>
              </div>

              <div className="form-grid settings-form-grid">
                <label>
                  AI provider
                  <select value={settingsProvider} onChange={(event) => setSettingsProvider(event.target.value)} disabled={settingsBusy}>
                    <option value="local">local fallback</option>
                    <option value="openai-compatible">openai-compatible</option>
                    <option value="anthropic">anthropic</option>
                    <option value="ollama">ollama</option>
                  </select>
                </label>
                <label>
                  Model
                  <input value={settingsModel} onChange={(event) => setSettingsModel(event.target.value)} placeholder="gemini-3.1-pro-low, gpt-4.1, claude..." disabled={settingsBusy} />
                </label>
                <label>
                  Base URL
                  <input value={settingsBaseUrl} onChange={(event) => setSettingsBaseUrl(event.target.value)} placeholder="http://localhost:20128/v1" disabled={settingsBusy} />
                </label>
                <label>
                  API key env
                  <input value={settingsApiKeyEnv} onChange={(event) => setSettingsApiKeyEnv(event.target.value)} placeholder="LEXICON_API_KEY" disabled={settingsBusy} />
                </label>
                <label>
                  Default knowledge mode
                  <select value={settingsDefaultMode} onChange={(event) => setSettingsDefaultMode(event.target.value as KnowledgeMode)} disabled={settingsBusy}>
                    <option value="vault-only">vault-only</option>
                    <option value="vault+model">vault+model</option>
                    <option value="vault+web">vault+web</option>
                  </select>
                </label>
                <label>
                  URL extractor
                  <select value={settingsUrlExtractor} onChange={(event) => setSettingsUrlExtractor(event.target.value)} disabled={settingsBusy}>
                    <option value="http">http fallback</option>
                    <option value="playwright">playwright</option>
                    <option value="markitdown">markitdown</option>
                  </select>
                </label>
                <label>
                  File extractor
                  <select value={settingsFileExtractor} onChange={(event) => setSettingsFileExtractor(event.target.value)} disabled={settingsBusy}>
                    <option value="auto">auto</option>
                    <option value="markitdown">markitdown</option>
                  </select>
                </label>
                <label>
                  MinerU endpoint
                  <input value={mineruEndpoint} onChange={(event) => setMineruEndpoint(event.target.value)} placeholder="http://127.0.0.1:8888" disabled={settingsBusy} />
                </label>
                <label>
                  MinerU timeout seconds
                  <input value={mineruTimeoutSeconds} onChange={(event) => setMineruTimeoutSeconds(event.target.value)} inputMode="numeric" disabled={settingsBusy} />
                </label>
              </div>

              <div className="button-row">
                <button onClick={() => void refreshAppHealth()} disabled={settingsBusy}>Reload current</button>
                <button className="primary" onClick={() => void saveSystemSettings()} disabled={settingsBusy}>
                  {settingsBusy ? "Saving" : "Save settings"}
                </button>
              </div>
            </section>

            <section className="panel system-health-panel">
              <div className="panel-header">
                <div>
                  <p className="panel-kicker">Doctor</p>
                  <h3>System health</h3>
                </div>
                <span className={doctor?.services?.ai_provider === "ok" ? "status ready" : "status danger"}>{doctor?.services?.ai_provider === "ok" ? "AI provider ok" : "AI provider check"}</span>
              </div>
              <dl className="kv-list">
                <div>
                  <dt>Provider</dt>
                  <dd>{doctor?.provider ?? "-"}</dd>
                </div>
                <div>
                  <dt>Model</dt>
                  <dd>{doctor?.model ?? "-"}</dd>
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
            </section>

            <section className="panel mineru-runtime-panel">
              <div className="panel-header">
                <div>
                  <p className="panel-kicker">Local OCR service</p>
                  <h3>MinerU runtime</h3>
                </div>
                <span className={mineruEndpointReachable || mineruManagedRunning ? "status ready" : "status"}>
                  {mineruEndpointReachable
                    ? "endpoint reachable"
                    : mineruManagedRunning
                      ? `managed PID ${mineruRuntime?.pid ?? "-"}`
                      : "stopped"}
                </span>
              </div>
              <div className="form-grid settings-form-grid">
                <label>
                  Command
                  <input value={mineruCommand} onChange={(event) => setMineruCommand(event.target.value)} placeholder="D:\MinerU\.venv\Scripts\mineru-api.exe" disabled={mineruRuntimeBusy} />
                </label>
                <label>
                  Arguments
                  <input value={mineruArgsText} onChange={(event) => setMineruArgsText(event.target.value)} placeholder="--host 127.0.0.1 --port 8888" disabled={mineruRuntimeBusy} />
                </label>
                <label>
                  Working directory
                  <input value={mineruCwd} onChange={(event) => setMineruCwd(event.target.value)} placeholder="D:\MinerU" disabled={mineruRuntimeBusy} />
                </label>
                <label>
                  Endpoint used by Lexicon
                  <input value={mineruEndpoint} onChange={(event) => setMineruEndpoint(event.target.value)} placeholder="http://127.0.0.1:8888" disabled={settingsBusy} />
                </label>
              </div>
              <p className="inline-help">
                Lexicon starts only the local MinerU API process configured here. If MinerU is already reachable, Lexicon reuses it instead of spawning another process.
              </p>
              <div className="button-row">
                <button onClick={saveMineruRuntimeDefaults} disabled={mineruRuntimeBusy}>Save command</button>
                <button onClick={() => void refreshMineruRuntime()} disabled={mineruRuntimeBusy}>Runtime status</button>
                <button onClick={() => void saveMineruEndpoint()} disabled={ingestBusy}>Save endpoint</button>
                <button onClick={() => void startMineruRuntime()} disabled={mineruRuntimeBusy || !mineruCommand.trim() || mineruEndpointReachable || mineruManagedRunning}>
                  Start MinerU
                </button>
                <button onClick={() => void stopMineruRuntime()} disabled={mineruRuntimeBusy || !mineruManagedRunning}>Stop</button>
              </div>
              {mineruRuntime?.lastError && !mineruEndpointReachable ? (
                <pre className="runtime-log danger">{mineruRuntime.lastError}</pre>
              ) : mineruRuntime?.lastOutput ? (
                <pre className="runtime-log">{mineruRuntime.lastOutput}</pre>
              ) : null}
            </section>

            <section className="panel agent-panel">
              <div className="panel-header">
                <div>
                  <p className="panel-kicker">Vault profile</p>
                  <h3>Vault Agent</h3>
                </div>
                <span className={agent ? "status ready" : "status"}>{agent ? `${agent.line_count} lines` : "not loaded"}</span>
              </div>
              <p className="inline-help">
                This file defines the vault's role, scope, ingestion rules, chat behavior, and safety limits.
              </p>
              <div className="agent-toolbar">
                <button onClick={() => void loadVaultAgent(false)} disabled={agentBusy || !vaultPath.trim()}>
                  Reload agent.md
                </button>
                <button onClick={() => void loadVaultAgent(true)} disabled={agentBusy || !vaultPath.trim()}>
                  Create/load template
                </button>
                <button className="primary" onClick={() => void saveVaultAgent()} disabled={agentBusy || !vaultPath.trim() || !agentBody.trim() || !agentDirty}>
                  {agentBusy ? "Saving" : "Save agent.md"}
                </button>
              </div>
              {agent ? (
                <dl className="kv-list compact agent-meta">
                  <div>
                    <dt>File</dt>
                    <dd>{agent.filename}</dd>
                  </div>
                  <div>
                    <dt>Status</dt>
                    <dd>{agent.exists ? "found" : "new template"}</dd>
                  </div>
                </dl>
              ) : null}
              <div className="agent-split">
                <label className="markdown-editor agent-editor">
                  Agent Markdown
                  <textarea
                    value={agentBody}
                    onChange={(event) => {
                      setAgentBody(event.target.value);
                      setAgentDirty(true);
                      setAgentResult(null);
                    }}
                    placeholder="Load or create agent.md for this vault."
                    spellCheck={false}
                    disabled={agentBusy || !vaultPath.trim()}
                  />
                </label>
                <section className="markdown-preview-panel agent-preview" aria-label="Agent preview">
                  <div className="panel-header">
                    <h3>Preview</h3>
                    <span className="status">read-only</span>
                  </div>
                  <MarkdownPreview markdown={agentBody} />
                </section>
              </div>
              {agentDirty ? <p className="inline-help warn">Unsaved agent changes. Ingest and chat will keep using the last saved agent.md until you save.</p> : null}
            </section>

            <section className="panel setup-notes-panel">
              <div className="panel-header">
                <div>
                  <p className="panel-kicker">Setup notes</p>
                  <h3>Clone checklist</h3>
                </div>
              </div>
              <ul className="setup-list">
                <li>Set the API key in the environment variable named by <code>{settingsApiKeyEnv || "LEXICON_API_KEY"}</code>.</li>
                <li>For local OpenAI-compatible servers, use provider <code>openai-compatible</code> and a <code>/v1</code> base URL.</li>
                <li>Start MinerU before PDF/image OCR, then keep endpoint pointed at <code>http://127.0.0.1:8888</code>.</li>
                <li>Use <code>playwright</code> only when browser-rendered URL ingestion is installed and needed.</li>
              </ul>
            </section>
          </section>
        ) : activeView === "workspace" ? (
          <section className="workspace-grid">
            <section className="panel workspace-browser">
              <div className="panel-header">
                <div>
                  <p className="panel-kicker">File browser</p>
                  <h3>Vault notes</h3>
                </div>
                <span className="status">{workspaceQuery.trim() ? `${workspaceHits.length} hits` : `${workspaceNotes.length} notes`}</span>
              </div>
              <div className="input-row workspace-search">
                <input
                  value={workspaceQuery}
                  onChange={(event) => setWorkspaceQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") void refreshWorkspace();
                  }}
                  placeholder="Search notes and indexed chunks"
                />
                <button onClick={() => void refreshWorkspace()} disabled={workspaceBusy || !vaultPath.trim()}>
                  Search
                </button>
              </div>
              <div className="button-row workspace-actions">
                <button
                  onClick={() => {
                    setWorkspaceQuery("");
                    void refreshWorkspace("");
                  }}
                  disabled={workspaceBusy || !vaultPath.trim()}
                >
                  Show all
                </button>
                <button onClick={() => void lexiconApi().run("scan", ["--vault", vaultPath, "--json"]).then(() => refreshWorkspace())} disabled={workspaceBusy || !vaultPath.trim()}>
                  Rebuild index
                </button>
              </div>

              {workspaceQuery.trim() ? (
                <div className="table-list workspace-list">
                  {workspaceHits.length === 0 ? (
                    <p className="empty">No search hits.</p>
                  ) : (
                    workspaceHits.map((hit) => (
                      <button key={`${hit.path}:${hit.heading}:${hit.score}`} className="row-card" onClick={() => void openWorkspaceFromHit(hit)} disabled={workspaceBusy}>
                        <div>
                          <strong>{hit.title || hit.path}</strong>
                          <span>{hit.path} / {hit.heading || "Overview"} / score {hit.score.toFixed(3)}</span>
                          <small>{hit.snippet}</small>
                        </div>
                      </button>
                    ))
                  )}
                </div>
              ) : (
                <div className="workspace-list workspace-tree">
                  {workspaceNotes.length === 0 ? (
                    <p className="empty">No workspace notes.</p>
                  ) : (
                    workspaceGroups.map(([folder, notes]) => (
                      <section className="folder-group" key={folder}>
                        <div className="folder-heading">
                          <strong>{folder}</strong>
                          <span>{notes.length}</span>
                        </div>
                        <div className="table-list">
                          {notes.map((note) => (
                            <button
                              key={note.path}
                              className={selectedWorkspaceNote?.path === note.path ? "row-card selected" : "row-card"}
                              onClick={() => void selectWorkspaceNote(note.path)}
                              disabled={workspaceBusy}
                            >
                              <div>
                                <strong>{note.title}</strong>
                                <span>{note.path}</span>
                                <small>{note.preview}</small>
                              </div>
                            </button>
                          ))}
                        </div>
                      </section>
                    ))
                  )}
                </div>
              )}
            </section>

            <section className="panel workspace-reader">
              <div className="panel-header">
                <div>
                  <p className="panel-kicker">Reader</p>
                  <h3>Note detail</h3>
                </div>
                {selectedWorkspaceNote ? <span className="status">{selectedWorkspaceNote.path}</span> : null}
              </div>
              {!selectedWorkspaceNote ? (
                <div className="empty-state">
                  <strong>No note selected</strong>
                  <p>Select a note from the file browser to inspect committed Markdown content.</p>
                </div>
              ) : (
                <div className="note-detail">
                  <dl className="kv-list compact">
                    <div>
                      <dt>Title</dt>
                      <dd>{selectedWorkspaceNote.title}</dd>
                    </div>
                    <div>
                      <dt>Folder</dt>
                      <dd>{selectedWorkspaceNote.folder || "-"}</dd>
                    </div>
                    <div>
                      <dt>Modified</dt>
                      <dd>{selectedWorkspaceNote.modified_at}</dd>
                    </div>
                  </dl>
                  <div className="button-row reader-actions">
                    <button
                      onClick={() => {
                        setChatQuestion(`Using ${selectedWorkspaceNote.path}, summarize and verify "${selectedWorkspaceNote.title}".`);
                        setChatTitle(`${selectedWorkspaceNote.title} Chat Summary`);
                        setActiveView("chat");
                      }}
                    >
                      Ask in chat
                    </button>
                  </div>
                  <section className="workspace-markdown-reader">
                    <MarkdownPreview markdown={selectedWorkspaceNote.body} onNavigate={navigateWikilink} />
                  </section>
                </div>
              )}
            </section>
          </section>
        ) : activeView === "chat" ? (
          <section className="chat-grid">
            <section className="chat-left-column">
            <section className="panel chat-composer">
              <div className="panel-header">
                <div>
                  <p className="panel-kicker">RAG session</p>
                  <h3>Ask vault</h3>
                </div>
                <span className="status">{chatMode}</span>
              </div>

              <label className="full-width">
                Question
                <textarea
                  value={chatQuestion}
                  onChange={(event) => setChatQuestion(event.target.value)}
                  onKeyDown={(event) => {
                    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") void askVault();
                  }}
                  placeholder="Ask a question about the current vault"
                  disabled={chatBusy}
                />
              </label>

              <div className="form-grid chat-options">
                <label>
                  Knowledge mode
                  <select value={chatMode} onChange={(event) => setChatMode(event.target.value as KnowledgeMode)} disabled={chatBusy}>
                    <option value="vault-only">vault-only</option>
                    <option value="vault+model">vault+model</option>
                    <option value="vault+web">vault+web</option>
                  </select>
                </label>
                <label>
                  Save title
                  <input
                    value={chatTitle}
                    onChange={(event) => setChatTitle(event.target.value)}
                    placeholder={titleFromQuestion(chatQuestion)}
                    disabled={chatBusy || !chatSave}
                  />
                </label>
              </div>

              <label className="toggle-row">
                <input type="checkbox" checked={chatSave} onChange={(event) => setChatSave(event.target.checked)} disabled={chatBusy} />
                Save answer to review queue
              </label>
              {chatSave && currentQuestionAlreadySaved ? (
                <p className="inline-help warn">This question was already saved in this session. Ask again without saving or edit the question/title.</p>
              ) : null}

              <div className="button-row">
                <button onClick={() => setChatQuestion("")} disabled={chatBusy || !chatQuestion.trim()}>Clear</button>
                <button className="primary" onClick={() => void askVault()} disabled={chatBusy || !vaultPath.trim() || !chatQuestion.trim() || (chatSave && currentQuestionAlreadySaved)}>
                  {chatBusy ? "Answering" : "Ask"}
                </button>
              </div>
            </section>

            <section className="panel chat-history-panel">
              <div className="panel-header">
                <div>
                  <p className="panel-kicker">Current session</p>
                  <h3>History</h3>
                </div>
                <span className="status">{chatHistory.length} turns</span>
              </div>
              {chatHistory.length === 0 ? (
                <p className="empty">No chat turns yet.</p>
              ) : (
                <div className="chat-history-list">
                  {chatHistory.map((item) => (
                    <button key={item.id} className={chatResult?.question === item.question && chatResult.answer === item.answer ? "history-card selected" : "history-card"} onClick={() => setChatResult(item)}>
                      <strong>{item.question}</strong>
                      <span>{item.createdAt} / {item.mode} / {item.saved ? "saved" : "not saved"}</span>
                      {item.citations.length > 0 ? <small>{item.citations.length} citations</small> : null}
                    </button>
                  ))}
                </div>
              )}
            </section>
            </section>

            <section className="panel chat-answer">
              <div className="panel-header">
                <div>
                  <p className="panel-kicker">Vault response</p>
                  <h3>Answer</h3>
                </div>
                {chatResult ? <span className="status">{chatResult.mode}</span> : null}
              </div>
              {!chatResult ? (
                <p className="empty">Ask a question to retrieve relevant vault context and generate an answer.</p>
              ) : (
                <div className="chat-result">
                  <dl className="kv-list compact">
                    <div>
                      <dt>Question</dt>
                      <dd>{chatResult.question}</dd>
                    </div>
                    <div>
                      <dt>Saved</dt>
                      <dd>{chatResult.saved ? "review queue" : "no"}</dd>
                    </div>
                  </dl>
                  {chatCitations.length > 0 ? (
                    <div className="citation-panel">
                      <h4>Citations in answer</h4>
                      <div>
                        {chatCitations.map((citation) => (
                          <button key={citation} onClick={() => navigateWikilink(`[[${citation}]]`)}>
                            [[{citation}]]
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null}
                  <section className="chat-answer-box">
                    <MarkdownPreview markdown={chatResult.answer} onNavigate={navigateWikilink} />
                  </section>
                </div>
              )}
            </section>
          </section>
        ) : activeView === "decay" ? (
          <section className="decay-grid">
            <section className="panel decay-list-panel">
              <div className="panel-header">
                <h3>Needs Review</h3>
                <span className="status">{decay.length} notes</span>
              </div>
              {decay.length === 0 ? (
                <p className="empty">No expired or due-soon notes.</p>
              ) : (
                <div className="table-list decay-list">
                  {decay.map((item) => (
                    <button
                      key={item.path}
                      className={selectedDecay?.path === item.path ? "row-card selected" : "row-card"}
                      onClick={() => void selectDecayItem(item)}
                      disabled={decayBusy}
                    >
                      <div>
                        <strong>{item.title}</strong>
                        <span>{item.path}</span>
                        <small>
                          {item.status} / expires {item.expires_at || "n/a"} / reviewed {item.reviewed_at || "never"}
                        </small>
                      </div>
                      <span className={item.status === "expired" ? "status danger" : "status"}>{item.status}</span>
                    </button>
                  ))}
                </div>
              )}
            </section>

            <section className="panel decay-detail-panel">
              <div className="panel-header">
                <h3>Review Note</h3>
                {selectedDecay ? <span className="status">{selectedDecay.path}</span> : null}
              </div>
              {!selectedDecay || !selectedDecayNote ? (
                <p className="empty">Select an expired or due-soon note to inspect and update freshness metadata.</p>
              ) : (
                <div className="decay-detail">
                  <dl className="kv-list compact">
                    <div>
                      <dt>Status</dt>
                      <dd>{selectedDecay.status}</dd>
                    </div>
                    <div>
                      <dt>Title</dt>
                      <dd>{selectedDecay.title}</dd>
                    </div>
                    <div>
                      <dt>Days</dt>
                      <dd>{selectedDecay.days_until_expiry ?? "n/a"}</dd>
                    </div>
                  </dl>

                  <div className="form-grid decay-form">
                    <label>
                      Reviewed at
                      <input type="date" value={decayReviewedAt} onChange={(event) => setDecayReviewedAt(event.target.value)} disabled={decayBusy} />
                    </label>
                    <label>
                      Expires at
                      <input type="date" value={decayExpiresAt} onChange={(event) => setDecayExpiresAt(event.target.value)} disabled={decayBusy} />
                    </label>
                  </div>

                  <div className="button-row decay-presets">
                    <button onClick={() => setDecayExpiresAt(new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10))} disabled={decayBusy}>+90 days</button>
                    <button onClick={() => setDecayExpiresAt(new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10))} disabled={decayBusy}>+1 year</button>
                    <button className="primary" onClick={() => void updateSelectedDecay()} disabled={decayBusy || !decayExpiresAt}>
                      {decayBusy ? "Updating" : "Mark reviewed"}
                    </button>
                  </div>

                  <pre className="preview-box decay-note-body">{selectedDecayNote.body}</pre>
                </div>
              )}
            </section>
          </section>
        ) : activeView === "review" ? (
          <section className="review-screen">
            <section className="panel review-queue-panel">
              <div className="panel-header">
                <div>
                  <p className="panel-kicker">Human gate</p>
                  <h3>Pending review</h3>
                </div>
                <span className="status">{inbox.length} items</span>
              </div>
              {inbox.length === 0 ? (
                <div className="empty-state">
                  <strong>No pending review items</strong>
                  <p>Add a source or save a chat answer to create a review item.</p>
                </div>
              ) : (
                <div className="table-list review-queue-list">
                  {inbox.map((item) => (
                    <button
                      key={item.filename}
                      className={selectedReview?.filename === item.filename ? "row-card selected" : "row-card"}
                      onClick={() => void selectReviewItem(item)}
                      disabled={reviewBusy}
                    >
                      <div>
                        <strong>{item.title}</strong>
                        <span>{item.suggested_folder} / {item.filename}</span>
                        <small>{item.body_preview}</small>
                      </div>
                      <span className={`confidence-badge ${confidenceTone(item.confidence)}`}>{item.confidence.toFixed(2)}</span>
                    </button>
                  ))}
                </div>
              )}
            </section>

            <section className="panel review-stage">
              <div className="panel-header">
                <div>
                  <p className="panel-kicker">Commit decision</p>
                  <h3>Review detail</h3>
                </div>
                {selectedReview ? <span className="status">{selectedReview.filename}</span> : null}
              </div>
              {!selectedReview ? (
                <div className="empty-state">
                  <strong>Select an inbox item</strong>
                  <p>Review extracted content, warnings, duplicate signals, and Markdown before committing it to the vault.</p>
                </div>
              ) : (
                <div className="review-detail review-detail-expanded">
                  <div className="review-summary-strip">
                    <div>
                      <span>Title</span>
                      <strong>{selectedReview.title}</strong>
                    </div>
                    <div>
                      <span>Folder</span>
                      <strong>{reviewFolder}</strong>
                    </div>
                    <div>
                      <span>Confidence</span>
                      <strong className={`confidence-text ${confidenceTone(selectedReview.confidence)}`}>{selectedReview.confidence.toFixed(2)}</strong>
                    </div>
                    <div>
                      <span>Source</span>
                      <strong>{selectedReview.source}</strong>
                    </div>
                  </div>

                  {selectedDuplicates.length > 0 ? (
                    <div className="duplicate-panel">
                      <div className="duplicate-header">
                        <div>
                          <h4>Potential duplicates</h4>
                          <p>Choose how this review item should interact with existing vault knowledge.</p>
                        </div>
                        <span className="status">{selectedDuplicates.length} match{selectedDuplicates.length > 1 ? "es" : ""}</span>
                      </div>
                      <div className="duplicate-list">
                        {selectedDuplicates.map((duplicate) => (
                          <label key={duplicate.path} className={duplicateTarget === duplicate.path ? "duplicate-choice selected" : "duplicate-choice"}>
                            <input
                              type="radio"
                              name="duplicate-target"
                              checked={duplicateTarget === duplicate.path}
                              onChange={() => setDuplicateTarget(duplicate.path)}
                              disabled={reviewBusy}
                            />
                            <span>
                              <strong>{duplicate.path}</strong>
                              <small>similarity {duplicate.score ?? "n/a"}</small>
                            </span>
                          </label>
                        ))}
                      </div>
                      <div className="segmented duplicate-actions" aria-label="Duplicate decision">
                        <button className={duplicateDecision === "keep" ? "active" : ""} onClick={() => setDuplicateDecision("keep")} disabled={reviewBusy}>
                          Keep new
                        </button>
                        <button className={duplicateDecision === "link" ? "active" : ""} onClick={() => setDuplicateDecision("link")} disabled={reviewBusy || !duplicateTarget}>
                          Link related
                        </button>
                        <button className={duplicateDecision === "merge" ? "active" : ""} onClick={() => setDuplicateDecision("merge")} disabled={reviewBusy || !duplicateTarget}>
                          Merge into existing
                        </button>
                      </div>
                      <p className="decision-copy">
                        {duplicateDecision === "merge"
                          ? `This will append the reviewed content into ${duplicateTarget} and remove the inbox item.`
                          : duplicateDecision === "link"
                            ? `This will commit a new note and add a related-note link to ${duplicateTarget}.`
                            : "This will commit the item as a new note, preserving the duplicate signal in the review section."}
                      </p>
                    </div>
                  ) : null}

                  {nonDuplicateWarnings(selectedReview.warnings).length > 0 ? (
                    <div className="warning-list">
                      {nonDuplicateWarnings(selectedReview.warnings).map((warning) => (
                        <div key={warning}>{warning}</div>
                      ))}
                    </div>
                  ) : null}

                  <div className="review-split">
                    <label className="markdown-editor review-editor">
                      Markdown editor
                      <textarea
                        value={reviewBody}
                        onChange={(event) => {
                          setReviewBody(event.target.value);
                          setReviewDirty(true);
                          setReviewSaveStatus(null);
                        }}
                        spellCheck={false}
                        disabled={reviewBusy}
                      />
                    </label>

                    <section className="markdown-preview-panel" aria-label="Markdown preview">
                      <div className="panel-header">
                        <h3>Rendered preview</h3>
                        <span className="status">read-only</span>
                      </div>
                      <MarkdownPreview markdown={reviewBody} />
                    </section>
                  </div>

                  <div className="review-actions review-actions-sticky">
                    <label>
                      Commit folder
                      <select value={reviewFolder} onChange={(event) => setReviewFolder(event.target.value as KnowledgeFolder)} disabled={reviewBusy}>
                        <option value="concepts">concepts</option>
                        <option value="guidelines">guidelines</option>
                        <option value="references">references</option>
                      </select>
                    </label>
                    <div className="button-row">
                      {reviewSaveStatus ? <span className="inline-status">{reviewSaveStatus}</span> : null}
                      {reviewDirty ? <span className="inline-status warn">Unsaved edits</span> : null}
                      <button onClick={() => void saveSelectedReviewBody()} disabled={reviewBusy || !reviewDirty}>
                        Save edits
                      </button>
                      <button onClick={() => void rejectSelectedReview()} disabled={reviewBusy}>Reject</button>
                      <button className="primary" onClick={() => void approveSelectedReview()} disabled={reviewBusy}>
                        {reviewBusy ? "Committing" : duplicateDecision === "merge" ? "Merge and open workspace" : "Approve and open workspace"}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </section>
          </section>
        ) : (
          <>
        <section className="vault-overview">
          <article className="vault-card">
            <div>
              <p className="panel-kicker">Current vault</p>
              <h3>{vaultName}</h3>
              <span>{vaultPath || "Load a vault path to begin."}</span>
            </div>
            <div className="vault-actions">
              <button onClick={() => setActiveView("workspace")} disabled={!vaultPath.trim()}>Open workspace</button>
              <button className="primary" onClick={() => setActiveView("chat")} disabled={!vaultPath.trim()}>Chat with vault</button>
            </div>
          </article>
          <article className="vault-card vault-card-compact">
            <span>Review discipline</span>
            <strong>{staleCount + dueSoonCount}</strong>
            <small>notes in decay window</small>
          </article>
        </section>

        <section className="metric-grid">
          <Metric label="Vault notes" value={vaultNoteCount ?? workspaceNotes.length} note="committed markdown" />
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
              <div>
                <p className="panel-kicker">Add source</p>
                <h3>Ingest workbench</h3>
              </div>
              <span className={mineruReady ? "status ready" : "status danger"}>{mineruReady ? "MinerU ready" : "MinerU not ready"}</span>
            </div>

            <div className="segmented source-types" aria-label="Source type">
              <button className={sourceMode === "url" ? "active" : ""} onClick={() => setSourceMode("url")}>URL</button>
              <button className={sourceMode === "file" ? "active" : ""} onClick={() => setSourceMode("file")}>PDF / file</button>
              <button className={sourceMode === "image" ? "active" : ""} onClick={() => setSourceMode("image")}>Image</button>
              <button className={sourceMode === "text" ? "active" : ""} onClick={() => setSourceMode("text")}>Note</button>
              <button disabled title="Video ingestion is planned after audio transcription support.">Video</button>
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

            {sourceMode === "file" || sourceMode === "image" ? (
              <label className="full-width">
                {sourceMode === "image" ? "Source image" : "Source file"}
                <div className="input-row compact-row">
                  <input
                    value={sourceFile}
                    onChange={(event) => setSourceFile(event.target.value)}
                    placeholder={sourceMode === "image" ? "Select a PNG, JPG, WebP, GIF, BMP, or TIFF image" : "Select a PDF, Markdown, text, Office, HTML, or CSV file"}
                  />
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
              <span>PDF and image files use MinerU when the endpoint is configured; otherwise the core stores a reviewable fallback.</span>
              {ingestStep ? <strong className="progress-text">{ingestStep}</strong> : null}
              {selectedFileUsesMineru && !mineruReady ? <strong>Configure MinerU + requests before ingesting scanned PDFs or image OCR sources.</strong> : null}
              {sourceMode === "image" && selectedFileIsImage ? <span>Image OCR will create a review item and copy the source image into vault assets when needed.</span> : null}
            </div>

            <div className="button-row">
              <button onClick={resetIngestForm} disabled={ingestBusy}>Cancel</button>
              <button className="primary" onClick={() => void ingestSource()} disabled={!canIngest()}>
                {ingestBusy ? "Processing" : "Process source"}
              </button>
            </div>
          </section>

          <Panel title="Review queue">
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

                <label className="markdown-editor">
                  Markdown body
                  <textarea
                    value={reviewBody}
                    onChange={(event) => {
                      setReviewBody(event.target.value);
                      setReviewDirty(true);
                      setReviewSaveStatus(null);
                    }}
                    spellCheck={false}
                    disabled={reviewBusy}
                  />
                </label>

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
                    {reviewSaveStatus ? <span className="inline-status">{reviewSaveStatus}</span> : null}
                    {reviewDirty ? <span className="inline-status warn">Unsaved edits</span> : null}
                    <button onClick={() => void saveSelectedReviewBody()} disabled={reviewBusy || !reviewDirty}>
                      Save edits
                    </button>
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
          </>
        )}
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

function normalizePathKey(path: string) {
  return path.trim().replace(/\\/g, "/").replace(/\/+$/g, "").toLowerCase();
}

function splitCommandArgs(value: string) {
  const args: string[] = [];
  const pattern = /"([^"]*)"|'([^']*)'|(\S+)/g;
  for (const match of value.matchAll(pattern)) {
    args.push(match[1] ?? match[2] ?? match[3] ?? "");
  }
  return args.filter(Boolean);
}

function SetupStep({ label, done }: { label: string; done: boolean }) {
  return (
    <div className={done ? "setup-progress-step done" : "setup-progress-step"}>
      <span>{done ? "Ready" : "Pending"}</span>
      <strong>{label}</strong>
    </div>
  );
}

function confidenceTone(value: number) {
  if (value >= 0.85) return "high";
  if (value >= 0.7) return "medium";
  return "low";
}

function duplicateWarnings(warnings: string[]) {
  return warnings.filter((warning) => /^Potential duplicates:/i.test(warning));
}

function nonDuplicateWarnings(warnings: string[]) {
  return warnings.filter((warning) => !/^Potential duplicates:/i.test(warning));
}

function parseDuplicateWarnings(warnings: string[]) {
  return duplicateWarnings(warnings).flatMap((warning) => {
    const raw = warning.replace(/^Potential duplicates:\s*/i, "");
    return raw
      .split(/,\s+(?=[^,]+\.md\s+\()/)
      .map((entry) => {
        const match = entry.trim().match(/^(.+?\.md)\s+\(([^)]+)\)$/);
        if (!match) return null;
        return { path: match[1].trim(), score: match[2].trim() };
      })
      .filter((item): item is { path: string; score: string } => Boolean(item));
  });
}

function bodyWithRelatedNote(body: string, target: string) {
  const link = `[[${target.replace(/\.md$/i, "")}]]`;
  if (body.includes(link) || body.includes(`[[${target}]]`)) return body;
  const clean = body.trimEnd();
  const heading = "## Related notes";
  if (clean.includes(heading)) return `${clean}\n- ${link}\n`;
  return `${clean}\n\n${heading}\n- ${link}\n`;
}

function titleFromQuestion(question: string) {
  const clean = question.trim().replace(/[?!.]+$/g, "");
  if (!clean) return "Saved Chat Answer";
  return clean.length > 72 ? `${clean.slice(0, 72).trim()}...` : clean;
}

function extractCitations(markdown: string) {
  const citations = new Set<string>();
  for (const match of markdown.matchAll(/\[\[([^\]]+)\]\]/g)) {
    const target = match[1].split("|")[0].trim();
    if (target) citations.add(target);
  }
  return Array.from(citations).sort((left, right) => left.localeCompare(right));
}

function MarkdownPreview({ markdown, onNavigate }: { markdown: string; onNavigate?: (target: string) => void }) {
  const cleanMarkdown = markdown
    .replace(/<!--[\s\S]*?-->/g, "")
    .split("\n")
    .filter((line) => !/^\s*-\s*Potential duplicates:/i.test(line))
    .join("\n")
    .trim();
  const blocks = cleanMarkdown ? cleanMarkdown.split(/\n{2,}/) : [];
  if (blocks.length === 0) {
    return <p className="empty">No Markdown content.</p>;
  }
  return (
    <div className="markdown-preview">
      {blocks.map((block, index) => (
        <MarkdownBlock key={`${index}:${block.slice(0, 24)}`} block={block} onNavigate={onNavigate} />
      ))}
    </div>
  );
}

function MarkdownBlock({ block, onNavigate }: { block: string; onNavigate?: (target: string) => void }) {
  const lines = block.split("\n");
  const first = lines[0] ?? "";
  const heading = first.match(/^(#{1,4})\s+(.+)$/);
  if (heading) {
    const level = heading[1].length;
    if (level === 1) return <h2>{heading[2]}</h2>;
    if (level === 2) return <h3>{heading[2]}</h3>;
    if (level === 3) return <h4>{heading[2]}</h4>;
    return <h5>{heading[2]}</h5>;
  }
  if (first.startsWith("```")) {
    return <pre>{lines.filter((line) => !line.startsWith("```")).join("\n")}</pre>;
  }
  if (lines.every((line) => line.trim().startsWith("|"))) {
    return (
      <div className="preview-table-wrap">
        <table>
          <tbody>
            {lines
              .filter((line) => !/^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line))
              .map((line, rowIndex) => (
                <tr key={`${rowIndex}:${line}`}>
                  {line
                    .split("|")
                    .map((cell) => cell.trim())
                    .filter(Boolean)
                    .map((cell, cellIndex) => (
                      <td key={`${cellIndex}:${cell}`}>{inlineMarkdown(cell, onNavigate)}</td>
                    ))}
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    );
  }
  if (lines.every((line) => /^\s*[-*]\s+/.test(line))) {
    return (
      <ul>
        {lines.map((line) => (
          <li key={line}>{inlineMarkdown(line.replace(/^\s*[-*]\s+/, ""), onNavigate)}</li>
        ))}
      </ul>
    );
  }
  if (lines.some((line) => /^\s*[-*]\s+/.test(line))) {
    const items: ReactNode[] = [];
    const paragraphs: ReactNode[] = [];
    let paragraph: string[] = [];
    for (const line of lines) {
      if (/^\s*[-*]\s+/.test(line)) {
        if (paragraph.length) {
          paragraphs.push(<p key={`p-${paragraphs.length}`}>{inlineMarkdown(paragraph.join(" "), onNavigate)}</p>);
          paragraph = [];
        }
        items.push(<li key={`li-${items.length}`}>{inlineMarkdown(line.replace(/^\s*[-*]\s+/, ""), onNavigate)}</li>);
      } else if (line.trim()) {
        paragraph.push(line);
      }
    }
    if (paragraph.length) {
      paragraphs.push(<p key={`p-${paragraphs.length}`}>{inlineMarkdown(paragraph.join(" "), onNavigate)}</p>);
    }
    return (
      <>
        {paragraphs}
        {items.length ? <ul>{items}</ul> : null}
      </>
    );
  }
  if (lines.every((line) => line.trim().startsWith(">"))) {
    return <blockquote>{lines.map((line) => line.replace(/^\s*>\s?/, "")).join("\n")}</blockquote>;
  }
  return <p>{inlineMarkdown(lines.join(" "), onNavigate)}</p>;
}

function inlineMarkdown(text: string, onNavigate?: (target: string) => void): ReactNode {
  const parts = text.split(/(\[\[[^\]]+\]\]|\*\*[^*]+\*\*|`[^`]+`)/g).filter(Boolean);
  return parts.map((part, index) => {
    if (part.startsWith("[[") && part.endsWith("]]")) {
      if (!onNavigate) {
        return <span key={`${index}:${part}`} className="wikilink">{part}</span>;
      }
      return (
        <button key={`${index}:${part}`} className="wikilink wikilink-button" onClick={() => onNavigate(part)}>
          {part}
        </button>
      );
    }
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={`${index}:${part}`}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith("`") && part.endsWith("`")) {
      return <code key={`${index}:${part}`}>{part.slice(1, -1)}</code>;
    }
    return <span key={`${index}:${part}`}>{part}</span>;
  });
}

createRoot(document.getElementById("root")!).render(<App />);
