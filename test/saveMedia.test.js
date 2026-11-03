const assert = require("node:assert/strict");
const { mkdir, mkdtemp, writeFile, rm } = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const { parseSavePath, resolveDestination, saveSelected, ytDlpExtractor, INVALID_SAVE_PATH } = require("../lib/saveMedia");

test("save_path is required to be a local path", () => {
  assert.equal(parseSavePath(undefined), null);
  assert.equal(parseSavePath(""), null);
  assert.ok(path.isAbsolute(parseSavePath("videos")));
  assert.throws(() => parseSavePath("x".repeat(5000)), (error) => error.message === INVALID_SAVE_PATH);
});

test("YouTube and Instagram tickets are saved with yt-dlp, HTTP links are fetched", async () => {
  assert.equal(ytDlpExtractor("youtube", "https://youtu.be/123"), "youtube");
  assert.equal(ytDlpExtractor("meta", "https://www.instagram.com/p/abc/"), "Instagram");
  assert.equal(ytDlpExtractor("tiktok", "https://www.tiktok.com/@u/video/1"), null);

  const root = await mkdtemp(path.join(os.tmpdir(), "ud-save-"));
  try {
    const folder = path.join(root, "out");
    const youtube = await saveSelected({
      source: "https://www.youtube.com/watch?v=jNQXAC9IVRw",
      platform: "youtube",
      kind: "video",
      title: "Me at the zoo",
      items: [{ url: "/api/files/11111111-1111-4111-8111-111111111111", kind: "video", format: "mp4" }],
      savePath: folder,
      saveExtractor: async ({ destination }) => destination,
    });
    assert.equal(path.basename(youtube[0]), "Me at the zoo.mp4");

    const written = [];
    const tiktok = await saveSelected({
      source: "https://www.tiktok.com/@u/video/1",
      platform: "tiktok",
      kind: "video",
      title: "Clip",
      items: [{ url: "https://cdn.example/video.mp4", kind: "video" }],
      savePath: folder,
      saveHttpFile: async (url, destination) => {
        written.push({ url, destination });
        await mkdir(path.dirname(destination), { recursive: true });
        await writeFile(destination, "ok");
        return destination;
      },
    });
    assert.equal(written[0].url, "https://cdn.example/video.mp4");
    assert.equal(path.basename(tiktok[0]), "Clip.mp4");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("empty HTTP save is rejected", async () => {
  const http = require("node:http");
  const { saveHttp } = require("../lib/saveMedia");
  const server = http.createServer((_, res) => {
    res.writeHead(204);
    res.end();
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  const root = await mkdtemp(path.join(os.tmpdir(), "ud-empty-"));
  try {
    await assert.rejects(
      saveHttp(`http://127.0.0.1:${port}/empty.mp4`, path.join(root, "empty.mp4")),
      (error) => /empty file|HTTP 204/.test(error.message),
    );
  } finally {
    server.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("a file save_path keeps the requested name", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ud-file-"));
  try {
    const file = path.join(root, "zoo.mp4");
    const destination = await resolveDestination(file, {
      title: "Me at the zoo",
      item: { url: "https://cdn.example/video.mp4", format: "mp4" },
      kind: "video",
      index: 0,
      count: 1,
    });
    assert.equal(destination, file);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
