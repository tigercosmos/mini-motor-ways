import test from 'node:test';
import assert from 'node:assert/strict';
import { Board } from '../src/board.js';
import { createGame, addRoad, removeRoad } from '../src/engine.js';

function recordingContext() {
  const operations = [];
  let path = [];
  let dash = [];
  return new Proxy({ operations }, {
    get(target, name) {
      if (name in target) return target[name];
      return (...args) => {
        if (name === 'beginPath') path = [];
        if (name === 'moveTo' || name === 'lineTo') path.push({ method: name, args });
        if (name === 'setLineDash') dash = [...args[0]];
        operations.push({ method: name, args, path: [...path], dash: [...dash], strokeStyle: target.strokeStyle, lineWidth: target.lineWidth });
      };
    },
  });
}

function fixture(t, { width = 390, height = 560, dpr = 3 } = {}) {
  const originalWindow = globalThis.window;
  const originalObserver = globalThis.ResizeObserver;
  globalThis.window = { devicePixelRatio: dpr };
  globalThis.ResizeObserver = class { observe() {} disconnect() {} };
  const listeners = new Map();
  const captures = new Set();
  const bounds = { left: 27, top: 91, width, height };
  const ctx = recordingContext();
  const canvas = {
    style: {},
    getContext: () => ctx,
    setAttribute() {},
    addEventListener(name, handler) { listeners.set(name, handler); },
    removeEventListener(name) { listeners.delete(name); },
    getBoundingClientRect: () => bounds,
    setPointerCapture(id) { captures.add(id); },
    hasPointerCapture(id) { return captures.has(id); },
    releasePointerCapture(id) { captures.delete(id); },
  };
  const state = createGame(7);
  const roads = [];
  const erased = [];
  const viewChanges = [];
  let gestures = 0;
  const board = new Board(canvas, {
    onRoad(a, b) { roads.push([a, b]); return addRoad(state, a, b); },
    onErase(a, b) { erased.push([a, b]); return removeRoad(state, a, b); },
    onGestureEnd() { gestures++; },
    onViewChange(view) { viewChanges.push(view); },
  });
  board.setState(state);
  function dispatch(type, cell, pointerId = 1) {
    const point = board.cellToPoint(cell);
    dispatchAt(type, point.x, point.y, pointerId);
  }
  function dispatchAt(type, x, y, pointerId = 1, pointerType = 'touch') {
    listeners.get(type)?.({
      type, pointerId, pointerType, button: 0,
      clientX: bounds.left + x, clientY: bounds.top + y,
      preventDefault() {},
    });
  }
  t.after(() => {
    board.destroy();
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
    if (originalObserver === undefined) delete globalThis.ResizeObserver;
    else globalThis.ResizeObserver = originalObserver;
  });
  return { board, canvas, ctx, bounds, captures, state, roads, erased, dispatch, dispatchAt, viewChanges, gestures: () => gestures };
}

test('client coordinates roundtrip on portrait and landscape layouts; high DPR is capped', t => {
  const { board, canvas, bounds } = fixture(t);
  assert.equal(canvas.width, 780);
  assert.equal(canvas.height, 1120);
  assert.equal(canvas.style.touchAction, 'none');
  for (const size of [{ width: 390, height: 560 }, { width: 844, height: 300 }]) {
    Object.assign(bounds, size);
    board.resize();
    for (const cell of [{ x: 0, y: 0 }, { x: 6, y: 8 }, { x: 12, y: 16 }]) {
      const point = board.cellToPoint(cell);
      assert.deepEqual(board.pointToCell(bounds.left + point.x, bounds.top + point.y), cell);
    }
    assert.equal(board.pointToCell(bounds.left - 1, bounds.top - 1), null);
  }
  window.devicePixelRatio = 1;
  board.resize();
  assert.equal(canvas.width, bounds.width);
  assert.equal(canvas.height, bounds.height);
});

test('a rapid diagonal drag produces a continuous adjacent path and spends exactly its length', t => {
  const { dispatch, roads, state, gestures, captures } = fixture(t);
  const start = { x: 1, y: 1 }, end = { x: 6, y: 2 };
  const budget = state.roadTiles;
  dispatch('pointerdown', start);
  assert.ok(captures.has(1));
  dispatch('pointermove', end);
  dispatch('pointerup', end);
  assert.equal(roads.length, 5);
  assert.deepEqual(roads[0][0], start);
  assert.deepEqual(roads.at(-1)[1], end);
  for (let i = 0; i < roads.length; i++) {
    const [a, b] = roads[i];
    assert.equal(Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)), 1);
    if (i > 0) assert.deepEqual(a, roads[i - 1][1]);
  }
  assert.equal(state.roadTiles, budget - 5);
  assert.equal(gestures(), 1);
  assert.equal(captures.size, 0);
});

test('a second finger finishes the existing edit once and suppresses editing until all fingers lift', t => {
  const { board, dispatch, roads, gestures } = fixture(t);
  const start = { x: 1, y: 1 };
  dispatch('pointerdown', start);
  dispatch('pointermove', { x: 2, y: 1 });
  dispatch('pointerdown', { x: 9, y: 9 }, 2);
  dispatch('pointermove', { x: 10, y: 10 }, 2);
  dispatch('pointerup', { x: 10, y: 10 }, 2);
  assert.equal(board.hover, null);
  assert.equal(board.pointer, null);
  assert.equal(roads.length, 1);
  assert.equal(gestures(), 1);
  dispatch('pointermove', { x: 3, y: 1 });
  dispatch('pointerup', { x: 3, y: 1 });
  assert.equal(roads.length, 1);
  assert.equal(gestures(), 1);
  board.resetView();
  dispatch('pointerdown', { x: 3, y: 1 });
  dispatch('pointerup', { x: 4, y: 1 });
  assert.equal(roads.length, 2);
  assert.equal(gestures(), 2);
});

test('the final touch release draws omitted segments even without a pointermove', t => {
  const { board, dispatch, roads, gestures } = fixture(t);
  dispatch('pointerdown', { x: 1, y: 1 });
  dispatch('pointerup', { x: 4, y: 1 });
  assert.equal(roads.length, 3);
  assert.deepEqual(roads.at(-1)[1], { x: 4, y: 1 });
  assert.equal(board.pointer, null);
  assert.equal(board.hover, null);
  assert.equal(gestures(), 1);
});

test('cancellation preserves completed segments without drawing to the cancellation coordinate', t => {
  const { board, dispatch, roads, gestures, captures } = fixture(t);
  dispatch('pointerdown', { x: 1, y: 1 });
  dispatch('pointermove', { x: 3, y: 1 });
  dispatch('pointercancel', { x: 10, y: 10 });
  dispatch('lostpointercapture', { x: 10, y: 10 });
  assert.equal(roads.length, 2);
  assert.equal(board.pointer, null);
  assert.equal(captures.size, 0);
  assert.equal(gestures(), 1);
});

test('eraser taps refund one road, but canceled or lost-capture taps never erase', t => {
  const { board, dispatch, erased, state } = fixture(t);
  board.setTool('erase');
  const cell = { x: 2, y: 3 }, budget = state.roadTiles;
  dispatch('pointerdown', cell);
  dispatch('pointercancel', cell);
  dispatch('pointerdown', cell);
  dispatch('lostpointercapture', cell);
  assert.equal(erased.length, 0);
  assert.equal(state.roadTiles, budget);
  dispatch('pointerdown', cell);
  dispatch('pointerup', cell);
  assert.equal(erased.length, 1);
  assert.equal(state.roadTiles, budget + 1);
});

test('pending removal roads remain visible as gray dashed paths, excluded from active pavement', t => {
  const { board, ctx, state } = fixture(t);
  state.roads = [
    { a: { x: 1, y: 1 }, b: { x: 2, y: 1 }, bridge: false, pendingRemoval: true },
    { a: { x: 4, y: 4 }, b: { x: 5, y: 4 }, bridge: false },
  ];
  board.drawRoads(ctx);
  const strokes = ctx.operations.filter(op => op.method === 'stroke' && op.path.length);
  const pending = strokes.filter(op => op.path[0].args[0] === 1.5);
  const active = strokes.filter(op => op.path[0].args[0] === 4.5);
  assert.ok(pending.length > 0);
  assert.ok(pending.some(op => op.dash.length > 0));
  assert.ok(active.some(op => op.dash.length === 0));
  assert.notEqual(pending[0].strokeStyle, active.find(op => op.lineWidth === 0.35).strokeStyle);
  assert.ok(strokes.every(op => op.path.length === 2), 'pending and active paths must never be drawn together');
});

test('opposing cars occupy separate right-hand lanes without changing simulation positions', t => {
  const { board, ctx, state } = fixture(t);
  state.cars = [0, Math.PI, Math.PI / 4, Math.PI * 1.25].map((angle, i) => ({ id: `lane-${i}`, x: 3, y: 4, angle, color: 'coral' }));
  const before = structuredClone(state.cars);
  board.drawCars(ctx);
  const positions = ctx.operations.filter(op => op.method === 'translate').map(op => op.args);
  assert.equal(positions.length, 4);
  for (let i = 0; i < positions.length; i++) {
    const [x, y] = positions[i];
    const dx = x - 3.5, dy = y - 4.5, angle = state.cars[i].angle;
    assert.ok(Math.abs(dx * Math.cos(angle) + dy * Math.sin(angle)) < 1e-12, 'offset must be perpendicular to travel');
    assert.ok(dx * -Math.sin(angle) + dy * Math.cos(angle) > 0, 'offset must be to the right');
  }
  assert.ok(positions[0][1] > 4.5 && positions[1][1] < 4.5);
  assert.deepEqual(state.cars, before);
});

test('overloaded destinations render the demand hidden beyond the six visible dots', t => {
  const { board, ctx, state } = fixture(t);
  const destination = state.buildings.find(item => item.type === 'destination');
  destination.demand = 12;
  destination.capacity = 6;
  board.drawBuildings(ctx, 1000);
  assert.ok(ctx.operations.some(op => op.method === 'fillText' && op.args[0] === '+6'));
  ctx.operations.length = 0;
  destination.demand = 6;
  board.drawBuildings(ctx, 1000);
  assert.ok(!ctx.operations.some(op => op.method === 'fillText' && /^\+/.test(op.args[0])));
});

test('home driveway follows the active entrance instead of an old pending entrance', t => {
  const { board, ctx, state } = fixture(t);
  const home = state.buildings.find(item => item.type === 'home');
  state.roads = [
    { a: home, b: { x: home.x - 1, y: home.y }, pendingRemoval: true },
    { a: home, b: { x: home.x, y: home.y - 1 } },
  ];
  board.drawHome(ctx, { main: '#db725e', roof: '#bc594d', light: '#f5b4a0' }, home);
  const driveway = ctx.operations.find(op => op.method === 'stroke' && op.lineWidth === 0.2);
  assert.deepEqual(driveway.path.map(point => point.args), [[0, -0.2], [0, -0.55]]);
  const before = JSON.stringify(state);
  board.render(1000);
  assert.equal(JSON.stringify(state), before, 'render must not mutate the game state');
});

test('camera buttons clamp zoom to 1–3x and reset the view without touching game state', t => {
  const { board, state, viewChanges } = fixture(t);
  const before = JSON.stringify(state);
  const initialOffset = { x: board.offsetX, y: board.offsetY };
  board.zoomBy(2);
  assert.deepEqual(board.getView(), { zoom: 2 });
  board.zoomBy(100);
  assert.equal(board.getView().zoom, 3);
  board.zoomBy(0);
  board.zoomBy(NaN);
  assert.equal(board.getView().zoom, 3);
  board.zoomBy(0.01);
  assert.equal(board.getView().zoom, 1);
  board.zoomBy(2);
  board.resetView();
  assert.equal(board.getView().zoom, 1);
  assert.deepEqual({ x: board.offsetX, y: board.offsetY }, initialOffset);
  assert.deepEqual(viewChanges.at(-1), { zoom: 1 });
  assert.equal(JSON.stringify(state), before);
});

test('pinch zoom preserves the world point under the fingers midpoint', t => {
  const { board, dispatchAt, roads } = fixture(t);
  board.zoomBy(1.5);
  const anchor = { x: (170 - board.offsetX) / board.cell, y: (230 - board.offsetY) / board.cell };
  dispatchAt('pointerdown', 120, 230, 1);
  dispatchAt('pointerdown', 220, 230, 2);
  dispatchAt('pointermove', 100, 230, 1);
  dispatchAt('pointermove', 240, 230, 2);
  assert.ok(Math.abs(board.getView().zoom - 2.1) < 1e-12);
  assert.ok(Math.abs((170 - board.offsetX) / board.cell - anchor.x) < 1e-12);
  assert.ok(Math.abs((230 - board.offsetY) / board.cell - anchor.y) < 1e-12);
  assert.equal(roads.length, 0);
  dispatchAt('pointerup', 100, 230, 1);
  dispatchAt('pointerup', 240, 230, 2);
});

test('two-finger translation pans the camera without altering the final zoom or roads', t => {
  const { board, dispatchAt, roads, erased } = fixture(t);
  board.zoomBy(2);
  board.setTool('erase');
  const start = { x: board.offsetX, y: board.offsetY };
  dispatchAt('pointerdown', 120, 250, 1);
  dispatchAt('pointerdown', 220, 250, 2);
  dispatchAt('pointermove', 145, 280, 1);
  dispatchAt('pointermove', 245, 280, 2);
  assert.equal(board.getView().zoom, 2);
  assert.ok(Math.abs(board.offsetX - start.x - 25) < 1e-12);
  assert.ok(Math.abs(board.offsetY - start.y - 30) < 1e-12);
  dispatchAt('pointerup', 145, 280, 1);
  dispatchAt('pointermove', 300, 300, 2);
  dispatchAt('pointerup', 300, 300, 2);
  assert.equal(roads.length, 0);
  assert.equal(erased.length, 0);
});

test('the pan tool supports one finger and mouse while keeping map edges reachable and bounded', t => {
  const { board, dispatchAt, roads, state } = fixture(t);
  board.zoomBy(2);
  board.setTool('pan');
  const start = { x: board.offsetX, y: board.offsetY };
  dispatchAt('pointerdown', 190, 280);
  dispatchAt('pointermove', 220, 310);
  assert.equal(board.offsetX, start.x + 30);
  assert.equal(board.offsetY, start.y + 30);
  dispatchAt('pointerup', 220, 310);
  dispatchAt('pointerdown', 190, 280, 2, 'mouse');
  dispatchAt('pointermove', 10000, 10000, 2, 'mouse');
  assert.equal(board.offsetX, 8);
  assert.equal(board.offsetY, 8);
  dispatchAt('pointermove', -10000, -10000, 2, 'mouse');
  assert.equal(board.offsetX, board.width - 8 - state.cols * board.cell);
  assert.equal(board.offsetY, board.height - 8 - state.rows * board.cell);
  assert.ok(board.cellToPoint({ x: state.cols - 1, y: 8 }).x < board.width - 8);
  dispatchAt('pointerup', -10000, -10000, 2, 'mouse');
  assert.equal(roads.length, 0);
});

test('resizing preserves the viewed world center and replacing equal-sized game state preserves zoom', t => {
  const { board, bounds, dispatchAt, state } = fixture(t);
  board.zoomBy(2);
  board.setTool('pan');
  dispatchAt('pointerdown', 190, 280);
  dispatchAt('pointerup', 210, 300);
  const center = { ...board.viewCenter };
  bounds.width = 400;
  bounds.height = 580;
  board.resize();
  assert.equal(board.getView().zoom, 2);
  assert.ok(Math.abs(board.viewCenter.x - center.x) < 1e-12);
  assert.ok(Math.abs(board.viewCenter.y - center.y) < 1e-12);
  board.setState(structuredClone(state));
  assert.equal(board.getView().zoom, 2);
  board.setState({ ...state, cols: 15, rows: 18 });
  assert.equal(board.getView().zoom, 1);
});

test('roads drawn after zoom use inverse camera coordinates', t => {
  const { board, dispatch, roads, state, bounds } = fixture(t);
  board.zoomBy(2);
  const start = { x: 4, y: 5 }, end = { x: 6, y: 5 };
  const position = board.cellToPoint(start);
  assert.deepEqual(board.pointToCell(position.x + bounds.left, position.y + bounds.top), start);
  const budget = state.roadTiles;
  dispatch('pointerdown', start);
  dispatch('pointerup', end);
  assert.deepEqual(roads, [[start, { x: 5, y: 5 }], [{ x: 5, y: 5 }, end]]);
  assert.equal(state.roadTiles, budget - 2);
});

test('captured pointers outside the visible canvas cannot draw hidden roads or bridge a re-entry gap', t => {
  const { board, dispatchAt, roads, bounds } = fixture(t);
  board.zoomBy(3);
  assert.equal(board.pointToCell(bounds.left + 400, bounds.top + 280), null);
  dispatchAt('pointerdown', 380, 280);
  dispatchAt('pointermove', 500, 280);
  dispatchAt('pointermove', 50, 280);
  dispatchAt('pointerup', 50, 280);
  assert.equal(roads.length, 0);
});

test('cancelGesture finalizes an edit once and prevents edits until all retained contacts end', t => {
  const { board, dispatch, roads, gestures, captures } = fixture(t);
  dispatch('pointerdown', { x: 1, y: 1 });
  dispatch('pointermove', { x: 3, y: 1 });
  board.cancelGesture();
  board.cancelGesture();
  dispatch('pointerdown', { x: 4, y: 1 }, 2);
  dispatch('pointermove', { x: 5, y: 1 });
  dispatch('pointerup', { x: 5, y: 1 });
  dispatch('pointermove', { x: 6, y: 1 }, 2);
  dispatch('pointerup', { x: 6, y: 1 }, 2);
  assert.equal(roads.length, 2);
  assert.equal(gestures(), 1);
  assert.equal(captures.size, 0);
  dispatch('pointerdown', { x: 3, y: 1 });
  dispatch('pointerup', { x: 4, y: 1 });
  assert.equal(roads.length, 3);
  assert.equal(gestures(), 2);
});

test('canceling one finger of a pinch blocks camera and edits until the remaining finger lifts', t => {
  const { board, dispatchAt, roads } = fixture(t);
  board.zoomBy(2);
  dispatchAt('pointerdown', 120, 250, 1);
  dispatchAt('pointerdown', 220, 250, 2);
  dispatchAt('pointercancel', 120, 250, 1);
  const view = { zoom: board.zoom, x: board.offsetX, y: board.offsetY };
  dispatchAt('pointermove', 300, 300, 2);
  dispatchAt('pointerup', 300, 300, 2);
  assert.deepEqual({ zoom: board.zoom, x: board.offsetX, y: board.offsetY }, view);
  assert.equal(roads.length, 0);
  assert.equal(board.pointers.size, 0);
});

test('page lifecycle cancellation discards stale contacts so the next gesture is not blocked', t => {
  const { board, dispatch, roads, gestures, captures } = fixture(t);
  dispatch('pointerdown', { x: 1, y: 1 }, 10);
  dispatch('pointermove', { x: 2, y: 1 }, 10);
  dispatch('pointerdown', { x: 9, y: 9 }, 20);
  board.cancelGesture({ releasePointers: true });
  assert.equal(board.pointers.size, 0);
  assert.equal(captures.size, 0);
  assert.equal(gestures(), 1);
  // The browser may deliver a late release, or none at all, after returning to the page.
  dispatch('pointerup', { x: 6, y: 1 }, 10);
  assert.equal(roads.length, 1);
  dispatch('pointerdown', { x: 2, y: 1 }, 30);
  dispatch('pointerup', { x: 3, y: 1 }, 30);
  assert.equal(roads.length, 2);
  assert.equal(gestures(), 2);
});

test('in-place map growth updates drawing scale and keeps new cells reachable', t => {
  const { board, state, bounds } = fixture(t);
  const before = board.cell;
  state.cols += 4; state.rows += 4;
  board.render(0);
  assert.ok(board.cell < before);
  const cell = { x: state.cols - 1, y: state.rows - 1 };
  const point = board.cellToPoint(cell);
  assert.deepEqual(board.pointToCell(bounds.left + point.x, bounds.top + point.y), cell);
});

test('slow diagonal strokes across slightly offset grid corners stay diagonal in all directions', t => {
  const { board, dispatch, dispatchAt, roads, state } = fixture(t);
  state.roads = []; state.water = []; state.roadTiles = 100;
  for (const zoom of [1, 2]) {
    board.resetView(); board.zoomBy(zoom);
    for (const [dx, dy] of [[1, -1], [-1, -1], [1, 1], [-1, 1]]) {
      roads.length = 0;
      const start = { x: 6, y: 8 }, end = { x: 6 + dx * 2, y: 8 + dy * 2 };
      const origin = board.cellToPoint(start);
      dispatch('pointerdown', start);
      // Real pointer events cross one cell boundary a little before the other.
      for (let i = 1; i <= 40; i++) {
        const progress = i / 20;
        dispatchAt('pointermove', origin.x + dx * progress * board.cell, origin.y + dy * (progress - 0.04) * board.cell);
      }
      dispatch('pointerup', end);
      assert.equal(roads.length, 2, `direction ${dx},${dy}, zoom ${zoom}`);
      assert.deepEqual(roads[0], [start, { x: start.x + dx, y: start.y + dy }]);
      assert.deepEqual(roads[1][1], end);
    }
  }
});

test('direction buffer preserves deliberate right-angle turns and commits a short final segment on release', t => {
  const { board, dispatch, dispatchAt, roads } = fixture(t);
  const start = { x: 2, y: 3 };
  dispatch('pointerdown', start);
  dispatch('pointermove', { x: 3, y: 3 });
  dispatch('pointermove', { x: 3, y: 2 });
  const point = board.cellToPoint({ x: 3, y: 2 });
  dispatchAt('pointermove', point.x + 0.6 * board.cell, point.y);
  assert.equal(roads.length, 2);
  dispatchAt('pointerup', point.x + 0.6 * board.cell, point.y);
  assert.deepEqual(roads, [[start, { x: 3, y: 3 }], [{ x: 3, y: 3 }, { x: 3, y: 2 }], [{ x: 3, y: 2 }, { x: 4, y: 2 }]]);
});

test('road strokes stop at the shop instead of creating disconnected roads beyond it', t => {
  const { dispatch, state } = fixture(t);
  const before = state.roads.length;
  dispatch('pointerdown', { x: 7, y: 2 });
  dispatch('pointermove', { x: 7, y: 5 });
  dispatch('pointerup', { x: 7, y: 5 });
  assert.equal(state.roads.length, before);
});

test('migrated shops render on their reserved side of parking', t => {
  const { board, state, ctx } = fixture(t);
  const destination = state.buildings.find(item => item.id === 'd1');
  destination.shopSide = 'south';
  board.drawDestination = (_ctx, building) => {
    if (building.id !== destination.id) return;
    assert.deepEqual(ctx.operations.filter(op => op.method === 'translate').at(-1).args, [0, 1]);
  };
  board.drawBuildings(ctx, 0);
});

test('map growth waits for the active road stroke to finish before changing its coordinates', t => {
  const { board, state, dispatch, roads, gestures } = fixture(t);
  dispatch('pointerdown', { x: 1, y: 1 });
  dispatch('pointermove', { x: 2, y: 1 });
  const before = { cell: board.cell, x: board.offsetX, y: board.offsetY };
  state.cols += 2; state.rows += 2;
  board.render(0);
  assert.equal(board.pointer, 1);
  assert.equal(gestures(), 0);
  assert.deepEqual({ cell: board.cell, x: board.offsetX, y: board.offsetY }, before);
  dispatch('pointerup', { x: 3, y: 1 });
  assert.equal(roads.length, 2);
  assert.equal(gestures(), 1);
  board.render(1);
  assert.ok(board.cell < before.cell);
});

test('growth also defers camera layout until both pinch fingers have lifted', t => {
  const { board, state, dispatch } = fixture(t);
  dispatch('pointerdown', { x: 2, y: 3 }, 1);
  dispatch('pointerdown', { x: 8, y: 12 }, 2);
  const dimensions = board.dimensions;
  state.cols += 2; state.rows += 2;
  board.render(0);
  assert.equal(board.dimensions, dimensions);
  assert.equal(board.gesture.type, 'pinch');
  dispatch('pointerup', { x: 2, y: 3 }, 1);
  board.render(1);
  assert.equal(board.dimensions, dimensions);
  dispatch('pointerup', { x: 8, y: 12 }, 2);
  board.render(2);
  assert.equal(board.dimensions, `${state.cols},${state.rows}`);
});


test('lost pointer capture during deferred growth releases the view without dropping completed roads', t => {
  const { board, state, dispatch, gestures, roads } = fixture(t);
  dispatch('pointerdown', { x: 1, y: 1 });
  dispatch('pointermove', { x: 2, y: 1 });
  state.cols += 2; state.rows += 2;
  board.render(0);
  dispatch('lostpointercapture', { x: 8, y: 8 });
  board.render(1);
  assert.equal(board.pointers.size, 0);
  assert.equal(gestures(), 1);
  assert.equal(roads.length, 1);
  assert.equal(board.dimensions, `${state.cols},${state.rows}`);
});
