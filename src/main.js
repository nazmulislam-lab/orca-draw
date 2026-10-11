import rough from 'roughjs';
import '@fontsource/caveat/400.css';
import './style.css';
import { ICONS } from './icons.js';

// ---------- constants (values recovered from the excalidraw.com bundle via REA) ----------
const STORAGE = { elements: 'excalidraw', state: 'excalidraw-state', theme: 'excalidraw-theme' };
const STROKES = ['#1e1e1e', '#e03131', '#2f9e44', '#1971c2', '#f08c00'];
const BGS = ['transparent', '#ffc9c9', '#b2f2bb', '#a5d8ff', '#ffec99'];
const FONT = {
  1: 'Caveat, cursive', 5: 'Caveat, cursive',
  2: 'system-ui, sans-serif', 6: 'system-ui, sans-serif',
  3: 'ui-monospace, "Cascadia Code", monospace', 8: 'ui-monospace, "Cascadia Code", monospace',
};
const LINE_H = 1.25;
const TYPES = new Set(['rectangle', 'diamond', 'ellipse', 'line', 'arrow', 'freedraw', 'text']);
const CLOSED = new Set(['rectangle', 'diamond', 'ellipse']);
const LINEAR = new Set(['line', 'arrow']);
const DRAW_TOOLS = new Set(['rectangle', 'diamond', 'ellipse', 'arrow', 'line', 'freedraw', 'text']);
const DARK_MAP = { '#1e1e1e': '#cdd6f4', '#000000': '#cdd6f4', '#000': '#cdd6f4', '#ffffff': '#1e1e2e', '#fff': '#1e1e2e' };
const DEFAULTS = {
  strokeColor: '#1e1e1e', backgroundColor: 'transparent', fillStyle: 'hachure', strokeWidth: 2,
  strokeStyle: 'solid', roughness: 1, opacity: 100, roundness: true, fontSize: 20, fontFamily: 1,
  textAlign: 'left', startArrowhead: null, endArrowhead: 'arrow',
};

const TOOLS = [
  { id: 'lock', icon: 'lockOpen', title: 'Keep selected tool active after drawing (Q)' },
  'sep',
  { id: 'hand', icon: 'hand', key: 'H', title: 'Hand (panning tool) — H' },
  { id: 'selection', icon: 'pointer', key: '1', title: 'Selection — V or 1' },
  { id: 'rectangle', icon: 'rectangle', key: '2', title: 'Rectangle — R or 2' },
  { id: 'diamond', icon: 'diamond', key: '3', title: 'Diamond — D or 3' },
  { id: 'ellipse', icon: 'ellipse', key: '4', title: 'Ellipse — O or 4' },
  { id: 'arrow', icon: 'arrow', key: '5', title: 'Arrow — A or 5' },
  { id: 'line', icon: 'line', key: '6', title: 'Line — L or 6' },
  { id: 'freedraw', icon: 'pencil', key: '7', title: 'Draw — P or 7' },
  { id: 'text', icon: 'text', key: '8', title: 'Text — T or 8' },
  { id: 'eraser', icon: 'eraser', key: '0', title: 'Eraser — E or 0' },
];
const TOOL_KEYS = {
  h: 'hand', v: 'selection', 1: 'selection', r: 'rectangle', 2: 'rectangle', d: 'diamond', 3: 'diamond',
  o: 'ellipse', 4: 'ellipse', a: 'arrow', 5: 'arrow', l: 'line', 6: 'line', p: 'freedraw', 7: 'freedraw',
  t: 'text', 8: 'text', e: 'eraser', 0: 'eraser',
};

// ---------- state ----------
const $ = (s) => document.querySelector(s);
const canvas = $('#canvas');
const ctx = canvas.getContext('2d');
const rc = rough.canvas(canvas);
const gen = rough.generator();
const mctx = document.createElement('canvas').getContext('2d');

let elements = [];
let selected = new Set();
const app = { tool: 'selection', locked: false, zoom: 1, scrollX: 0, scrollY: 0, theme: 'light', current: { ...DEFAULTS } };
let action = null; // current pointer gesture
let multi = null; // linear element being built point-by-point
let editing = null; // text element being edited
let erasing = new Set();
let spaceDown = false;
let lastPointer = [innerWidth / 2, innerHeight / 2];
let lastFinish = 0;
let VC = 1; // global version counter: (id, version) uniquely identifies element content
let undoStack = [];
let redoStack = [];
const cache = new Map();

const rid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
const rseed = () => Math.floor(Math.random() * 2 ** 31);
const touch = (el) => { el.version = ++VC; };
const byId = (id) => elements.find((e) => e.id === id);
const selectedElements = () => elements.filter((e) => selected.has(e.id));
const fontOf = (el) => FONT[el.fontFamily] || FONT[1];
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const col = (c, theme) => (theme === 'dark' && c ? DARK_MAP[c.toLowerCase()] || c : c);

// ---------- geometry ----------
function rotate(px, py, cx, cy, a) {
  const c = Math.cos(a), s = Math.sin(a), dx = px - cx, dy = py - cy;
  return [cx + dx * c - dy * s, cy + dx * s + dy * c];
}
function bounds(el) {
  if (el.points) {
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    for (const [px, py] of el.points) { x1 = Math.min(x1, px); y1 = Math.min(y1, py); x2 = Math.max(x2, px); y2 = Math.max(y2, py); }
    return [el.x + x1, el.y + y1, el.x + x2, el.y + y2];
  }
  return [el.x, el.y, el.x + el.width, el.y + el.height];
}
function center(el) {
  const [x1, y1, x2, y2] = bounds(el);
  return [(x1 + x2) / 2, (y1 + y2) / 2];
}
function aabb(el) {
  const [x1, y1, x2, y2] = bounds(el);
  if (!el.angle) return [x1, y1, x2, y2];
  const [cx, cy] = center(el);
  const pts = [[x1, y1], [x2, y1], [x2, y2], [x1, y2]].map(([x, y]) => rotate(x, y, cx, cy, el.angle));
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}
function unionBounds(els) {
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const el of els) {
    const b = aabb(el);
    x1 = Math.min(x1, b[0]); y1 = Math.min(y1, b[1]); x2 = Math.max(x2, b[2]); y2 = Math.max(y2, b[3]);
  }
  return [x1, y1, x2, y2];
}
function distToSeg(px, py, [ax, ay], [bx, by]) {
  const dx = bx - ax, dy = by - ay, l = dx * dx + dy * dy;
  const t = l ? clamp(((px - ax) * dx + (py - ay) * dy) / l, 0, 1) : 0;
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
}
const toScene = (sx, sy) => [sx / app.zoom - app.scrollX, sy / app.zoom - app.scrollY];
function snapAngle(dx, dy) {
  const step = Math.PI / 12, a = Math.round(Math.atan2(dy, dx) / step) * step, d = Math.hypot(dx, dy);
  return [Math.cos(a) * d, Math.sin(a) * d];
}

// ---------- elements ----------
function measureText(el) {
  mctx.font = `${el.fontSize}px ${fontOf(el)}`;
  const lines = el.text.split('\n');
  el.width = Math.max(1, ...lines.map((l) => mctx.measureText(l).width));
  el.height = lines.length * el.fontSize * LINE_H;
}
function newElement(type, x, y) {
  const c = app.current;
  const el = {
    id: rid(), type, x, y, width: 0, height: 0, angle: 0,
    strokeColor: c.strokeColor, backgroundColor: CLOSED.has(type) ? c.backgroundColor : 'transparent',
    fillStyle: c.fillStyle, strokeWidth: c.strokeWidth, strokeStyle: c.strokeStyle, roughness: c.roughness,
    opacity: c.opacity, roundness: c.roundness && (type === 'rectangle' || LINEAR.has(type)) ? { type: LINEAR.has(type) ? 2 : 3 } : null,
    seed: rseed(), version: ++VC, isDeleted: false,
  };
  if (LINEAR.has(type)) {
    el.points = [[0, 0], [0, 0]];
    el.startArrowhead = type === 'arrow' ? c.startArrowhead : null;
    el.endArrowhead = type === 'arrow' ? c.endArrowhead : null;
  }
  if (type === 'freedraw') el.points = [[0, 0]];
  if (type === 'text') Object.assign(el, { text: '', fontSize: c.fontSize, fontFamily: c.fontFamily, textAlign: c.textAlign, verticalAlign: 'top' });
  return el;
}
function sanitize(list) {
  return (Array.isArray(list) ? list : [])
    .filter((e) => e && TYPES.has(e.type) && !e.isDeleted)
    .map((e) => {
      const el = { ...e };
      el.id = typeof e.id === 'string' ? e.id : rid();
      for (const [k, d] of [['x', 0], ['y', 0], ['width', 0], ['height', 0], ['angle', 0], ['strokeWidth', 2], ['roughness', 1], ['opacity', 100]]) {
        el[k] = Number.isFinite(+e[k]) ? +e[k] : d;
      }
      el.strokeColor = e.strokeColor || '#1e1e1e';
      el.backgroundColor = e.backgroundColor || 'transparent';
      el.fillStyle = e.fillStyle || 'hachure';
      el.strokeStyle = e.strokeStyle || 'solid';
      el.seed = Number.isFinite(e.seed) ? e.seed : rseed();
      el.roundness = e.roundness || null;
      if (el.type === 'line' || el.type === 'arrow' || el.type === 'freedraw') {
        el.points = Array.isArray(e.points) && e.points.length ? e.points.map((p) => [+p[0] || 0, +p[1] || 0]) : [[0, 0], [0, 0]];
      } else delete el.points;
      if (el.type === 'arrow') { el.endArrowhead = e.endArrowhead === undefined ? 'arrow' : e.endArrowhead; el.startArrowhead = e.startArrowhead || null; }
      if (el.type === 'text') {
        el.text = String(e.text ?? '');
        el.fontSize = +e.fontSize || 20;
        el.fontFamily = FONT[e.fontFamily] ? e.fontFamily : 1;
        el.textAlign = e.textAlign || 'left';
        measureText(el);
      }
      el.version = ++VC;
      return el;
    });
}
function serialize(el) {
  const out = { ...el, groupIds: [], frameId: null, boundElements: null, link: null, locked: false, updated: Date.now(), versionNonce: rseed() };
  if (el.points) {
    const [x1, y1, x2, y2] = bounds(el);
    out.width = x2 - x1;
    out.height = y2 - y1;
    if (LINEAR.has(el.type)) Object.assign(out, { lastCommittedPoint: null, startBinding: null, endBinding: null });
    else Object.assign(out, { pressures: [], simulatePressure: true });
  }
  if (el.type === 'text') Object.assign(out, { originalText: el.text, lineHeight: LINE_H, containerId: null, autoResize: true });
  return out;
}

// ---------- rendering ----------
function roughOpts(el, theme) {
  const o = {
    seed: el.seed, roughness: el.roughness, bowing: 1, stroke: col(el.strokeColor, theme), strokeWidth: el.strokeWidth,
    preserveVertices: el.roughness < 2, disableMultiStroke: el.strokeStyle !== 'solid',
  };
  if (el.strokeStyle === 'dashed') { o.strokeLineDash = [8, 8 + el.strokeWidth]; o.strokeWidth += 0.5; }
  if (el.strokeStyle === 'dotted') { o.strokeLineDash = [1.5, 6 + el.strokeWidth]; o.strokeWidth += 0.5; }
  if (CLOSED.has(el.type) && el.backgroundColor !== 'transparent') {
    Object.assign(o, { fill: col(el.backgroundColor, theme), fillStyle: el.fillStyle, fillWeight: el.strokeWidth / 2, hachureGap: el.strokeWidth * 4 });
  }
  return o;
}
function arrowhead(el, pts, atStart, kind, o) {
  const [tip, prev] = atStart ? [pts[0], pts[1]] : [pts[pts.length - 1], pts[pts.length - 2]];
  const dx = tip[0] - prev[0], dy = tip[1] - prev[1], dist = Math.hypot(dx, dy);
  if (dist < 1) return [];
  const size = Math.min(16 + el.strokeWidth * 3, dist * 0.6), a = Math.atan2(dy, dx), spread = 0.45;
  const p1 = [tip[0] - size * Math.cos(a - spread), tip[1] - size * Math.sin(a - spread)];
  const p2 = [tip[0] - size * Math.cos(a + spread), tip[1] - size * Math.sin(a + spread)];
  const ho = { ...o, strokeLineDash: undefined };
  if (kind === 'triangle') return [gen.polygon([tip, p1, p2], { ...ho, fill: o.stroke, fillStyle: 'solid' })];
  return [gen.linearPath([p1, tip, p2], ho)];
}
function buildShapes(el, theme) {
  const o = roughOpts(el, theme), w = el.width, h = el.height;
  switch (el.type) {
    case 'rectangle': {
      if (!el.roundness) return [gen.rectangle(0, 0, w, h, o)];
      const r = Math.min(32, Math.min(w, h) * 0.25);
      return [gen.path(`M ${r} 0 L ${w - r} 0 Q ${w} 0, ${w} ${r} L ${w} ${h - r} Q ${w} ${h}, ${w - r} ${h} L ${r} ${h} Q 0 ${h}, 0 ${h - r} L 0 ${r} Q 0 0, ${r} 0`, o)];
    }
    case 'diamond': return [gen.polygon([[w / 2, 0], [w, h / 2], [w / 2, h], [0, h / 2]], o)];
    case 'ellipse': return [gen.ellipse(w / 2, h / 2, w, h, o)];
    case 'line': case 'arrow': {
      const pts = el.points;
      const out = [el.roundness && pts.length > 2 ? gen.curve(pts, o) : gen.linearPath(pts, o)];
      if (pts.length > 1) {
        if (el.endArrowhead) out.push(...arrowhead(el, pts, false, el.endArrowhead, o));
        if (el.startArrowhead) out.push(...arrowhead(el, pts, true, el.startArrowhead, o));
      }
      return out;
    }
  }
  return [];
}
function drawables(el, theme) {
  const key = el.version + theme;
  const hit = cache.get(el.id);
  if (hit && hit.key === key) return hit.d;
  const d = buildShapes(el, theme);
  cache.set(el.id, { key, d });
  return d;
}
function freedrawPath(pts) {
  if (pts.length === 1) return `M ${pts[0][0]} ${pts[0][1]} L ${pts[0][0] + 0.01} ${pts[0][1]}`;
  let d = `M ${pts[0][0]} ${pts[0][1]}`;
  for (let i = 1; i < pts.length - 1; i++) {
    d += ` Q ${pts[i][0]} ${pts[i][1]} ${(pts[i][0] + pts[i + 1][0]) / 2} ${(pts[i][1] + pts[i + 1][1]) / 2}`;
  }
  const l = pts[pts.length - 1];
  return d + ` L ${l[0]} ${l[1]}`;
}
const freedrawWidth = (el) => el.strokeWidth * 1.25 + 1;

function drawElement(c, r, el, theme) {
  if (CLOSED.has(el.type) && el.width < 0.5 && el.height < 0.5) return;
  c.save();
  c.globalAlpha = (el.opacity / 100) * (erasing.has(el.id) ? 0.2 : 1);
  if (el.angle) {
    const [cx, cy] = center(el);
    c.translate(cx, cy); c.rotate(el.angle); c.translate(-cx, -cy);
  }
  c.translate(el.x, el.y);
  if (el.type === 'text') {
    c.font = `${el.fontSize}px ${fontOf(el)}`;
    c.fillStyle = col(el.strokeColor, theme);
    c.textBaseline = 'top';
    c.textAlign = el.textAlign;
    const lh = el.fontSize * LINE_H, x = el.textAlign === 'center' ? el.width / 2 : el.textAlign === 'right' ? el.width : 0;
    el.text.split('\n').forEach((line, i) => c.fillText(line, x, i * lh + (lh - el.fontSize) / 2));
  } else if (el.type === 'freedraw') {
    c.strokeStyle = col(el.strokeColor, theme);
    c.lineWidth = freedrawWidth(el);
    c.lineCap = c.lineJoin = 'round';
    c.stroke(new Path2D(freedrawPath(el.points)));
  } else {
    for (const d of drawables(el, theme)) r.draw(d);
  }
  c.restore();
}

let frame = 0;
const render = () => { if (!frame) frame = requestAnimationFrame(draw); };
function draw() {
  frame = 0;
  const dpr = devicePixelRatio || 1, z = app.zoom;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = app.theme === 'dark' ? '#1e1e2e' : '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(dpr * z, 0, 0, dpr * z, dpr * z * app.scrollX, dpr * z * app.scrollY);
  const [vx1, vy1] = toScene(0, 0), [vx2, vy2] = toScene(innerWidth, innerHeight);
  for (const el of elements) {
    if (editing && el.id === editing.id) continue;
    const b = aabb(el), m = 50;
    if (b[2] < vx1 - m || b[0] > vx2 + m || b[3] < vy1 - m || b[1] > vy2 + m) continue;
    drawElement(ctx, rc, el, app.theme);
  }
  drawSelection();
  if (action?.type === 'rubber') {
    const { x0, y0, x1, y1 } = action;
    ctx.fillStyle = app.theme === 'dark' ? 'rgba(203,166,247,0.1)' : 'rgba(105,101,219,0.08)';
    ctx.strokeStyle = accent();
    ctx.lineWidth = 1 / z;
    ctx.fillRect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0));
    ctx.strokeRect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0));
  }
  updateChrome();
}
const accent = () => (app.theme === 'dark' ? '#cba6f7' : '#6965db');

function handlesFor(el) {
  const z = app.zoom, out = [];
  if (el.points && LINEAR.has(el.type)) el.points.forEach((p, i) => out.push({ name: 'p' + i, x: el.x + p[0], y: el.y + p[1], point: true }));
  if (el.points && LINEAR.has(el.type) && el.points.length <= 2) return out;
  const [x1, y1, x2, y2] = bounds(el), pad = 4 / z, mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
  const L = x1 - pad, T = y1 - pad, R = x2 + pad, B = y2 + pad;
  const corners = [['nw', L, T], ['ne', R, T], ['se', R, B], ['sw', L, B]];
  const sides = [['n', mx, T], ['e', R, my], ['s', mx, B], ['w', L, my]];
  for (const [name, x, y] of el.type === 'text' ? corners : [...corners, ...sides]) out.push({ name, x, y });
  out.push({ name: 'rotation', x: mx, y: T - 20 / z });
  return out;
}
function drawSelection() {
  const sel = selectedElements();
  if (!sel.length || (action && ['create', 'linear', 'freedraw'].includes(action.type)) || multi) return;
  const z = app.zoom, pad = 4 / z;
  ctx.save();
  ctx.strokeStyle = accent();
  ctx.lineWidth = 1 / z;
  for (const el of sel) {
    ctx.save();
    if (el.angle) { const [cx, cy] = center(el); ctx.translate(cx, cy); ctx.rotate(el.angle); ctx.translate(-cx, -cy); }
    const [x1, y1, x2, y2] = bounds(el);
    ctx.setLineDash(sel.length > 1 ? [4 / z, 4 / z] : []);
    if (!(sel.length === 1 && LINEAR.has(el.type) && el.points.length <= 2)) ctx.strokeRect(x1 - pad, y1 - pad, x2 - x1 + 2 * pad, y2 - y1 + 2 * pad);
    if (sel.length === 1) {
      ctx.setLineDash([]);
      ctx.fillStyle = app.theme === 'dark' ? '#1e1e2e' : '#ffffff';
      for (const h of handlesFor(el)) {
        ctx.beginPath();
        if (h.point || h.name === 'rotation') ctx.arc(h.x, h.y, (h.point ? 5 : 4) / z, 0, Math.PI * 2);
        else ctx.roundRect(h.x - 4 / z, h.y - 4 / z, 8 / z, 8 / z, 2 / z);
        ctx.fill(); ctx.stroke();
      }
    }
    ctx.restore();
  }
  if (sel.length > 1) {
    const [x1, y1, x2, y2] = unionBounds(sel), p = 8 / z;
    ctx.setLineDash([]);
    ctx.strokeRect(x1 - p, y1 - p, x2 - x1 + 2 * p, y2 - y1 + 2 * p);
  }
  ctx.restore();
}

// ---------- hit testing ----------
function hitElement(el, x, y) {
  const t = 8 / app.zoom + el.strokeWidth / 2;
  let px = x, py = y;
  if (el.angle) { const [cx, cy] = center(el); [px, py] = rotate(x, y, cx, cy, -el.angle); }
  const [x1, y1, x2, y2] = bounds(el);
  if (px < x1 - t || px > x2 + t || py < y1 - t || py > y2 + t) return false;
  const filled = el.backgroundColor !== 'transparent';
  const a = (x2 - x1) / 2, b = (y2 - y1) / 2, cx = x1 + a, cy = y1 + b;
  switch (el.type) {
    case 'text': return true;
    case 'rectangle': return filled || !(px > x1 + t && px < x2 - t && py > y1 + t && py < y2 - t);
    case 'ellipse': {
      if (a < 1 || b < 1) return true;
      const d = Math.hypot((px - cx) / a, (py - cy) / b);
      return (filled && d <= 1) || Math.abs(d - 1) * Math.min(a, b) <= t;
    }
    case 'diamond': {
      if (a < 1 || b < 1) return true;
      const k = Math.abs(px - cx) / a + Math.abs(py - cy) / b;
      return (filled && k <= 1) || Math.abs(k - 1) * Math.min(a, b) <= t;
    }
    default: {
      const pts = el.points.map((p) => [el.x + p[0], el.y + p[1]]);
      const tt = el.type === 'freedraw' ? t + freedrawWidth(el) / 2 : t;
      if (pts.length === 1) return Math.hypot(px - pts[0][0], py - pts[0][1]) <= tt;
      for (let i = 0; i < pts.length - 1; i++) if (distToSeg(px, py, pts[i], pts[i + 1]) <= tt) return true;
      return false;
    }
  }
}
function hitTest(x, y) {
  for (let i = elements.length - 1; i >= 0; i--) if (hitElement(elements[i], x, y)) return elements[i];
  return null;
}
function hitHandle(el, x, y) {
  const [cx, cy] = center(el);
  const [px, py] = el.angle ? rotate(x, y, cx, cy, -el.angle) : [x, y];
  const tol = 7 / app.zoom;
  return handlesFor(el).find((h) => Math.abs(px - h.x) <= tol && Math.abs(py - h.y) <= tol) || null;
}

// ---------- history & persistence ----------
function commit() {
  const snap = JSON.stringify(elements);
  if (snap === undoStack[undoStack.length - 1]) return;
  undoStack.push(snap);
  if (undoStack.length > 200) undoStack.shift();
  redoStack = [];
  save();
}
function restore(snap) {
  elements = JSON.parse(snap);
  for (const el of elements) el.version = ++VC;
  selected = new Set([...selected].filter((id) => byId(id)));
  save(); render(); renderPanel();
}
function undo() {
  if (multi) finishMulti();
  if (undoStack.length < 2) return;
  redoStack.push(undoStack.pop());
  restore(undoStack[undoStack.length - 1]);
}
function redo() {
  if (!redoStack.length) return;
  const s = redoStack.pop();
  undoStack.push(s);
  restore(s);
}
let saveTimer = 0;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(STORAGE.elements, JSON.stringify(elements.map(serialize)));
      localStorage.setItem(STORAGE.state, JSON.stringify({ zoom: app.zoom, scrollX: app.scrollX, scrollY: app.scrollY, current: app.current, locked: app.locked }));
      localStorage.setItem(STORAGE.theme, app.theme);
    } catch (err) {
      toast('Could not save to browser storage');
    }
  }, 250);
}
function loadLocal() {
  try {
    elements = sanitize(JSON.parse(localStorage.getItem(STORAGE.elements) || '[]'));
    const st = JSON.parse(localStorage.getItem(STORAGE.state) || '{}');
    if (Number.isFinite(st.zoom)) app.zoom = clamp(st.zoom, 0.1, 30);
    if (Number.isFinite(st.scrollX)) app.scrollX = st.scrollX;
    if (Number.isFinite(st.scrollY)) app.scrollY = st.scrollY;
    app.current = { ...DEFAULTS, ...(st.current || {}) };
    app.locked = !!st.locked;
    app.theme = localStorage.getItem(STORAGE.theme) === 'dark' ? 'dark' : 'light';
  } catch {
    elements = [];
  }
}

// ---------- tools ----------
function setTool(tool) {
  if (multi) finishMulti();
  if (editing) commitText();
  app.tool = tool;
  if (tool !== 'selection') selected.clear();
  renderToolbar(); renderPanel(); updateCursor(); render();
}
function finishMulti() {
  const el = multi;
  multi = null;
  lastFinish = performance.now();
  el.points.pop();
  touch(el);
  if (el.points.length < 2) elements = elements.filter((e) => e !== el);
  else {
    selected = new Set([el.id]);
    if (!app.locked) app.tool = 'selection';
  }
  commit(); renderToolbar(); renderPanel(); render();
}

// ---------- text editing ----------
const ta = $('#text-editor');
function startEdit(el) {
  editing = el;
  selected = new Set([el.id]);
  ta.value = el.text;
  positionEditor();
  ta.style.display = 'block';
  requestAnimationFrame(() => { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); });
  renderPanel(); render();
}
function positionEditor() {
  const el = editing, z = app.zoom;
  const w = Math.max(el.width, 4) * z + 24, h = Math.max(el.height, el.fontSize * LINE_H) * z;
  const shift = el.textAlign === 'center' ? 12 : el.textAlign === 'right' ? 24 : 0;
  Object.assign(ta.style, {
    left: `${(el.x + app.scrollX) * z - shift}px`, top: `${(el.y + app.scrollY) * z}px`,
    width: `${w}px`, height: `${h}px`, font: `${el.fontSize * z}px ${fontOf(el)}`, lineHeight: String(LINE_H),
    color: col(el.strokeColor, app.theme), textAlign: el.textAlign, opacity: el.opacity / 100,
    transform: el.angle ? `rotate(${el.angle}rad)` : '', transformOrigin: `${w / 2}px ${h / 2}px`,
  });
}
ta.addEventListener('input', () => {
  editing.text = ta.value;
  measureText(editing);
  touch(editing);
  positionEditor();
});
ta.addEventListener('keydown', (e) => {
  e.stopPropagation();
  if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) { e.preventDefault(); commitText(); }
});
ta.addEventListener('blur', () => commitText());
function commitText() {
  if (!editing) return;
  const el = editing;
  editing = null;
  ta.style.display = 'none';
  el.text = el.text.replace(/\s+$/, '');
  if (!el.text.trim()) {
    elements = elements.filter((e) => e !== el);
    selected.delete(el.id);
  } else {
    measureText(el);
    touch(el);
    selected = new Set([el.id]);
    if (!app.locked) app.tool = 'selection';
  }
  commit(); renderToolbar(); renderPanel(); render();
}

// ---------- pointer ----------
canvas.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  hideMenu();
  if (editing) { commitText(); return; }
  canvas.setPointerCapture(e.pointerId);
  const [x, y] = toScene(e.clientX, e.clientY);
  lastPointer = [x, y];
  if (e.button === 1 || spaceDown || app.tool === 'hand') {
    action = { type: 'pan', cx: e.clientX, cy: e.clientY, sx: app.scrollX, sy: app.scrollY };
    updateCursor();
    return;
  }
  if (e.button !== 0) return;
  if (multi) {
    const el = multi, pts = el.points, last = pts[pts.length - 2];
    if (Math.hypot(x - el.x - last[0], y - el.y - last[1]) < 8 / app.zoom) { finishMulti(); return; }
    pts.push([...pts[pts.length - 1]]);
    touch(el); render();
    return;
  }
  const tool = app.tool;
  if (tool === 'selection') return selectionDown(e, x, y);
  if (CLOSED.has(tool)) {
    const el = newElement(tool, x, y);
    elements.push(el);
    action = { type: 'create', el, ox: x, oy: y };
  } else if (LINEAR.has(tool)) {
    const el = newElement(tool, x, y);
    elements.push(el);
    action = { type: 'linear', el, ox: x, oy: y, moved: false };
  } else if (tool === 'freedraw') {
    const el = newElement(tool, x, y);
    elements.push(el);
    action = { type: 'freedraw', el };
  } else if (tool === 'text') {
    const el = newElement('text', x, y - (app.current.fontSize * LINE_H) / 2);
    measureText(el);
    elements.push(el);
    startEdit(el);
  } else if (tool === 'eraser') {
    action = { type: 'erase', last: [x, y] };
    eraseAlong(x, y, x, y);
  }
  render();
});

function selectionDown(e, x, y) {
  const sel = selectedElements();
  if (sel.length === 1) {
    const el = sel[0], h = hitHandle(el, x, y);
    if (h) {
      if (h.name === 'rotation') {
        const [cx, cy] = center(el);
        action = { type: 'rotate', el, cx, cy, orig: el.angle || 0, start: Math.atan2(y - cy, x - cx) };
      } else if (h.point) {
        action = { type: 'point', el, index: +h.name.slice(1), center: center(el) };
      } else {
        action = { type: 'resize', el, handle: h.name, orig: structuredClone(el), ob: bounds(el), center: center(el) };
      }
      return;
    }
  }
  const hit = hitTest(x, y);
  const insideSelection = !hit && sel.length && (() => { const [x1, y1, x2, y2] = unionBounds(sel); return x >= x1 && x <= x2 && y >= y1 && y <= y2; })();
  if (hit || insideSelection) {
    if (hit && e.shiftKey) {
      if (selected.has(hit.id)) { selected.delete(hit.id); renderPanel(); render(); return; }
      selected.add(hit.id);
    } else if (hit && !selected.has(hit.id)) selected = new Set([hit.id]);
    if (e.altKey) duplicateSelection(0);
    action = { type: 'move', start: [x, y], orig: new Map(selectedElements().map((el) => [el.id, [el.x, el.y]])), moved: false };
  } else {
    if (!e.shiftKey) selected.clear();
    action = { type: 'rubber', x0: x, y0: y, x1: x, y1: y, base: new Set(selected) };
  }
  renderPanel(); render();
}

canvas.addEventListener('pointermove', (e) => {
  const [x, y] = toScene(e.clientX, e.clientY);
  lastPointer = [x, y];
  if (multi && !action) {
    const el = multi, pts = el.points, prev = pts[pts.length - 2];
    let dx = x - el.x - prev[0], dy = y - el.y - prev[1];
    if (e.shiftKey) [dx, dy] = snapAngle(dx, dy);
    pts[pts.length - 1] = [prev[0] + dx, prev[1] + dy];
    touch(el); render();
    return;
  }
  if (!action) { updateCursor(x, y); return; }
  const z = app.zoom, a = action;
  switch (a.type) {
    case 'pan':
      app.scrollX = a.sx + (e.clientX - a.cx) / z;
      app.scrollY = a.sy + (e.clientY - a.cy) / z;
      break;
    case 'create': {
      let w = x - a.ox, h = y - a.oy;
      if (e.shiftKey) { const m = Math.max(Math.abs(w), Math.abs(h)); w = Math.sign(w || 1) * m; h = Math.sign(h || 1) * m; }
      let x0 = a.ox, y0 = a.oy;
      if (e.altKey) { x0 -= w; y0 -= h; w *= 2; h *= 2; }
      Object.assign(a.el, { x: Math.min(x0, x0 + w), y: Math.min(y0, y0 + h), width: Math.abs(w), height: Math.abs(h) });
      touch(a.el);
      break;
    }
    case 'linear': {
      let dx = x - a.ox, dy = y - a.oy;
      if (e.shiftKey) [dx, dy] = snapAngle(dx, dy);
      a.el.points[1] = [dx, dy];
      if (Math.hypot(dx, dy) > 4 / z) a.moved = true;
      touch(a.el);
      break;
    }
    case 'freedraw': {
      const el = a.el, l = el.points[el.points.length - 1], p = [x - el.x, y - el.y];
      if (Math.hypot(p[0] - l[0], p[1] - l[1]) >= 1 / z) { el.points.push(p); touch(el); }
      break;
    }
    case 'move': {
      let dx = x - a.start[0], dy = y - a.start[1];
      if (e.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
      if (Math.hypot(dx, dy) > 0) a.moved = true;
      for (const [id, [ox, oy]] of a.orig) { const el = byId(id); if (el) { el.x = ox + dx; el.y = oy + dy; touch(el); } }
      break;
    }
    case 'resize': doResize(a, x, y, e.shiftKey); break;
    case 'rotate': {
      let ang = a.orig + Math.atan2(y - a.cy, x - a.cx) - a.start;
      if (e.shiftKey) ang = Math.round(ang / (Math.PI / 12)) * (Math.PI / 12);
      a.el.angle = ((ang % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
      touch(a.el);
      break;
    }
    case 'point': {
      const el = a.el, [cx, cy] = a.center;
      const [lx, ly] = el.angle ? rotate(x, y, cx, cy, -el.angle) : [x, y];
      el.points[a.index] = [lx - el.x, ly - el.y];
      touch(el);
      break;
    }
    case 'rubber': {
      Object.assign(a, { x1: x, y1: y });
      const rx1 = Math.min(a.x0, x), ry1 = Math.min(a.y0, y), rx2 = Math.max(a.x0, x), ry2 = Math.max(a.y0, y);
      selected = new Set(a.base);
      for (const el of elements) {
        const [bx1, by1, bx2, by2] = aabb(el);
        if (bx1 >= rx1 && by1 >= ry1 && bx2 <= rx2 && by2 <= ry2) selected.add(el.id);
      }
      renderPanel();
      break;
    }
    case 'erase': eraseAlong(a.last[0], a.last[1], x, y); a.last = [x, y]; break;
  }
  render();
});

function doResize(a, x, y, keepRatio) {
  const el = a.el, o = a.orig, [cx, cy] = a.center, ang = o.angle || 0;
  const [lx, ly] = ang ? rotate(x, y, cx, cy, -ang) : [x, y];
  const [ox1, oy1, ox2, oy2] = a.ob, h = a.handle;
  let [x1, y1, x2, y2] = a.ob;
  if (h.includes('w')) x1 = lx;
  if (h.includes('e')) x2 = lx;
  if (h.includes('n')) y1 = ly;
  if (h.includes('s')) y2 = ly;
  const ow = ox2 - ox1, oh = oy2 - oy1;
  if ((keepRatio || el.type === 'text') && h.length === 2 && ow && oh) {
    const m = Math.max(Math.abs((x2 - x1) / ow), Math.abs((y2 - y1) / oh));
    const sx = Math.sign(x2 - x1 || 1) * m, sy = Math.sign(y2 - y1 || 1) * m;
    if (h.includes('w')) x1 = x2 - ow * sx; else x2 = x1 + ow * sx;
    if (h.includes('n')) y1 = y2 - oh * sy; else y2 = y1 + oh * sy;
  }
  const sx = ow ? (x2 - x1) / ow : 1, sy = oh ? (y2 - y1) / oh : 1;
  if (el.points) {
    el.points = o.points.map(([px, py]) => [px * sx, py * sy]);
    el.x = x1 + (o.x - ox1) * sx;
    el.y = y1 + (o.y - oy1) * sy;
  } else if (el.type === 'text') {
    el.fontSize = Math.max(4, o.fontSize * Math.abs(sy));
    measureText(el);
    el.x = Math.min(x1, x2);
    el.y = Math.min(y1, y2);
  } else {
    Object.assign(el, { x: Math.min(x1, x2), y: Math.min(y1, y2), width: Math.abs(x2 - x1), height: Math.abs(y2 - y1) });
  }
  if (ang) {
    const [ncx, ncy] = center(el), [wx, wy] = rotate(ncx, ncy, cx, cy, ang);
    el.x += wx - ncx;
    el.y += wy - ncy;
  }
  touch(el);
}

function eraseAlong(x0, y0, x1, y1) {
  const steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / (4 / app.zoom)));
  for (let i = 0; i <= steps; i++) {
    const px = x0 + ((x1 - x0) * i) / steps, py = y0 + ((y1 - y0) * i) / steps;
    for (const el of elements) if (!erasing.has(el.id) && hitElement(el, px, py)) erasing.add(el.id);
  }
}

function endPointer() {
  const a = action;
  if (!a) return;
  action = null;
  switch (a.type) {
    case 'create':
      if (a.el.width < 2 && a.el.height < 2) elements = elements.filter((e) => e !== a.el);
      else finishCreate(a.el);
      break;
    case 'linear':
      if (!a.moved) { multi = a.el; selected.clear(); }
      else finishCreate(a.el);
      break;
    case 'freedraw':
      commit();
      break;
    case 'move': case 'resize': case 'rotate': case 'point':
      commit();
      break;
    case 'erase':
      if (erasing.size) {
        elements = elements.filter((e) => !erasing.has(e.id));
        for (const id of erasing) selected.delete(id);
        erasing = new Set();
        commit();
      }
      break;
  }
  renderPanel(); updateCursor(...lastPointer); render();
}
function finishCreate(el) {
  selected = new Set([el.id]);
  if (!app.locked) { app.tool = 'selection'; renderToolbar(); }
  commit();
}
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);

canvas.addEventListener('dblclick', (e) => {
  if (app.tool !== 'selection' || multi || performance.now() - lastFinish < 500) return;
  const [x, y] = toScene(e.clientX, e.clientY);
  const hit = hitTest(x, y);
  if (hit?.type === 'text') { startEdit(hit); return; }
  if (hit && hit.points) return;
  const el = newElement('text', x, y - (app.current.fontSize * LINE_H) / 2);
  measureText(el);
  elements.push(el);
  startEdit(el);
});

canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  if (e.ctrlKey || e.metaKey) {
    zoomAt(app.zoom * Math.exp(-clamp(e.deltaY, -50, 50) * 0.006), e.clientX, e.clientY);
  } else {
    const dx = e.shiftKey && !e.deltaX ? e.deltaY : e.deltaX, dy = e.shiftKey && !e.deltaX ? 0 : e.deltaY;
    app.scrollX -= dx / app.zoom;
    app.scrollY -= dy / app.zoom;
    save();
  }
  if (editing) positionEditor();
  render();
}, { passive: false });

function zoomAt(nz, sx = innerWidth / 2, sy = innerHeight / 2) {
  nz = clamp(nz, 0.1, 30);
  const [px, py] = toScene(sx, sy);
  app.zoom = nz;
  app.scrollX = sx / nz - px;
  app.scrollY = sy / nz - py;
  if (editing) positionEditor();
  save(); render();
}
function zoomStep(dir) { zoomAt(Math.round((app.zoom + dir * 0.1) * 10) / 10); }
function fitToContent() {
  if (!elements.length) return;
  const [x1, y1, x2, y2] = unionBounds(elements), pad = 60;
  const z = clamp(Math.min(innerWidth / (x2 - x1 + pad * 2), innerHeight / (y2 - y1 + pad * 2)), 0.1, 2);
  app.zoom = z;
  app.scrollX = innerWidth / (2 * z) - (x1 + x2) / 2;
  app.scrollY = innerHeight / (2 * z) - (y1 + y2) / 2;
  save(); render();
}

function updateCursor(x, y) {
  let c = 'default';
  if (action?.type === 'pan') c = 'grabbing';
  else if (spaceDown || app.tool === 'hand') c = 'grab';
  else if (app.tool === 'text') c = 'text';
  else if (app.tool !== 'selection') c = 'crosshair';
  else if (x !== undefined) {
    const sel = selectedElements();
    const h = sel.length === 1 && hitHandle(sel[0], x, y);
    if (h) c = h.name === 'rotation' ? 'grab' : h.point ? 'pointer' : { n: 'ns', s: 'ns', e: 'ew', w: 'ew', nw: 'nwse', se: 'nwse', ne: 'nesw', sw: 'nesw' }[h.name] + '-resize';
    else if (hitTest(x, y)) c = 'move';
  }
  canvas.style.cursor = c;
}

// ---------- editing commands ----------
function deleteSelection() {
  if (!selected.size) return;
  elements = elements.filter((e) => !selected.has(e.id));
  selected.clear();
  commit(); renderPanel(); render();
}
function duplicateSelection(offset = 10) {
  const sel = selectedElements();
  if (!sel.length) return;
  const copies = sel.map((el) => ({ ...structuredClone(el), id: rid(), seed: rseed(), x: el.x + offset, y: el.y + offset, version: ++VC }));
  const lastIndex = Math.max(...sel.map((el) => elements.indexOf(el)));
  elements.splice(lastIndex + 1, 0, ...copies);
  selected = new Set(copies.map((c) => c.id));
  if (offset) { commit(); renderPanel(); render(); }
}
function reorder(kind) {
  const isSel = (el) => selected.has(el.id);
  if (kind === 'front') elements = [...elements.filter((e) => !isSel(e)), ...elements.filter(isSel)];
  else if (kind === 'back') elements = [...elements.filter(isSel), ...elements.filter((e) => !isSel(e))];
  else if (kind === 'forward') {
    for (let i = elements.length - 2; i >= 0; i--) if (isSel(elements[i]) && !isSel(elements[i + 1])) [elements[i], elements[i + 1]] = [elements[i + 1], elements[i]];
  } else {
    for (let i = 1; i < elements.length; i++) if (isSel(elements[i]) && !isSel(elements[i - 1])) [elements[i], elements[i - 1]] = [elements[i - 1], elements[i]];
  }
  commit(); render();
}
function insertElements(list, at) {
  const els = sanitize(list).map((el) => ({ ...el, id: rid(), seed: rseed() }));
  if (!els.length) return;
  const [x1, y1, x2, y2] = unionBounds(els), dx = at[0] - (x1 + x2) / 2, dy = at[1] - (y1 + y2) / 2;
  for (const el of els) { el.x += dx; el.y += dy; }
  elements.push(...els);
  selected = new Set(els.map((e) => e.id));
  app.tool = 'selection';
  commit(); renderToolbar(); renderPanel(); render();
}

const isTyping = (t) => t instanceof Element && t.closest('input, textarea, select');
document.addEventListener('copy', (e) => {
  if (isTyping(e.target) || !selected.size) return;
  e.clipboardData.setData('text/plain', JSON.stringify({ type: 'excalidraw/clipboard', elements: selectedElements().map(serialize) }));
  e.preventDefault();
});
document.addEventListener('cut', (e) => {
  if (isTyping(e.target) || !selected.size) return;
  e.clipboardData.setData('text/plain', JSON.stringify({ type: 'excalidraw/clipboard', elements: selectedElements().map(serialize) }));
  e.preventDefault();
  deleteSelection();
});
document.addEventListener('paste', (e) => {
  if (isTyping(e.target)) return;
  const text = e.clipboardData.getData('text/plain');
  if (!text) return;
  e.preventDefault();
  try {
    const data = JSON.parse(text);
    if (data?.type === 'excalidraw/clipboard' || data?.type === 'excalidraw') return insertElements(data.elements, lastPointer);
  } catch { /* plain text */ }
  const el = newElement('text', ...lastPointer);
  el.text = text.replace(/\r\n?/g, '\n').replace(/\t/g, '    ');
  measureText(el);
  el.x -= el.width / 2;
  el.y -= el.height / 2;
  elements.push(el);
  selected = new Set([el.id]);
  commit(); renderPanel(); render();
});

// ---------- keyboard ----------
window.addEventListener('keydown', (e) => {
  if (isTyping(e.target)) return;
  if (!$('#help-modal').hidden) { if (e.key === 'Escape') toggleHelp(false); return; }
  const k = e.key.toLowerCase(), mod = e.ctrlKey || e.metaKey;
  if (e.key === ' ') { e.preventDefault(); if (!spaceDown) { spaceDown = true; updateCursor(); } return; }
  if (mod) {
    const handled = {
      z: () => (e.shiftKey ? redo() : undo()), y: redo, a: selectAll, d: () => duplicateSelection(),
      s: saveFile, o: () => $('#file-input').click(), '=': () => zoomStep(1), '+': () => zoomStep(1),
      '-': () => zoomStep(-1), 0: () => zoomAt(1),
    };
    if (e.code === 'BracketRight') { e.preventDefault(); return reorder(e.shiftKey ? 'front' : 'forward'); }
    if (e.code === 'BracketLeft') { e.preventDefault(); return reorder(e.shiftKey ? 'back' : 'backward'); }
    if (e.shiftKey && k === 'e') { e.preventDefault(); return exportPNG(); }
    if (handled[k]) { e.preventDefault(); handled[k](); }
    return;
  }
  if (e.altKey && e.shiftKey && e.code === 'KeyD') { e.preventDefault(); return toggleTheme(); }
  if (e.shiftKey && e.code === 'Digit1') return fitToContent();
  if (e.key === 'Escape') {
    if (multi) return finishMulti();
    hideMenu();
    selected.clear();
    if (app.tool !== 'selection' && !app.locked) setTool('selection');
    renderPanel(); render();
    return;
  }
  if (e.key === 'Enter') {
    if (multi) return finishMulti();
    const sel = selectedElements();
    if (sel.length === 1 && sel[0].type === 'text') { e.preventDefault(); startEdit(sel[0]); }
    return;
  }
  if (e.key === 'Delete' || e.key === 'Backspace') return deleteSelection();
  if (e.key.startsWith('Arrow') && selected.size) {
    e.preventDefault();
    const s = e.shiftKey ? 10 : 1, d = { ArrowLeft: [-s, 0], ArrowRight: [s, 0], ArrowUp: [0, -s], ArrowDown: [0, s] }[e.key];
    for (const el of selectedElements()) { el.x += d[0]; el.y += d[1]; touch(el); }
    commit(); render();
    return;
  }
  if (e.key === '?') return toggleHelp(true);
  if (e.altKey || e.shiftKey) return;
  if (k === 'q') return toggleLock();
  if (TOOL_KEYS[k]) setTool(TOOL_KEYS[k]);
});
window.addEventListener('keyup', (e) => {
  if (e.key === ' ') { spaceDown = false; updateCursor(...lastPointer); }
});
function selectAll() {
  if (multi) finishMulti();
  app.tool = 'selection';
  selected = new Set(elements.map((e) => e.id));
  renderToolbar(); renderPanel(); render();
}

// ---------- files & export ----------
function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
const stamp = () => {
  const d = new Date(), pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
};
function saveFile() {
  const data = { type: 'excalidraw', version: 2, source: location.origin, elements: elements.map(serialize), appState: { viewBackgroundColor: '#ffffff', gridSize: null }, files: {} };
  download(new Blob([JSON.stringify(data, null, 2)], { type: 'application/vnd.excalidraw+json' }), `drawing-${stamp()}.excalidraw`);
  toast('Saved to file');
}
async function openFile(file) {
  try {
    const data = JSON.parse(await file.text());
    const list = data?.type === 'excalidraw' ? data.elements : Array.isArray(data) ? data : null;
    if (!list) throw new Error('not an excalidraw file');
    elements = sanitize(list);
    selected.clear();
    commit(); renderPanel(); fitToContent(); render();
    toast(`Opened ${file.name}`);
  } catch {
    toast("Couldn't open that file. Is it a valid .excalidraw file?");
  }
}
$('#file-input').addEventListener('change', (e) => {
  const f = e.target.files[0];
  if (f) openFile(f);
  e.target.value = '';
});
canvas.addEventListener('dragover', (e) => e.preventDefault());
canvas.addEventListener('drop', (e) => {
  e.preventDefault();
  const f = e.dataTransfer.files[0];
  if (f) openFile(f);
});
function exportPNG() {
  const els = elements;
  if (!els.length) return toast('Nothing to export yet');
  const [bx1, by1, bx2, by2] = unionBounds(els), pad = 20, scale = 2;
  const x1 = bx1 - pad, y1 = by1 - pad, w = bx2 - bx1 + pad * 2, h = by2 - by1 + pad * 2;
  const c = document.createElement('canvas');
  c.width = Math.ceil(w * scale);
  c.height = Math.ceil(h * scale);
  const cx = c.getContext('2d');
  cx.fillStyle = '#ffffff';
  cx.fillRect(0, 0, c.width, c.height);
  cx.setTransform(scale, 0, 0, scale, -x1 * scale, -y1 * scale);
  const r = rough.canvas(c);
  for (const el of els) drawElement(cx, r, el, 'light');
  c.toBlob((b) => download(b, `drawing-${stamp()}.png`));
}
function exportSVG() {
  const els = elements;
  if (!els.length) return toast('Nothing to export yet');
  const NS = 'http://www.w3.org/2000/svg';
  const [bx1, by1, bx2, by2] = unionBounds(els), pad = 20;
  const x1 = bx1 - pad, y1 = by1 - pad, w = bx2 - bx1 + pad * 2, h = by2 - by1 + pad * 2;
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('xmlns', NS);
  svg.setAttribute('viewBox', `${x1} ${y1} ${w} ${h}`);
  svg.setAttribute('width', w);
  svg.setAttribute('height', h);
  const bg = document.createElementNS(NS, 'rect');
  Object.entries({ x: x1, y: y1, width: w, height: h, fill: '#ffffff' }).forEach(([k, v]) => bg.setAttribute(k, v));
  svg.appendChild(bg);
  const rs = rough.svg(svg);
  for (const el of els) {
    const g = document.createElementNS(NS, 'g');
    const [cx, cy] = center(el);
    g.setAttribute('transform', `${el.angle ? `rotate(${(el.angle * 180) / Math.PI} ${cx} ${cy}) ` : ''}translate(${el.x} ${el.y})`);
    if (el.opacity !== 100) g.setAttribute('opacity', el.opacity / 100);
    if (el.type === 'text') {
      const lh = el.fontSize * LINE_H, anchor = { left: 'start', center: 'middle', right: 'end' }[el.textAlign];
      const tx = el.textAlign === 'center' ? el.width / 2 : el.textAlign === 'right' ? el.width : 0;
      el.text.split('\n').forEach((line, i) => {
        const t = document.createElementNS(NS, 'text');
        Object.entries({ x: tx, y: i * lh + (lh - el.fontSize) / 2, 'font-family': fontOf(el), 'font-size': el.fontSize, fill: el.strokeColor, 'text-anchor': anchor, 'dominant-baseline': 'text-before-edge', 'xml:space': 'preserve' })
          .forEach(([k, v]) => t.setAttribute(k, v));
        t.textContent = line;
        g.appendChild(t);
      });
    } else if (el.type === 'freedraw') {
      const p = document.createElementNS(NS, 'path');
      Object.entries({ d: freedrawPath(el.points), stroke: el.strokeColor, 'stroke-width': freedrawWidth(el), fill: 'none', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' })
        .forEach(([k, v]) => p.setAttribute(k, v));
      g.appendChild(p);
    } else {
      for (const d of drawables(el, 'light')) g.appendChild(rs.draw(d));
    }
    svg.appendChild(g);
  }
  download(new Blob([new XMLSerializer().serializeToString(svg)], { type: 'image/svg+xml' }), `drawing-${stamp()}.svg`);
}
function resetCanvas() {
  if (!elements.length || !confirm('This will clear the whole canvas. Are you sure?')) return;
  elements = [];
  selected.clear();
  commit(); renderPanel(); render();
}
function toggleTheme() {
  app.theme = app.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = app.theme;
  $('#theme-label').textContent = app.theme === 'dark' ? 'Light mode' : 'Dark mode';
  $('#menu [data-cmd="theme"] .ic').innerHTML = ICONS[app.theme === 'dark' ? 'sun' : 'moon'];
  if (editing) positionEditor();
  save(); render();
}
function toggleLock() {
  app.locked = !app.locked;
  save(); renderToolbar();
}

// ---------- UI chrome ----------
function iconize(root = document) {
  root.querySelectorAll('[data-icon]').forEach((n) => { n.innerHTML = ICONS[n.dataset.icon] || ''; });
}
function renderToolbar() {
  $('#toolbar').innerHTML = TOOLS.map((t) => {
    if (t === 'sep') return '<span class="sep"></span>';
    const active = t.id === 'lock' ? app.locked : app.tool === t.id;
    const icon = t.id === 'lock' && app.locked ? 'lockClosed' : t.icon;
    return `<button class="icon-btn${active ? ' active' : ''}" data-tool="${t.id}" title="${t.title}"><span class="ic">${ICONS[icon]}</span>${t.key ? `<span class="key">${t.key}</span>` : ''}</button>`;
  }).join('');
  updateHint();
}
$('#toolbar').addEventListener('click', (e) => {
  const b = e.target.closest('[data-tool]');
  if (!b) return;
  if (b.dataset.tool === 'lock') toggleLock();
  else setTool(b.dataset.tool);
  b.blur();
});
function updateHint() {
  const sel = selectedElements();
  const hints = {
    hand: 'Drag to pan the canvas',
    rectangle: 'Hold <kbd>Shift</kbd> for a perfect square, <kbd>Alt</kbd> to draw from the center',
    diamond: 'Hold <kbd>Shift</kbd> for equal sides, <kbd>Alt</kbd> to draw from the center',
    ellipse: 'Hold <kbd>Shift</kbd> for a circle, <kbd>Alt</kbd> to draw from the center',
    arrow: 'Click to start multiple points, drag for single line',
    line: 'Click to start multiple points, drag for single line',
    freedraw: 'Draw freely — the tool stays active until you pick another',
    text: 'Click anywhere to add text — <kbd>Esc</kbd> or <kbd>Ctrl+Enter</kbd> to finish',
    eraser: 'Drag over elements to erase them',
  };
  let h = hints[app.tool] || '';
  if (multi) h = 'Click the last point or press <kbd>Esc</kbd> / <kbd>Enter</kbd> to finish';
  else if (app.tool === 'selection') {
    h = sel.length === 1 ? 'Hold <kbd>Shift</kbd> to keep proportions or snap rotation · <kbd>Alt</kbd>-drag to duplicate'
      : sel.length > 1 ? '<kbd>Ctrl+D</kbd> duplicate · <kbd>Ctrl+]</kbd> bring forward · <kbd>Del</kbd> delete'
      : 'To move canvas, hold <kbd>Scroll wheel</kbd> or <kbd>Space</kbd> while dragging, or use the hand tool';
  }
  $('#tool-hint').innerHTML = h;
}
let lastChrome = '';
function updateChrome() {
  const sig = [Math.round(app.zoom * 100), undoStack.length, redoStack.length, elements.length, app.tool, selected.size, !!multi, !!action].join();
  if (sig === lastChrome) return;
  lastChrome = sig;
  $('#zoom-label').textContent = `${Math.round(app.zoom * 100)}%`;
  $('#undo-btn').disabled = undoStack.length < 2;
  $('#redo-btn').disabled = !redoStack.length;
  $('#welcome').hidden = elements.length > 0 || !!action || !!multi || !!editing;
  updateHint();
}

// ---------- properties panel ----------
const NUMERIC = new Set(['strokeWidth', 'roughness', 'opacity', 'fontSize', 'fontFamily']);
const APPLIES = {
  strokeColor: () => true,
  backgroundColor: (t) => CLOSED.has(t),
  fillStyle: (t) => CLOSED.has(t),
  strokeWidth: (t) => t !== 'text',
  strokeStyle: (t) => CLOSED.has(t) || LINEAR.has(t),
  roughness: (t) => CLOSED.has(t) || LINEAR.has(t),
  roundness: (t) => t === 'rectangle' || LINEAR.has(t),
  startArrowhead: (t) => LINEAR.has(t),
  endArrowhead: (t) => LINEAR.has(t),
  fontSize: (t) => t === 'text',
  fontFamily: (t) => t === 'text',
  textAlign: (t) => t === 'text',
  opacity: () => true,
};
function panelContext() {
  const sel = editing ? [editing] : selectedElements();
  if (sel.length) return { types: [...new Set(sel.map((e) => e.type))], src: sel[0], sel };
  if (DRAW_TOOLS.has(app.tool)) return { types: [app.tool], src: null, sel: [] };
  return null;
}
function renderPanel() {
  const panel = $('#panel'), pc = panelContext();
  if (!pc || action?.type === 'rubber') { panel.hidden = true; updateHint(); return; }
  const { types, src, sel } = pc;
  const has = (prop) => types.some((t) => APPLIES[prop](t));
  const val = (prop) => {
    if (src && APPLIES[prop](src.type)) return prop === 'roundness' ? !!src.roundness : src[prop];
    return app.current[prop];
  };
  const opt = (prop, value, inner, title) =>
    `<button class="opt${val(prop) === value ? ' active' : ''}" data-prop="${prop}" data-value="${value}" title="${title}">${inner}</button>`;
  const swatches = (prop, list) =>
    `<div class="row">${list.map((c) => `<button class="swatch${c === 'transparent' ? ' transparent' : ''}${val(prop) === c ? ' active' : ''}" style="${c === 'transparent' ? '' : `background:${c}`}" data-prop="${prop}" data-value="${c}" title="${c}"></button>`).join('')}<span class="sep-v"></span><input class="custom" type="color" data-color="${prop}" value="${/^#[0-9a-f]{6}$/i.test(val(prop)) ? val(prop) : '#ffffff'}" title="Custom color"></div>`;
  const ic = (name) => `<span class="ic">${ICONS[name]}</span>`;
  let h = '<h3>Stroke</h3>' + swatches('strokeColor', STROKES);
  if (has('backgroundColor')) h += '<h3>Background</h3>' + swatches('backgroundColor', BGS);
  if (has('fillStyle')) h += `<h3>Fill</h3><div class="row">${opt('fillStyle', 'hachure', ic('fillHachure'), 'Hachure')}${opt('fillStyle', 'cross-hatch', ic('fillCross'), 'Cross-hatch')}${opt('fillStyle', 'solid', ic('fillSolid'), 'Solid')}${opt('fillStyle', 'zigzag', ic('fillZigzag'), 'Zigzag')}</div>`;
  if (has('strokeWidth')) h += `<h3>Stroke width</h3><div class="row">${opt('strokeWidth', 1, ic('width1'), 'Thin')}${opt('strokeWidth', 2, ic('width2'), 'Bold')}${opt('strokeWidth', 4, ic('width4'), 'Extra bold')}</div>`;
  if (has('strokeStyle')) h += `<h3>Stroke style</h3><div class="row">${opt('strokeStyle', 'solid', ic('styleSolid'), 'Solid')}${opt('strokeStyle', 'dashed', ic('styleDashed'), 'Dashed')}${opt('strokeStyle', 'dotted', ic('styleDotted'), 'Dotted')}</div>`;
  if (has('roughness')) h += `<h3>Sloppiness</h3><div class="row">${opt('roughness', 0, ic('rough0'), 'Architect')}${opt('roughness', 1, ic('rough1'), 'Artist')}${opt('roughness', 2, ic('rough2'), 'Cartoonist')}</div>`;
  if (has('roundness')) h += `<h3>Edges</h3><div class="row">${opt('roundness', false, ic('edgeSharp'), 'Sharp')}${opt('roundness', true, ic('edgeRound'), 'Round')}</div>`;
  if (has('endArrowhead')) {
    const heads = (prop) => `${opt(prop, null, ic('headNone'), 'None')}${opt(prop, 'arrow', ic('headArrow'), 'Arrow')}${opt(prop, 'triangle', ic('headTriangle'), 'Triangle')}`;
    h += `<h3>Arrowheads (start · end)</h3><div class="row">${heads('startArrowhead')}</div><div class="row" style="margin-top:4px">${heads('endArrowhead')}</div>`;
  }
  if (has('fontSize')) {
    h += `<h3>Font size</h3><div class="row">${opt('fontSize', 16, 'S', 'Small')}${opt('fontSize', 20, 'M', 'Medium')}${opt('fontSize', 28, 'L', 'Large')}${opt('fontSize', 36, 'XL', 'Very large')}</div>`;
    h += `<h3>Font family</h3><div class="row">${opt('fontFamily', 1, '<span style="font:20px Caveat">Aa</span>', 'Hand-drawn')}${opt('fontFamily', 2, '<span style="font:14px system-ui">Aa</span>', 'Normal')}${opt('fontFamily', 3, '<span style="font:13px ui-monospace,monospace">Aa</span>', 'Code')}</div>`;
    h += `<h3>Text align</h3><div class="row">${opt('textAlign', 'left', ic('alignLeft'), 'Left')}${opt('textAlign', 'center', ic('alignCenter'), 'Center')}${opt('textAlign', 'right', ic('alignRight'), 'Right')}</div>`;
  }
  h += `<h3>Opacity</h3><input type="range" min="0" max="100" step="10" value="${val('opacity')}" data-range="opacity">`;
  if (sel.length && !editing) {
    h += `<h3>Layers</h3><div class="row"><button class="opt" data-action="back" title="Send to back (Ctrl+Shift+[)">${ic('toBack')}</button><button class="opt" data-action="backward" title="Send backward (Ctrl+[)">${ic('backward')}</button><button class="opt" data-action="forward" title="Bring forward (Ctrl+])">${ic('forward')}</button><button class="opt" data-action="front" title="Bring to front (Ctrl+Shift+])">${ic('toFront')}</button></div>`;
    h += `<h3>Actions</h3><div class="row"><button class="opt" data-action="duplicate" title="Duplicate (Ctrl+D)">${ic('duplicate')}</button><button class="opt" data-action="delete" title="Delete (Del)">${ic('trash')}</button></div>`;
  }
  panel.innerHTML = h;
  panel.hidden = false;
  updateHint();
}
function parseValue(prop, raw) {
  if (NUMERIC.has(prop)) return +raw;
  if (prop === 'roundness') return raw === 'true';
  if (raw === 'null') return null;
  return raw;
}
function setProp(prop, value, record = true) {
  app.current[prop] = value;
  const targets = editing ? [editing] : selectedElements();
  for (const el of targets) {
    if (!APPLIES[prop](el.type)) continue;
    if (prop === 'roundness') el.roundness = value ? { type: LINEAR.has(el.type) ? 2 : 3 } : null;
    else el[prop] = value;
    if (el.type === 'text') measureText(el);
    touch(el);
  }
  if (editing) positionEditor();
  if (record) commit(); else save();
  render();
}
const panelEl = $('#panel');
panelEl.addEventListener('pointerdown', (e) => { if (editing && e.target.closest('button')) e.preventDefault(); });
panelEl.addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.prop) setProp(b.dataset.prop, parseValue(b.dataset.prop, b.dataset.value));
  const act = b.dataset.action;
  if (act === 'duplicate') duplicateSelection();
  else if (act === 'delete') deleteSelection();
  else if (act) reorder(act);
  renderPanel();
});
panelEl.addEventListener('input', (e) => {
  const t = e.target;
  if (t.dataset.color) setProp(t.dataset.color, t.value, false);
  if (t.dataset.range) setProp(t.dataset.range, +t.value, false);
});
panelEl.addEventListener('change', (e) => {
  if (e.target.dataset.color || e.target.dataset.range) { commit(); renderPanel(); }
});

// ---------- menu, help, toasts ----------
function hideMenu() { $('#menu').hidden = true; }
$('#menu-btn').addEventListener('click', (e) => { e.stopPropagation(); $('#menu').hidden = !$('#menu').hidden; });
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-cmd]');
  if (!e.target.closest('#menu, #menu-btn')) hideMenu();
  if (!b) return;
  const cmds = {
    open: () => $('#file-input').click(), save: saveFile, png: exportPNG, svg: exportSVG, reset: resetCanvas,
    theme: toggleTheme, help: () => toggleHelp(true), 'close-help': () => toggleHelp(false),
    'zoom-in': () => zoomStep(1), 'zoom-out': () => zoomStep(-1), 'zoom-reset': () => zoomAt(1), undo, redo,
  };
  cmds[b.dataset.cmd]?.();
  if (b.closest('#menu')) hideMenu();
  b.blur();
});
$('#help-modal').addEventListener('click', (e) => { if (e.target.id === 'help-modal') toggleHelp(false); });
const SHORTCUTS = {
  Tools: [['Hand (panning)', 'H'], ['Selection', 'V or 1'], ['Rectangle', 'R or 2'], ['Diamond', 'D or 3'], ['Ellipse', 'O or 4'], ['Arrow', 'A or 5'], ['Line', 'L or 6'], ['Draw', 'P or 7'], ['Text', 'T or 8'], ['Eraser', 'E or 0'], ['Keep tool active', 'Q']],
  View: [['Zoom in / out', 'Ctrl + = / -'], ['Reset zoom', 'Ctrl + 0'], ['Zoom to fit', 'Shift + 1'], ['Pan', 'Space + drag, wheel'], ['Zoom at cursor', 'Ctrl + wheel'], ['Dark mode', 'Alt + Shift + D']],
  Editor: [['Undo / Redo', 'Ctrl + Z / Ctrl + Shift + Z'], ['Select all', 'Ctrl + A'], ['Copy / Cut / Paste', 'Ctrl + C / X / V'], ['Duplicate', 'Ctrl + D or Alt + drag'], ['Delete', 'Delete'], ['Nudge', 'Arrows (Shift = 10px)'], ['Bring forward / to front', 'Ctrl + ] / Ctrl + Shift + ]'], ['Send backward / to back', 'Ctrl + [ / Ctrl + Shift + ['], ['Edit text', 'Enter or double-click'], ['Finish line / deselect', 'Esc']],
  File: [['Open', 'Ctrl + O'], ['Save', 'Ctrl + S'], ['Export PNG', 'Ctrl + Shift + E'], ['Help', '?']],
};
$('#help-body').innerHTML = Object.entries(SHORTCUTS).map(([g, list]) =>
  `<section><h4>${g}</h4>${list.map(([a, k]) => `<div class="sc"><span>${a}</span><kbd>${k}</kbd></div>`).join('')}</section>`).join('');
function toggleHelp(show) { $('#help-modal').hidden = !show; }
let toastTimer = 0;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 2500);
}

// ---------- boot ----------
function resize() {
  const dpr = devicePixelRatio || 1;
  canvas.width = Math.round(innerWidth * dpr);
  canvas.height = Math.round(innerHeight * dpr);
  canvas.style.width = `${innerWidth}px`;
  canvas.style.height = `${innerHeight}px`;
  render();
}
window.addEventListener('resize', resize);
window.addEventListener('beforeunload', () => {
  try {
    localStorage.setItem(STORAGE.elements, JSON.stringify(elements.map(serialize)));
  } catch { /* storage full or blocked */ }
});

(async function boot() {
  try { await document.fonts.load('20px Caveat'); } catch { /* fall back to cursive */ }
  loadLocal();
  document.documentElement.dataset.theme = app.theme;
  $('#theme-label').textContent = app.theme === 'dark' ? 'Light mode' : 'Dark mode';
  iconize();
  if (app.theme === 'dark') $('#menu [data-cmd="theme"] .ic').innerHTML = ICONS.sun;
  undoStack = [JSON.stringify(elements)];
  renderToolbar(); renderPanel(); resize();
  window.__orca = { get elements() { return elements; }, app };
})();
