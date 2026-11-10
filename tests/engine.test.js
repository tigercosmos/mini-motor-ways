import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, addRoad, removeRoad, getRoute, stepGame, applyUpgrade, serializeGame, restoreGame } from '../src/engine.js';

test('starter route connects matching buildings; unrelated buildings stay disconnected', () => {
  const game = createGame(7);
  assert.equal(game.roadTiles, 18);
  assert.equal(getRoute(game, 'h1', 'd1').length, 7);
  assert.equal(getRoute(game, 'h3', 'd2'), null);
  assert.deepEqual(createGame(7), game);
});

test('resource spending, duplicate edges, bridge cost and refunds are exact', () => {
  const game = createGame(7), a = { x: 1, y: 7 }, b = { x: 1, y: 8 };
  assert.equal(addRoad(game, a, b).ok, true);
  assert.equal(game.bridges, 0); assert.equal(game.roadTiles, 17);
  assert.equal(addRoad(game, b, a).existing, true);
  assert.equal(addRoad(game, b, a).changed, false);
  assert.equal(game.bridges, 0); assert.equal(game.roadTiles, 17);
  assert.equal(removeRoad(game, b, a).ok, true);
  assert.equal(game.bridges, 1); assert.equal(game.roadTiles, 18);
  game.roadTiles = 0;
  assert.equal(addRoad(game, a, b).ok, false);
  game.roadTiles = 10; game.bridges = 0;
  assert.equal(addRoad(game, a, b).ok, false);
});

test('one complete river crossing consumes one bridge and refunds only when its water cell is unused', () => {
  const game = createGame(7), bank = { x: 1, y: 7 }, river = { x: 1, y: 8 }, opposite = { x: 1, y: 9 };
  addRoad(game, bank, river); addRoad(game, river, opposite);
  assert.equal(game.bridges, 0);
  removeRoad(game, bank, river); assert.equal(game.bridges, 0);
  removeRoad(game, river, opposite); assert.equal(game.bridges, 1);
});

test('invalid segments are rejected; diagonal bridges and crossing diagonals are allowed', () => {
  const game = createGame(7);
  assert.equal(addRoad(game, { x: -1, y: 0 }, { x: 0, y: 0 }).ok, false);
  assert.equal(addRoad(game, { x: 1, y: 1 }, { x: 3, y: 1 }).ok, false);
  assert.equal(addRoad(game, { x: 4, y: 9 }, { x: 5, y: 10 }).ok, true);
  assert.equal(addRoad(game, { x: 0, y: 0 }, { x: 1, y: 1 }).ok, true);
  assert.equal(addRoad(game, { x: 1, y: 0 }, { x: 0, y: 1 }).ok, true);
});

test('connected homes send moving cars, deliver trips and return home', () => {
  const game = createGame(7);
  stepGame(game, 1);
  assert.ok(game.cars.length > 0);
  assert.ok(game.cars[0].x > 2);
  stepGame(game, 5);
  assert.ok(game.score >= 1);
  assert.ok(game.cars.some(car => car.returning));
  stepGame(game, 5);
  assert.ok(game.score >= 1);
});

test('busy road removal retains roundtrip cars and refunds only after they arrive home', () => {
  const game = createGame(7);
  stepGame(game, 1);
  const demand = game.buildings.find(item => item.id === 'd1').demand;
  const tiles = game.roadTiles;
  assert.equal(removeRoad(game, { x: 4, y: 3 }, { x: 5, y: 3 }).pending, true);
  assert.equal(game.cars.length, 1);
  assert.equal(game.roadTiles, tiles);
  assert.equal(getRoute(game, 'h1', 'd1'), null);
  assert.equal(game.buildings.find(item => item.id === 'd1').demand, demand);
  stepGame(game, 8);
  assert.equal(game.cars.length, 0);
  assert.equal(game.score, 1);
  assert.equal(game.roadTiles, tiles + 1);
});

test('each home can have two reserved roundtrips, with no over-dispatch for a single pin', () => {
  const game = createGame(7); game.buildings.find(item => item.id === 'd1').demand = 3;
  stepGame(game, 2);
  assert.equal(game.cars.filter(car => car.homeId === 'h1').length, 2);
  stepGame(game, 0.5);
  assert.equal(game.cars.filter(car => car.homeId === 'h1').length, 2);
  const single = createGame(7); stepGame(single, 2);
  assert.equal(single.cars.length, 1);
});

test('destinations request the nearest available home by physical route length', () => {
  const game = createGame(7);
  const route = [{ x: 3, y: 6 }, { x: 4, y: 6 }, { x: 5, y: 5 }, { x: 6, y: 4 }, { x: 7, y: 4 }];
  for (let i = 1; i < route.length; i++) assert.equal(addRoad(game, route[i - 1], route[i]).ok, true);
  stepGame(game, 0.4);
  assert.equal(game.cars[0].homeId, 'h2');
});

test('capacity six is safe, while the seventh unserved pin starts overload', () => {
  const game = createGame(7), destination = game.buildings.find(item => item.id === 'd2');
  assert.equal(destination.capacity, 6);
  destination.demand = 6; stepGame(game, 1); assert.equal(destination.stress, 0);
  destination.demand = 7; stepGame(game, 1); assert.ok(destination.stress > 0);
});

test('pending removal can be canceled without spending or refunding a tile twice', () => {
  const game = createGame(7); stepGame(game, 1);
  const a = { x: 4, y: 3 }, b = { x: 5, y: 3 }, count = game.roadTiles;
  assert.equal(removeRoad(game, a, b).pending, true);
  assert.equal(removeRoad(game, a, b).changed, false);
  assert.equal(addRoad(game, a, b).restored, true);
  assert.equal(game.roadTiles, count); assert.ok(getRoute(game, 'h1', 'd1'));
  stepGame(game, 8); assert.equal(game.roadTiles, count);
});

test('homes allow new directions while pending old roads remain usable by existing cars', () => {
  const game = createGame(7), home = { x: 2, y: 3 }, old = { x: 3, y: 3 }, fresh = { x: 2, y: 4 };
  assert.equal(addRoad(game, home, fresh).ok, true);
  stepGame(game, 1); assert.equal(removeRoad(game, home, old).pending, true);
  assert.equal(addRoad(game, home, fresh).ok, true);
  assert.equal(addRoad(game, home, old).ok, true);
  assert.equal(game.cars.length, 1);
});

test('a long bent bridge uses one span, rejects branches, and refunds after the last segment', () => {
  const game = createGame(7), route = [{ x: 1, y: 7 }, { x: 1, y: 8 }, { x: 2, y: 8 }, { x: 3, y: 8 }, { x: 3, y: 9 }];
  for (let i = 1; i < route.length; i++) assert.equal(addRoad(game, route[i - 1], route[i]).ok, true);
  assert.equal(game.bridges, 0);
  assert.equal(addRoad(game, { x: 2, y: 8 }, { x: 2, y: 7 }).ok, false);
  for (let i = 1; i < route.length; i++) {
    assert.equal(removeRoad(game, route[i - 1], route[i]).ok, true);
    assert.equal(game.bridges, i === route.length - 1 ? 1 : 0);
  }
});

test('splitting a bridge requires an extra bridge and rejoining restores that resource', () => {
  const game = createGame(7), route = [{ x: 1, y: 7 }, { x: 1, y: 8 }, { x: 2, y: 8 }, { x: 3, y: 8 }, { x: 3, y: 9 }];
  for (let i = 1; i < route.length; i++) addRoad(game, route[i - 1], route[i]);
  game.bridges = 0;
  assert.equal(removeRoad(game, route[1], route[2]).ok, false);
  game.bridges = 1;
  assert.equal(removeRoad(game, route[1], route[2]).ok, true); assert.equal(game.bridges, 0);
  assert.equal(addRoad(game, route[1], route[2]).ok, true); assert.equal(game.bridges, 1);
});

test('pending bridge splits reserve resources until the full roundtrip clears the old span', () => {
  const game = createGame(7); game.roads = []; game.roadTiles = 50; game.bridges = 2;
  Object.assign(game.buildings.find(item => item.id === 'h1'), { x: 1, y: 7 });
  Object.assign(game.buildings.find(item => item.id === 'd1'), { x: 3, y: 9, shopSide: 'east' });
  const route = [{ x: 1, y: 7 }, { x: 1, y: 8 }, { x: 2, y: 8 }, { x: 3, y: 8 }, { x: 3, y: 9 }];
  for (let i = 1; i < route.length; i++) assert.equal(addRoad(game, route[i - 1], route[i]).ok, true);
  stepGame(game, 0.5);
  assert.equal(removeRoad(game, route[1], route[2]).pending, true);
  assert.equal(game.bridges, 1);
  assert.equal(addRoad(game, { x: 10, y: 7 }, { x: 10, y: 8 }).ok, false);
  const restored = restoreGame(serializeGame(game)); assert.ok(restored);
  stepGame(restored, 8);
  assert.equal(restored.cars.length, 0); assert.equal(restored.bridges, 0);
  for (const road of [...restored.roads]) assert.equal(removeRoad(restored, road.a, road.b).ok, true);
  assert.equal(restored.bridges, 2);
});

test('version one saves migrate capacity and refund excess per-water-cell bridge charges', () => {
  const game = createGame(7), route = [{ x: 1, y: 7 }, { x: 1, y: 8 }, { x: 2, y: 8 }, { x: 2, y: 9 }];
  for (let i = 1; i < route.length; i++) addRoad(game, route[i - 1], route[i]);
  game.version = 1; game.bridges = 0;
  game.buildings.forEach(item => { item.capacity = 7; }); game.roads.forEach(road => { delete road.pendingRemoval; });
  const migrated = restoreGame(serializeGame(game));
  assert.ok(migrated); assert.equal(migrated.version, 4); assert.equal(migrated.bridges, 1);
  assert.ok(migrated.buildings.every(item => item.capacity === 6));
});

test('perpendicular streams serialize their shared junction and both finish trips', () => {
  const game = createGame(7); game.roads = []; game.roadTiles = 100;
  const positions = { h1: [2, 4], d1: [6, 4], h3: [4, 2], d2: [4, 6], h2: [1, 1], h4: [10, 14] };
  for (const item of game.buildings) { [item.x, item.y] = positions[item.id]; if (item.type === 'destination') { item.demand = 4; item.shopSide = 'east'; } }
  for (let i = 2; i < 6; i++) { addRoad(game, { x: i, y: 4 }, { x: i + 1, y: 4 }); addRoad(game, { x: 4, y: i }, { x: 4, y: i + 1 }); }
  let sawWaiting = false;
  for (let i = 0; i < 500; i++) {
    stepGame(game, 0.05);
    assert.ok(game.cars.filter(car => car.junction?.x === 4 && car.junction?.y === 4).length <= 1);
    assert.ok(game.cars.filter(car => Math.hypot(car.x - 4, car.y - 4) < 0.3).length <= 1);
    if (game.cars.some(car => car.junction)) sawWaiting = true;
  }
  assert.ok(sawWaiting); assert.ok(game.score >= 8);
  assert.ok(game.buildings.filter(item => item.type === 'destination').every(item => item.demand < 4));
});

test('weekly supplies pause the simulation and can only be claimed once', () => {
  const game = createGame(7);
  stepGame(game, 61);
  assert.equal(game.status, 'upgrade'); assert.equal(game.week, 1);
  const elapsed = game.elapsed, roads = game.roadTiles;
  stepGame(game, 10); assert.equal(game.elapsed, elapsed);
  assert.equal(applyUpgrade(game, 'bridge').ok, true);
  assert.equal(game.roadTiles, roads + 8); assert.equal(game.bridges, 2); assert.equal(game.week, 2);
  assert.equal(applyUpgrade(game, 'roads').ok, false);
});

test('unserved demand eventually ends the game and freezes score', () => {
  const game = createGame(7);
  stepGame(game, 60); applyUpgrade(game, 'roads'); stepGame(game, 35);
  assert.equal(game.status, 'gameover');
  const elapsed = game.elapsed; stepGame(game, 10); assert.equal(game.elapsed, elapsed);
});

test('save roundtrip preserves simulation and rejects malformed input', () => {
  const game = createGame(7); stepGame(game, 3);
  const restored = restoreGame(serializeGame(game));
  assert.deepEqual(restored, game);
  stepGame(game, 5); stepGame(restored, 5); assert.deepEqual(restored, game);
  assert.equal(restoreGame('{broken'), null);
  assert.equal(restoreGame(null), null);
  assert.equal(restoreGame(undefined), null);
  assert.equal(restoreGame({ version: 1 }), null);
  const invalid = JSON.parse(serializeGame(game)); invalid.cars = [{ route: null }];
  assert.equal(restoreGame(invalid), null);
  invalid.cars = []; invalid.buildings[0].demandClock = 'bad';
  assert.equal(restoreGame(invalid), null);
});

test('saved upgrade and finished games restore without advancing until explicitly restarted', () => {
  const game = createGame(7); stepGame(game, 60);
  const upgraded = restoreGame(serializeGame(game));
  assert.equal(upgraded.status, 'upgrade');
  stepGame(upgraded, 5); assert.equal(upgraded.elapsed, game.elapsed);
  applyUpgrade(upgraded, 'roads'); stepGame(upgraded, 35);
  const finished = restoreGame(serializeGame(upgraded));
  assert.equal(finished.status, 'gameover');
  stepGame(finished, 5); assert.equal(finished.elapsed, upgraded.elapsed);
});

test('restore rejects a car route that bypasses a removed road', () => {
  const game = createGame(7); stepGame(game, 1);
  game.roads.splice(2, 1);
  assert.equal(restoreGame(serializeGame(game)), null);
});

test('undoing mixed land and river edits conserves all resources', () => {
  const game = createGame(7), baseline = { roads: game.roadTiles, bridges: game.bridges, segments: game.roads.length };
  const points = [{ x: 1, y: 6 }, { x: 1, y: 7 }, { x: 1, y: 8 }, { x: 1, y: 9 }, { x: 1, y: 10 }];
  for (let i = 1; i < points.length; i++) assert.equal(addRoad(game, points[i - 1], points[i]).ok, true);
  for (let i = points.length - 1; i > 0; i--) assert.equal(removeRoad(game, points[i - 1], points[i]).ok, true);
  assert.equal(game.roadTiles, baseline.roads); assert.equal(game.bridges, baseline.bridges); assert.equal(game.roads.length, baseline.segments);
  assert.equal(removeRoad(game, null, points[0]).ok, false);
});

test('seeded expansion avoids water, roads and existing building cells', () => {
  const game = createGame(42); stepGame(game, 36);
  assert.equal(game.buildings.length, 8);
  const newest = game.buildings.at(-1);
  assert.ok(!game.water.some(cell => cell.x === newest.x && cell.y === newest.y));
  assert.ok(!game.roads.some(road => [road.a, road.b].some(cell => cell.x === newest.x && cell.y === newest.y)));
});

test('all eight home directions accept roads without charging shoreline diagonals', () => {
  const game = createGame(9); game.roads = [];
  const home = game.buildings[0];
  for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
    if (dx || dy) assert.equal(addRoad(game, home, { x: home.x + dx, y: home.y + dy }).ok, true);
  }
  const a = { x: 4, y: 9 }, b = { x: 5, y: 10 };
  assert.equal(addRoad(game, a, b).ok, true);
  assert.equal(game.bridges, 1);
  assert.equal(removeRoad(game, a, b).ok, true);
  assert.equal(game.bridges, 1);
  assert.ok(restoreGame(serializeGame(game)));
});

test('growth adds repeated colors, shared lots, five colors and a larger restorable map', () => {
  for (const seed of [7, 42, 100]) {
    const game = createGame(seed);
    for (let seconds = 0; seconds < 420; seconds++) {
      // Isolate growth from loss caused by deliberately unconnected demand.
      for (const item of game.buildings) { item.demand = 0; item.stress = 0; }
      if (game.status === 'upgrade') applyUpgrade(game, 'roads');
      stepGame(game, 1);
    }
    const destinations = game.buildings.filter(item => item.type === 'destination');
    assert.ok(destinations.length > 8);
    assert.equal(new Set(destinations.map(item => item.color)).size, 5);
    assert.ok(destinations.filter(item => item.color === 'coral').length > 1);
    assert.ok(game.cols > 13 && game.rows > 17);
    assert.deepEqual(restoreGame(serializeGame(game)), game);
    const paired = destinations.find(item => item.parkingId);
    assert.ok(paired);
    const peer = destinations.find(item => item !== paired && item.parkingId === paired.parkingId);
    assert.notEqual(peer.color, paired.color);
    assert.equal(getRoute(game, paired.id, peer.id).length, 2);
  }
});

test('a matching car can enter either side of a shared parking lot and return after save', () => {
  const game = createGame(7); game.roads = []; game.water = [];
  const home = game.buildings.find(item => item.id === 'h1');
  const first = game.buildings.find(item => item.id === 'd1');
  const second = game.buildings.find(item => item.id === 'd2');
  Object.assign(home, { x: 5, y: 6 });
  Object.assign(first, { x: 5, y: 4, parkingId: 'lot' });
  Object.assign(second, { x: 6, y: 4, parkingId: 'lot' });
  addRoad(game, home, { x: 6, y: 5 });
  addRoad(game, { x: 6, y: 5 }, second);
  assert.equal(getRoute(game, home.id, first.id).length, 4);
  stepGame(game, 0.5);
  const restored = restoreGame(serializeGame(game)); assert.ok(restored);
  stepGame(restored, 5);
  assert.equal(restored.score, 1);
  assert.equal(restored.cars.length, 0);
  second.x = 10;
  assert.equal(restoreGame(serializeGame(game)), null);
});

test('shop footprint rejects roads while parking accepts side access and serves round trips', () => {
  const game = createGame(7);
  const count = game.roadTiles;
  assert.equal(addRoad(game, { x: 6, y: 3 }, { x: 7, y: 3 }).ok, false);
  assert.equal(addRoad(game, { x: 7, y: 3 }, { x: 7, y: 4 }).ok, false);
  assert.equal(game.roadTiles, count);
  const route = getRoute(game, 'h1', 'd1');
  assert.ok(route);
  assert.ok(!route.some(point => point.x === 7 && point.y === 3));
  assert.deepEqual(route.at(-2), { x: 6, y: 4 });
  assert.deepEqual(route.at(-1), { x: 7, y: 4 });
  stepGame(game, 7);
  assert.equal(game.score, 1);
  assert.ok(restoreGame(serializeGame(game)));
});

test('old saves relocate shops away from existing roads without changing trips or budgets', () => {
  const game = createGame(7);
  game.version = 2;
  game.roads.splice(-2, 2,
    { a: { x: 6, y: 3 }, b: { x: 7, y: 3 }, bridge: false, pendingRemoval: false },
    { a: { x: 7, y: 3 }, b: { x: 7, y: 4 }, bridge: false, pendingRemoval: false });
  const restored = restoreGame(serializeGame(game));
  assert.ok(restored);
  assert.equal(restored.version, 4);
  assert.equal(restored.buildings.find(item => item.id === 'd1').shopSide, 'south');
  assert.deepEqual(restored.roads, game.roads);
  assert.equal(restored.roadTiles, game.roadTiles);
  assert.deepEqual(restoreGame(serializeGame(restored)), restored);
  stepGame(restored, 7);
  assert.equal(restored.score, 1);
  assert.equal(addRoad(restored, { x: 7, y: 4 }, { x: 7, y: 5 }).ok, false);
});

test('migration refunds obstructing roads and returns affected cars without awarding a delivery', () => {
  const game = createGame(7); stepGame(game, 1); game.version = 2;
  const destination = game.buildings.find(item => item.id === 'd1');
  Object.assign(destination, { x: 4, y: 4 });
  for (const point of [{ x: 4, y: 5 }, { x: 3, y: 4 }, { x: 5, y: 4 }]) game.water.push(point);
  // The only dry shop location is (4,3), currently used by a car's route.
  const roads = game.roads.length, budget = game.roadTiles;
  const restored = restoreGame(serializeGame(game));
  assert.ok(restored);
  assert.equal(restored.roads.length, roads - 2);
  assert.equal(restored.roadTiles, budget + 2);
  assert.equal(restored.score, 0);
  assert.equal(restored.cars.length, 0);
  assert.match(restored.message, /回收/);
});

test('other parking lots cannot be used as through roads', () => {
  const game = createGame(7); game.roads = []; game.water = [];
  Object.assign(game.buildings.find(item => item.id === 'h1'), { x: 1, y: 4 });
  Object.assign(game.buildings.find(item => item.id === 'd1'), { x: 5, y: 4 });
  Object.assign(game.buildings.find(item => item.id === 'd2'), { x: 3, y: 4 });
  for (let x = 1; x < 5; x++) assert.equal(addRoad(game, { x, y: 4 }, { x: x + 1, y: 4 }).ok, true);
  assert.equal(getRoute(game, 'h1', 'd1'), null);
  assert.ok(getRoute(game, 'h1', 'd2'));
});

test('current saves reject roads hidden under shop footprints', () => {
  const game = createGame(7);
  game.roads.push({ a: { x: 7, y: 3 }, b: { x: 7, y: 4 }, bridge: false, pendingRemoval: false });
  assert.equal(restoreGame(serializeGame(game)), null);
});

test('a shoreline diagonal stays on land and needs no bridge', () => {
  const game = createGame(7); game.bridges = 0;
  const a = { x: 4, y: 9 }, b = { x: 5, y: 10 };
  assert.equal(addRoad(game, a, b).ok, true);
  assert.equal(game.roads.at(-1).bridge, false);
  assert.equal(game.bridges, 0);
  assert.equal(removeRoad(game, a, b).ok, true);
  assert.equal(game.bridges, 0);
});

test('a seam crossing and an opposite diagonal are separate bridges without a junction', () => {
  const game = createGame(7); game.roads = []; game.water = [{ x: 1, y: 2 }, { x: 2, y: 1 }];
  assert.equal(addRoad(game, { x: 1, y: 1 }, { x: 2, y: 2 }).ok, true);
  assert.equal(game.bridges, 0);
  assert.equal(addRoad(game, { x: 1, y: 2 }, { x: 2, y: 1 }).ok, false);
  game.bridges = 1;
  assert.equal(addRoad(game, { x: 1, y: 2 }, { x: 2, y: 1 }).ok, true);
  assert.equal(game.bridges, 0);
  removeRoad(game, { x: 1, y: 1 }, { x: 2, y: 2 });
  assert.equal(game.bridges, 1);
  assert.equal(game.roads.length, 1);
});

test('legacy shoreline bridge charges are refunded exactly once on restore', () => {
  const game = createGame(7); game.version = 3;
  game.roads.push({ a: { x: 4, y: 9 }, b: { x: 5, y: 10 }, bridge: true, pendingRemoval: false });
  game.roadTiles--; game.bridges--;
  const restored = restoreGame(serializeGame(game));
  assert.ok(restored);
  assert.equal(restored.version, 4);
  assert.equal(restored.bridges, 1);
  assert.equal(restored.roads.at(-1).bridge, false);
  assert.equal(restored.roadTiles, game.roadTiles);
  assert.deepEqual(restoreGame(serializeGame(restored)), restored);
  const road = restored.roads.at(-1);
  removeRoad(restored, road.a, road.b);
  assert.equal(restored.bridges, 1);
});

test('legacy split bridge spans remain funded without negative inventory', () => {
  const game = createGame(7); game.version = 3; game.roads = []; game.bridges = 1;
  game.water = [{ x: 1, y: 1 }, { x: 2, y: 1 }];
  game.roads.push(
    { a: { x: 1, y: 1 }, b: { x: 2, y: 2 }, bridge: true },
    { a: { x: 2, y: 1 }, b: { x: 3, y: 1 }, bridge: true });
  const restored = restoreGame(serializeGame(game));
  assert.ok(restored);
  assert.equal(restored.bridges, 1);
  assert.deepEqual(restoreGame(serializeGame(restored)), restored);
});

test('v1 migration preserves multiple valid home driveways', () => {
  const game = createGame(7);
  addRoad(game, { x: 2, y: 3 }, { x: 2, y: 4 });
  game.version = 1;
  const restored = restoreGame(serializeGame(game));
  assert.ok(restored);
  assert.deepEqual(restored.roads, game.roads);
  assert.equal(restored.roadTiles, game.roadTiles);
});

test('invalid shared parking metadata cannot introduce synthetic route edges', () => {
  for (const parkingId of ['', 0, {}, 'orphan']) {
    const game = createGame(7);
    game.buildings.find(item => item.id === 'd1').parkingId = parkingId;
    assert.equal(restoreGame(serializeGame(game)), null);
  }
  const game = createGame(7);
  const first = game.buildings.find(item => item.id === 'd1');
  const second = game.buildings.find(item => item.id === 'd2');
  Object.assign(second, { x: first.x + 1, y: first.y, color: first.color });
  first.parkingId = second.parkingId = 'lot';
  assert.equal(restoreGame(serializeGame(game)), null);
});

test('growth uses continuous terrain and puts every new shop on its new homes bank', () => {
  for (const seed of [2, 3, 6, 42]) {
    const game = createGame(seed);
    const reachable = (from, to) => {
      const water = new Set(game.water.map(p => `${p.x},${p.y}`)), seen = new Set(), queue = [from];
      while (queue.length) {
        const p = queue.pop(), id = `${p.x},${p.y}`;
        if (p.x < 0 || p.x >= game.cols || p.y < 0 || p.y >= game.rows || water.has(id) || seen.has(id)) continue;
        if (p.x === to.x && p.y === to.y) return true;
        seen.add(id);
        queue.push({ x: p.x + 1, y: p.y }, { x: p.x - 1, y: p.y }, { x: p.x, y: p.y + 1 }, { x: p.x, y: p.y - 1 });
      }
      return false;
    };
    for (let seconds = 0; seconds < 560; seconds++) {
      for (const item of game.buildings) { item.demand = 0; item.stress = 0; }
      if (game.status === 'upgrade') applyUpgrade(game, 'roads');
      const before = game.buildings.length;
      stepGame(game, 1);
      if (game.buildings.length > before) {
        const [home, destination] = game.buildings.slice(before);
        assert.equal(reachable(home, destination), true, `seed ${seed} at ${seconds}`);
      }
    }
    for (let x = 13; x < game.cols; x++) assert.ok(game.water.some(p => p.x === x && p.y === 8));
    assert.equal(reachable({ x: 0, y: 0 }, { x: 0, y: 16 }), false);
    assert.ok(restoreGame(serializeGame(game)));
  }
});

test('land junctions next to a river bend do not count as branches on neighboring water cells', () => {
  const game = createGame(7); game.bridges = 2;
  for (const [a, b] of [[{ x: 7, y: 8 }, { x: 7, y: 9 }], [{ x: 7, y: 9 }, { x: 7, y: 10 }], [{ x: 7, y: 8 }, { x: 8, y: 9 }], [{ x: 8, y: 9 }, { x: 8, y: 10 }]]) assert.equal(addRoad(game, a, b).ok, true);
  assert.equal(game.bridges, 0);
  assert.ok(restoreGame(serializeGame(game)));
});

test('retired legacy bridge branches cannot be restored into an invalid save', () => {
  const game = createGame(7); game.roads = []; game.version = 3; game.bridges = 1;
  const home = game.buildings.find(item => item.id === 'h1');
  const destination = game.buildings.find(item => item.id === 'd1');
  Object.assign(home, { x: 1, y: 7 }); Object.assign(destination, { x: 2, y: 8, shopSide: 'north' });
  const a = { x: 1, y: 8 }, b = { x: 2, y: 8 };
  game.roads = [
    { a: { x: 1, y: 7 }, b: a, bridge: true, pendingRemoval: false },
    { a, b: { x: 1, y: 9 }, bridge: true, pendingRemoval: false },
    { a, b, bridge: true, pendingRemoval: false },
  ];
  game.cars.push({ id: 'c1', color: home.color, homeId: home.id, destinationId: destination.id, route: [{ x: 1, y: 7 }, a, b], segment: 0, progress: 0.5, x: 1, y: 7.5, angle: Math.PI / 2, returning: false, stopTime: 0 });
  const restored = restoreGame(serializeGame(game)); assert.ok(restored);
  assert.equal(restored.roads.at(-1).pendingRemoval, true);
  assert.equal(addRoad(restored, a, b).ok, false);
  assert.ok(restoreGame(serializeGame(restored)));
});
