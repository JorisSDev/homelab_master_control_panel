import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const children = [];

function start(command, args, cwd) {
  const child = spawn(command, args, { cwd, stdio: "inherit" });
  children.push(child);
  return child;
}

function stop() {
  for (const child of children) {
    if (child.exitCode === null) {
      child.kill("SIGTERM");
    }
  }
}

process.on("SIGINT", () => {
  stop();
  process.exit(0);
});
process.on("SIGTERM", stop);

const api = start("python3", ["-m", "homelab_panel", "--config", "config.example.json"], root);
const ui = start("npx", ["vite", "--host", "127.0.0.1"], path.join(root, "ui"));

api.on("exit", (code) => {
  if (code) {
    stop();
    process.exit(code);
  }
});
ui.on("exit", (code) => {
  stop();
  process.exit(code ?? 0);
});
