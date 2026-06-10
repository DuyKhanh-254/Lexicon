import { app, BrowserWindow, dialog, ipcMain } from "electron";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

type LexiconCommand =
  | "settings"
  | "doctor"
  | "inbox"
  | "decay"
  | "scan"
  | "chat"
  | "ingest"
  | "agent"
  | "init-vault"
  | "vaults"
  | "workspace";

const allowedCommands = new Set<LexiconCommand>([
  "settings",
  "doctor",
  "inbox",
  "decay",
  "scan",
  "chat",
  "ingest",
  "agent",
  "init-vault",
  "vaults",
  "workspace"
]);

let mineruProcess: ChildProcessWithoutNullStreams | null = null;
let mineruRuntime = {
  command: "",
  args: [] as string[],
  cwd: "",
  pid: null as number | null,
  lastOutput: "",
  lastError: "",
  exitCode: null as number | null
};

function mineruStatus() {
  return {
    running: Boolean(mineruProcess && !mineruProcess.killed && mineruRuntime.exitCode === null),
    ...mineruRuntime
  };
}

function rememberMineruOutput(kind: "lastOutput" | "lastError", chunk: Buffer) {
  const next = `${mineruRuntime[kind]}${chunk.toString("utf8")}`;
  mineruRuntime[kind] = next.slice(-4000);
}

function repoRoot(): string {
  return process.env.LEXICON_REPO_ROOT || path.resolve(desktopRoot(), "..");
}

function desktopRoot(): string {
  return path.resolve(__dirname, "..", "..");
}

function pythonExecutable(root: string): string {
  const candidate = process.platform === "win32"
    ? path.join(root, ".venv", "Scripts", "python.exe")
    : path.join(root, ".venv", "bin", "python");
  return fs.existsSync(candidate) ? candidate : "python";
}

function runLexicon(command: LexiconCommand, args: string[] = []) {
  if (!allowedCommands.has(command)) {
    throw new Error(`Unsupported Lexicon command: ${command}`);
  }

  const root = repoRoot();
  const python = pythonExecutable(root);
  const cliArgs = ["-m", "lexicon.cli", command, ...args];

  return new Promise((resolve, reject) => {
    const child = spawn(python, cliArgs, {
      cwd: root,
      env: {
        ...process.env,
        PYTHONIOENCODING: "utf-8",
        PYTHONPATH: path.join(root, "src")
      },
      windowsHide: true
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || stdout.trim() || `Lexicon exited with code ${code}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch {
        resolve({ ok: true, text: stdout.trim() });
      }
    });
  });
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 980,
    minHeight: 640,
    title: "Lexicon",
    backgroundColor: "#f7f5ef",
    webPreferences: {
      preload: path.join(__dirname, "..", "preload", "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  window.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL) => {
    console.error(`Renderer failed to load ${validatedURL}: ${errorCode} ${errorDescription}`);
  });
  window.webContents.on("render-process-gone", (_event, details) => {
    console.error(`Renderer process gone: ${details.reason}`);
  });
  window.webContents.on("console-message", (_event, level, message, line, sourceId) => {
    if (level >= 2) {
      console.error(`Renderer console: ${message} (${sourceId}:${line})`);
    }
  });

  const devServerUrl = process.env.VITE_DEV_SERVER_URL;
  if (devServerUrl) {
    void window.loadURL(devServerUrl);
  } else {
    void window.loadFile(path.join(desktopRoot(), "dist-renderer", "index.html"));
  }
}

ipcMain.handle("lexicon:run", async (_event, command: LexiconCommand, args: string[] = []) => {
  return runLexicon(command, args);
});

ipcMain.handle("dialog:selectFile", async () => {
  const result = await dialog.showOpenDialog({
    title: "Select source file",
    properties: ["openFile"],
    filters: [
      { name: "Supported sources", extensions: ["pdf", "md", "txt", "docx", "pptx", "xlsx", "xls", "html", "htm", "csv"] },
      { name: "All files", extensions: ["*"] }
    ]
  });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle("dialog:selectDirectory", async () => {
  const result = await dialog.showOpenDialog({
    title: "Select vault folder",
    properties: ["openDirectory", "createDirectory"]
  });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle("mineru:status", async () => mineruStatus());

ipcMain.handle("mineru:start", async (_event, options: { command?: string; args?: string[]; cwd?: string } = {}) => {
  if (mineruProcess && mineruRuntime.exitCode === null) return mineruStatus();
  const command = options.command?.trim();
  if (!command) throw new Error("MinerU command is required.");
  const args = options.args ?? [];
  const cwd = options.cwd?.trim() || undefined;
  mineruRuntime = {
    command,
    args,
    cwd: cwd ?? "",
    pid: null,
    lastOutput: "",
    lastError: "",
    exitCode: null
  };
  mineruProcess = spawn(command, args, {
    cwd,
    windowsHide: true,
    shell: false
  });
  mineruRuntime.pid = mineruProcess.pid ?? null;
  mineruProcess.stdout.on("data", (chunk: Buffer) => rememberMineruOutput("lastOutput", chunk));
  mineruProcess.stderr.on("data", (chunk: Buffer) => rememberMineruOutput("lastError", chunk));
  mineruProcess.on("error", (error) => {
    mineruRuntime.lastError = `${mineruRuntime.lastError}\n${error.message}`.trim().slice(-4000);
    mineruRuntime.exitCode = -1;
    mineruProcess = null;
  });
  mineruProcess.on("close", (code) => {
    mineruRuntime.exitCode = code;
    mineruProcess = null;
  });
  return mineruStatus();
});

ipcMain.handle("mineru:stop", async () => {
  if (mineruProcess && mineruRuntime.exitCode === null) {
    mineruProcess.kill();
  }
  mineruProcess = null;
  mineruRuntime.exitCode = mineruRuntime.exitCode ?? 0;
  return mineruStatus();
});

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  if (mineruProcess && mineruRuntime.exitCode === null) mineruProcess.kill();
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  if (mineruProcess && mineruRuntime.exitCode === null) mineruProcess.kill();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
