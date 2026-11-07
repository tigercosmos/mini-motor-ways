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
  let gestures = 0;
  const board = new Board(canvas, {
    onRoad(a, b) { roads.push([a, b]); return addRoad(state, a, b); },
    onErase(a, b) { erased.push([a, b]); return removeRoad(state, a, b); },
    onGestureEnd() { gestures++; },
  });
  board.setState(state);
  function dispatch(type, cell, pointerId = 1) {
    const point = board.cellToPoint(cell);
    listeners.get(type)?.({
      type, pointerId, pointerType: 'touch',
      clientX: bounds.left + point.x, clientY: bounds.top + point.y,
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
  return { board, canvas, ctx, bounds, captures, state, roads, erased, dispatch, gestures: () => gestures };
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

test('a second finger cannot redirect or finish the first finger drag', t => {
  const { board, dispatch, roads, gestures } = fixture(t);
  const start = { x: 1, y: 1 };
  dispatch('pointerdown', start);
  dispatch('pointerdown', { x: 9, y: 9 }, 2);
  dispatch('pointermove', { x: 10, y: 10 }, 2);
  dispatch('pointerup', { x: 10, y: 10 }, 2);
  assert.deepEqual(board.hover, start);
  assert.equal(board.pointer, 1);
  assert.equal(roads.length, 0);
  assert.equal(gestures(), 0);
  dispatch('pointermove', { x: 3, y: 1 });
  dispatch('pointerup', { x: 3, y: 1 });
  assert.equal(roads.length, 2);
  assert.equal(gestures(), 1);
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
