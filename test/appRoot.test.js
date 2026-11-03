const assert = require("node:assert/strict");
const { mkdirSync, writeFileSync, rmSync } = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const { sidecar, firstExisting, nodeRuntime } = require("../lib/appRoot");

test("sidecar prefers files next to APP_ROOT over .runtime", () => {
  const root = path.join(os.tmpdir(), `ud-root-${process.pid}`);
  mkdirSync(path.join(root, ".runtime", "ffmpeg", "bin"), { recursive: true });
  writeFileSync(path.join(root, ".runtime", "yt-dlp.exe"), "");
  writeFileSync(path.join(root, ".runtime", "ffmpeg", "bin", "ffmpeg.exe"), "");
  const previous = process.env.APP_ROOT;
  process.env.APP_ROOT = root;
  try {
    assert.equal(sidecar("yt-dlp"), path.join(root, ".runtime", "yt-dlp.exe"));
    writeFileSync(path.join(root, "yt-dlp.exe"), "");
    writeFileSync(path.join(root, "ffmpeg.exe"), "");
    assert.equal(sidecar("yt-dlp"), path.join(root, "yt-dlp.exe"));
    assert.equal(sidecar("ffmpeg", ["ffmpeg", "bin"]), path.join(root, "ffmpeg.exe"));
    assert.equal(firstExisting([path.join(root, "missing.exe"), path.join(root, "yt-dlp.exe")]), path.join(root, "yt-dlp.exe"));
  } finally {
    if (previous === undefined) delete process.env.APP_ROOT;
    else process.env.APP_ROOT = previous;
    rmSync(root, { recursive: true, force: true });
  }
});

test("nodeRuntime keeps the current Node process unless a colocated node.exe exists", () => {
  assert.equal(nodeRuntime(), process.execPath);
});
