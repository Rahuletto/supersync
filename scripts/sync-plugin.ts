import { cp, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { execSync } from "node:child_process";

const vaultPath = process.env.OBSIDIAN_VAULT_PATH;
if (!vaultPath) {
  console.error("Error: OBSIDIAN_VAULT_PATH is not set in your .env file.");
  process.exit(1);
}

const destDir = join(vaultPath, ".obsidian", "plugins", "supersync");

try {
  console.log("Building plugin...");
  execSync("bun run build", { stdio: "inherit" });

  console.log(`Copying files to ${destDir}...`);
  await mkdir(destDir, { recursive: true });
  await cp("main.js", join(destDir, "main.js"));
  await cp("manifest.json", join(destDir, "manifest.json"));
  await cp("styles.css", join(destDir, "styles.css"));

  console.log("Plugin synchronized successfully!");
} catch (error) {
  console.error("Failed to sync plugin:", error);
  process.exit(1);
}
