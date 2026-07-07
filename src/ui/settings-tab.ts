import { App, PluginSettingTab, Setting } from "obsidian";
import { Settings, DEFAULT_SETTINGS } from "../types";
import type SuperSyncPlugin from "../../main";

export class SuperSyncSettingTab extends PluginSettingTab {
  plugin: SuperSyncPlugin;

  constructor(app: App, plugin: SuperSyncPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "Private GitHub Sync" });
    const isAuthorized = Boolean(this.plugin.settings.token);

    containerEl.createEl("p", {
      text: isAuthorized
        ? "Unified mobile + desktop sync through the GitHub API. You are authenticated with GitHub."
        : "Unified mobile + desktop sync through the GitHub API. Sign in using the button below to authorize the plugin.",
    });

    if (isAuthorized) {
      new Setting(containerEl)
        .setName("GitHub signed in")
        .setDesc("You are authenticated with GitHub.")
        .addButton((button) =>
          button
            .setButtonText("Sign out")
            .setWarning()
            .onClick(async () => {
              this.plugin.settings.token = "";
              this.plugin.settings.owner = "";
              await this.plugin.saveSettings();
              this.plugin.refreshStatusViews();
              this.display();
            }),
        );
    } else {
      new Setting(containerEl)
        .setName("GitHub device sign-in")
        .setDesc("Uses GitHub OAuth device flow to authorize and log in.")
        .addButton((button) =>
          button
            .setButtonText("Sign in with GitHub")
            .setCta()
            .onClick(() => void this.plugin.startDeviceFlowLogin()),
        );
    }
    this.text("Repository owner", "GitHub username or organization (optional, defaults to authenticated user)", "owner");
    this.text("Repository name", "GitHub repository name", "repo");
    this.text("Branch", "Branch to sync with", "branch");
    this.text("Root path", "Optional subfolder inside the repo", "rootPath");
    this.toggle(
      "Automatic sync",
      "Run startup/change/interval syncs",
      "autoSync",
    );
    this.toggle("Sync on startup", "", "syncOnStartup");
    this.toggle("Sync after file changes", "", "syncOnFileChange");
    new Setting(containerEl).setName("Interval minutes").addText((text) =>
      text
        .setValue(String(this.plugin.settings.intervalMinutes))
        .onChange(async (value) => {
          this.plugin.settings.intervalMinutes = Math.max(
            1,
            Number(value) || DEFAULT_SETTINGS.intervalMinutes,
          );
          await this.plugin.saveSettings();
        }),
    );
    this.toggle(
      "Sync .obsidian config",
      "Includes settings, themes, snippets, canvas metadata, etc. Workspace files still ignored by default.",
      "syncObsidianConfig",
    );
    this.toggle(
      "Sync community plugins",
      "Disabled by default. Enable only if all devices should share installed plugin files.",
      "syncCommunityPlugins",
    );
    const ignoreSetting = new Setting(containerEl)
      .setName("Ignore patterns")
      .setDesc(
        "One glob-ish pattern per line. Supports exact paths, /** folder prefixes, * wildcards.",
      );
    ignoreSetting.settingEl.style.flexDirection = "column";
    ignoreSetting.settingEl.style.alignItems = "stretch";
    ignoreSetting.settingEl.style.gap = "8px";

    ignoreSetting.addTextArea((text) => {
      text.inputEl.rows = 6;
      text.inputEl.style.width = "100%";
      text.inputEl.style.height = "120px";
      text.inputEl.style.fontFamily = "monospace";
      text.setPlaceholder(".git/**\n.trash/**\n.DS_Store");
      text
        .setValue(this.plugin.settings.ignorePatterns)
        .onChange(async (value) => {
          this.plugin.settings.ignorePatterns = value;
          await this.plugin.saveSettings();
        });
    });
    new Setting(containerEl).addButton((button) =>
      button
        .setButtonText("Sync now")
        .setCta()
        .onClick(() => void this.plugin.sync("settings")),
    );
    containerEl.createDiv({
      cls: "private-github-sync-status",
      text: "Safety: all files are synced as bytes. If local and remote both changed, the remote copy is saved as a conflict file and local data is preserved.",
    });
  }

  private text<K extends keyof Settings>(name: string, desc: string, key: K) {
    new Setting(this.containerEl)
      .setName(name)
      .setDesc(desc)
      .addText((text) => {
        if (key === "token") text.inputEl.type = "password";
        text
          .setValue(String(this.plugin.settings[key] ?? ""))
          .onChange(async (value) => {
            (this.plugin.settings[key] as string) = value.trim();
            await this.plugin.saveSettings();
          });
      });
  }

  private toggle<K extends keyof Settings>(name: string, desc: string, key: K) {
    new Setting(this.containerEl)
      .setName(name)
      .setDesc(desc)
      .addToggle((toggle) =>
        toggle
          .setValue(Boolean(this.plugin.settings[key]))
          .onChange(async (value) => {
            (this.plugin.settings[key] as boolean) = value;
            await this.plugin.saveSettings();
          }),
      );
  }
}
