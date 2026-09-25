'use strict';

/**
 * The last scan's folder tree, kept in this process and handed to the window
 * one level at a time.
 *
 * The Disk usage screen draws a map of the folder: every child folder as a
 * tile sized by what it holds, the folders inside those drawn inside them, and
 * a click to go deeper. The data for that is the tree the scan already builds
 * for its snapshot -- and the whole of it is too much to send. Measured on the
 * home folder of the machine this was written on (377,419 files): 51,252 rows,
 * 62,771 folders once the ones holding only other folders are counted, twenty
 * levels deep, 5.3 MB as JSON. Nobody looks at twenty levels at once, and the
 * window has no business holding the names of 377,000 files it will never
 * draw. So the tree stays here and the window asks for the part it is showing:
 * a folder, and at most three levels under it, and at most `maxNodes` of
 * those, largest first.
 *
 * What a level holds, for each folder in it:
 *
 *   folder   a child folder, with its total and, if there was room, its own
 *            level nested inside
 *   file     a file the scan named -- 10 MB or more, ten per folder, the same
 *            rule as the snapshot -- as a candidate, with the verdict the
 *            advisor gave it, so a tile can be selected like a list row
 *   rest     the folder's own files that were not named: one tile, with a
 *            count, so the sizes add up and nobody wonders where the rest went
 *   others   the child folders past `maxChildren`, as one tile. One folder
 *            here has 2,838 folders in it; the smallest two thousand of those
 *            would be tiles nobody could see
 *
 * Nothing in a level is looked up on the disk. The window names a folder by
 * the relative path this module gave it, and a name it was not given is not
 * found -- there is no path here to escape from.
 */

const path = require('node:path');

const { validateCandidate } = require('./contract');
const { fileCandidate, analyzer: scanAnalyzer } = require('./scan');
const { pathKey } = require('../lib/util');

const LIMITS = Object.freeze({ depth: 3, maxNodes: 1500, maxChildren: 300 });

const DECLARED = new Set(scanAnalyzer.categories);

class ScanTree {
  /**
   * @param {object} scan
   * @param {string} scan.root
   * @param {Array}  scan.rows        the scan's `tree`
   * @param {Map}    [scan.files]     the scan's `treeFiles`
   * @param {boolean} [scan.complete]
   * @param {number} [scan.scannedAt]
   * @param {object} [scan.accessTimes]
   */
  constructor({ root, rows, files = new Map(), complete = true, scannedAt = Date.now(), accessTimes = null, openApps = [] }) {
    this.root = path.resolve(root);
    this.complete = complete;
    this.scannedAt = scannedAt;
    this.accessTimes = accessTimes;
    // Which known apps were open when the scan ended (D4); null is "could not tell".
    this.openApps = Array.isArray(openApps) ? new Set(openApps) : null;
    this.removed = { files: 0, bytes: 0 };
    this._removedKeys = new Set();
    this._files = files;

    /** rel -> node. The root is ''. */
    this.nodes = new Map();
    this._node('');

    for (const [rel, bytes, count, big] of rows) {
      const node = this._node(rel);
      node.ownBytes = bytes;
      node.ownFiles = count;
      node.big = big.map(([name, size, mtimeMs]) => ({ name, size, mtimeMs }));
    }

    // Totals from the bottom up: a folder is what it holds plus what its
    // folders hold. Deepest first, so each parent is added to only once all
    // of its children are complete.
    const order = [...this.nodes.values()].sort((a, b) => b.depth - a.depth);
    for (const node of order) {
      node.bytes += node.ownBytes;
      node.files += node.ownFiles;
      if (node.parent !== null) {
        const parent = this.nodes.get(node.parent);
        parent.bytes += node.bytes;
        parent.files += node.files;
      }
    }
    for (const node of this.nodes.values()) this._sortKids(node);
  }

  /** The node for `rel`, creating it and every folder above it. */
  _node(rel) {
    let node = this.nodes.get(rel);
    if (node) return node;
    const parent = rel === '' ? null : path.dirname(rel) === '.' ? '' : path.dirname(rel);
    node = {
      rel,
      name: rel === '' ? path.basename(this.root) || this.root : path.basename(rel),
      parent,
      depth: rel === '' ? 0 : rel.split(path.sep).length,
      ownBytes: 0,
      ownFiles: 0,
      big: [],
      kids: [],
      bytes: 0,
      files: 0,
    };
    this.nodes.set(rel, node);
    if (parent !== null) this._node(parent).kids.push(rel);
    return node;
  }

  _sortKids(node) {
    node.kids.sort((a, b) => this.nodes.get(b).bytes - this.nodes.get(a).bytes);
  }

  /** The absolute path of a node. */
  pathOf(rel) {
    return rel === '' ? this.root : path.join(this.root, rel);
  }

  /**
   * One folder, and what is under it to `depth` levels, for the window.
   *
   * Filled breadth first, so a budget that runs out does so at the deepest
   * level being drawn and never leaves a shallow folder half described. A
   * folder whose contents did not fit comes back without `children`, and the
   * window asks for it when somebody goes into it.
   *
   * @returns {object|null} null when the tree has no such folder
   */
  level(rel, limits = {}) {
    if (typeof rel !== 'string') return null;
    const node = this.nodes.get(rel);
    if (!node) return null;
    const { depth, maxNodes, maxChildren } = { ...LIMITS, ...limits };

    let budget = maxNodes;
    const top = this._folderItem(node);
    let frontier = [{ node, item: top, level: 0 }];
    while (frontier.length > 0) {
      const next = [];
      for (const entry of frontier) {
        if (entry.level >= depth) continue;
        const items = this._contents(entry.node, maxChildren);
        // The folder asked for always gets its own contents; the budget only
        // decides how far below that the reply reaches.
        if (entry.level > 0 && items.length > budget) continue;
        budget = Math.max(0, budget - items.length);
        entry.item.children = items;
        for (const item of items) {
          if (item.kind === 'folder') next.push({ node: this.nodes.get(item.rel), item, level: entry.level + 1 });
        }
      }
      frontier = next;
    }

    const crumbs = [];
    for (let at = node; at; at = at.parent === null ? null : this.nodes.get(at.parent)) {
      crumbs.unshift({ rel: at.rel, name: at.name });
    }

    return {
      ...top,
      crumbs,
      complete: this.complete,
      scannedAt: this.scannedAt,
      removed: { ...this.removed },
      limits: { depth, maxNodes, maxChildren },
    };
  }

  _folderItem(node) {
    return { kind: 'folder', rel: node.rel, name: node.name, path: this.pathOf(node.rel), bytes: node.bytes, files: node.files };
  }

  /** A folder's own contents, largest first. */
  _contents(node, maxChildren) {
    const items = [];
    const kids = node.kids.filter((rel) => this.nodes.get(rel).files > 0 || this.nodes.get(rel).bytes > 0);
    for (const rel of kids.slice(0, maxChildren)) items.push(this._folderItem(this.nodes.get(rel)));
    if (kids.length > maxChildren) {
      const rest = kids.slice(maxChildren).map((rel) => this.nodes.get(rel));
      items.push({
        kind: 'others',
        count: rest.length,
        bytes: rest.reduce((n, k) => n + k.bytes, 0),
        files: rest.reduce((n, k) => n + k.files, 0),
      });
    }

    let namedBytes = 0;
    let namedFiles = 0;
    for (const file of node.big) {
      const candidate = this._candidate(node, file);
      if (!candidate) continue;
      namedBytes += file.size;
      namedFiles += 1;
      items.push({ kind: 'file', name: file.name, bytes: file.size, candidate });
    }
    const restFiles = node.ownFiles - namedFiles;
    if (restFiles > 0) {
      items.push({ kind: 'rest', files: restFiles, bytes: Math.max(0, node.ownBytes - namedBytes) });
    }

    return items.sort((a, b) => b.bytes - a.bytes);
  }

  /**
   * A named file as the same candidate the largest list would make of it.
   *
   * Validated here, because this reaches the window by a different road from
   * the analyzer's own stream and the rule is that no road skips the check.
   * One that fails is counted in its folder's "rest" instead of being drawn.
   */
  _candidate(node, file) {
    const full = path.join(this.pathOf(node.rel), file.name);
    const detail = this._files.get(full) || {};
    const candidate = fileCandidate(
      {
        path: full,
        size: file.size,
        mtimeMs: file.mtimeMs,
        atimeMs: detail.atimeMs,
        verdict: detail.verdict || 'keep',
        reason: detail.reason || null,
        category: detail.category || null,
        source: detail.source || null,
      },
      this.accessTimes,
      this.openApps
    );
    try {
      validateCandidate(candidate);
      if (!DECLARED.has(candidate.category)) throw new TypeError(`scan did not declare ${candidate.category}`);
      return candidate;
    } catch (err) {
      console.error('[scan-tree]', err.message);
      return null;
    }
  }

  /**
   * Take files that have left their folder -- moved to the Recycle Bin from
   * any screen -- out of the tree, so the map stops drawing them.
   *
   * Only this process's copy changes. The snapshot on disk is a record of what
   * the scan saw, and stays that. Each file is taken out once, however many
   * times it is reported.
   *
   * @param {Array<{path: string, size: number}>} moved
   * @returns {number} how many were taken out
   */
  remove(moved) {
    let taken = 0;
    const rootKey = pathKey(this.root);
    for (const item of moved || []) {
      if (!item || typeof item.path !== 'string') continue;
      const full = path.resolve(item.path);
      const key = pathKey(full);
      if (this._removedKeys.has(key)) continue;
      if (key === rootKey || !key.startsWith(rootKey.endsWith(path.sep) ? rootKey : rootKey + path.sep)) continue;
      const node = this.nodes.get(path.relative(this.root, path.dirname(full)));
      if (!node || node.ownFiles === 0) continue;

      const named = node.big.findIndex((file) => pathKey(path.join(this.pathOf(node.rel), file.name)) === key);
      const size = named !== -1 ? node.big[named].size : Math.max(0, Number(item.size) || 0);
      if (named !== -1) node.big.splice(named, 1);

      const bytes = Math.min(size, node.ownBytes);
      node.ownBytes -= bytes;
      node.ownFiles -= 1;
      for (let at = node; at; at = at.parent === null ? null : this.nodes.get(at.parent)) {
        at.bytes = Math.max(0, at.bytes - bytes);
        at.files = Math.max(0, at.files - 1);
      }
      for (let at = node.parent === null ? null : this.nodes.get(node.parent); at; at = at.parent === null ? null : this.nodes.get(at.parent)) {
        this._sortKids(at);
      }

      this._removedKeys.add(key);
      this.removed.files += 1;
      this.removed.bytes += bytes;
      taken += 1;
    }
    return taken;
  }
}

module.exports = { ScanTree, LIMITS };
