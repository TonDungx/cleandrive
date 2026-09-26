'use strict';

/**
 * One pass of the Developer screen: which of the tools are here, how much each
 * holds, and -- for the caches the app will actually move -- which files.
 *
 * The two halves are deliberately different, and the difference was measured
 * rather than guessed (2026-09-26, this machine):
 *
 *   package caches   npm 13.8 s, Gradle 21.8 s, NuGet 6.7 s, pip 2.4 s to
 *                    list file by file -- 45 s for a screen that should open
 *                    in a moment. They are summed with `measureTree`, which
 *                    reads sizes and no names, and nothing is listed.
 *   IDE caches       0.1 s, 0.2 s, 1.3 s, 0.8 s -- 2.4 s for all of them. Those
 *                    are listed, because those are the ones a row can offer to
 *                    move to the bin.
 *
 * Only reads.
 */

const path = require('node:path');

const { fsp } = require('../lib/real-fs');
const { measureTree } = require('../system/walk');
const { runningProcessNames } = require('../lib/processes');

const tools = require('./tools');

/** An IDE cache larger than this is not listed file by file. */
const MAX_CACHE_FILES = 20000;

async function isDirectory(dir) {
  try {
    return (await fsp.stat(dir)).isDirectory();
  } catch {
    return false;
  }
}

/** Sums only: how much a folder holds, and nothing about what is in it. */
async function sizeOf(dir, token) {
  const out = await measureTree(dir, token ? { token } : {});
  const all = out.buckets.all || { allocated: 0, logical: 0, files: 0 };
  return { bytes: all.allocated, files: all.files, refused: out.deniedCount };
}

/** Every file below a folder, with what it occupies. */
async function filesUnder(root, token, cap = MAX_CACHE_FILES) {
  const out = [];
  let truncated = false;
  const visit = async (dir, depth) => {
    if (out.length >= cap) {
      truncated = true;
      return;
    }
    if (depth > 12 || (token && token.cancelled)) return;
    let entries;
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (out.length >= cap) {
        truncated = true;
        return;
      }
      if (entry.isSymbolicLink()) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await visit(full, depth + 1);
        continue;
      }
      if (!entry.isFile()) continue;
      try {
        const stat = await fsp.stat(full);
        out.push({
          path: full,
          size: stat.size,
          allocated: Number.isFinite(stat.blocks) ? stat.blocks * 512 : stat.size,
          mtimeMs: stat.mtimeMs,
        });
      } catch {
        /* gone between the listing and the stat */
      }
    }
  };
  await visit(root, 0);
  return { files: out, truncated };
}

/**
 * A JetBrains installation is one folder per product, and only three names
 * inside each may be touched. Resolved here rather than in the definition,
 * because which products are installed is a fact about the machine.
 */
async function jetbrainsFolders(tool, env) {
  const root = tool.productsUnder(env);
  let products;
  try {
    products = (await fsp.readdir(root, { withFileTypes: true })).filter((d) => d.isDirectory() && !d.isSymbolicLink());
  } catch {
    return [];
  }
  const found = [];
  for (const product of products) {
    for (const name of tool.subfolders) {
      const dir = path.join(root, product.name, name);
      if (await isDirectory(dir)) found.push({ dir, product: product.name, what: name });
    }
  }
  return found;
}

/**
 * Everything the Developer screen is drawn from.
 *
 * @param {object} [options]
 * @param {{cancelled: boolean}} [options.token]
 * @param {(p: object) => void} [options.onProgress]
 */
async function scan({ token = null, onProgress = () => {}, env = process.env, deps = {} } = {}) {
  const started = Date.now();

  onProgress({ phase: 'processes' });
  const running = await (deps.runningProcessNames || runningProcessNames)();

  const found = [];
  for (const tool of tools.TOOLS) {
    if (token && token.cancelled) break;
    onProgress({ phase: 'measuring', tool: tool.id, name: tool.name });

    const places = [];
    if (tool.productsUnder) {
      for (const folder of await jetbrainsFolders(tool, env)) {
        places.push({ dir: folder.dir, label: `${folder.product}\\${folder.what}` });
      }
    } else {
      for (const dir of tools.pathsOf(tool, env)) {
        if (await isDirectory(dir)) places.push({ dir, label: path.basename(dir) });
      }
    }
    if (places.length === 0) continue;

    let bytes = 0;
    let fileCount = 0;
    let refused = 0;
    for (const place of places) {
      const size = await sizeOf(place.dir, token);
      place.bytes = size.bytes;
      place.files = size.files;
      place.refused = size.refused;
      bytes += size.bytes;
      fileCount += size.files;
      refused += size.refused;
    }

    // Only the caches a row may offer to move are listed file by file.
    let files = [];
    let truncated = false;
    if (tool.kind === 'ideCache') {
      for (const place of places) {
        if (token && token.cancelled) break;
        const listing = await filesUnder(place.dir, token, MAX_CACHE_FILES - files.length);
        files = files.concat(listing.files);
        truncated = truncated || listing.truncated;
      }
    }

    // An IDE that is open is holding its own cache; nothing is taken from
    // under it. A process list that could not be read is not a "no".
    const processes = (tool.processes || []).map((name) => name.toLowerCase());
    const open = running ? processes.filter((name) => running.has(name)) : [];

    found.push({
      id: tool.id,
      name: tool.name,
      kind: tool.kind,
      places,
      bytes,
      fileCount,
      refused,
      files,
      truncated,
      command: tool.command || null,
      handoff: tool.handoff || null,
      manager: tool.manager || null,
      openProcesses: open,
      // `null` means it could not be checked, which is not the same as "no".
      isOpen: running ? open.length > 0 : null,
    });
  }

  return {
    at: Date.now(),
    tools: found,
    // What was looked for and not found, so the screen can say "no pnpm here"
    // rather than leaving somebody wondering whether it looked.
    missing: tools.TOOLS.filter((tool) => !found.some((f) => f.id === tool.id)).map((tool) => ({ id: tool.id, name: tool.name, kind: tool.kind })),
    processesReadable: running !== null,
    cancelled: Boolean(token && token.cancelled),
    durationMs: Date.now() - started,
  };
}

module.exports = { scan, sizeOf, filesUnder, jetbrainsFolders, MAX_CACHE_FILES };
