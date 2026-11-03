const assert = require("node:assert/strict");
const { test } = require("node:test");
const { createDownloader, detect, UNRECOGNIZED, INVALID_KIND } = require("../lib/autoDownload");
const { parseCli, run } = require("../cli");
const { domains } = require("../web/media");

function fetchers(calls, result) {
  const next = {};
  for (const platform of Object.keys(domains)) {
    next[platform] = async (url) => {
      calls.push({ platform, url });
      return result;
    };
  }
  return next;
}

test("core downloader auto-detects and defaults to video items", async () => {
  const calls = [];
  const download = createDownloader(fetchers(calls, {
    title: "Example",
    downloads: [
      { text: "Without watermark", url: "https://cdn.example/video.mp4", type: "video" },
      { text: "Download MP3", url: "https://cdn.example/audio.mp3", type: "audio" },
    ],
  }));
  const result = await download("https://www.tiktok.com/@user/video/1");
  assert.equal(result.success, true);
  assert.equal(result.platform, "tiktok");
  assert.equal(result.kind, "video");
  assert.deepEqual(result.items.map((item) => item.url), ["https://cdn.example/video.mp4"]);
  assert.deepEqual(calls.map((call) => call.platform), ["tiktok"]);
});

test("core downloader can pin a platform", async () => {
  const download = createDownloader(fetchers([], {
    videos: [{ url: "https://cdn.example/video.mp4", quality: "720p" }],
  }));
  const result = await download("https://bsky.app/profile/user/post/1", { platform: "bluesky" });
  assert.equal(result.platform, "bluesky");
  assert.equal(result.items[0].kind, "video");
});

test("detect and kind validation stay shared with the HTTP API", () => {
  assert.deepEqual(detect("https://youtu.be/123"), { success: true, platform: "youtube" });
  assert.throws(() => detect("https://example.com/video"), (error) => error.publicMessage === UNRECOGNIZED);
  assert.throws(() => require("../lib/autoDownload").parseKind("clip"), (error) => error.message === INVALID_KIND);
});

test("CLI parses downloader, platform, and a bare URL", () => {
  assert.deepEqual(parseCli(["downloader", "https://www.tiktok.com/@u/video/1"]), {
    command: "downloader",
    url: "https://www.tiktok.com/@u/video/1",
    kind: "video",
    urlOnly: false,
    savePath: undefined,
  });
  assert.deepEqual(parseCli(["bluesky", "https://bsky.app/profile/u/post/1", "--kind", "all", "--save-path", "D:\\\\videos"]), {
    command: "bluesky",
    url: "https://bsky.app/profile/u/post/1",
    kind: "all",
    urlOnly: false,
    savePath: "D:\\\\videos",
  });
  assert.equal(parseCli(["https://youtu.be/123"]).command, "downloader");
  assert.equal(parseCli(["ig", "https://www.instagram.com/p/abc/"]).command, "meta");
  assert.equal(parseCli(["--help"]).help, true);
});

test("CLI run prints JSON or a single URL without starting the HTTP server", async () => {
  const help = await run(["--help"]);
  assert.equal(help.status, 0);
  assert.match(help.output, /universal bluesky/);

  const detected = await run(["detect", "https://www.tiktok.com/@u/video/1"]);
  assert.equal(detected.status, 0);
  assert.deepEqual(JSON.parse(detected.output), { success: true, platform: "tiktok" });

  const unknown = await run(["downloader", "https://example.com/video"]);
  assert.equal(unknown.status, 2);
  assert.deepEqual(JSON.parse(unknown.output), {
    success: false,
    error: UNRECOGNIZED,
  });

  const mismatch = await run(["bluesky", "https://www.tiktok.com/@u/video/1"]);
  assert.equal(mismatch.status, 2);
  assert.deepEqual(JSON.parse(mismatch.output), {
    success: false,
    platform: "tiktok",
    error: "That link looks like tiktok, not bluesky.",
  });
});

test("save_path writes HTTP media through the injected saver", async () => {
  const saved = [];
  const { createDownloader } = require("../lib/autoDownload");
  const download = createDownloader(fetchers([], {
    title: "Example",
    downloads: [{ text: "Without watermark", url: "https://cdn.example/video.mp4", type: "video" }],
  }), {
    save: async (options) => {
      saved.push(options.savePath);
      return ["D:\\\\videos\\\\Example.mp4"];
    },
  });
  const result = await download("https://www.tiktok.com/@u/video/1", { savePath: "D:\\\\videos" });
  assert.deepEqual(result.saved, ["D:\\\\videos\\\\Example.mp4"]);
  assert.equal(result.items[0].saved, "D:\\\\videos\\\\Example.mp4");
  assert.equal(saved.length, 1);
});

test("CLI failures from a known platform return JSON with that platform", async () => {
  const original = require.cache[require.resolve("../lib/autoDownload")];
  const { createDownloader } = require("../lib/autoDownload");
  const download = createDownloader({
    ...Object.fromEntries(Object.keys(domains).map((name) => [name, async () => { throw new Error("provider down"); }])),
  });
  await assert.rejects(() => download("https://www.tiktok.com/@u/video/1"), (error) => {
    assert.equal(error.platform, "tiktok");
    assert.equal(error.statusCode, 502);
    return true;
  });
  assert.equal(original.id, require.resolve("../lib/autoDownload"));
});
