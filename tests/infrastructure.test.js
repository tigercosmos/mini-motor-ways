import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, addRoad, addMotorway, placeJunction, removeInfrastructure, availableUpgrades, applyUpgrade, getRoute, stepGame, serializeGame, restoreGame } from '../src/engine.js';

function cross() {
  const state = createGame(7);
  state.buildings = []; state.roads = []; state.roadTiles = 100;
  for (const [a, b] of [[{x:3,y:4},{x:4,y:4}], [{x:4,y:4},{x:5,y:4}], [{x:4,y:3},{x:4,y:4}], [{x:4,y:4},{x:4,y:5}]]) assert.ok(addRoad(state,a,b).ok);
  return state;
}
function car(id, route, progress=0.5) {
  const [a,b] = route;
  return {id, color:'coral', route, segment:0, progress, x:a.x+(b.x-a.x)*progress, y:a.y+(b.y-a.y)*progress, angle:Math.atan2(b.y-a.y,b.x-a.x), stopTime:0, returning:false};
}

test('special packages unlock on entry to week four and exactly one package can be claimed', () => {
  for (const [kind,resource,count,roads] of [['motorway','motorwayTiles',1,12],['signal','signals',2,10],['roundabout','roundabouts',1,10]]) {
    const state = createGame(7); state.status='upgrade'; state.week=2;
    assert.deepEqual(availableUpgrades(state), ['roads','bridge']);
    assert.equal(applyUpgrade(state,kind).ok,false);
    state.week=3; const before=state.roadTiles;
    assert.ok(availableUpgrades(state).includes(kind));
    assert.ok(applyUpgrade(state,kind).ok);
    assert.equal(state.week,4); assert.equal(state[resource],count); assert.equal(state.roadTiles,before+roads);
    assert.equal(applyUpgrade(state,kind).ok,false);
    assert.equal(state[resource],count);
  }
});

test('motorway costs one item, spans water without a bridge, routes and survives restore', () => {
  const state=createGame(7); state.motorwayTiles=1;
  const home=state.buildings.find(b=>b.id==='h3'), dest=state.buildings.find(b=>b.id==='d2');
  const bridges=state.bridges, roads=state.roadTiles;
  assert.ok(addMotorway(state,home,dest).ok);
  assert.equal(state.motorwayTiles,0); assert.equal(state.bridges,bridges); assert.equal(state.roadTiles,roads);
  assert.equal(getRoute(state,home.id,dest.id).length,2);
  stepGame(state,0.6);
  const restored=restoreGame(serializeGame(state)); assert.ok(restored); assert.equal(restored.motorways.length,1);
  assert.equal(addMotorway(state,home,dest).ok,false);
  assert.equal(removeInfrastructure(state,home).pending,true);
  assert.equal(getRoute(state,home.id,dest.id),null);
  const retiring = restoreGame(serializeGame(state)); assert.ok(retiring);
  assert.equal(retiring.motorways[0].pendingRemoval,true); assert.equal(getRoute(retiring,home.id,dest.id),null);
  assert.equal(state.motorwayTiles,0);
  // Existing outbound/return trips keep the retired link until they reach home.
  for(const b of state.buildings) if(b.type==='destination') b.demand=0;
  stepGame(state,12);
  assert.equal(state.motorways.length,0); assert.equal(state.motorwayTiles,1);
});

test('motorway rejects invalid endpoints and refunds an unused link', () => {
  const state=createGame(7); state.motorwayTiles=2;
  assert.equal(addMotorway(state,{x:0,y:0},{x:1,y:1}).ok,false);
  assert.equal(addMotorway(state,{x:0,y:0},{x:0,y:8}).ok,false);
  assert.equal(addMotorway(state,{x:0,y:0},{x:7,y:3}).ok,false);
  assert.ok(addMotorway(state,{x:0,y:0},{x:0,y:10}).ok);
  assert.equal(state.motorwayTiles,1);
  assert.ok(removeInfrastructure(state,{x:0,y:0}).ok);
  assert.equal(state.motorwayTiles,2);
});

test('motorways travel at double speed and ignore traffic beneath the elevated span', () => {
  const state=cross(); state.motorwayTiles=1;
  assert.ok(addMotorway(state,{x:2,y:4},{x:6,y:4}).ok);
  state.cars=[car('fast',[{x:2,y:4},{x:6,y:4}],0.4),car('surface',[{x:3,y:4},{x:4,y:4},{x:5,y:4}],0.8)];
  const before=state.cars[0].x;
  stepGame(state,0.05);
  assert.ok(Math.abs(state.cars[0].x-before-4.6*0.05)<1e-10);
});

test('signals require a land junction, consume inventory and refund without consuming roads', () => {
  const state=cross(); state.signals=2; state.roundabouts=1; const roads=state.roadTiles;
  assert.equal(placeJunction(state,{x:3,y:4},'signal').ok,false);
  assert.ok(placeJunction(state,{x:4,y:4},'signal').ok);
  assert.equal(state.signals,1); assert.equal(state.roadTiles,roads);
  assert.equal(placeJunction(state,{x:4,y:4},'roundabout').ok,false);
  assert.ok(removeInfrastructure(state,{x:4,y:4}).ok);
  assert.equal(state.signals,2); assert.equal(state.roundabouts,1);
});

test('a red approach only waits when another approach actually competes', () => {
  const state=cross(); state.signals=1; placeJunction(state,{x:4,y:4},'signal');
  const vertical=car('vertical',[{x:4,y:3},{x:4,y:4},{x:4,y:5}]);
  state.cars=[structuredClone(vertical)]; stepGame(state,0.05);
  assert.ok(state.cars[0].y>vertical.y);
  const busy=cross(); busy.signals=1; placeJunction(busy,{x:4,y:4},'signal');
  busy.cars=[structuredClone(vertical),car('horizontal',[{x:3,y:4},{x:4,y:4},{x:5,y:4}])];
  stepGame(busy,0.05);
  assert.equal(busy.cars[0].y,vertical.y); assert.ok(busy.cars[1].x>3.5);
});

test('a roundabout follows the circular lane and gives the circulating car priority', () => {
  const state=cross(); state.roundabouts=1; placeJunction(state,{x:4,y:4},'roundabout');
  state.cars=[car('first',[{x:3,y:4},{x:4,y:4},{x:5,y:4}],0.65),car('second',[{x:4,y:3},{x:4,y:4},{x:4,y:5}],0.5)];
  stepGame(state,0.05);
  assert.ok(state.cars[0].roundabout);
  assert.ok(Math.abs(Math.hypot(state.cars[0].x-4,state.cars[0].y-4)-0.4)<1e-10);
  assert.equal(state.cars[1].y,3.5);
  assert.equal(removeInfrastructure(state,{x:4,y:4}).ok,false);
  let exited = false;
  for(let i=0;i<20;i++) {
    stepGame(state,0.05);
    assert.ok(state.cars.filter(c=>c.roundabout).length<=1);
    exited ||= state.cars.some(c=>c.segment>0);
  }
  assert.ok(exited);
});

test('v4 saves migrate without losing roads and malformed infrastructure is rejected', () => {
  const original=createGame(7); original.version=4;
  for(const field of ['motorways','junctions','motorwayTiles','signals','roundabouts']) delete original[field];
  const restored=restoreGame(serializeGame(original)); assert.ok(restored);
  assert.equal(restored.version,5); assert.equal(restored.roads.length,original.roads.length); assert.equal(restored.signals,0);
  for(const mutate of [s=>s.signals=-1,s=>s.motorways=[{a:{x:0,y:0},b:{x:0,y:8},pendingRemoval:false}],s=>s.junctions=[{x:2,y:3,kind:'signal'}],s=>s.junctions=[{x:0,y:0,kind:'invalid'}]]) {
    const invalid=structuredClone(restored); mutate(invalid); assert.equal(restoreGame(serializeGame(invalid)),null);
  }
});

test('a save in the middle of a roundabout preserves the active turn', () => {
  const state=createGame(7); state.roundabouts=1; state.roadTiles=100;
  for(const [a,b] of [[{x:4,y:3},{x:4,y:4}],[{x:4,y:4},{x:5,y:4}],[{x:5,y:4},{x:6,y:4}],[{x:4,y:4},{x:4,y:5}]]) assert.ok(addRoad(state,a,b).ok);
  assert.ok(placeJunction(state,{x:4,y:4},'roundabout').ok);
  const trip=car('c1',[{x:4,y:3},{x:4,y:4},{x:5,y:4},{x:6,y:4},{x:7,y:4}],0.65);
  Object.assign(trip,{homeId:'h1',destinationId:'d1'}); state.cars=[trip];
  stepGame(state,0.05); assert.ok(trip.roundabout);
  const restored=restoreGame(serializeGame(state)); assert.ok(restored);
  assert.deepEqual(restored.cars[0].roundabout,trip.roundabout);
  stepGame(restored,0.05); assert.ok(Number.isFinite(restored.cars[0].x));
  const broken=structuredClone(state); broken.cars[0].roundabout.travelled=100;
  assert.equal(restoreGame(serializeGame(broken)),null);
});

test('routing prefers a longer motorway trip when its travel time is shorter', () => {
  const state=createGame(7);state.motorwayTiles=1;
  assert.ok(addMotorway(state,{x:2,y:3},{x:7,y:5}).ok);
  assert.ok(addRoad(state,{x:7,y:5},{x:7,y:4}).ok);
  assert.deepEqual(getRoute(state,'h1','d1'),[{x:2,y:3},{x:7,y:5},{x:7,y:4}]);
});

test('signals alternate the favored approach without blocking a car already crossing', () => {
  const state=cross();state.signals=1;state.elapsed=3;placeJunction(state,{x:4,y:4},'signal');
  state.cars=[car('horizontal',[{x:3,y:4},{x:4,y:4},{x:5,y:4}]),car('vertical',[{x:4,y:3},{x:4,y:4},{x:4,y:5}])];
  stepGame(state,0.05);assert.equal(state.cars[0].x,3.5);assert.ok(state.cars[1].y>3.5);
  state.elapsed=6;const before=state.cars[1].y;stepGame(state,0.05);assert.ok(state.cars[1].y>before);
});
