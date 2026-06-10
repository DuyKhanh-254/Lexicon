import { contextBridge, ipcRenderer } from "electron";

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

const api = {
  run(command: LexiconCommand, args: string[] = []) {
    return ipcRenderer.invoke("lexicon:run", command, args);
  },
  selectFile(): Promise<string | null> {
    return ipcRenderer.invoke("dialog:selectFile");
  },
  selectDirectory(): Promise<string | null> {
    return ipcRenderer.invoke("dialog:selectDirectory");
  },
  mineruStatus(): Promise<any> {
    return ipcRenderer.invoke("mineru:status");
  },
  mineruStart(options: { command: string; args: string[]; cwd?: string }): Promise<any> {
    return ipcRenderer.invoke("mineru:start", options);
  },
  mineruStop(): Promise<any> {
    return ipcRenderer.invoke("mineru:stop");
  }
};

contextBridge.exposeInMainWorld("lexicon", api);
