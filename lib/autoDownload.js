const { detectPlatform, domains, normalizeMedia } = require("../web/media");
const { validateUrl } = require("./validateUrl");
const { isDownloadResult } = require("./providerResponse");
const { DownloadError } = require("./downloadError");
const { parseSavePath, saveSelected } = require("./saveMedia");

const UNRECOGNIZED =
  "Could not recognize this source. Use a supported public link, or call /api/{platform}/download directly.";
const INVALID_KIND =
  "The 'kind' query parameter must be a single value: video, audio, photo, or all.";
const KINDS = new Set(["video", "audio", "photo", "all"]);
const AUDIO_HINT = /audio|mp3|m4a|aac|ogg|opus|wav|flac/i;
const PHOTO_HINT = /photo|image|jpg|jpeg|png|webp|gif|avif|heic|heif/i;
const VIDEO_HINT = /video|mp4|m4v|mov|webm|mkv|avi|watermark|\bhd\b|\bpreview\b/i;

const defaultFetchers = {
  bluesky: require("../services/blueskyService").fetchBlueskyMedia,
  capcut: require("../services/capcutService").fetchCapcutData,
  dailymotion: require("../services/dailymotionService").fetchDailymotionData,
  douyin: require("../services/douyinService").fetchDouyinVideoInfo,
  meta: require("../services/facebookInstaService"),
  kuaishou: require("../services/kuaishouService").scrapeKuaishou,
  linkedin: require("../services/linkedinService").fetchLinkedinData,
  pinterest: require("../services/pinterestService").fetchPinterestMedia,
  reddit: require("../services/redditService"),
  snapchat: require("../services/snapchatService").fetchSnapchat,
  soundcloud: require("../services/soundcloudService").fetchSoundcloudData,
  spotify: require("../services/spotifyService").fetchSpotify,
  terabox: require("../services/teraboxService").fetchTerabox,
  threads: require("../services/threadsService"),
  tiktok: require("../services/tiktokService").fetchTikTokData,
  tumblr: require("../services/tumblrService").fetchTumblrData,
  twitter: require("../services/twitterService").twitterDownloader,
  youtube: require("../services/youtubeService").fetchYouTubeData,
};

function parseKind(value) {
  if (value === undefined || value === null || value === "") return "video";
  if (typeof value !== "string" || !KINDS.has(value.trim().toLowerCase())) {
    throw new Error(INVALID_KIND);
  }
  return value.trim().toLowerCase();
}

function resolvedKind(item) {
  if (item.kind === "video" || item.kind === "audio" || item.kind === "photo") return item.kind;
  const hint = `${item.label || ""} ${item.format || ""} ${item.url || ""}`;
  const looksVideo = VIDEO_HINT.test(hint);
  if (AUDIO_HINT.test(hint) && !looksVideo) return "audio";
  if (PHOTO_HINT.test(hint) && !looksVideo) return "photo";
  return "video";
}

function selectItems(items, kind) {
  const tagged = items.map((item) => ({ ...item, kind: resolvedKind(item) }));
  if (kind === "all") return tagged;
  return tagged.filter((item) => item.kind === kind);
}

function isTimeout(error) {
  const seen = new Set();
  while (error && typeof error === "object" && !seen.has(error)) {
    seen.add(error);
    if (
      ["ECONNABORTED", "ETIMEDOUT", "UND_ERR_CONNECT_TIMEOUT"].includes(error.code) ||
      error.name === "TimeoutError"
    ) {
      return true;
    }
    error = error.cause;
  }
  return false;
}

function fail(message, statusCode, code, platform) {
  const error = new DownloadError(message, statusCode, code);
  if (platform) error.platform = platform;
  return error;
}

function toDownloadError(error, platform) {
  if (error instanceof DownloadError) {
    if (platform && !error.platform) error.platform = platform;
    return error;
  }
  if (isTimeout(error)) {
    return fail("The media provider timed out. Please try again.", 504, "ETIMEDOUT", platform);
  }
  return fail("Unable to fetch media from the provider. Please try again later.", 502, "UPSTREAM_ERROR", platform);
}

function createDownloader(fetchers = defaultFetchers, { save = saveSelected } = {}) {
  const missing = Object.keys(domains).filter((platform) => typeof fetchers[platform] !== "function");
  if (missing.length) throw new Error(`Downloader is missing fetchers: ${missing.join(", ")}`);

  return async function downloadMedia(url, { kind, platform, signal, savePath } = {}) {
    const source = validateUrl(url);
    const selectedKind = parseKind(kind);
    const resolved = platform || detectPlatform(source);
    if (!resolved) throw fail(UNRECOGNIZED, 400, "UNRECOGNIZED_PLATFORM");
    const fetch = fetchers[resolved];
    if (typeof fetch !== "function") throw fail(UNRECOGNIZED, 400, "UNRECOGNIZED_PLATFORM");
    const destination = parseSavePath(savePath);

    let data;
    try {
      data = await fetch(source, { signal });
    } catch (error) {
      throw toDownloadError(error, resolved);
    }
    if (!isDownloadResult(data, source)) {
      throw fail("Unable to fetch media from the provider. Please try again later.", 502, "UPSTREAM_ERROR", resolved);
    }

    const media = normalizeMedia(data, source);
    const items = selectItems(media.items, selectedKind);
    if (selectedKind !== "all" && items.length === 0) {
      throw fail(`No ${selectedKind} was available at this link.`, 422, "NO_KIND", resolved);
    }

    let saved;
    if (destination) {
      try {
        saved = await save({
          source, platform: resolved, kind: selectedKind, items,
          title: media.title, savePath: destination, signal,
        });
      } catch (error) {
        throw toDownloadError(error, resolved);
      }
    }

    return {
      success: true,
      platform: resolved,
      kind: selectedKind,
      title: media.title || null,
      thumbnail: media.thumbnail,
      items: saved ? items.map((item, index) => ({ ...item, saved: saved[index] || saved[0] })) : items,
      saved,
      data,
    };
  };
}

const downloadMedia = createDownloader();

function detect(url) {
  const source = validateUrl(url);
  const platform = detectPlatform(source);
  if (!platform) throw fail(UNRECOGNIZED, 400, "UNRECOGNIZED_PLATFORM");
  return { success: true, platform };
}

module.exports = {
  createDownloader,
  downloadMedia,
  detect,
  parseKind,
  selectItems,
  UNRECOGNIZED,
  INVALID_KIND,
  defaultFetchers,
  parseSavePath,
};
