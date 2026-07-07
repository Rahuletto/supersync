import { App, Modal, Setting, Notice } from "obsidian";
import { DeviceCodeResponse } from "../types";
import { GithubClient } from "../utils/github";

export class DeviceFlowModal extends Modal {
  private timer: any = null;
  private countdown: number;
  private intervalSeconds: number;
  private isClosed = false;
  private isChecking = false;

  private statusEl!: HTMLSpanElement;
  private countdownEl!: HTMLSpanElement;
  private spinnerEl!: HTMLDivElement;
  private checkNowBtnEl!: HTMLButtonElement;

  constructor(
    app: App,
    private device: DeviceCodeResponse,
    private clientId: string,
    private githubClient: GithubClient,
    private onSuccess: (token: string) => Promise<void>,
  ) {
    super(app);
    this.intervalSeconds = Math.max(5, device.interval);
    this.countdown = this.intervalSeconds;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    
    contentEl.createEl("h2", { text: "Sign in to GitHub" });
    
    contentEl.createEl("p", {
      text: "Authorize this plugin by entering the code below at GitHub's device activation page:",
    });

    // Code container
    const codeContainer = contentEl.createDiv({ cls: "super-sync-code-container" });
    codeContainer.style.display = "flex";
    codeContainer.style.alignItems = "center";
    codeContainer.style.gap = "10px";
    codeContainer.style.margin = "20px 0";

    const codeEl = codeContainer.createEl("code", { text: this.device.user_code });
    codeEl.style.fontSize = "28px";
    codeEl.style.fontWeight = "bold";
    codeEl.style.padding = "8px 16px";
    codeEl.style.background = "var(--background-secondary)";
    codeEl.style.border = "1px solid var(--border-color)";
    codeEl.style.borderRadius = "6px";
    codeEl.style.letterSpacing = "1px";

    const copyBtn = codeContainer.createEl("button", { text: "Copy" });
    copyBtn.onClickEvent(async () => {
      await navigator.clipboard.writeText(this.device.user_code);
      copyBtn.setText("Copied!");
      new Notice("Code copied to clipboard.");
      setTimeout(() => {
        if (!this.isClosed) copyBtn.setText("Copy");
      }, 2000);
    });

    // Verification URL info
    contentEl.createEl("p", {
      text: `Verification URL: ${this.device.verification_uri}`,
      cls: "super-sync-url-info"
    });

    // Primary action: Open GitHub
    new Setting(contentEl)
      .addButton((button) =>
        button
          .setButtonText("Open GitHub")
          .setCta()
          .onClick(() => window.open(this.device.verification_uri)),
      );

    // Separator line
    contentEl.createEl("hr");

    // Status area in bottom
    const statusContainer = contentEl.createDiv();
    statusContainer.style.display = "flex";
    statusContainer.style.justifyContent = "space-between";
    statusContainer.style.alignItems = "center";
    statusContainer.style.marginTop = "15px";

    const leftSide = statusContainer.createDiv();
    leftSide.style.display = "flex";
    leftSide.style.alignItems = "center";
    leftSide.style.gap = "8px";

    // CSS Spinner
    this.spinnerEl = leftSide.createDiv();
    this.spinnerEl.style.width = "14px";
    this.spinnerEl.style.height = "14px";
    this.spinnerEl.style.borderRadius = "50%";
    this.spinnerEl.style.border = "2px solid var(--text-muted)";
    this.spinnerEl.style.borderTopColor = "transparent";
    this.spinnerEl.style.animation = "spin 1s linear infinite";
    
    // Inject keyframes style if not exists
    if (!document.getElementById("super-sync-spinner-style")) {
      const style = document.createElement("style");
      style.id = "super-sync-spinner-style";
      style.textContent = "@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }";
      document.head.appendChild(style);
    }

    this.statusEl = leftSide.createSpan({ text: "Waiting for code entry... " });
    this.statusEl.style.color = "var(--text-muted)";
    this.statusEl.style.fontSize = "0.9em";

    this.countdownEl = leftSide.createSpan({ text: `(checking in ${this.countdown}s)` });
    this.countdownEl.style.color = "var(--text-muted)";
    this.countdownEl.style.fontSize = "0.9em";

    // "Check now" minimal button
    this.checkNowBtnEl = statusContainer.createEl("button", { text: "Check now" }) as HTMLButtonElement;
    this.checkNowBtnEl.style.padding = "4px 8px";
    this.checkNowBtnEl.style.fontSize = "0.85em";
    this.checkNowBtnEl.onClickEvent(() => {
      void this.triggerImmediateCheck();
    });

    // Start polling loop
    this.startPollingLoop();
  }

  onClose() {
    this.isClosed = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private startPollingLoop() {
    const tick = async () => {
      if (this.isClosed) return;

      if (this.countdown <= 0) {
        await this.checkToken();
      } else {
        this.countdown--;
        this.countdownEl.setText(`(checking in ${this.countdown}s)`);
      }

      if (!this.isClosed) {
        this.timer = setTimeout(tick, 1000);
      }
    };

    this.timer = setTimeout(tick, 1000);
  }

  private async triggerImmediateCheck() {
    if (this.isChecking || this.isClosed) return;
    if (this.checkNowBtnEl) {
      this.checkNowBtnEl.disabled = true;
      setTimeout(() => {
        if (!this.isClosed && this.checkNowBtnEl) {
          this.checkNowBtnEl.disabled = false;
        }
      }, 5000);
    }
    this.countdown = 0;
    this.countdownEl.setText("(checking now...)");
    await this.checkToken();
  }

  private async checkToken() {
    if (this.isChecking || this.isClosed) return;
    this.isChecking = true;
    this.spinnerEl.style.borderTopColor = "var(--text-accent)";

    try {
      const result = await this.githubClient.checkDeviceToken(this.clientId, this.device.device_code);

      if (result.access_token) {
        this.isClosed = true;
        if (this.timer) clearTimeout(this.timer);
        this.statusEl.setText("Authorized! Setting up...");
        this.countdownEl.setText("");
        await this.onSuccess(result.access_token);
        this.close();
        return;
      }

      if (result.error === "authorization_pending") {
        this.countdown = this.intervalSeconds;
        this.statusEl.setText("Waiting for code entry... ");
        this.countdownEl.setText(`(checking in ${this.countdown}s)`);
      } else if (result.error === "slow_down") {
        this.intervalSeconds += 5;
        this.countdown = this.intervalSeconds;
        this.statusEl.setText("Slow down requested... ");
        this.countdownEl.setText(`(checking in ${this.countdown}s)`);
        new Notice("GitHub requested to slow down polling. Cooldown interval increased by 5s.", 3000);
      } else {
        this.isClosed = true;
        if (this.timer) clearTimeout(this.timer);
        const errMsg = result.error_description || result.error || "GitHub sign-in failed.";
        this.statusEl.setText(`Error: ${errMsg}`);
        this.countdownEl.setText("");
        new Notice(errMsg, 10000);
      }
    } catch (error) {
      console.error("Error checking device token:", error);
    } finally {
      this.isChecking = false;
      if (!this.isClosed) {
        this.spinnerEl.style.borderTopColor = "transparent";
      }
    }
  }
}
