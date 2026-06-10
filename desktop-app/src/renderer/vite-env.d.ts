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
    | "vaults"
    | "workspace";

  interface Window {
    lexicon: {
      run(command: LexiconCommand, args?: string[]): Promise<any>;
      selectFile(): Promise<string | null>;
      selectDirectory(): Promise<string | null>;
      mineruStatus(): Promise<any>;
      mineruStart(options: { command: string; args: string[]; cwd?: string }): Promise<any>;
      mineruStop(): Promise<any>;
    };
  }
}

export {};
