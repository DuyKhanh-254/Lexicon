import { contextBridge, ipcRenderer } from "electron";

type LexiconCommand =
  | "settings"
  | "doctor"
  | "inbox"
  | "decay"
  | "scan"
  | "chat"
  | "ingest"
  | "init-vault";

const api = {
  run(command: LexiconCommand, args: string[] = []) {
    return ipcRenderer.invoke("lexicon:run", command, args);
  },
  selectFile(): Promise<string | null> {
    return ipcRenderer.invoke("dialog:selectFile");
  }
};

contextBridge.exposeInMainWorld("lexicon", api);
