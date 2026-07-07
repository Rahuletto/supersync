import { App, Modal, Setting, Notice, TFile, FuzzySuggestModal } from "obsidian";
import { VersionEntry } from "../types";
import { generateDiff, stripFrontmatter } from "../utils/helpers";
import type SuperSyncPlugin from "../../main";

export class RestoreConfirmModal extends Modal {
  constructor(
    app: App,
    private plugin: SuperSyncPlugin,
    private file: TFile,
    private version: VersionEntry,
    private onConfirm: () => Promise<void>,
  ) {
    super(app);
  }

  async onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    
    contentEl.createEl("h2", { text: "Confirm Restore" });
    contentEl.createEl("p", {
      text: `Are you sure you want to overwrite "${this.file.name}" with the version from the commit below?`,
    });

    // Commit Details Box
    const commitBox = contentEl.createDiv();
    commitBox.setCssStyles({
      background: "var(--background-secondary)",
      border: "1px solid var(--border-color)",
      borderRadius: "6px",
      padding: "10px 14px",
      marginBottom: "15px",
      fontSize: "0.9em"
    });

    const addCommitRow = (parent: HTMLElement, label: string, val: string) => {
      const row = parent.createDiv();
      row.setCssStyles({ margin: "4px 0" });
      row.createEl("strong", { text: label + ": " });
      row.createSpan({ text: val });
    };
    addCommitRow(commitBox, "Date", new Date(this.version.date).toLocaleString());
    addCommitRow(commitBox, "Commit Message", this.version.message);
    addCommitRow(commitBox, "Commit SHA", this.version.sha.slice(0, 8));

    // Diff Loading Box
    const diffContainer = contentEl.createDiv();
    diffContainer.setCssStyles({
      padding: "12px",
      background: "var(--background-secondary)",
      border: "1px solid var(--border-color)",
      borderRadius: "6px",
      maxHeight: "250px",
      overflowY: "auto",
      fontFamily: "var(--font-monospace)",
      fontSize: "0.85em",
      whiteSpace: "pre-wrap",
      marginBottom: "15px"
    });
    diffContainer.setText("Loading diff...");

    // Action buttons
    new Setting(contentEl)
      .addButton((button) =>
        button
          .setButtonText("Cancel")
          .onClick(() => this.close()),
      )
      .addButton((button) =>
        button
          .setButtonText("Restore (Overwrite)")
          .setCta()
          .setDestructive()
          .onClick(async () => {
            button.setDisabled(true);
            button.setButtonText("Restoring...");
            try {
              await this.onConfirm();
              this.close();
            } catch (e) {
              new Notice("Restore failed: " + String(e));
              button.setDisabled(false);
              button.setButtonText("Restore (Overwrite)");
            }
          }),
      );

    try {
      await this.renderDiff(diffContainer);
    } catch (e) {
      diffContainer.setText(`Failed to load diff: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  private async renderDiff(container: HTMLDivElement) {
    const localText = await this.app.vault.read(this.file);
    const remoteBytes = await this.plugin.githubClient.downloadBytesAtCommit(this.file.path, this.version.sha);
    const remoteText = new TextDecoder().decode(remoteBytes);

    const cleanLocal = stripFrontmatter(localText);
    const cleanRemote = stripFrontmatter(remoteText);

    container.empty();

    if (cleanLocal === cleanRemote) {
      const msg = container.createDiv();
      msg.setText("File contents are identical.");
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
}

export class VersionRestoreModal extends FuzzySuggestModal<VersionEntry> {
  constructor(
    app: App,
    private plugin: SuperSyncPlugin,
    private file: TFile,
    private versions: VersionEntry[],
    private restore: (version: VersionEntry) => Promise<void>,
  ) {
    super(app);
    this.setPlaceholder(`Restore ${file.path} from GitHub history`);
  }

  getItems(): VersionEntry[] {
    return this.versions;
  }

  getItemText(version: VersionEntry): string {
    return `${version.date.slice(0, 10)} ${version.sha.slice(0, 8)} ${version.message}`;
  }

  onChooseItem(version: VersionEntry): void {
    new RestoreConfirmModal(this.app, this.plugin, this.file, version, async () => {
      await this.restore(version);
    }).open();
  }
}
