import { ItemView, WorkspaceLeaf, Notice } from "obsidian";
import { VIEW_TYPE_SYNC_STATUS } from "../constants";
import type SuperSyncPlugin from "../../main";

export class SyncStatusView extends ItemView {
  constructor(
    leaf: WorkspaceLeaf,
    private plugin: SuperSyncPlugin,
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
    container.setCssStyles({
      padding: "16px",
      display: "flex",
      flexDirection: "column"
    });

    // Header Area with Title & Status Badge
    const header = container.createDiv();
    header.setCssStyles({
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      marginBottom: "20px"
    });

    const title = header.createEl("h3", { text: "SuperSync" });
    title.setCssStyles({ margin: "0" });

    // Status Indicator Badge
    const isError = snapshot.status.toLowerCase().includes("failed") || snapshot.status.toLowerCase().includes("error");
    const isSyncing = snapshot.status.toLowerCase().includes("syncing");

    const badge = header.createSpan();
    badge.setCssStyles({
      fontSize: "0.75em",
      padding: "4px 10px",
      borderRadius: "12px",
      fontWeight: "bold",
      display: "inline-flex",
      alignItems: "center",
      gap: "6px"
    });

    const dot = badge.createSpan();
    dot.setCssStyles({
      width: "6px",
      height: "6px",
      borderRadius: "50%"
    });

    if (isSyncing) {
      badge.setCssStyles({
        background: "var(--background-modifier-accent-hover)",
        color: "var(--text-on-accent)"
      });
      dot.setCssStyles({ background: "var(--text-on-accent)" });
      badge.createSpan({ text: "Syncing" });
    } else if (isError) {
      badge.setCssStyles({
        background: "rgba(244, 67, 54, 0.2)",
        color: "#f44336"
      });
      dot.setCssStyles({ background: "#f44336" });
      badge.createSpan({ text: "Error" });
    } else {
      badge.setCssStyles({
        background: "rgba(76, 175, 80, 0.15)",
        color: "#4caf50"
      });
      dot.setCssStyles({ background: "#4caf50" });
      badge.createSpan({ text: "Synced" });
    }

    // Main Info Card
    const infoCard = container.createDiv();
    infoCard.setCssStyles({
      background: "var(--background-secondary)",
      border: "1px solid var(--border-color)",
      borderRadius: "8px",
      padding: "14px 16px",
      marginBottom: "20px"
    });

    const addCardRow = (parent: HTMLElement, label: string, value: string, isMonospace = false) => {
      const row = parent.createDiv();
      row.setCssStyles({
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        padding: "8px 0",
        borderBottom: "1px solid var(--background-modifier-border-hover)"
      });

      const labelSpan = row.createSpan({ text: label });
      labelSpan.setCssStyles({ color: "var(--text-muted)" });
      const valSpan = row.createSpan({ text: value });
      if (isMonospace) {
        valSpan.setCssStyles({
          fontFamily: "var(--font-monospace)",
          fontSize: "0.9em"
        });
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
      infoCard.lastChild.setCssStyles({ borderBottom: "none" });
    }

    // Error Message Box (displays only if the last status has an error/failed)
    if (snapshot.lastError && snapshot.lastError !== "None") {
      const errorBox = container.createDiv();
      errorBox.setCssStyles({
        background: "rgba(244, 67, 54, 0.1)",
        border: "1px solid rgba(244, 67, 54, 0.3)",
        color: "#f44336",
        borderRadius: "6px",
        padding: "10px 14px",
        fontSize: "0.85em",
        marginBottom: "20px",
        overflowWrap: "anywhere"
      });

      const errTitle = errorBox.createDiv();
      errTitle.createEl("strong", { text: "Last Error:" });
      errTitle.setCssStyles({ marginBottom: "4px" });

      errorBox.createSpan({ text: snapshot.lastError });
    }

    // Action Buttons Container
    const btnContainer = container.createDiv();
    btnContainer.setCssStyles({
      display: "flex",
      flexDirection: "column",
      gap: "8px",
      marginTop: "auto"
    });

    // Sync Now (CTA)
    const syncBtn = btnContainer.createEl("button", { text: "Sync Now", cls: "mod-cta" });
    syncBtn.setCssStyles({
      width: "100%",
      padding: "10px",
      fontSize: "1em",
      fontWeight: "bold"
    });
    syncBtn.onClickEvent(() => void this.plugin.sync("panel"));

    // Pull Changes button
    const pullBtn = btnContainer.createEl("button", { text: "⬇ Pull Changes" });
    pullBtn.setCssStyles({
      width: "100%",
      padding: "10px",
      fontSize: "0.95em"
    });
    pullBtn.onClickEvent(() => void this.plugin.pull());
    // Secondary row of buttons
    const secondaryRow = btnContainer.createDiv();
    secondaryRow.setCssStyles({
      display: "flex",
      gap: "8px"
    });

    const logBtn = secondaryRow.createEl("button", { text: "Sync Log" });
    logBtn.setCssStyles({
      flex: "1",
      padding: "8px"
    });
    logBtn.onClickEvent(() => this.plugin.showSyncLog());

    const restoreBtn = secondaryRow.createEl("button", { text: "Restore Version" });
    restoreBtn.setCssStyles({
      flex: "1",
      padding: "8px"
    });
    restoreBtn.onClickEvent(() => {
      const file = this.app.workspace.getActiveFile();
      if (file) void this.plugin.openVersionRestore(file);
      else new Notice("Open a file first.");
    });
  }
}
