import { shopCell } from './engine.js';

const COLORS = {
  coral: { main: '#db725e', roof: '#bc594d', light: '#f5b4a0' },
  teal: { main: '#558d87', roof: '#3d726e', light: '#9ac7bd' },
  blue: { main: '#658cbd', roof: '#456c9d', light: '#b2cee9' },
  purple: { main: '#a37ab6', roof: '#805596', light: '#d7b6e6' },
  gold: { main: '#d5a44e', roof: '#ad8237', light: '#f1d28c' },
};
const sameCell = (a, b) => a && b && a.x === b.x && a.y === b.y;
const key = (p) => `${p.x},${p.y}`;

function roundedRect(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, radius);
}

/** Responsive, immediate-mode map. Coordinates exposed by cellToPoint are CSS pixels. */
export class Board {
  constructor(canvas, callbacks = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.callbacks = callbacks;
    this.state = null;
    this.tool = 'road';
    this.grid = true;
    this.pointer = null;
    this.hover = null;
    this.lastCell = null;
    this.width = 0;
    this.height = 0;
    this.cell = 1;
    this.offsetX = 0;
    this.offsetY = 0;
    this.zoom = 1;
    this.baseCell = 1;
    this.viewCenter = null;
    this.pointers = new Map();
    this.gesture = null;
    this.blockEdit = false;
    this.gestureCanceled = false;
    this.canvas.style.touchAction = 'none';
    this.canvas.style.userSelect = 'none';
    this.canvas.style.webkitUserSelect = 'none';
    this.canvas.setAttribute('aria-label', '城市地圖。單指拖曳鋪路，連接同色住宅與目的地。雙指縮放或移動地圖，也可選擇移動工具以單指拖曳。跨河會使用橋梁。');
    this.canvas.setAttribute('role', 'img');
    this.handlers = {
      pointerdown: (event) => this.onPointerDown(event),
      pointermove: (event) => this.onPointerMove(event),
      pointerup: (event) => this.onPointerUp(event),
      pointercancel: (event) => this.onPointerUp(event),
      lostpointercapture: (event) => this.onPointerUp(event),
      pointerleave: () => { if (this.pointer === null) this.hover = null; },
      contextmenu: (event) => event.preventDefault(),
    };
    for (const [name, handler] of Object.entries(this.handlers)) canvas.addEventListener(name, handler);
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(canvas);
    this.resize();
  }

  setState(state) {
    const changedDimensions = !this.state || this.state.cols !== state.cols || this.state.rows !== state.rows;
    this.state = state;
    this.dimensions = `${state.cols},${state.rows}`;
    if (changedDimensions) {
      this.cancelGesture();
      this.zoom = 1;
      this.viewCenter = { x: state.cols / 2, y: state.rows / 2 };
    }
    this.layout();
    this.notifyView();
  }

  setTool(tool) {
    const next = ['erase', 'pan'].includes(tool) ? tool : 'road';
    if (next !== this.tool) this.cancelGesture();
    this.tool = next;
    this.canvas.style.cursor = next === 'pan' ? 'grab' : next === 'erase' ? 'cell' : 'crosshair';
  }

  setGrid(visible) { this.grid = Boolean(visible); }
  getView() { return { zoom: this.zoom }; }
  notifyView() { this.callbacks.onViewChange?.(this.getView()); }

  zoomBy(factor) {
    if (!this.state || !Number.isFinite(factor) || factor <= 0) return;
    this.cancelGesture();
    this.zoom = Math.min(3, Math.max(1, this.zoom * factor));
    this.layout();
    this.notifyView();
  }

  resetView() {
    this.cancelGesture();
    this.zoom = 1;
    if (this.state) this.viewCenter = { x: this.state.cols / 2, y: this.state.rows / 2 };
    this.layout();
    this.notifyView();
  }

  resize() {
    const bounds = this.canvas.getBoundingClientRect();
    if (bounds.width !== this.width || bounds.height !== this.height) this.cancelGesture();
    this.width = bounds.width;
    this.height = bounds.height;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(this.width * this.dpr);
    this.canvas.height = Math.round(this.height * this.dpr);
    this.layout();
  }

  layout() {
    if (!this.state) return;
    const gutter = this.width < 500 ? 8 : 26;
    const [cols, rows] = this.dimensions.split(',').map(Number);
    this.baseCell = Math.max(1, Math.min((this.width - gutter * 2) / cols, (this.height - gutter * 2) / rows));
    this.cell = this.baseCell * this.zoom;
    const center = this.viewCenter || { x: this.state.cols / 2, y: this.state.rows / 2 };
    this.offsetX = this.width / 2 - center.x * this.cell;
    this.offsetY = this.height / 2 - center.y * this.cell;
    this.clampView();
  }

  clampView() {
    if (!this.state) return;
    const gutter = this.width < 500 ? 8 : 26;
    const clampAxis = (offset, viewport, extent, endGutter = gutter) => extent <= viewport - gutter - endGutter
      ? (viewport - extent) / 2
      : Math.min(gutter, Math.max(viewport - endGutter - extent, offset));
    const [cols, rows] = this.dimensions.split(',').map(Number);
    this.offsetX = clampAxis(this.offsetX, this.width, cols * this.cell, gutter);
    this.offsetY = clampAxis(this.offsetY, this.height, rows * this.cell);
    this.viewCenter = { x: (this.width / 2 - this.offsetX) / this.cell, y: (this.height / 2 - this.offsetY) / this.cell };
  }

  localPoint(event) {
    const bounds = this.canvas.getBoundingClientRect();
    return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
  }

  pointToCell(clientX, clientY) {
    if (!this.state) return null;
    const point = this.localPoint({ clientX, clientY });
    if (point.x < 0 || point.y < 0 || point.x >= this.width || point.y >= this.height) return null;
    const x = Math.floor((point.x - this.offsetX) / this.cell);
    const y = Math.floor((point.y - this.offsetY) / this.cell);
    if (x < 0 || y < 0 || x >= this.state.cols || y >= this.state.rows) return null;
    return { x, y };
  }

  cellToPoint(cell) {
    return { x: this.offsetX + (cell.x + 0.5) * this.cell, y: this.offsetY + (cell.y + 0.5) * this.cell };
  }

  finishEdit() {
    const editing = this.pointer !== null;
    this.pointer = null;
    this.lastCell = null;
    this.origin = null;
    this.strokeOffset = null;
    this.lastReason = null;
    this.hover = null;
    if (editing) this.callbacks.onGestureEnd?.();
  }

  /** Retain contacts normally; page lifecycle cancellation can discard stale contacts. */
  cancelGesture({ releasePointers = false } = {}) {
    this.finishEdit();
    this.gesture = null;
    if (releasePointers) {
      const ids = [...this.pointers.keys()];
      this.pointers.clear();
      for (const id of ids) {
        if (this.canvas.hasPointerCapture?.(id)) this.canvas.releasePointerCapture(id);
      }
    }
    this.blockEdit = this.pointers.size > 0;
    this.gestureCanceled = this.pointers.size > 0;
  }

  startPinch() {
    const entries = [...this.pointers.entries()].slice(0, 2);
    if (entries.length < 2) { this.gesture = null; return; }
    const [a, b] = entries.map(entry => entry[1]);
    const midpoint = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    this.gesture = {
      type: 'pinch', ids: entries.map(entry => entry[0]),
      distance: Math.max(1, Math.hypot(b.x - a.x, b.y - a.y)), zoom: this.zoom,
      anchor: { x: (midpoint.x - this.offsetX) / this.cell, y: (midpoint.y - this.offsetY) / this.cell },
    };
  }

  moveCamera() {
    const gesture = this.gesture;
    if (!gesture || this.gestureCanceled) return;
    if (gesture.type === 'pan') {
      const point = this.pointers.get(gesture.id);
      if (!point) return;
      this.offsetX = gesture.offsetX + point.x - gesture.point.x;
      this.offsetY = gesture.offsetY + point.y - gesture.point.y;
    } else {
      const [a, b] = gesture.ids.map(id => this.pointers.get(id));
      if (!a || !b) return;
      const distance = Math.hypot(b.x - a.x, b.y - a.y);
      this.zoom = Math.min(3, Math.max(1, gesture.zoom * distance / gesture.distance));
      this.cell = this.baseCell * this.zoom;
      this.offsetX = (a.x + b.x) / 2 - gesture.anchor.x * this.cell;
      this.offsetY = (a.y + b.y) / 2 - gesture.anchor.y * this.cell;
    }
    this.clampView();
    this.notifyView();
  }

  onPointerDown(event) {
    if (!this.state || (event.pointerType === 'mouse' && event.button !== 0)) return;
    event.preventDefault();
    this.pointers.set(event.pointerId, this.localPoint(event));
    try { this.canvas.setPointerCapture?.(event.pointerId); } catch { /* The contact may already have ended. */ }
    if (this.gestureCanceled) return;
    if (this.pointers.size >= 2) {
      this.finishEdit();
      this.blockEdit = true;
      this.startPinch();
      return;
    }
    if (this.blockEdit) return;
    if (this.tool === 'pan') {
      this.hover = null;
      this.gesture = { type: 'pan', id: event.pointerId, point: this.localPoint(event), offsetX: this.offsetX, offsetY: this.offsetY };
      return;
    }
    const cell = this.pointToCell(event.clientX, event.clientY);
    if (!cell) return;
    this.pointer = event.pointerId;
    this.lastCell = cell;
    this.hover = cell;
    this.origin = cell;
    const start = this.localPoint(event), center = this.cellToPoint(cell);
    this.strokeOffset = { x: start.x - center.x, y: start.y - center.y };
    this.moved = false;
  }

  onPointerMove(event) {
    if (this.pointers.has(event.pointerId)) {
      this.pointers.set(event.pointerId, this.localPoint(event));
      event.preventDefault();
    }
    if (this.gesture || this.blockEdit) { this.moveCamera(); return; }
    const cell = this.pointToCell(event.clientX, event.clientY);
    if (this.pointer !== null && event.pointerId !== this.pointer) return;
    this.hover = this.tool === 'pan' ? null : cell;
    if (event.pointerId !== this.pointer) return;
    if (!cell) { this.lastCell = null; this.strokeOffset = null; return; }
    if (!this.lastCell) {
      this.lastCell = cell;
      const point = this.localPoint(event), center = this.cellToPoint(cell);
      this.strokeOffset = { x: point.x - center.x, y: point.y - center.y };
      return;
    }
    if (sameCell(this.lastCell, cell)) return;
    if (event.type !== 'pointerup') {
      const point = this.localPoint(event);
      const center = this.cellToPoint(this.lastCell);
      // Wait beyond the half-cell boundary before choosing the next direction.
      // Slow diagonal drags otherwise commit two orthogonal edges at each corner.
      const travel = Math.max(Math.abs(point.x - center.x), Math.abs(point.y - center.y)) / this.cell;
      if (travel < 0.75) return;
      if (this.tool === 'road' && (cell.x === this.lastCell.x || cell.y === this.lastCell.y)) {
        const dx = Math.abs(point.x - center.x - (this.strokeOffset?.x || 0));
        const dy = Math.abs(point.y - center.y - (this.strokeOffset?.y || 0));
        // An off-center touch crosses one grid boundary before the other even
        // on a straight diagonal. Wait for both axes instead of laying a stair.
        if (Math.min(dx, dy) > Math.max(dx, dy) / 3) return;
      }
    }
    const previous = this.lastCell;
    const count = Math.max(Math.abs(cell.x - previous.x), Math.abs(cell.y - previous.y));
    let a = previous;
    for (let i = 1; i <= count; i++) {
      const b = { x: Math.round(previous.x + (cell.x - previous.x) * i / count), y: Math.round(previous.y + (cell.y - previous.y) * i / count) };
      if (!sameCell(a, b)) {
        const result = this.tool === 'erase' ? this.callbacks.onErase?.(a, b) : this.callbacks.onRoad?.(a, b);
        if (result && result.ok === false && result.reason && result.reason !== this.lastReason) {
          this.callbacks.onMessage?.(result.reason);
          this.lastReason = result.reason;
        }
        if (this.tool === 'road' && result?.ok === false) {
          this.lastCell = a;
          this.moved = true;
          return;
        }
        a = b;
      }
    }
    this.lastCell = cell;
    this.moved = true;
  }

  onPointerUp(event) {
    if (!this.pointers.has(event.pointerId)) return;
    // Touch browsers can deliver a final release position without a matching move.
    if (event.type === 'pointerup') this.onPointerMove(event);
    if (event.pointerId === this.pointer && !this.blockEdit) {
      if (this.tool === 'erase' && !this.moved && this.lastCell && event.type === 'pointerup') {
        const roads = this.state?.roads || [];
        const road = roads.find(entry => !entry.pendingRemoval && (sameCell(entry.a, this.lastCell) || sameCell(entry.b, this.lastCell)));
        if (road) this.callbacks.onErase?.(road.a, road.b);
      }
      this.finishEdit();
    }
    this.pointers.delete(event.pointerId);
    if (this.canvas.hasPointerCapture?.(event.pointerId)) this.canvas.releasePointerCapture(event.pointerId);
    if (event.type !== 'pointerup') {
      this.finishEdit();
      this.gestureCanceled = this.pointers.size > 0;
      this.blockEdit = this.pointers.size > 0;
      this.gesture = null;
    } else if (this.gesture?.type === 'pinch') this.startPinch();
    else this.gesture = null;
    if (!this.pointers.size) {
      this.blockEdit = false;
      this.gestureCanceled = false;
      this.hover = null;
    }
  }

  render(time = 0) {
    if (this.state && this.dimensions !== `${this.state.cols},${this.state.rows}` && this.pointers.size === 0) {
      // Apply growth after all fingers lift, preserving the active gesture's coordinates.
      this.dimensions = `${this.state.cols},${this.state.rows}`;
      if (this.zoom === 1) this.viewCenter = { x: this.state.cols / 2, y: this.state.rows / 2 };
      this.layout();
    }
    const ctx = this.ctx;
    if (!ctx || this.width <= 0 || this.height <= 0) return;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.width, this.height);
    ctx.fillStyle = '#eef0e6';
    ctx.fillRect(0, 0, this.width, this.height);
    if (!this.state) return;
    ctx.save();
    ctx.translate(this.offsetX, this.offsetY);
    ctx.scale(this.cell, this.cell);
    this.drawLand(ctx);
    this.drawWater(ctx, time);
    this.drawGrid(ctx);
    this.drawTrees(ctx);
    this.drawRoads(ctx);
    this.drawBuildings(ctx, time);
    this.drawCars(ctx);
    this.drawPointer(ctx, time);
    ctx.restore();
    this.drawMapLabels(ctx);
  }

  drawLand(ctx) {
    ctx.fillStyle = '#e8ecde';
    ctx.beginPath();
    ctx.ellipse(2.2, 3.5, 3.5, 3.7, -0.45, 0, Math.PI * 2);
    ctx.ellipse(12.2, 14.5, 4.1, 4.8, 0.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#e4e9d9';
    ctx.beginPath();
    ctx.ellipse(-0.4, 15.8, 2.4, 2.8, -0.7, 0, Math.PI * 2);
    ctx.ellipse(12.3, 1.3, 2.3, 2.9, 0.5, 0, Math.PI * 2);
    ctx.fill();
  }

  drawWater(ctx, time) {
    const cells = this.state.water || [];
    ctx.fillStyle = '#bdd5cb';
    for (const cell of cells) {
      roundedRect(ctx, cell.x - 0.1, cell.y - 0.1, 1.2, 1.2, 0.28);
      ctx.fill();
    }
    ctx.fillStyle = '#a8c9c0';
    for (const cell of cells) {
      roundedRect(ctx, cell.x, cell.y, 1, 1, 0.19);
      ctx.fill();
    }
    ctx.strokeStyle = 'rgba(239,248,236,0.42)';
    ctx.lineWidth = 0.025;
    ctx.lineCap = 'round';
    for (let i = 0; i < cells.length; i++) {
      if (i % 3 !== 0) continue;
      const p = cells[i];
      const shift = Math.sin(time / 2800 + i) * 0.08;
      ctx.beginPath();
      ctx.moveTo(p.x + 0.18 + shift, p.y + 0.35);
      ctx.bezierCurveTo(p.x + 0.3 + shift, p.y + 0.3, p.x + 0.45 + shift, p.y + 0.4, p.x + 0.57 + shift, p.y + 0.35);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(p.x + 0.45 - shift, p.y + 0.68);
      ctx.lineTo(p.x + 0.73 - shift, p.y + 0.68);
      ctx.stroke();
    }
  }

  drawGrid(ctx) {
    if (!this.grid && this.pointer === null) return;
    const water = new Set((this.state.water || []).map(key));
    ctx.fillStyle = this.pointer === null ? '#c6cebd' : '#b8c2ac';
    for (let x = 0; x < this.state.cols; x++) {
      for (let y = 0; y < this.state.rows; y++) {
        if (water.has(`${x},${y}`)) continue;
        ctx.beginPath();
        ctx.arc(x + 0.5, y + 0.5, 0.025, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  drawTrees(ctx) {
    const occupied = new Set([...(this.state.water || []), ...(this.state.buildings || []).flatMap(item => item.type === 'destination' ? [item, shopCell(item)] : [item]), ...(this.state.roads || []).flatMap((road) => [road.a, road.b])].map(key));
    for (let x = 0; x < this.state.cols; x++) {
      for (let y = 0; y < this.state.rows; y++) {
        const hash = (x * 43 + y * 67 + x * y * 17) % 79;
        if (hash > 5 || occupied.has(`${x},${y}`)) continue;
        const px = x + 0.23;
        const py = y + 0.3;
        const size = 0.13 + hash * 0.012;
        ctx.fillStyle = 'rgba(81,103,71,.1)';
        ctx.beginPath();
        ctx.ellipse(px + 0.03, py + size * 0.75, size * 0.88, size * 0.38, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#859878';
        ctx.lineWidth = 0.035;
        ctx.beginPath();
        ctx.moveTo(px, py + size * 0.4);
        ctx.lineTo(px, py + size * 1.1);
        ctx.stroke();
        ctx.fillStyle = hash % 2 ? '#a7b99a' : '#b5c2a5';
        ctx.beginPath();
        ctx.ellipse(px, py, size * 0.8, size, -0.2, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = 'rgba(104,132,87,.3)';
        ctx.lineWidth = 0.018;
        ctx.beginPath();
        ctx.moveTo(px, py + size * 0.55);
        ctx.lineTo(px, py - size * 0.45);
        ctx.stroke();
      }
    }
  }

  drawRoads(ctx) {
    const allRoads = this.state.roads || [];
    const roads = allRoads.filter(road => !road.pendingRemoval);
    const pending = allRoads.filter(road => road.pendingRemoval);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const drawSegments = (segments = roads) => {
      ctx.beginPath();
      for (const road of segments) {
        ctx.moveTo(road.a.x + 0.5, road.a.y + 0.5);
        ctx.lineTo(road.b.x + 0.5, road.b.y + 0.5);
      }
      ctx.stroke();
    };
    // Retiring roads still carry already-dispatched cars until their return trip ends.
    ctx.strokeStyle = '#d2d5cc';
    ctx.lineWidth = 0.4;
    drawSegments(pending);
    ctx.strokeStyle = '#9da49b';
    ctx.lineWidth = 0.12;
    ctx.setLineDash([0.13, 0.12]);
    drawSegments(pending);
    ctx.setLineDash([]);
    ctx.save();
    ctx.translate(0.02, 0.05);
    ctx.strokeStyle = '#c9cdbf';
    ctx.lineWidth = 0.39;
    drawSegments();
    ctx.restore();
    for (const road of roads) {
      if (!road.bridge) continue;
      ctx.strokeStyle = '#faf5e7';
      ctx.lineWidth = 0.57;
      ctx.beginPath();
      ctx.moveTo(road.a.x + 0.5, road.a.y + 0.5);
      ctx.lineTo(road.b.x + 0.5, road.b.y + 0.5);
      ctx.stroke();
    }
    ctx.strokeStyle = '#6d7974';
    ctx.lineWidth = 0.35;
    drawSegments();
    ctx.strokeStyle = '#aeb7ab';
    ctx.lineWidth = 0.022;
    ctx.setLineDash([0.09, 0.12]);
    drawSegments();
    ctx.setLineDash([]);
  }

  drawBuildings(ctx, time) {
    const drawn = new Set();
    for (const destination of this.state.buildings.filter(item => item.type === 'destination')) {
      const id = destination.parkingId || destination.id;
      if (drawn.has(id)) continue;
      drawn.add(id);
      const peers = this.state.buildings.filter(item => item.type === 'destination' && (item.parkingId || item.id) === id);
      const x = Math.min(...peers.map(item => item.x));
      ctx.save(); ctx.translate(x + 0.5, destination.y + 0.5);
      ctx.fillStyle = '#abb3a7';
      roundedRect(ctx, -0.47, -0.48, peers.length - 0.06, 0.96, 0.13); ctx.fill();
      ctx.strokeStyle = '#f5f4df'; ctx.lineWidth = 0.035;
      for (let i = 0; i < peers.length * 3; i++) {
        ctx.beginPath(); ctx.moveTo(-0.35 + i * 0.29, -0.38); ctx.lineTo(-0.35 + i * 0.29, -0.12); ctx.stroke();
      }
      ctx.fillStyle = '#f5f4df'; ctx.font = '600 0.24px system-ui'; ctx.textAlign = 'center';
      ctx.fillText('P', (peers.length - 1) / 2, 0.32);
      ctx.restore();
    }
    for (const building of this.state.buildings || []) {
      const colors = COLORS[building.color] || COLORS.coral;
      ctx.save();
      ctx.translate(building.x + 0.5, building.y + 0.5);
      if (building.type === 'home') this.drawHome(ctx, colors, building);
      else { const shop = shopCell(building); ctx.translate(shop.x - building.x, shop.y - building.y); this.drawDestination(ctx, building, colors, time); }
      ctx.restore();
    }
  }

  drawHome(ctx, colors, building) {
    const driveways = (this.state.roads || []).filter(entry => !entry.pendingRemoval && (sameCell(entry.a, building) || sameCell(entry.b, building)));
    for (const road of driveways) {
      const exit = sameCell(road.a, building) ? road.b : road.a;
      const length = Math.hypot(exit.x - building.x, exit.y - building.y);
      const dx = (exit.x - building.x) / length;
      const dy = (exit.y - building.y) / length;
      ctx.lineCap = 'butt';
      ctx.beginPath();
      ctx.moveTo(dx * 0.2, dy * 0.2);
      ctx.lineTo(dx * 0.55, dy * 0.55);
      ctx.strokeStyle = '#eef0e6';
      ctx.lineWidth = 0.38;
      ctx.stroke();
      ctx.strokeStyle = '#a1aaa0';
      ctx.lineWidth = 0.2;
      ctx.stroke();
      ctx.lineCap = 'round';
    }
    ctx.fillStyle = 'rgba(61,75,59,.13)';
    roundedRect(ctx, -0.23, -0.14, 0.55, 0.49, 0.075);
    ctx.fill();
    ctx.fillStyle = '#f8f4e8';
    roundedRect(ctx, -0.32, -0.29, 0.64, 0.62, 0.1);
    ctx.fill();
    ctx.fillStyle = colors.main;
    roundedRect(ctx, -0.24, -0.15, 0.48, 0.4, 0.035);
    ctx.fill();
    ctx.fillStyle = colors.roof;
    ctx.beginPath();
    ctx.moveTo(-0.3, -0.12);
    ctx.lineTo(0, -0.35);
    ctx.lineTo(0.3, -0.12);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#fff8e9';
    roundedRect(ctx, -0.17, -0.045, 0.11, 0.105, 0.015);
    ctx.fill();
    roundedRect(ctx, 0.065, -0.045, 0.11, 0.105, 0.015);
    ctx.fill();
    ctx.fillStyle = colors.roof;
    roundedRect(ctx, -0.045, 0.12, 0.09, 0.13, 0.014);
    ctx.fill();
    ctx.fillStyle = colors.light;
    ctx.fillRect(0.15, -0.3, 0.07, 0.13);
  }

  drawDestination(ctx, building, colors, time) {
    ctx.fillStyle = 'rgba(61,75,59,.12)';
    roundedRect(ctx, -0.38, -0.32, 0.88, 0.87, 0.18);
    ctx.fill();
    ctx.fillStyle = '#faf6e9';
    roundedRect(ctx, -0.49, -0.48, 0.98, 0.96, 0.18);
    ctx.fill();
    ctx.fillStyle = colors.main;
    roundedRect(ctx, -0.4, -0.39, 0.8, 0.76, 0.12);
    ctx.fill();
    ctx.fillStyle = colors.roof;
    roundedRect(ctx, -0.3, 0.22, 0.6, 0.08, 0.025);
    ctx.fill();
    ctx.strokeStyle = '#fff9e9';
    ctx.lineWidth = 0.065;
    ctx.beginPath();
    ctx.arc(0, -0.075, 0.16, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = '#fff9e9';
    ctx.beginPath();
    ctx.moveTo(-0.09, 0.04);
    ctx.lineTo(0, 0.17);
    ctx.lineTo(0.09, 0.04);
    ctx.closePath();
    ctx.fill();
    const demand = Math.max(0, Math.ceil(building.demand || 0));
    const dots = Math.min(6, demand);
    const overflow = Math.max(0, demand - dots);
    if (dots) {
      const width = dots * 0.115 + 0.14 + (overflow ? 0.43 : 0);
      ctx.fillStyle = '#fff9eb';
      roundedRect(ctx, -width / 2, -0.745, width, 0.28, 0.14);
      ctx.fill();
      ctx.fillStyle = demand > (building.capacity ?? 6) ? '#bc594d' : colors.main;
      for (let i = 0; i < dots; i++) {
        ctx.beginPath();
        ctx.arc(-width / 2 + 0.125 + i * 0.115, -0.605, 0.033, 0, Math.PI * 2);
        ctx.fill();
      }
      if (overflow) {
        ctx.font = '600 0.23px ui-sans-serif, system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(`+${overflow}`, width / 2 - 0.23, -0.605);
      }
    }
    const stress = Math.max(0, Math.min(1, building.stress || 0));
    if (stress > 0.05) {
      ctx.strokeStyle = stress > 0.6 ? '#c45e4e' : '#d5a44e';
      ctx.globalAlpha = stress > 0.75 ? 0.65 + 0.35 * Math.sin(time / 200) : 0.85;
      ctx.lineWidth = 0.055;
      ctx.beginPath();
      ctx.arc(0, -0.02, 0.58, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * stress);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  drawCars(ctx) {
    for (const car of this.state.cars || []) {
      if (!Number.isFinite(car.x) || !Number.isFinite(car.y)) continue;
      const color = COLORS[car.color] || COLORS.coral;
      const angle = car.angle || 0;
      // Display opposing traffic in separate right-hand lanes; simulation stays in grid coordinates.
      const lane = 0.085;
      ctx.save();
      ctx.translate(car.x + 0.5 - Math.sin(angle) * lane, car.y + 0.5 + Math.cos(angle) * lane);
      ctx.rotate(angle);
      ctx.fillStyle = 'rgba(35,55,45,.2)';
      roundedRect(ctx, -0.135, -0.06, 0.28, 0.16, 0.045);
      ctx.fill();
      ctx.fillStyle = color.main;
      roundedRect(ctx, -0.15, -0.09, 0.29, 0.16, 0.045);
      ctx.fill();
      ctx.fillStyle = '#fff7e8';
      roundedRect(ctx, -0.03, -0.065, 0.08, 0.11, 0.018);
      ctx.fill();
      ctx.fillStyle = color.roof;
      ctx.fillRect(-0.1, -0.06, 0.035, 0.1);
      ctx.restore();
    }
  }

  drawPointer(ctx, time) {
    if (!this.hover) return;
    ctx.save();
    const color = this.tool === 'erase' ? '#c46c59' : '#4d7d71';
    ctx.strokeStyle = color;
    ctx.fillStyle = this.tool === 'erase' ? 'rgba(196,108,89,.12)' : 'rgba(77,125,113,.10)';
    ctx.lineWidth = 0.045;
    roundedRect(ctx, this.hover.x + 0.08, this.hover.y + 0.08, 0.84, 0.84, 0.17);
    ctx.fill();
    ctx.stroke();
    if (this.pointer !== null) {
      ctx.globalAlpha = 0.35;
      ctx.beginPath();
      ctx.arc(this.hover.x + 0.5, this.hover.y + 0.5, 0.58 + Math.sin(time / 200) * 0.035, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  drawMapLabels(ctx) {
    const inset = this.width < 500 ? 16 : 24;
    ctx.save();
    ctx.fillStyle = '#94a08f';
    ctx.font = '500 9px ui-monospace, SFMono-Regular, monospace';
    ctx.letterSpacing = '1.8px';
    ctx.textAlign = 'left';
    ctx.fillText('RIVER DISTRICT', inset, this.height - inset);
    ctx.textAlign = 'right';
    ctx.fillStyle = '#849480';
    ctx.fillText('N ↑', this.width - inset, inset + 4);
    ctx.restore();
  }

  destroy() {
    this.cancelGesture({ releasePointers: true });
    this.observer.disconnect();
    for (const [name, handler] of Object.entries(this.handlers)) this.canvas.removeEventListener(name, handler);
  }
}
