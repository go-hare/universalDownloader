const { createWriteStream, existsSync } = require("node:fs");
const { mkdir, stat } = require("node:fs/promises");
const path = require("node:path");
const { pipeline } = require("node:stream/promises");
const axios = require("axios");
const { DownloadError } = require("./downloadError");
const { detectPlatform } = require("../web/media");
const { nodeRuntime } = require("./appRoot");
const { runtimePath } = require("./ytDlp");
const { runChild, runtimePaths } = require("./youtubeMerge");

const INVALID_SAVE_PATH =
  "The 'save_path' parameter must be a local folder or file path (maximum 4096 characters).";
const LOCAL_TICKET = /^\/api\/files\/[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
const MEDIA_EXT = /^(?:mp4|m4v|mov|webm|mkv|avi|mp3|m4a|aac|ogg|opus|wav|flac|jpg|jpeg|png|webp|gif|avif|heic|heif)$/i;
const MAX_HTTP_BYTES = 512 * 1024 * 1024;

function fail(message, statusCode = 400, code = "INVALID_SAVE_PATH") {
  return new DownloadError(message, statusCode, code);
}

function sanitizeName(value, fallback = "download") {
  const cleaned = String(value || "")
    .replace(/[<>:"/\\|?*]/g, "_")
    .replace(/[\u0000-\u001f\u007f]/g, "_")
    .replace(/[. ]+$/g, "")
    .slice(0, 120);
  return cleaned || fallback;
}
function extensionFor(item, kind) {
  if (item?.format && MEDIA_EXT.test(item.format)) return item.format.toLowerCase();
  const fromUrl = String(item?.url || "").match(/\.([a-z0-9]{2,5})(?:[?#]|$)/i)?.[1];
  if (fromUrl && MEDIA_EXT.test(fromUrl)) return fromUrl.toLowerCase();
  if (kind === "audio") return "m4a";
  if (kind === "photo") return "jpg";
  return "mp4";
}

function parseSavePath(value) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || value.length > 4096 || value.includes("\0")) {
    throw fail(INVALID_SAVE_PATH);
  }
  const trimmed = value.trim();
  if (!trimmed) throw fail(INVALID_SAVE_PATH);
  return path.resolve(trimmed);
}

async function resolveDestination(savePath, { title, item, kind, index, count, original } = {}) {
  const resolved = parseSavePath(savePath);
  const source = String(original || savePath || "");
  let asDirectory = /[\\/]$/.test(source.trim());
  const extName = path.extname(resolved).slice(1);
  if (extName && MEDIA_EXT.test(extName) && !asDirectory) asDirectory = false;
  else if (!asDirectory) asDirectory = true;
  try {
    const info = await stat(resolved);
    asDirectory = info.isDirectory();
  } catch (error) {
    if (error.code !== "ENOENT") throw fail(INVALID_SAVE_PATH);
  }

  const ext = extensionFor(item, kind);
  const stem = sanitizeName(title || path.basename(resolved, path.extname(resolved)), "download");
  const filename = count > 1 ? `${stem}-${index + 1}.${ext}` : `${stem}.${ext}`;

  if (asDirectory) {
    await mkdir(resolved, { recursive: true });
    return path.join(resolved, filename);
  }

  const directory = path.dirname(resolved);
  await mkdir(directory, { recursive: true });
  if (count > 1) return path.join(directory, filename);
  const currentExt = path.extname(resolved).slice(1);
  if (currentExt && MEDIA_EXT.test(currentExt)) return resolved;
  return `${resolved}.${ext}`;
}

function ytDlpExtractor(platform, sourceUrl) {
  if (platform === "youtube") return "youtube";
  if (platform === "meta" && detectPlatform(sourceUrl) === "meta" && /instagram\.com$/i.test(new URL(sourceUrl).hostname.replace(/^www\./, ""))) {
    return "Instagram";
  }
  if (platform === "meta") {
    const host = new URL(sourceUrl).hostname.toLowerCase().replace(/\.$/, "");
    if (host === "instagram.com" || host.endsWith(".instagram.com")) return "Instagram";
  }
  return null;
}

function ytDlpFormat(kind) {
  if (kind === "audio") return "ba[protocol=https]/bestaudio/best";
  if (kind === "photo") return "best";
  return "bv*[protocol=https]+ba[protocol=https]/b[protocol=https]/best";
}

async function saveWithYtDlp({ source, platform, kind, destination, signal }) {
  const extractor = ytDlpExtractor(platform, source);
  const executable = runtimePath();
  if (!extractor) return null;
  if (!executable || !existsSync(executable)) {
    throw fail("The local downloader is missing. Place yt-dlp.exe next to universal.exe, then try again.", 503, "DOWNLOADER_MISSING");
  }
  const paths = runtimePaths();
  const output = destination.replace(/%/g, "_");
  const args = [
    "--ignore-config", "--no-plugin-dirs", "--no-playlist", "--no-cache-dir",
    "--no-warnings", "--no-progress", "--newline",
    "--retries", "3", "--fragment-retries", "3",
    "--no-js-runtimes", "--js-runtimes", `node:${nodeRuntime()}`,
    "--use-extractors", extractor,
    "--format", ytDlpFormat(kind),
    "--output", output,
    "--print", "after_move:%(filepath)s",
    "--print", "after_video:%(filepath)s",
    "--", source,
  ];
  if (paths.ffmpeg && existsSync(paths.ffmpeg)) {
    args.splice(args.indexOf("--output"), 0, "--ffmpeg-location", path.dirname(paths.ffmpeg), "--merge-output-format", kind === "audio" ? "m4a" : "mp4");
  }
  const printed = await runChild(executable, args, { signal, timeoutMs: 30 * 60 * 1000, maxOutputBytes: 64 * 1024 });
  const lines = printed.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const saved = lines.find((line) => path.isAbsolute(line) && existsSync(line)) || (existsSync(output) ? output : null);
  if (!saved) throw fail("The downloader finished without writing a file. Try another public link.", 502, "SAVE_FAILED");
  return saved;
}

async function saveHttp(url, destination, { signal } = {}) {
  const client = axios.create({
    timeout: 5 * 60 * 1000,
    maxContentLength: MAX_HTTP_BYTES,
    maxBodyLength: MAX_HTTP_BYTES,
    maxRedirects: 5,
    responseType: "stream",
    decompress: false,
  });
  const response = await client.get(url, {
    signal,
    headers: {
      "user-agent": "Mozilla/5.0",
      referer: "https://ssstik.io/",
      accept: "*/*",
    },
    validateStatus: () => true,
  });
  const status = response.status;
  if (status < 200 || status >= 300) {
    throw fail(`The media provider returned HTTP ${status}.`, 502, "SAVE_FAILED");
  }
  await pipeline(response.data, createWriteStream(destination));
  const info = await stat(destination);
  if (!info.size) {
    throw fail("The media provider returned an empty file.", 502, "SAVE_FAILED");
  }
  return destination;
}

async function saveSelected({ source, platform, kind, items, title, savePath, signal, saveHttpFile = saveHttp, saveExtractor = saveWithYtDlp }) {
  const selected = items.filter((item) => item?.url);
  if (!selected.length) throw fail(`No ${kind} was available at this link.`, 422, "NO_KIND");

  const extractor = ytDlpExtractor(platform, source);
  if (extractor || selected.every((item) => LOCAL_TICKET.test(item.url))) {
    const destination = await resolveDestination(savePath, { title, item: selected[0], kind, index: 0, count: 1 });
    const saved = await saveExtractor({ source, platform, kind, destination, signal });
    return [saved];
  }

  const saved = [];
  for (const [index, item] of selected.entries()) {
    if (!/^https?:\/\//i.test(item.url)) {
      throw fail("This platform did not return a downloadable file URL.", 502, "SAVE_FAILED");
    }
    const destination = await resolveDestination(savePath, { title, item, kind, index, count: selected.length });
    saved.push(await saveHttpFile(item.url, destination, { signal }));
  }
  return saved;
}

module.exports = {
  parseSavePath,
  resolveDestination,
  saveSelected,
  saveWithYtDlp,
  saveHttp,
  ytDlpExtractor,
  INVALID_SAVE_PATH,
};
