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
    | "init-vault";

  interface Window {
    lexicon: {
      run(command: LexiconCommand, args?: string[]): Promise<any>;
      selectFile(): Promise<string | null>;
    };
  }
}

export {};
