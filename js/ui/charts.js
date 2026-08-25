/**
 * ui/charts.js — the plotting the result panels are drawn with.
 *
 * Hand-written SVG rather than a charting library: the cross-section drawings
 * already work this way, it keeps the page free of any dependency beyond
 * three.js, and every colour comes from the theme tokens so light and dark
 * both look deliberate.
 *
 * Two shapes cover everything the results need:
 *   `xyChart`     value against value — capacity curves, hysteresis, traces
 *   `storyChart`  a quantity per story, drawn against the building's height
 */

const NS = 'http://www.w3.org/2000/svg';

const PALETTE = ['--el-beam', '--el-column', '--accent', '--el-damper', '--ok', '--info'];

const el = (name, attrs = {}) => {
  const node = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
};

/* ──────────────────────────── axis scaling ──────────────────────────── */

/**
 * Round tick steps — 1, 2, 5 × a power of ten. An axis labelled 0.0237 tells
 * the reader nothing they can hold in their head.
 */
function niceStep(range, target) {
  if (!(range > 0)) return 1;
  const raw = range / Math.max(target, 1);
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const scaled = raw / magnitude;
  const step = scaled <= 1 ? 1 : scaled <= 2 ? 2 : scaled <= 5 ? 5 : 10;
  return step * magnitude;
}

function ticks(min, max, target = 5) {
  if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) {
    return { values: [min || 0], step: 1 };
  }
  const step = niceStep(max - min, target);
  const first = Math.ceil(min / step) * step;
  const values = [];
  for (let v = first; v <= max + step * 1e-9; v += step) values.push(Number(v.toFixed(12)));
  return { values, step };
}

/** Axis labels get as many decimals as their step needs, and no more. */
function labeller(step) {
  const magnitude = Math.abs(step);
  if (magnitude === 0) return (v) => String(v);
  if (magnitude >= 1e5 || magnitude < 1e-3) return (v) => (v === 0 ? '0' : v.toExponential(1));
  const decimals = Math.max(0, Math.ceil(-Math.log10(magnitude)));
  return (v) => v.toFixed(decimals);
}

function extent(datasets, axis) {
  let min = Infinity;
  let max = -Infinity;
  for (const set of datasets) {
    for (const point of set.points) {
      const v = point[axis];
      if (!Number.isFinite(v)) continue;
      if (v < min) min = v;
      if (v > max) max = v;
    }
  }
  if (min === Infinity) return [0, 1];
  if (min === max) return [min - 0.5, max + 0.5];
  return [min, max];
}

/* ──────────────────────────────── frame ─────────────────────────────── */

const PAD = { top: 14, right: 16, bottom: 40, left: 62 };

/**
 * Draws the box, the gridlines and the axis labels shared by every chart, and
 * hands back the mapping functions the caller plots into.
 */
function frame(svg, width, height, xDomain, yDomain, opts) {
  const plotW = width - PAD.left - PAD.right;
  const plotH = height - PAD.top - PAD.bottom;

  const [x0, x1] = xDomain;
  const [y0, y1] = yDomain;
  const sx = (v) => PAD.left + ((v - x0) / (x1 - x0 || 1)) * plotW;
  const sy = (v) => PAD.top + plotH - ((v - y0) / (y1 - y0 || 1)) * plotH;

  const xTicks = ticks(x0, x1, opts.xTicks ?? 6);
  const yTicks = ticks(y0, y1, opts.yTicks ?? 5);
  const xLabel = labeller(xTicks.step);
  const yLabel = labeller(yTicks.step);

  for (const v of yTicks.values) {
    const y = sy(v);
    svg.append(el('line', { x1: PAD.left, y1: y, x2: PAD.left + plotW, y2: y, class: 'ch-grid' }));
    const text = el('text', { x: PAD.left - 7, y: y + 3.5, class: 'ch-tick ch-tick-y' });
    text.textContent = yLabel(v);
    svg.append(text);
  }

  for (const v of xTicks.values) {
    const x = sx(v);
    svg.append(el('line', { x1: x, y1: PAD.top, x2: x, y2: PAD.top + plotH, class: 'ch-grid' }));
    const text = el('text', { x, y: PAD.top + plotH + 15, class: 'ch-tick ch-tick-x' });
    text.textContent = xLabel(v);
    svg.append(text);
  }

  // Zero lines are drawn on top of the grid: a hysteresis loop is read against
  // them, so they must not be just another gridline.
  if (y0 < 0 && y1 > 0) {
    svg.append(el('line', { x1: PAD.left, y1: sy(0), x2: PAD.left + plotW, y2: sy(0), class: 'ch-zero' }));
  }
  if (x0 < 0 && x1 > 0) {
    svg.append(el('line', { x1: sx(0), y1: PAD.top, x2: sx(0), y2: PAD.top + plotH, class: 'ch-zero' }));
  }

  svg.append(el('rect', {
    x: PAD.left, y: PAD.top, width: plotW, height: plotH, class: 'ch-box',
  }));

  if (opts.xTitle) {
    const t = el('text', { x: PAD.left + plotW / 2, y: height - 6, class: 'ch-axis-title' });
    t.textContent = opts.xTitle;
    svg.append(t);
  }
  if (opts.yTitle) {
    const t = el('text', {
      x: 12, y: PAD.top + plotH / 2, class: 'ch-axis-title',
      transform: `rotate(-90 12 ${PAD.top + plotH / 2})`,
    });
    t.textContent = opts.yTitle;
    svg.append(t);
  }

  return { sx, sy, plotW, plotH };
}

function legend(host, datasets) {
  if (datasets.length < 2) return;
  const box = document.createElement('div');
  box.className = 'ch-legend';
  datasets.forEach((set, i) => {
    const item = document.createElement('span');
    const swatch = document.createElement('i');
    swatch.style.background = `var(${set.color || PALETTE[i % PALETTE.length]})`;
    item.append(swatch, document.createTextNode(set.name || `Series ${i + 1}`));
    box.append(item);
  });
  host.append(box);
}

function wrap(title, note) {
  const card = document.createElement('figure');
  card.className = 'chart';
  if (title) {
    const caption = document.createElement('figcaption');
    caption.textContent = title;
    card.append(caption);
  }
  if (note) {
    const p = document.createElement('p');
    p.className = 'ch-note';
    p.textContent = note;
    card.append(p);
  }
  return card;
}

/* ───────────────────────────── xy line chart ────────────────────────── */

/**
 * Value against value. `datasets` is `[{ name, points: [[x, y], …], color }]`.
 *
 * @param {object} opts  title, note, xTitle, yTitle, width, height, symmetric
 */
export function xyChart(datasets, opts = {}) {
  const sets = datasets.filter((d) => d && d.points && d.points.length);
  const card = wrap(opts.title, opts.note);
  if (!sets.length) {
    const empty = document.createElement('p');
    empty.className = 'ch-empty';
    empty.textContent = opts.emptyText || 'Nothing to plot.';
    card.append(empty);
    return card;
  }

  const width = opts.width || 640;
  const height = opts.height || 300;
  const svg = el('svg', {
    viewBox: `0 0 ${width} ${height}`, class: 'ch-svg',
    preserveAspectRatio: 'xMidYMid meet', role: 'img',
  });

  let xDomain = extent(sets, 0);
  let yDomain = extent(sets, 1);
  if (opts.symmetric) {
    const xMax = Math.max(Math.abs(xDomain[0]), Math.abs(xDomain[1]));
    const yMax = Math.max(Math.abs(yDomain[0]), Math.abs(yDomain[1]));
    xDomain = [-xMax, xMax];
    yDomain = [-yMax, yMax];
  } else {
    yDomain = padDomain(yDomain);
  }

  const { sx, sy } = frame(svg, width, height, xDomain, yDomain, opts);

  sets.forEach((set, i) => {
    const points = set.points
      .filter((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]))
      .map((p) => `${sx(p[0]).toFixed(2)},${sy(p[1]).toFixed(2)}`)
      .join(' ');
    svg.append(el('polyline', {
      points, class: 'ch-line',
      style: `stroke: var(${set.color || PALETTE[i % PALETTE.length]})`,
    }));
  });

  card.append(svg);
  legend(card, sets);
  return card;
}

/** A little headroom so the top of a curve is not welded to the frame. */
function padDomain([min, max]) {
  const span = max - min || Math.abs(max) || 1;
  return [min < 0 ? min - span * 0.05 : Math.min(0, min), max + span * 0.05];
}

/* ────────────────────────────── story chart ─────────────────────────── */

/**
 * A quantity per story against the building's height — the shape every drift
 * and shear check is read in. Stories run up the y-axis as levels, the value
 * across the x-axis, and the line steps between levels rather than sloping,
 * because a story shear is constant within its story.
 *
 * `datasets` is `[{ name, values: [{ level, value }], color }]`.
 */
export function storyChart(datasets, opts = {}) {
  const sets = datasets.filter((d) => d && d.values && d.values.length);
  const card = wrap(opts.title, opts.note);
  if (!sets.length) {
    const empty = document.createElement('p');
    empty.className = 'ch-empty';
    empty.textContent = opts.emptyText || 'Nothing to plot.';
    card.append(empty);
    return card;
  }

  const levels = [...new Set(sets.flatMap((s) => s.values.map((v) => v.level)))].sort((a, b) => a - b);
  const width = opts.width || 420;
  const height = opts.height || Math.max(240, 40 + levels.length * 34);

  const asPoints = sets.map((set) => ({
    ...set,
    points: set.values.map((v) => [v.value, v.level]),
  }));

  const svg = el('svg', {
    viewBox: `0 0 ${width} ${height}`, class: 'ch-svg',
    preserveAspectRatio: 'xMidYMid meet', role: 'img',
  });

  let xDomain = extent(asPoints, 0);
  xDomain = opts.fromZero === false ? padDomain(xDomain) : [Math.min(0, xDomain[0]), xDomain[1] * 1.08 || 1];
  const yDomain = [Math.min(...levels) - 0.5, Math.max(...levels) + 0.5];

  const { sx, sy, plotW } = frame(svg, width, height, xDomain, yDomain, {
    ...opts, yTicks: levels.length,
  });

  // The y-axis is a list of stories, not a continuous scale, so its own labels
  // replace the numeric ticks the frame drew.
  for (const tick of svg.querySelectorAll('.ch-tick-y')) tick.remove();
  for (const level of levels) {
    const t = el('text', { x: PAD.left - 7, y: sy(level) + 3.5, class: 'ch-tick ch-tick-y' });
    t.textContent = level === 0 ? 'Base' : `L${level}`;
    svg.append(t);
  }

  asPoints.forEach((set, i) => {
    const colour = `var(${set.color || PALETTE[i % PALETTE.length]})`;
    const ordered = [...set.points].sort((a, b) => a[1] - b[1]);
    const line = ordered.map((p) => `${sx(p[0]).toFixed(2)},${sy(p[1]).toFixed(2)}`).join(' ');
    svg.append(el('polyline', { points: line, class: 'ch-line', style: `stroke: ${colour}` }));

    for (const [value, level] of ordered) {
      svg.append(el('circle', {
        cx: sx(value), cy: sy(level), r: 3, class: 'ch-dot', style: `fill: ${colour}`,
      }));
    }
  });

  // A limit line is what turns a drift plot into a check.
  if (Number.isFinite(opts.limit) && opts.limit > 0 && opts.limit <= xDomain[1]) {
    svg.append(el('line', {
      x1: sx(opts.limit), y1: PAD.top, x2: sx(opts.limit), y2: height - PAD.bottom,
      class: 'ch-limit',
    }));
    const t = el('text', { x: sx(opts.limit) - 4, y: PAD.top + 11, class: 'ch-limit-label' });
    t.textContent = opts.limitLabel || 'limit';
    svg.append(t);
  }

  void plotW;
  card.append(svg);
  legend(card, asPoints);
  return card;
}
