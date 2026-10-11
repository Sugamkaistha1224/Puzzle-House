export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));
export const range = (from, to) => Array.from({ length: Math.max(0, to - from) }, (_, k) => from + k);

export const rng = (seed) => {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    const a = Math.imul(s ^ (s >>> 15), s | 1);
    const b = (a + Math.imul(a ^ (a >>> 7), a | 61)) ^ a;
    return ((b ^ (b >>> 14)) >>> 0) / 4294967296;
  };
};
export const newSeed = () => Math.floor(Math.random() * 2 ** 31);

export const clockText = (ms) => {
  const s = Math.floor(ms / 1000);
  const hms = [Math.floor(s / 3600), Math.floor(s / 60) % 60, s % 60];
  return hms[0] ? `${hms[0]}:${String(hms[1]).padStart(2, '0')}:${String(hms[2]).padStart(2, '0')}` : `${hms[1]}:${String(hms[2]).padStart(2, '0')}`;
};
export const minutesText = (ms) => {
  const m = Math.max(1, Math.round(ms / 60000));
  return `${m} min`;
};

export const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
export const easeOut = (t) => 1 - (1 - t) ** 3;
export const easeInOut = (t) => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2);
export const nextFrame = () => new Promise((done) => { requestAnimationFrame(done); });
export const animate = (ms, step, ease = easeOut) => new Promise((done) => {
  const duration = reducedMotion() ? 0 : ms;
  const start = performance.now();
  const frame = (now) => {
    const t = duration ? clamp((now - start) / duration, 0, 1) : 1;
    step(ease(t), t);
    if (t < 1) requestAnimationFrame(frame);
    else done();
  };
  requestAnimationFrame(frame);
});

export const gridFor = (count, aspect) => {
  const cols = Math.max(2, Math.round(Math.sqrt(count * aspect)));
  const rows = Math.max(2, Math.round(count / cols));
  return { cols, rows, total: cols * rows };
};

export const workSize = (grid, w, h) => {
  const cell = Math.min(130, (Math.sqrt(2e7 / grid.total) - 4) / 1.72);
  const scale = Math.min(1, (grid.cols * cell) / w, (grid.rows * cell) / h, 4096 / Math.max(w, h));
  return { w: Math.round(w * scale), h: Math.round(h * scale) };
};

export const deviceTier = () => {
  const small = Math.min(window.screen.width, window.screen.height) < 600;
  const coarse = window.matchMedia('(pointer: coarse)').matches;
  const memory = navigator.deviceMemory ?? (small ? 3 : 8);
  const cores = navigator.hardwareConcurrency || 4;
  if (small) return 0;
  if (coarse) return 1;
  return memory >= 8 && cores >= 8 ? 3 : 2;
};
const COMFORT = [1000, 1500, 2000, 5000];
const LAGGY = [2000, 3000, 4000, 5000];
export const rateCount = (count, tier) => {
  if (count <= COMFORT[tier]) return 'ok';
  return count <= LAGGY[tier] ? 'lag' : 'slow';
};

const edgeShape = (r, flip) => {
  const t = 0.085 + r() * 0.025;
  const [a, b, c, d, e] = range(0, 5).map(() => (r() * 2 - 1) * 0.05);
  return [
    [0, 0], [0.2, a], [0.5 + b + d, -t + c], [0.5 - t + b, t + c],
    [0.5 - 2 * t + b - d, 3 * t + c], [0.5 + 2 * t + b - d, 3 * t + c], [0.5 + t + b, t + c],
    [0.5 + b + d, -t + c], [0.8, e], [1, 0],
  ].map(([u, v]) => [u, v * flip]);
};

export const cutPuzzle = ({
  cols, rows, w, h, seed, seg = 0,
}) => {
  const r = rng(seed);
  const cw = w / cols;
  const ch = h / rows;
  const unit = (cw + ch) / 2;
  const flip = () => (r() < 0.5 ? -1 : 1);
  const hEdges = range(1, rows).map((k) => range(0, cols).map((c) => edgeShape(r, flip())
    .map(([u, v]) => [(c + u) * cw, k * ch + v * unit])));
  const vEdges = range(0, rows).map((k) => range(1, cols).map((c) => edgeShape(r, flip())
    .map(([u, v]) => [c * cw + v * unit, (k + u) * ch])));
  const pieces = range(0, rows * cols).map((i) => {
    const row = Math.floor(i / cols);
    const col = i % cols;
    const hx = (col + 0.5) * cw;
    const hy = (row + 0.5) * ch;
    const path = new Path2D();
    const pts = [];
    const add = (x, y) => { if (seg) pts.push([x, y]); };
    const curve = (edge) => [1, 4, 7].forEach((k) => {
      path.bezierCurveTo(
        edge[k][0] - hx, edge[k][1] - hy, edge[k + 1][0] - hx, edge[k + 1][1] - hy, edge[k + 2][0] - hx, edge[k + 2][1] - hy,
      );
      range(1, seg + 1).forEach((j) => {
        const [t, u] = [j / seg, 1 - j / seg];
        const at = (c) => u ** 3 * edge[k - 1][c] + 3 * u * u * t * edge[k][c] + 3 * u * t * t * edge[k + 1][c] + t ** 3 * edge[k + 2][c];
        add(at(0) - hx, at(1) - hy);
      });
    });
    const line = (x, y) => {
      path.lineTo(x, y);
      add(x, y);
    };
    const [x0, x1, y0, y1] = [-cw / 2, cw / 2, -ch / 2, ch / 2];
    path.moveTo(x0, y0);
    add(x0, y0);
    if (row > 0) curve(hEdges[row - 1][col]); else line(x1, y0);
    if (col < cols - 1) curve(vEdges[row][col]); else line(x1, y1);
    if (row < rows - 1) curve([...hEdges[row][col]].reverse()); else line(x0, y1);
    if (col > 0) curve([...vEdges[row][col - 1]].reverse()); else line(x0, y0);
    path.closePath();
    const edge = row === 0 || col === 0 || row === rows - 1 || col === cols - 1;
    return {
      i, row, col, hx, hy, path, edge, pts: pts.slice(0, -1),
    };
  });
  const pad = Math.ceil(unit * 0.35 + 4);
  return {
    cols, rows, cw, ch, w, h, unit, n: pieces.length, pieces, slotW: Math.ceil(cw + pad * 2), slotH: Math.ceil(ch + pad * 2),
  };
};

export const neighborsOf = (P, i) => {
  const { row, col } = P.pieces[i];
  return [
    row > 0 ? i - P.cols : -1,
    row < P.rows - 1 ? i + P.cols : -1,
    col > 0 ? i - 1 : -1,
    col < P.cols - 1 ? i + 1 : -1,
  ].filter((j) => j >= 0);
};
