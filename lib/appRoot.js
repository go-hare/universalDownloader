const { existsSync } = require("node:fs");
const path = require("node:path");

function packedBinary() {
  const base = path.basename(process.execPath).toLowerCase();
  if (process.pkg || process.versions.sea) return true;
  if (typeof process.versions.bun === "string" && base !== "bun.exe" && base !== "bun") return true;
  return false;
}

function appRoot() {
  if (process.env.APP_ROOT) return path.resolve(process.env.APP_ROOT);
  if (packedBinary()) return path.dirname(process.execPath);
  return path.join(__dirname, "..");
}

function firstExisting(candidates) {
  return candidates.find((candidate) => candidate && existsSync(candidate)) || null;
}

function sidecar(name, nested = []) {
  const root = appRoot();
  const suffix = process.platform === "win32" && !name.endsWith(".exe") ? ".exe" : "";
  const filename = name + suffix;
  return firstExisting([
    path.join(root, filename),
    path.join(root, ".runtime", filename),
    nested.length ? path.join(root, ".runtime", ...nested, filename) : null,
  ]);
}

function nodeRuntime() {
  const env = process.env.YTDLP_NODE || process.env.NODE_BINARY;
  if (env) return env;
  const colocated = sidecar("node");
  if (colocated) return colocated;
  const base = path.basename(process.execPath).toLowerCase();
  if (base === "node.exe" || base === "node" || base === "bun.exe" || base === "bun") return process.execPath;
  return process.execPath;
}

module.exports = { appRoot, packedBinary, sidecar, nodeRuntime, firstExisting };
