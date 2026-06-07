import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:net";

const children = [];

function run(command, args, options = {}) {
  const child = spawn(command, args, {
    stdio: "inherit",
    shell: process.platform === "win32",
    ...options
  });
  children.push(child);
  return child;
}

function runChecked(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    shell: process.platform === "win32",
    ...options
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function waitForPort(port, host = "127.0.0.1", timeoutMs = 30000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      const socket = createServer();
      socket.once("error", () => resolve());
      socket.once("listening", () => {
        socket.close();
        if (Date.now() - start > timeoutMs) {
          reject(new Error(`Timed out waiting for ${host}:${port}`));
          return;
        }
        setTimeout(tick, 250);
      });
      socket.listen(port, host);
    };
    tick();
  });
}

function shutdown() {
  for (const child of children) {
    if (!child.killed) child.kill();
  }
}

process.on("SIGINT", () => {
  shutdown();
  process.exit(130);
});
process.on("SIGTERM", () => {
  shutdown();
  process.exit(143);
});

runChecked("npx", ["tsc", "-p", "tsconfig.electron.json"]);
run("npx", ["tsc", "-p", "tsconfig.electron.json", "--watch", "--preserveWatchOutput"]);
run("npx", ["vite", "--host", "127.0.0.1"]);

await waitForPort(5173);

const electron = run("npx", ["electron", "."], {
  env: {
    ...process.env,
    VITE_DEV_SERVER_URL: "http://127.0.0.1:5173"
  }
});

electron.on("exit", (code) => {
  shutdown();
  process.exit(code ?? 0);
});
