import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, stepGame, addRoad, removeRoad, getRoute, serializeGame, restoreGame } from '../src/engine.js';

test('a reserved trip survives erase, save/reload, undo, and eventual return', () => {
  const state = createGame(91);
  stepGame(state, 1);
  const a = { x: 4, y: 3 }, b = { x: 5, y: 3 };
  const cars = structuredClone(state.cars);
  const budget = state.roadTiles;
  const result = removeRoad(state, a, b);
  assert.equal(result.pending, true);
  assert.deepEqual(state.cars, cars, 'erase must not teleport or cancel cars');
  assert.equal(state.roadTiles, budget, 'busy road remains charged');
  assert.equal(getRoute(state, 'h1', 'd1'), null, 'new departures cannot use a ghost road');
  const restored = restoreGame(serializeGame(state));
  assert.ok(restored, 'pending removal must survive a reload');
  assert.equal(addRoad(restored, a, b).changed, true, 'undo reactivates the same road');
  assert.equal(restored.roadTiles, budget, 'reactivation must not charge twice');
  assert.ok(getRoute(restored, 'h1', 'd1'));
  assert.equal(removeRoad(restored, a, b).pending, true);
  stepGame(restored, 12);
  assert.equal(restored.cars.filter(car => car.homeId === 'h1').length, 0);
  assert.equal(restored.score, 1, 'the already-reserved trip must still deliver once');
  assert.equal(restored.roadTiles, budget + 1, 'refund occurs after the round trip');
});

test('unconnected homes do not generate trips, but destinations still generate demand', () => {
  const state = createGame(92);
  const destination = state.buildings.find(item => item.id === 'd2');
  const initial = destination.demand;
  stepGame(state, 16);
  assert.ok(destination.demand > initial);
  assert.equal(state.cars.filter(car => car.color === 'teal').length, 0);
  assert.equal(state.cars.every(car => {
    const home = state.buildings.find(item => item.id === car.homeId);
    const target = state.buildings.find(item => item.id === car.destinationId);
    return home.color === target.color && car.color === home.color;
  }), true);
});

test('large simulation steps and many frame steps preserve core roundtrip outcome', () => {
  const large = createGame(93);
  const small = createGame(93);
  stepGame(large, 20);
  for (let i = 0; i < 400; i++) stepGame(small, 0.05);
  assert.equal(large.score, small.score);
  assert.equal(large.roadTiles, small.roadTiles);
  assert.deepEqual(large.buildings.map(item => item.demand), small.buildings.map(item => item.demand));
  assert.deepEqual(large.cars.map(car => [car.homeId, car.destinationId, car.returning]), small.cars.map(car => [car.homeId, car.destinationId, car.returning]));
});
