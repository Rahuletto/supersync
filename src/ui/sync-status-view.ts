import { ItemView, WorkspaceLeaf, Notice } from "obsidian";
import { VIEW_TYPE_SYNC_STATUS } from "../constants";
import type ObsidianSyncPlugin from "../../main";

export class SyncStatusView extends ItemView {
  constructor(
    leaf: WorkspaceLeaf,
    private plugin: ObsidianSyncPlugin,
  ) {
    super(leaf);
  }

  getViewType(): string {
    return VIEW_TYPE_SYNC_STATUS;
  }

  getDisplayText(): string {
    return "GitHub Sync";
  }

  getIcon(): string {
    return "refresh-cw";
  }

  async onOpen() {
    this.render();
  }

  render() {
    const snapshot = this.plugin.getStatusSnapshot();
    const container = this.containerEl.children[1] as HTMLElement;
    container.empty();
    container.style.padding = "16px";
    container.style.display = "flex";
    container.style.flexDirection = "column";

    // Header Area with Title & Status Badge
    const header = container.createDiv();
    header.style.display = "flex";
    header.style.justifyContent = "space-between";
    header.style.alignItems = "center";
    header.style.marginBottom = "20px";

    const title = header.createEl("h3", { text: "ObsidianSync" });
    title.style.margin = "0";

    // Status Indicator Badge
    const isError = snapshot.status.toLowerCase().includes("failed") || snapshot.status.toLowerCase().includes("error");
    const isSyncing = snapshot.status.toLowerCase().includes("syncing");

    const badge = header.createSpan();
    badge.style.fontSize = "0.75em";
    badge.style.padding = "4px 10px";
    badge.style.borderRadius = "12px";
    badge.style.fontWeight = "bold";
    badge.style.display = "inline-flex";
    badge.style.alignItems = "center";
    badge.style.gap = "6px";

    const dot = badge.createSpan();
    dot.style.width = "6px";
    dot.style.height = "6px";
    dot.style.borderRadius = "50%";

    if (isSyncing) {
      badge.style.background = "var(--background-modifier-accent-hover)";
      badge.style.color = "var(--text-on-accent)";
      dot.style.background = "var(--text-on-accent)";
      badge.createSpan({ text: "Syncing" });
    } else if (isError) {
      badge.style.background = "rgba(244, 67, 54, 0.2)";
      badge.style.color = "#f44336";
      dot.style.background = "#f44336";
      badge.createSpan({ text: "Error" });
    } else {
      badge.style.background = "rgba(76, 175, 80, 0.15)";
      badge.style.color = "#4caf50";
      dot.style.background = "#4caf50";
      badge.createSpan({ text: "Synced" });
    }

    // Main Info Card
    const infoCard = container.createDiv();
    infoCard.style.background = "var(--background-secondary)";
    infoCard.style.border = "1px solid var(--border-color)";
    infoCard.style.borderRadius = "8px";
    infoCard.style.padding = "14px 16px";
    infoCard.style.marginBottom = "20px";

    const addCardRow = (parent: HTMLElement, label: string, value: string, isMonospace = false) => {
      const row = parent.createDiv();
      row.style.display = "flex";
      row.style.justifyContent = "space-between";
      row.style.alignItems = "center";
      row.style.padding = "8px 0";
      row.style.borderBottom = "1px solid var(--background-modifier-border-hover)";

      row.createSpan({ text: label }).style.color = "var(--text-muted)";
      const valSpan = row.createSpan({ text: value });
      if (isMonospace) {
        valSpan.style.fontFamily = "var(--font-monospace)";
        valSpan.style.fontSize = "0.9em";
      }
    };

    addCardRow(infoCard, "Repository", snapshot.repo, true);
    addCardRow(infoCard, "Branch", snapshot.branch, true);
    addCardRow(infoCard, "Last Sync", snapshot.lastSyncAt);
    addCardRow(infoCard, "Tracked Files", String(snapshot.trackedFiles));
    addCardRow(infoCard, "Last Changes", String(snapshot.lastChangeCount));
    addCardRow(infoCard, "Log Entries", String(snapshot.logEntries));

    // Remove the bottom border of the last row
    if (infoCard.lastChild instanceof HTMLElement) {
      infoCard.lastChild.style.borderBottom = "none";
    }

    // Error Message Box (displays only if the last status has an error/failed)
    if (snapshot.lastError && snapshot.lastError !== "None") {
      const errorBox = container.createDiv();
      errorBox.style.background = "rgba(244, 67, 54, 0.1)";
      errorBox.style.border = "1px solid rgba(244, 67, 54, 0.3)";
      errorBox.style.color = "#f44336";
      errorBox.style.borderRadius = "6px";
      errorBox.style.padding = "10px 14px";
      errorBox.style.fontSize = "0.85em";
      errorBox.style.marginBottom = "20px";
      errorBox.style.overflowWrap = "anywhere";

      const errTitle = errorBox.createDiv();
      errTitle.createEl("strong", { text: "Last Error:" });
      errTitle.style.marginBottom = "4px";

      errorBox.createSpan({ text: snapshot.lastError });
    }

    // Action Buttons Container
    const btnContainer = container.createDiv();
    btnContainer.style.display = "flex";
    btnContainer.style.flexDirection = "column";
    btnContainer.style.gap = "8px";
    btnContainer.style.marginTop = "auto"; // Push buttons to the bottom of view if there is space

    // Sync Now (CTA)
    const syncBtn = btnContainer.createEl("button", { text: "Sync Now", cls: "mod-cta" });
    syncBtn.style.width = "100%";
    syncBtn.style.padding = "10px";
    syncBtn.style.fontSize = "1em";
    syncBtn.style.fontWeight = "bold";
    syncBtn.onClickEvent(() => void this.plugin.sync("panel"));

    // Secondary row of buttons
    const secondaryRow = btnContainer.createDiv();
    secondaryRow.style.display = "flex";
    secondaryRow.style.gap = "8px";

    const logBtn = secondaryRow.createEl("button", { text: "Sync Log" });
    logBtn.style.flex = "1";
    logBtn.style.padding = "8px";
    logBtn.onClickEvent(() => this.plugin.showSyncLog());

    const restoreBtn = secondaryRow.createEl("button", { text: "Restore Version" });
    restoreBtn.style.flex = "1";
    restoreBtn.style.padding = "8px";
    restoreBtn.onClickEvent(() => {
      const file = this.app.workspace.getActiveFile();
      if (file) void this.plugin.openVersionRestore(file);
      else new Notice("Open a file first.");
    });
  }
}
