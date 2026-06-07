import { app, BrowserWindow, dialog, ipcMain } from "electron";
import { spawn } from "node:child_process";
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
  "workspace"
]);

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

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
