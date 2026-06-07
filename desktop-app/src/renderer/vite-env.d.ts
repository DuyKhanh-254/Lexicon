/// <reference types="vite/client" />

declare global {
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

  interface Window {
    lexicon: {
      run(command: LexiconCommand, args?: string[]): Promise<any>;
      selectFile(): Promise<string | null>;
    };
  }
}

export {};
