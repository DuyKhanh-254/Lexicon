import { App, Modal, Notice, Plugin, PluginSettingTab, Setting } from "obsidian";
import { spawn } from "child_process";

interface LexiconSettings {
  command: string;
}

const DEFAULT_SETTINGS: LexiconSettings = {
  command: "lexicon"
};

export default class LexiconPlugin extends Plugin {
  settings: LexiconSettings;

  async onload() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());

    this.addRibbonIcon("brain", "Lexicon: ingest source", () => {
      new IngestModal(this.app, this).open();
    });

    this.addCommand({
      id: "lexicon-ingest-source",
      name: "Ingest source",
      callback: () => new IngestModal(this.app, this).open()
    });

    this.addCommand({
      id: "lexicon-open-inbox",
      name: "Show inbox",
      callback: () => this.runLexicon(["inbox", "--vault", this.vaultPath()], "Inbox")
    });

    this.addSettingTab(new LexiconSettingTab(this.app, this));
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  vaultPath(): string {
    const adapter = this.app.vault.adapter as unknown as { basePath?: string };
    if (!adapter.basePath) {
      throw new Error("Lexicon requires a desktop vault with a local path.");
    }
    return adapter.basePath;
  }

  runLexicon(args: string[], title: string): Promise<void> {
    return new Promise((resolve) => {
      const child = spawn(this.settings.command, args, { shell: true });
      let out = "";
      let err = "";
      child.stdout.on("data", (data) => (out += data.toString()));
      child.stderr.on("data", (data) => (err += data.toString()));
      child.on("close", (code) => {
        if (code === 0) {
          new Notice(`${title}: ${out.trim() || "done"}`);
        } else {
          new Notice(`${title} failed: ${err.trim() || `exit ${code}`}`);
        }
        resolve();
      });
    });
  }
}

class IngestModal extends Modal {
  plugin: LexiconPlugin;
  source = "";
  title = "";

  constructor(app: App, plugin: LexiconPlugin) {
    super(app);
    this.plugin = plugin;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: "Lexicon ingest" });

    new Setting(contentEl)
      .setName("URL or text")
      .addTextArea((text) =>
        text
          .setPlaceholder("https://... or pasted note")
          .onChange((value) => (this.source = value))
      );

    new Setting(contentEl)
      .setName("Title")
      .addText((text) => text.setPlaceholder("Optional").onChange((value) => (this.title = value)));

    new Setting(contentEl).addButton((button) =>
      button
        .setButtonText("Process")
        .setCta()
        .onClick(async () => {
          const value = this.source.trim();
          if (!value) {
            new Notice("Source is required.");
            return;
          }
          const args = ["ingest", "--vault", this.plugin.vaultPath()];
          if (/^https?:\/\//i.test(value)) {
            args.push("--url", value);
          } else {
            args.push("--text", value);
          }
          if (this.title.trim()) {
            args.push("--title", this.title.trim());
          }
          this.close();
          await this.plugin.runLexicon(args, "Ingest");
        })
    );
  }
}

class LexiconSettingTab extends PluginSettingTab {
  plugin: LexiconPlugin;

  constructor(app: App, plugin: LexiconPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName("Lexicon command")
      .setDesc("CLI command or absolute path used by the plugin.")
      .addText((text) =>
        text
          .setPlaceholder("lexicon")
          .setValue(this.plugin.settings.command)
          .onChange(async (value) => {
            this.plugin.settings.command = value || "lexicon";
            await this.plugin.saveSettings();
          })
      );
  }
}
