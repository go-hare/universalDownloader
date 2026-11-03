#!/usr/bin/env node
const path = require("node:path");
const { detectPlatform, domains } = require("./web/media");
const { downloadMedia, detect, parseKind, UNRECOGNIZED, INVALID_KIND } = require("./lib/autoDownload");
const { DownloadError } = require("./lib/downloadError");
const { packedBinary } = require("./lib/appRoot");

const COMMANDS = new Set(["downloader", "download", "auto", "detect", ...Object.keys(domains)]);
const ALIASES = {
  ig: "meta",
  instagram: "meta",
  facebook: "meta",
  fb: "meta",
  x: "twitter",
  yt: "youtube",
};

function usage(name) {
  const platforms = Object.keys(domains).join(" | ");
  return `Usage:
  ${name} downloader <url> [--kind video|audio|photo|all] [--save-path <path>] [--url-only]
  ${name} detect <url>
  ${name} <platform> <url> [--kind video|audio|photo|all] [--save-path <path>] [--url-only]

Platforms:
  ${platforms}

Examples:
  ${name} downloader https://www.tiktok.com/@user/video/123 --save-path D:\\videos
  ${name} bluesky https://bsky.app/profile/user/post/123
  ${name} youtube https://youtu.be/dQw4w9WgXcQ --save-path zoo.mp4
`;
}

function userArgs(argv = process.argv) {
  const args = argv.slice(1);
  const exe = path.resolve(process.execPath);
  while (args[0]) {
    const first = args[0];
    const resolved = path.resolve(first);
    const base = path.basename(first).toLowerCase();
    if (resolved === exe || base === "cli.js" || base === "universal" || base === "universal.exe") args.shift();
    else break;
  }
  return args;
}

function parseCli(argv) {
  const args = [];
  const flags = { kind: "video", urlOnly: false, help: false, savePath: undefined };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "-h" || arg === "--help") flags.help = true;
    else if (arg === "--url-only") flags.urlOnly = true;
    else if (arg === "--kind" || arg === "-k") flags.kind = argv[++i];
    else if (arg.startsWith("--kind=")) flags.kind = arg.slice("--kind=".length);
    else if (arg === "--save-path" || arg === "--save_path" || arg === "-o") flags.savePath = argv[++i];
    else if (arg.startsWith("--save-path=")) flags.savePath = arg.slice("--save-path=".length);
    else if (arg.startsWith("--save_path=")) flags.savePath = arg.slice("--save_path=".length);
    else args.push(arg);
  }

  if (flags.help || args.length === 0) return { help: true };

  let command = args[0];
  let url = args[1];
  if (/^https?:\/\//i.test(command) && !url) {
    url = command;
    command = "downloader";
  }
  command = ALIASES[command] || command;
  if (!COMMANDS.has(command) || !url || args.length > 2) return { error: usage("universal") };

  return { command, url, kind: flags.kind, urlOnly: flags.urlOnly, savePath: flags.savePath };
}

function failJson(status, error, extra = {}) {
  const body = { success: false };
  if (extra.platform) body.platform = extra.platform;
  body.error = error;
  return { status, output: JSON.stringify(body, null, 2) + "\n" };
}

async function run(argv = userArgs()) {
  const parsed = parseCli(argv);
  const name = packedBinary() ? path.basename(process.execPath, path.extname(process.execPath)) : "universal";
  if (parsed.help) return { status: 0, output: usage(name) };
  if (parsed.error) return { status: 1, output: parsed.error };

  try {
    if (parsed.command === "detect") {
      return { status: 0, output: JSON.stringify(detect(parsed.url), null, 2) + "\n" };
    }
    const platform = parsed.command === "downloader" || parsed.command === "download" || parsed.command === "auto"
      ? undefined
      : parsed.command;
    if (platform && detectPlatform(parsed.url) && detectPlatform(parsed.url) !== platform) {
      const actual = detectPlatform(parsed.url);
      return failJson(2, `That link looks like ${actual}, not ${platform}.`, { platform: actual });
    }
    const result = await downloadMedia(parsed.url, { kind: parseKind(parsed.kind), platform, savePath: parsed.savePath });
    if (parsed.urlOnly) {
      const urls = result.items.map((item) => item.url).filter(Boolean);
      if (!urls.length) return failJson(3, `No ${result.kind} was available at this link.`, { platform: result.platform });
      return { status: 0, output: urls.join("\n") + "\n" };
    }
    const { data: _data, ...publicResult } = result;
    return { status: 0, output: JSON.stringify(publicResult, null, 2) + "\n" };
  } catch (error) {
    const message = error instanceof DownloadError ? error.publicMessage : error.message;
    const status = error instanceof DownloadError && error.statusCode === 400
      ? (message === INVALID_KIND ? 1 : 2)
      : 3;
    return failJson(status, message, {
      platform: error instanceof DownloadError ? error.platform : undefined,
    });
  }
}

module.exports = { parseCli, userArgs, run, usage, COMMANDS, ALIASES };

if (require.main === module) {
  run().then(({ status, output }) => {
    process.stdout.write(output);
    process.exitCode = status;
  }).catch((error) => {
    process.stderr.write((error && error.message ? error.message : String(error)) + "\n");
    process.exitCode = 1;
  });
}
