'use strict';

/**
 * Where each tile of the Disk usage map goes. Pure arithmetic, so the harness
 * can check it without a window: loaded as a classic `<script>` by the page and
 * as a CommonJS module by `scripts/test-treemap.js`, like `src/i18n/index.js`.
 *
 * The layout is the squarified one (Bruls, Huizing and van Wijk, 2000): tiles
 * are laid in rows along the shorter side of what is left, and a tile joins
 * the current row only while that makes the row's worst aspect ratio better.
 * A slice-and-dice layout gives the same areas as a stack of slivers, and a
 * sliver is a tile nobody can read or point at.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TreemapLayout = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  /** The worst aspect ratio in a row of `areas` laid along a side of `side`. */
  function worst(areas, side) {
    let sum = 0;
    let max = 0;
    let min = Infinity;
    for (const a of areas) {
      sum += a;
      if (a > max) max = a;
      if (a < min) min = a;
    }
    const s2 = sum * sum;
    const w2 = side * side;
    return Math.max((w2 * max) / s2, s2 / (w2 * min));
  }

  /**
   * @param {Array<{value: number}>} items   largest first; a value of 0 or less gets no tile
   * @param {{x: number, y: number, w: number, h: number}} rect
   * @returns {Array<{item: object, x: number, y: number, w: number, h: number}>}
   *   in the order given; the tiles cover `rect` exactly and do not overlap
   */
  function squarify(items, rect) {
    const live = items.filter((item) => Number.isFinite(item.value) && item.value > 0);
    const out = [];
    if (live.length === 0 || !(rect.w > 0) || !(rect.h > 0)) return out;

    const total = live.reduce((n, item) => n + item.value, 0);
    const scale = (rect.w * rect.h) / total;
    let { x, y, w, h } = rect;
    let row = [];
    let rowAreas = [];

    const place = (last) => {
      const sum = rowAreas.reduce((n, a) => n + a, 0);
      if (w >= h) {
        // A column down the left of what is left.
        const colW = last ? w : sum / h;
        let at = y;
        row.forEach((item, i) => {
          const tileH = i === row.length - 1 ? y + h - at : rowAreas[i] / colW;
          out.push({ item, x, y: at, w: colW, h: tileH });
          at += tileH;
        });
        x += colW;
        w -= colW;
      } else {
        // A row across the top.
        const rowH = last ? h : sum / w;
        let at = x;
        row.forEach((item, i) => {
          const tileW = i === row.length - 1 ? x + w - at : rowAreas[i] / rowH;
          out.push({ item, x: at, y, w: tileW, h: rowH });
          at += tileW;
        });
        y += rowH;
        h -= rowH;
      }
      row = [];
      rowAreas = [];
    };

    for (let i = 0; i < live.length; i++) {
      const area = live[i].value * scale;
      if (row.length === 0) {
        row.push(live[i]);
        rowAreas.push(area);
        continue;
      }
      const side = Math.min(w, h);
      if (worst([...rowAreas, area], side) <= worst(rowAreas, side)) {
        row.push(live[i]);
        rowAreas.push(area);
      } else {
        place(false);
        row.push(live[i]);
        rowAreas.push(area);
      }
    }
    // The last row takes whatever is left, so rounding never leaves a strip.
    if (row.length > 0) place(true);
    return out;
  }

  /**
   * Fold the tiles that would be too small to see into one.
   *
   * A tile a pixel wide is not information, and leaving it out would make the
   * rest look bigger than they are. So the smallest ones, each of which would
   * come out under `minArea` square pixels, become a single "(n small items)"
   * tile holding their total. A single small item is left as it is: folding
   * one thing into a group of one hides its name for nothing.
   *
   * @param {Array<{value: number}>} items  largest first
   * @param {number} area                   the pixels they will share
   * @param {number} minArea
   * @param {(folded: object[]) => object} makeGroup
   */
  function groupSmall(items, area, minArea, makeGroup) {
    const live = items.filter((item) => Number.isFinite(item.value) && item.value > 0);
    const total = live.reduce((n, item) => n + item.value, 0);
    if (total <= 0 || !(area > 0)) return live;
    const cut = live.findIndex((item) => (item.value / total) * area < minArea);
    if (cut === -1 || live.length - cut < 2) return live;
    const folded = live.slice(cut);
    const group = makeGroup(folded);
    group.value = folded.reduce((n, item) => n + item.value, 0);
    return [...live.slice(0, cut), group];
  }

  return { squarify, groupSmall, worst };
});
