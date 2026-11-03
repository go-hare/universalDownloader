const { detectPlatform, domains, normalizeMedia } = require("../web/media");
const { validateUrl } = require("../lib/validateUrl");
const { parseKind, selectItems, detect, parseSavePath, UNRECOGNIZED, INVALID_KIND } = require("../lib/autoDownload");
const { saveSelected } = require("../lib/saveMedia");
const { DownloadError } = require("../lib/downloadError");

const defaultHandlers = {
  bluesky: require("./blueskyController").handleBlueskyDownload,
  capcut: require("./capcutController").handleCapcutDownload,
  dailymotion: require("./dailymotionController").handleDailymotionDownload,
  douyin: require("./douyinController").handleDouyinDownload,
  meta: require("./facebookInstaController").handleFacebookInstaDownload,
  kuaishou: require("./kuaishouController").handleKuaishouDownload,
  linkedin: require("./linkedinController").handleLinkedinDownload,
  pinterest: require("./pinterestController").handlePinterestDownload,
  reddit: require("./redditController").handleRedditDownload,
  snapchat: require("./snapchatController").handleSnapchat,
  soundcloud: require("./soundcloudController").handleSoundcloudDownload,
  spotify: require("./spotifyController").handleSpotifyDownload,
  terabox: require("./TeraboxController").handleTeraboxDownload,
  threads: require("./threadsController").handleThreadsDownload,
  tiktok: require("./tiktokController").handleTikTokDownload,
  tumblr: require("./tumblrController").handleTumblrDownload,
  twitter: require("./twitterController").handleTwitterDownload,
  youtube: require("./youtubeController").handleYouTubeDownload,
};

function sendError(res, status, error) {
  return res.status(status).json({ success: false, error });
}

function attachResult(res, platform, sourceUrl, kind, savePath) {
  const json = res.json.bind(res);
  res.json = (body) => {
    if (body && typeof body === "object" && !Array.isArray(body)) {
      const { success, ...rest } = body;
      if (success === true && Object.hasOwn(rest, "data")) {
        const media = normalizeMedia(rest.data, sourceUrl);
        const items = selectItems(media.items, kind);
        if (kind !== "all" && items.length === 0) {
          return res.status(422).json({
            success: false,
            platform,
            error: `No ${kind} was available at this link.`,
          });
        }
        const finish = (saved) => json({
          success: true,
          platform,
          kind,
          title: media.title || null,
          thumbnail: media.thumbnail,
          items: saved ? items.map((item, index) => ({ ...item, saved: saved[index] || saved[0] })) : items,
          saved,
          data: rest.data,
        });
        if (!savePath) return finish();
        return saveSelected({
          source: sourceUrl, platform, kind, items, title: media.title, savePath,
        }).then(finish).catch((error) => {
          const status = error instanceof DownloadError ? error.statusCode : 502;
          const message = error instanceof DownloadError ? error.publicMessage : "Unable to save the media file.";
          return res.status(status).json({ success: false, platform, error: message });
        });
      }
      return json({
        ...(success !== undefined ? { success } : {}),
        platform,
        ...rest,
      });
    }
    return json(body);
  };
}

function createAutoDownloadHandler(handlers = defaultHandlers) {
  const missing = Object.keys(domains).filter((platform) => typeof handlers[platform] !== "function");
  if (missing.length) throw new Error(`Auto download is missing handlers: ${missing.join(", ")}`);

  return async function handleAutoDownload(req, res) {
    let url;
    let kind;
    let savePath;
    try {
      url = validateUrl(req.query?.url);
      kind = parseKind(req.query?.kind);
      savePath = parseSavePath(req.query?.save_path || req.query?.savePath);
    } catch (error) {
      return sendError(res, 400, error.message);
    }

    const platform = detectPlatform(url);
    if (!platform) return sendError(res, 400, UNRECOGNIZED);

    attachResult(res, platform, url, kind, savePath);
    return handlers[platform](req, res);
  };
}

async function handleDetectPlatform(req, res) {
  try {
    return res.json(detect(req.query?.url));
  } catch (error) {
    const status = error instanceof DownloadError ? error.statusCode : 400;
    const message = error instanceof DownloadError ? error.publicMessage : error.message;
    return sendError(res, status, message);
  }
}

module.exports = {
  handleAutoDownload: createAutoDownloadHandler(),
  handleDetectPlatform,
  createAutoDownloadHandler,
  parseKind,
  selectItems,
  UNRECOGNIZED,
  INVALID_KIND,
};
