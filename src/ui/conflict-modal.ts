import { App, Modal, Setting, Notice, TFile } from "obsidian";
import { Change } from "../sync-core";
import { ConflictResolution } from "../types";
import { conflictDescription, generateDiff, stripFrontmatter } from "../utils/helpers";
import type PrivateGithubSyncPlugin from "../../main";



export class ConflictModal extends Modal {
  private result?: Map<string, ConflictResolution>;
  private resolver?: (value: Map<string, ConflictResolution>) => void;
  private choices = new Map<string, ConflictResolution>();

  constructor(
    app: App,
    private plugin: PrivateGithubSyncPlugin,
    private conflicts: Array<Extract<Change, { type: "conflict" }>>,
  ) {
    super(app);
    for (const conflict of conflicts) this.choices.set(conflict.path, "both");
  }

  resolve(): Promise<Map<string, ConflictResolution>> {
    this.open();
    return new Promise((resolve) => {
      this.resolver = resolve;
    });
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: "Sync conflicts" });
    contentEl.createEl("p", {
      text: "Choose how to resolve each conflict. Keep both preserves local and saves the remote version as a conflict copy.",
    });

    new Setting(contentEl)
      .addButton((button) =>
        button.setButtonText("All local").onClick(() => this.setAll("local")),
      )
      .addButton((button) =>
        button.setButtonText("All remote").onClick(() => this.setAll("remote")),
      )
      .addButton((button) =>
        button.setButtonText("All both").onClick(() => this.setAll("both")),
      );

    for (const conflict of this.conflicts) {
      const rowContainer = contentEl.createDiv();
      rowContainer.style.borderBottom = "1px solid var(--background-modifier-border-hover)";
      rowContainer.style.paddingBottom = "15px";
      rowContainer.style.marginBottom = "15px";

      const settingRow = new Setting(rowContainer)
        .setName(conflict.path)
        .setDesc(conflictDescription(conflict.kind))
        .addDropdown((dropdown) =>
          dropdown
            .addOption("local", "Keep local")
            .addOption("remote", "Keep remote")
            .addOption("both", "Keep both")
            .setValue(this.choices.get(conflict.path) ?? "both")
            .onChange((value) =>
              this.choices.set(conflict.path, value as ConflictResolution),
            ),
        );

      if (conflict.path.endsWith(".md") || conflict.path.endsWith(".txt")) {
        const diffContainer = rowContainer.createDiv();
        diffContainer.style.display = "none";
        diffContainer.style.marginTop = "10px";
        diffContainer.style.padding = "12px";
        diffContainer.style.background = "var(--background-secondary)";
        diffContainer.style.border = "1px solid var(--border-color)";
        diffContainer.style.borderRadius = "6px";
        diffContainer.style.maxHeight = "250px";
        diffContainer.style.overflowY = "auto";
        diffContainer.style.fontFamily = "var(--font-monospace)";
        diffContainer.style.fontSize = "0.85em";
        diffContainer.style.whiteSpace = "pre-wrap";

        settingRow.addButton((button) =>
          button.setButtonText("Show Diff").onClick(async () => {
            const isShowing = diffContainer.style.display !== "none";
            if (isShowing) {
              diffContainer.style.display = "none";
              button.setButtonText("Show Diff");
            } else {
              button.setButtonText("Loading Diff...");
              button.setDisabled(true);
              try {
                await this.renderDiff(diffContainer, conflict);
                diffContainer.style.display = "block";
                button.setButtonText("Hide Diff");
              } catch (e) {
                new Notice("Failed to load diff: " + String(e));
                button.setButtonText("Show Diff");
              } finally {
                button.setDisabled(false);
              }
            }
          }),
        );
      }
    }

    new Setting(contentEl)
      .addButton((button) =>
        button.setButtonText("Cancel sync").onClick(() => this.close()),
      )
      .addButton((button) =>
        button
          .setButtonText("Apply choices")
          .setCta()
          .onClick(() => {
            this.result = new Map(this.choices);
            this.close();
          }),
      );
  }

  onClose() {
    this.contentEl.empty();
    this.resolver?.(
      this.result ??
        new Map(
          this.conflicts.map((conflict) => [
            conflict.path,
            "both" as ConflictResolution,
          ]),
        ),
    );
  }

  private async renderDiff(
    container: HTMLDivElement,
    conflict: Extract<Change, { type: "conflict" }>,
  ) {
    container.empty();

    let localText = "";
    const localFile = this.app.vault.getAbstractFileByPath(conflict.path);
    if (localFile instanceof TFile) {
      localText = await this.app.vault.read(localFile);
    }

    let remoteText = "";
    if (conflict.remoteSha) {
      try {
        const remoteBytes = await this.plugin.githubClient.downloadBytes(conflict.path);
        remoteText = new TextDecoder().decode(remoteBytes);
      } catch (e) {
        remoteText = `[Failed to download remote file: ${e instanceof Error ? e.message : String(e)}]`;
      }
    }

    const cleanLocal = stripFrontmatter(localText);
    const cleanRemote = stripFrontmatter(remoteText);

    if (cleanLocal === cleanRemote) {
      const msg = container.createDiv();
      msg.setText("File contents are identical (conflict is metadata-only).");
      msg.style.color = "var(--text-muted)";
      msg.style.fontStyle = "italic";
      return;
    }

    const diffLines = generateDiff(cleanLocal, cleanRemote);
    for (const line of diffLines) {
      const lineEl = container.createDiv();
      lineEl.style.padding = "2px 4px";
      lineEl.style.borderRadius = "2px";

      if (line.type === "added") {
        lineEl.style.background = "rgba(76, 175, 80, 0.12)";
        lineEl.style.color = "#4caf50";
        lineEl.setText(`+ ${line.text}`);
      } else if (line.type === "removed") {
        lineEl.style.background = "rgba(244, 67, 54, 0.12)";
        lineEl.style.color = "#f44336";
        lineEl.setText(`- ${line.text}`);
      } else {
        lineEl.style.color = "var(--text-muted)";
        lineEl.setText(`  ${line.text}`);
      }
    }
  }



  private setAll(choice: ConflictResolution) {
    for (const conflict of this.conflicts) this.choices.set(conflict.path, choice);
    this.onOpen();
  }
}
