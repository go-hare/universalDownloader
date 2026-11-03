const assert = require("node:assert/strict");
const { once } = require("node:events");
const { after, before, test } = require("node:test");
const { createAutoDownloadHandler, handleDetectPlatform, UNRECOGNIZED, INVALID_KIND } = require("../controllers/autoController");
const { domains } = require("../web/media");
const app = require("../index");

function response() {
  return {
    statusCode: 200,
    body: undefined,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

function handlers(calls, result = { downloads: [{ url: "https://media.example/video.mp4" }] }) {
  const next = {};
  for (const platform of Object.keys(domains)) {
    next[platform] = async (req, res) => {
      calls.push({ platform, url: req.query.url });
      return res.json({ success: true, data: result });
    };
  }
  return next;
}

test("auto download requires a valid public URL before detecting a platform", async () => {
  const calls = [];
  const handler = createAutoDownloadHandler(handlers(calls));
  for (const query of [{}, { url: [] }, { url: "not-a-url" }]) {
    const res = response();
    await handler({ query }, res);
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.success, false);
    assert.equal(res.body.platform, undefined);
  }
  assert.deepEqual(calls, []);
});

test("auto download rejects unrecognized hosts without calling a provider", async () => {
  const calls = [];
  const res = response();
  await createAutoDownloadHandler(handlers(calls))({ query: { url: "https://example.com/video" } }, res);
  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.body, { success: false, error: UNRECOGNIZED });
  assert.deepEqual(calls, []);
});

test("auto download routes known hosts to the matching platform handler", async () => {
  const calls = [];
  const handler = createAutoDownloadHandler(handlers(calls));
  const samples = [
    ["https://youtu.be/123", "youtube"],
    ["https://www.instagram.com/p/aye83DjauH/", "meta"],
    ["https://www.facebook.com/watch?v=123", "meta"],
    ["https://vm.tiktok.com/abc", "tiktok"],
    ["https://x.com/user/status/123", "twitter"],
    ["https://www.threads.net/@user/post/123", "threads"],
    ["https://bsky.app/profile/user/post/123", "bluesky"],
  ];
  for (const [url, platform] of samples) {
    const res = response();
    await handler({ query: { url } }, res);
    assert.equal(res.statusCode, 200, url);
    assert.equal(res.body.success, true, url);
    assert.equal(res.body.platform, platform, url);
    assert.equal(res.body.kind, "video", url);
    assert.deepEqual(res.body.data, { downloads: [{ url: "https://media.example/video.mp4" }] });
    assert.equal(res.body.items.length, 1);
    assert.equal(res.body.items[0].url, "https://media.example/video.mp4");
    assert.equal(res.body.items[0].kind, "video");
  }
  assert.deepEqual(calls.map((call) => call.platform), samples.map((sample) => sample[1]));
});

test("auto download keeps provider errors and still reports the detected platform", async () => {
  const next = handlers([]);
  next.youtube = async (_req, res) => res.status(502).json({ success: false, error: "Unable to fetch media from the provider. Please try again later." });
  const res = response();
  await createAutoDownloadHandler(next)({ query: { url: "https://www.youtube.com/watch?v=123" } }, res);
  assert.equal(res.statusCode, 502);
  assert.deepEqual(res.body, {
    success: false,
    platform: "youtube",
    error: "Unable to fetch media from the provider. Please try again later.",
  });
});

test("auto download defaults to video links and can return other kinds", async () => {
  const mixed = {
    title: "Example",
    thumbnail: "https://cdn.example/cover.jpg",
    downloads: [
      { text: "Without watermark", url: "https://cdn.example/video.mp4", type: "video" },
      { text: "Download MP3", url: "https://cdn.example/audio.mp3", type: "audio" },
      { text: "Photo", url: "https://cdn.example/photo.jpg", type: "photo" },
    ],
  };
  const handler = createAutoDownloadHandler(handlers([], mixed));

  const video = response();
  await handler({ query: { url: "https://www.tiktok.com/@user/video/1" } }, video);
  assert.equal(video.statusCode, 200);
  assert.equal(video.body.kind, "video");
  assert.deepEqual(video.body.items.map((item) => item.url), ["https://cdn.example/video.mp4"]);
  assert.equal(video.body.items[0].kind, "video");
  assert.equal(video.body.data.downloads.length, 3);

  const audio = response();
  await handler({ query: { url: "https://www.tiktok.com/@user/video/1", kind: "audio" } }, audio);
  assert.deepEqual(audio.body.items.map((item) => item.kind), ["audio"]);

  const all = response();
  await handler({ query: { url: "https://www.tiktok.com/@user/video/1", kind: "all" } }, all);
  assert.equal(all.body.items.length, 3);
});

test("auto download rejects an invalid kind and reports when no video exists", async () => {
  const handler = createAutoDownloadHandler(handlers([], {
    downloads: [{ text: "Download MP3", url: "https://cdn.example/audio.mp3", type: "audio" }],
  }));
  const invalid = response();
  await handler({ query: { url: "https://www.tiktok.com/@user/video/1", kind: "clip" } }, invalid);
  assert.equal(invalid.statusCode, 400);
  assert.deepEqual(invalid.body, { success: false, error: INVALID_KIND });

  const empty = response();
  await handler({ query: { url: "https://www.tiktok.com/@user/video/1" } }, empty);
  assert.equal(empty.statusCode, 422);
  assert.equal(empty.body.success, false);
  assert.equal(empty.body.platform, "tiktok");
  assert.match(empty.body.error, /No video/);
});

test("detect reports the platform without downloading", async () => {
  const res = response();
  await handleDetectPlatform({ query: { url: " https://m.youtube.com/watch?v=123 " } }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { success: true, platform: "youtube" });
});

test("detect rejects unrecognized and invalid URLs", async () => {
  const unknown = response();
  await handleDetectPlatform({ query: { url: "https://example.com/video" } }, unknown);
  assert.equal(unknown.statusCode, 400);
  assert.deepEqual(unknown.body, { success: false, error: UNRECOGNIZED });

  const missing = response();
  await handleDetectPlatform({ query: {} }, missing);
  assert.equal(missing.statusCode, 400);
  assert.equal(missing.body.success, false);
});

let server;
let baseUrl;

before(async () => {
  server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(() => new Promise((resolve) => server.close(resolve)));

test("HTTP auto routes validate, detect, and leave platform downloads unchanged", async () => {
  const missing = await fetch(`${baseUrl}/api/download`);
  assert.equal(missing.status, 400);
  assert.equal((await missing.json()).success, false);

  const unknown = await fetch(`${baseUrl}/api/download?url=${encodeURIComponent("https://example.com/video")}`);
  assert.equal(unknown.status, 400);
  assert.deepEqual(await unknown.json(), { success: false, error: UNRECOGNIZED });

  const detected = await fetch(`${baseUrl}/api/detect?url=${encodeURIComponent("https://www.instagram.com/p/aye83DjauH/")}`);
  assert.equal(detected.status, 200);
  assert.deepEqual(await detected.json(), { success: true, platform: "meta" });

  const lookalike = await fetch(`${baseUrl}/api/detect?url=${encodeURIComponent("https://notyoutube.com/123")}`);
  assert.equal(lookalike.status, 400);

  const directory = await fetch(baseUrl);
  const body = await directory.json();
  assert.equal(body.auto, "/api/download");
  assert.equal(body.detect, "/api/detect");
  assert.equal(body.endpoints.length, 18);
});
