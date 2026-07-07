import { App, Modal, Setting, Notice, TFile } from "obsidian";
import { Change } from "../sync-core";
import { ConflictResolution } from "../types";
import { conflictDescription, generateDiff, stripFrontmatter, isBinaryFile } from "../utils/helpers";
import type SuperSyncPlugin from "../../main";



export class ConflictModal extends Modal {
  private result?: Map<string, ConflictResolution>;
  private resolver?: (value: Map<string, ConflictResolution>) => void;
  private choices = new Map<string, ConflictResolution>();

  constructor(
    app: App,
    private plugin: SuperSyncPlugin,
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
      rowContainer.setCssStyles({
        borderBottom: "1px solid var(--background-modifier-border-hover)",
        paddingBottom: "15px",
        marginBottom: "15px"
      });

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

      if (!isBinaryFile(conflict.path)) {
        const diffContainer = rowContainer.createDiv();
        diffContainer.setCssStyles({
          display: "none",
          marginTop: "10px",
          padding: "12px",
          background: "var(--background-secondary)",
          border: "1px solid var(--border-color)",
          borderRadius: "6px",
          maxHeight: "250px",
          overflowY: "auto",
          fontFamily: "var(--font-monospace)",
          fontSize: "0.85em",
          whiteSpace: "pre-wrap"
        });

        settingRow.addButton((button) =>
          button.setButtonText("Show Diff").onClick(async () => {
            const isShowing = diffContainer.style.display !== "none";
            if (isShowing) {
              diffContainer.setCssStyles({ display: "none" });
              button.setButtonText("Show Diff");
            } else {
              button.setButtonText("Loading Diff...");
              button.setDisabled(true);
              try {
                await this.renderDiff(diffContainer, conflict);
                diffContainer.setCssStyles({ display: "block" });
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
      msg.setCssStyles({
        color: "var(--text-muted)",
        fontStyle: "italic"
      });
      return;
    }

    const diffLines = generateDiff(cleanLocal, cleanRemote);
    for (const line of diffLines) {
      const lineEl = container.createDiv();
      lineEl.setCssStyles({
        padding: "2px 4px",
        borderRadius: "2px"
      });

      if (line.type === "added") {
        lineEl.setCssStyles({
          background: "rgba(76, 175, 80, 0.12)",
          color: "#4caf50"
        });
        lineEl.setText(`+ ${line.text}`);
      } else if (line.type === "removed") {
        lineEl.setCssStyles({
          background: "rgba(244, 67, 54, 0.12)",
          color: "#f44336"
        });
        lineEl.setText(`- ${line.text}`);
      } else {
        lineEl.setCssStyles({
          color: "var(--text-muted)"
        });
        lineEl.setText(`  ${line.text}`);
      }
    }
  }



  private setAll(choice: ConflictResolution) {
    for (const conflict of this.conflicts) this.choices.set(conflict.path, choice);
    this.onOpen();
  }
}
