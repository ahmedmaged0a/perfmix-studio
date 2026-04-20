/**
 * Downloads official Grafana k6 release assets and copies them into
 * src-tauri/resources/k6/ with the names Tauri bundles (see resource_binary_name in lib.rs).
 *
 * Usage:
 *   node scripts/download-k6-for-tauri.mjs
 *   node scripts/download-k6-for-tauri.mjs --all
 *   node scripts/download-k6-for-tauri.mjs --platform=windows-amd64
 *   K6_VERSION=v0.55.0 node scripts/download-k6-for-tauri.mjs
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, "..");
const K6_RESOURCES_DIR = path.join(REPO_ROOT, "src-tauri", "resources", "k6");

const DEFAULT_VERSION = "v0.55.0";

/** @type {Record<string, { archiveSuffix: string; outFile: string; innerName: string }>} */
const PLATFORMS = {
  "windows-amd64": {
    archiveSuffix: "windows-amd64.zip",
    outFile: "k6-windows-amd64.exe",
    innerName: "k6.exe",
  },
  "linux-amd64": {
    archiveSuffix: "linux-amd64.tar.gz",
    outFile: "k6-linux-amd64",
    innerName: "k6",
  },
  "darwin-amd64": {
    archiveSuffix: "darwin-amd64.tar.gz",
    outFile: "k6-darwin-amd64",
    innerName: "k6",
  },
  "darwin-arm64": {
    archiveSuffix: "darwin-arm64.tar.gz",
    outFile: "k6-darwin-arm64",
    innerName: "k6",
  },
};

function parseArgs(argv) {
  let all = false;
  /** @type {string[]} */
  const platforms = [];
  let version = process.env.K6_VERSION?.trim() || DEFAULT_VERSION;
  if (!version.startsWith("v")) version = `v${version}`;

  for (const a of argv) {
    if (a === "--all") all = true;
    else if (a.startsWith("--platform=")) platforms.push(a.slice("--platform=".length));
    else if (a.startsWith("--version=")) version = a.slice("--version=".length).trim() || version;
  }
  return { all, platforms, version };
}

function defaultPlatforms() {
  if (process.platform === "win32") return ["windows-amd64"];
  if (process.platform === "darwin") {
    return [process.arch === "arm64" ? "darwin-arm64" : "darwin-amd64"];
  }
  return ["linux-amd64"];
}

/**
 * @param {string} dir
 * @param {string} basename
 * @returns {Promise<string | null>}
 */
async function findFileRecursive(dir, basename) {
  const entries = await fs.promises.readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      const found = await findFileRecursive(p, basename);
      if (found) return found;
    } else if (e.name === basename) {
      return p;
    }
  }
  return null;
}

/** @param {string} url @param {string} dest */
async function downloadToFile(url, dest) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Download failed (${res.status} ${res.statusText}): ${url}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  await fs.promises.writeFile(dest, buf);
}

/** @param {string} zipPath @param {string} outDir */
function unzipWindows(zipPath, outDir) {
  const z = zipPath.replace(/'/g, "''");
  const o = outDir.replace(/'/g, "''");
  const cmd = `Expand-Archive -LiteralPath '${z}' -DestinationPath '${o}' -Force`;
  const r = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", cmd], {
    stdio: "inherit",
  });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(`Expand-Archive failed with exit ${r.status}`);
}

/** @param {string} zipPath @param {string} outDir */
function extractZip(zipPath, outDir) {
  if (process.platform === "win32") {
    unzipWindows(zipPath, outDir);
    return;
  }
  const r = spawnSync("tar", ["-xf", zipPath, "-C", outDir], { stdio: "inherit" });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(`tar -xf (zip) failed with exit ${r.status}`);
}

/** @param {string} archivePath @param {string} outDir */
function untarGz(archivePath, outDir) {
  const r = spawnSync("tar", ["-xzf", archivePath, "-C", outDir], { stdio: "inherit" });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(`tar failed with exit ${r.status}`);
}

/** @param {string} dest @param {number} mode */
async function chmodIfNeeded(dest, mode) {
  if (process.platform === "win32") return;
  await fs.promises.chmod(dest, mode);
}

/**
 * @param {string} version e.g. v0.55.0
 * @param {keyof typeof PLATFORMS} key
 */
async function fetchOne(version, key) {
  const spec = PLATFORMS[key];
  if (!spec) throw new Error(`Unknown platform "${key}". Use: ${Object.keys(PLATFORMS).join(", ")}`);

  const fileName = `k6-${version}-${spec.archiveSuffix}`;
  const url = `https://github.com/grafana/k6/releases/download/${version}/${fileName}`;

  const work = await fs.promises.mkdtemp(path.join(os.tmpdir(), "perfmix-k6-"));
  const archivePath = path.join(work, fileName);
  const extractDir = path.join(work, "extract");

  try {
    console.log(`→ ${key}: ${url}`);
    await downloadToFile(url, archivePath);
    await fs.promises.mkdir(extractDir, { recursive: true });

    if (fileName.endsWith(".zip")) {
      extractZip(archivePath, extractDir);
    } else {
      untarGz(archivePath, extractDir);
    }

    const inner = await findFileRecursive(extractDir, spec.innerName);
    if (!inner) {
      throw new Error(`Could not find ${spec.innerName} inside ${fileName}`);
    }

    await fs.promises.mkdir(K6_RESOURCES_DIR, { recursive: true });
    const dest = path.join(K6_RESOURCES_DIR, spec.outFile);
    await fs.promises.copyFile(inner, dest);
    await chmodIfNeeded(dest, 0o755);

    console.log(`  wrote ${path.relative(REPO_ROOT, dest)}`);
  } finally {
    await fs.promises.rm(work, { recursive: true, force: true });
  }
}

async function main() {
  const { all, platforms: argPlatforms, version } = parseArgs(process.argv.slice(2));

  /** @type {string[]} */
  let keys;
  if (all) keys = Object.keys(PLATFORMS);
  else if (argPlatforms.length) keys = argPlatforms;
  else keys = defaultPlatforms();

  for (const k of keys) {
    if (!PLATFORMS[k]) {
      console.error(`Unknown platform: ${k}`);
      process.exit(1);
    }
  }

  console.log(`k6 release ${version} → ${path.relative(REPO_ROOT, K6_RESOURCES_DIR)}`);
  for (const k of keys) {
    await fetchOne(version, k);
  }
  console.log("Done.");
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
