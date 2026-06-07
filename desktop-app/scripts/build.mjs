import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const desktopRoot = path.resolve(__dirname, "..");
const tscBin = path.join(desktopRoot, "node_modules", "typescript", "bin", "tsc");
const viteBin = path.join(desktopRoot, "node_modules", "vite", "bin", "vite.js");

function run(command, args) {
  const executable = command;
  console.log(`> ${executable} ${args.join(" ")}`);
  const result = spawnSync(executable, args, {
    stdio: "inherit",
    shell: false
  });
  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

run("node", ["scripts/clean.mjs"]);
run("node", [tscBin, "-p", "tsconfig.electron.json"]);
run("node", [viteBin, "build"]);
