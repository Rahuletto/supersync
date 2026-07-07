import { App, Modal } from "obsidian";
import { SyncLogEntry } from "../types";

export class SyncLogModal extends Modal {
  constructor(
    app: App,
    private entries: SyncLogEntry[],
  ) {
    super(app);
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: "GitHub Sync log" });
    if (this.entries.length === 0) {
      contentEl.createEl("p", { text: "No sync runs yet." });
      return;
    }
    for (const entry of this.entries) {
      const box = contentEl.createDiv({ cls: "private-github-sync-log-entry" });
      box.createEl("strong", {
        text: `${entry.status.toUpperCase()} ${entry.reason} ${new Date(entry.endedAt).toLocaleString()}`,
      });
      box.createEl("div", {
        text: `changes ${entry.changes}, uploads ${entry.uploads}, downloads ${entry.downloads}, deletes ${entry.deletes}, conflicts ${entry.conflicts}`,
      });
      if (entry.commitSha)
        box.createEl("div", { text: `commit ${entry.commitSha.slice(0, 12)}` });
      if (entry.error) box.createEl("div", { text: entry.error });
    }
  }
}
