import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const desktopRoot = path.resolve(__dirname, "..");
const targets = ["dist-electron", "dist-renderer"];

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function removeBuildDir(target) {
  const fullPath = path.join(desktopRoot, target);
  if (!fs.existsSync(fullPath)) return;

  const attempts = 4;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      fs.rmSync(fullPath, { recursive: true, force: true });
      return;
    } catch (error) {
      if (attempt === attempts) {
        const detail = error instanceof Error ? error.message : String(error);
        throw new Error(
          `Cannot remove ${target}. Close any running Lexicon desktop window and stop npm.cmd run dev, then retry. ${detail}`
        );
      }
      sleep(300);
    }
  }
}

for (const target of targets) {
  removeBuildDir(target);
}

console.log("Cleaned desktop build outputs.");
