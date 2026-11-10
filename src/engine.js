const COLORS = ['coral', 'teal', 'gold', 'blue', 'purple'];
const STEP = 0.05;
const SHOP_SIDES = { north: [0, -1], south: [0, 1], west: [-1, 0], east: [1, 0] };
export function shopCell(destination) {
  const [dx, dy] = SHOP_SIDES[destination.shopSide || 'north'];
  return { x: destination.x + dx, y: destination.y + dy };
}
const footprint = item => item.type === 'destination' ? [item, shopCell(item)] : [item];
const shopAt = (state, point) => state.buildings.some(item => item.type === 'destination' && same(shopCell(item), point));
const key = p => `${p.x},${p.y}`;
const same = (a, b) => a.x === b.x && a.y === b.y;
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const segmentKey = (a, b) => [key(a), key(b)].sort().join('|');
const isWater = (state, point) => state.water.some(cell => same(cell, point));
const inside = (state, p) => p && Number.isInteger(p.x) && Number.isInteger(p.y) && p.x >= 0 && p.y >= 0 && p.x < state.cols && p.y < state.rows;

function random(state) {
  state.rng = (Math.imul(state.rng, 1664525) + 1013904223) >>> 0;
  return state.rng / 4294967296;
}

function building(id, type, color, x, y) {
  return { id, type, color, x, y, demand: type === 'destination' ? 1 : 0, stress: 0, capacity: 6, demandClock: 0, cooldown: 0 };
}

export function createGame(seed = Date.now()) {
  const normalizedSeed = Number(seed) >>> 0;
  const state = {
    version: 3, cols: 13, rows: 17, seed: normalizedSeed, rng: normalizedSeed,
    buildings: [building('h1', 'home', 'coral', 2, 3), building('h2', 'home', 'coral', 3, 6), building('d1', 'destination', 'coral', 7, 4), building('h3', 'home', 'teal', 10, 11), building('h4', 'home', 'teal', 7, 14), building('d2', 'destination', 'teal', 3, 12)],
    roads: [], cars: [], water: [], score: 0, elapsed: 0, week: 1,
    roadTiles: 24, bridges: 1, status: 'playing', upgradeChoices: ['roads', 'bridge'],
    message: '', nextCarId: 1, nextBuildingId: 7, nextExpansion: 35, dispatchClock: 0,
  };
  for (let x = 0; x < state.cols; x++) {
    state.water.push({ x, y: x >= 5 && x <= 8 ? 9 : 8 });
    // Fill the bend so diagonal roads cannot slip through a river seam.
    if (x === 5 || x === 8) state.water.push({ x, y: 8 });
  }
  for (let x = 2; x < 6; x++) addRoad(state, { x, y: 3 }, { x: x + 1, y: 3 });
  addRoad(state, { x: 6, y: 3 }, { x: 6, y: 4 });
  addRoad(state, { x: 6, y: 4 }, { x: 7, y: 4 });
  state.message = '';
  return state;
}

function roadWater(state, road) {
  const points = [road.a, road.b];
  if (road.a.x !== road.b.x && road.a.y !== road.b.y) points.push({ x: road.a.x, y: road.b.y }, { x: road.b.x, y: road.a.y });
  return points.filter(point => isWater(state, point));
}

function parkingLinks(state) {
  const links = [];
  for (const item of state.buildings) {
    if (!item.parkingId) continue;
    const peer = state.buildings.find(other => other.id !== item.id && other.parkingId === item.parkingId);
    if (peer && item.id < peer.id) links.push({ a: { x: item.x, y: item.y }, b: { x: peer.x, y: peer.y } });
  }
  return links;
}

function bridgeSpans(state, roads = state.roads) {
  const graph = new Map();
  for (const road of roads) {
    const water = roadWater(state, road);
    for (const point of water) if (!graph.has(key(point))) graph.set(key(point), []);
    for (const point of water) graph.get(key(point)).push(...water.filter(other => !same(other, point)).map(key));
  }
  const seen = new Set(); let count = 0;
  for (const point of graph.keys()) {
    if (seen.has(point)) continue;
    count++; const pending = [point];
    while (pending.length) {
      const next = pending.pop(); if (seen.has(next)) continue;
      seen.add(next); pending.push(...graph.get(next).filter(neighbor => !seen.has(neighbor)));
    }
  }
  return count;
}

const usesRoad = (car, road) => car.route.some((point, i) => i > 0 && segmentKey(car.route[i - 1], point) === segmentKey(road.a, road.b));
const incident = (road, point) => same(road.a, point) || same(road.b, point);

function bridgeReserve(state, roads = state.roads) {
  return Math.max(0, bridgeSpans(state, roads.filter(road => !road.pendingRemoval)) - bridgeSpans(state, roads));
}

function finishRoadRemovals(state) {
  const removable = state.roads.filter(road => road.pendingRemoval && !state.cars.some(car => usesRoad(car, road)));
  if (!removable.length) return;
  const remaining = state.roads.filter(road => !removable.includes(road));
  const cost = bridgeSpans(state, remaining) - bridgeSpans(state);
  // A temporarily split span waits until every affected car has cleared it.
  if (cost > state.bridges) return;
  state.roads = remaining; state.roadTiles += removable.length; state.bridges -= cost;
}

/** Add neighboring road segments. One connected, unbranched river span costs one bridge. */
export function addRoad(state, a, b) {
  if (!inside(state, a) || !inside(state, b)) return { ok: false, reason: '道路超出地圖範圍' };
  const dx = Math.abs(a.x - b.x), dy = Math.abs(a.y - b.y);
  if ((!dx && !dy) || dx > 1 || dy > 1) return { ok: false, reason: '請連接相鄰的格子' };
  if (shopAt(state, a) || shopAt(state, b)) return { ok: false, reason: '商場建築不能鋪路，請從旁邊接入 P 停車場' };
  const existing = state.roads.find(road => segmentKey(road.a, road.b) === segmentKey(a, b));
  if (existing && !existing.pendingRemoval) return { ok: true, existing: true, changed: false };
  if (existing) {
    const proposed = state.roads.map(road => road === existing ? { ...road, pendingRemoval: false } : road);
    if (bridgeReserve(state, proposed) > state.bridges) return { ok: false, reason: '恢復這段橋梁需要額外橋梁，請先恢復相鄰路段' };
    existing.pendingRemoval = false; return { ok: true, changed: true, restored: true };
  }
  if (state.roadTiles < 1) return { ok: false, reason: '道路用完了，移除舊道路可回收' };
  const bridge = roadWater(state, { a, b }).length > 0;
  if ([a, b].some(point => isWater(state, point) && state.roads.filter(road => incident(road, point)).length >= 2)) return { ok: false, reason: '橋梁不能分岔，請在陸地設置路口' };
  const road = { a: { ...a }, b: { ...b }, bridge, pendingRemoval: false };
  const proposed = [...state.roads, road];
  const cost = bridgeSpans(state, proposed) - bridgeSpans(state);
  if (state.bridges - cost < bridgeReserve(state, proposed)) return { ok: false, reason: '橋梁不足，下週可選擇補給' };
  state.roads.push(road);
  state.roadTiles--;
  state.bridges -= cost;
  return { ok: true, changed: true };
}

export function removeRoad(state, a, b) {
  if (!inside(state, a) || !inside(state, b)) return { ok: false, reason: '道路超出地圖範圍' };
  const index = state.roads.findIndex(road => segmentKey(road.a, road.b) === segmentKey(a, b));
  if (index < 0) return { ok: false, reason: '這裡沒有道路' };
  const road = state.roads[index];
  if (road.pendingRemoval) return { ok: true, changed: false, pending: true };
  const proposed = state.roads.map(item => item === road ? { ...item, pendingRemoval: true } : item);
  if (bridgeReserve(state, proposed) > state.bridges) return { ok: false, reason: '拆開橋梁需要額外橋梁，請從岸邊逐段拆除' };
  road.pendingRemoval = true;
  finishRoadRemovals(state);
  return { ok: true, changed: true, pending: state.roads.includes(road) };
}

/** Shortest physical route; buildings cannot be used as through intersections. */
export function getRoute(state, fromId, toId) {
  const from = state.buildings.find(item => item.id === fromId);
  const to = state.buildings.find(item => item.id === toId);
  if (!from || !to) return null;
  const graph = new Map();
  for (const road of [...state.roads, ...parkingLinks(state)]) {
    if (road.pendingRemoval || shopAt(state, road.a) || shopAt(state, road.b)) continue;
    const a = key(road.a), b = key(road.b);
    if (!graph.has(a)) graph.set(a, []);
    if (!graph.has(b)) graph.set(b, []);
    graph.get(a).push(road.b);
    graph.get(b).push(road.a);
  }
  const endpointLots = new Set([from, to].filter(item => item.type === 'destination').map(item => item.parkingId || item.id));
  const blocked = new Set(state.buildings.filter(item => item.id !== fromId && item.id !== toId && !(item.type === 'destination' && endpointLots.has(item.parkingId || item.id))).map(key));
  const origin = key(from), target = key(to), distances = new Map([[origin, 0]]), previous = new Map(), pending = [{ x: from.x, y: from.y }];
  const visited = new Set();
  while (pending.length) {
    pending.sort((a, b) => distances.get(key(a)) - distances.get(key(b)));
    const current = pending.shift(), currentKey = key(current);
    if (visited.has(currentKey)) continue;
    visited.add(currentKey);
    if (currentKey === target) {
      const path = [{ x: to.x, y: to.y }];
      let cursor = target;
      while (cursor !== origin) { const point = previous.get(cursor); path.unshift(point); cursor = key(point); }
      return path;
    }
    for (const next of graph.get(currentKey) || []) {
      const nextKey = key(next);
      if (blocked.has(nextKey)) continue;
      const candidate = distances.get(currentKey) + distance(current, next);
      if (candidate < (distances.get(nextKey) ?? Infinity)) {
        distances.set(nextKey, candidate); previous.set(nextKey, current); pending.push(next);
      }
    }
  }
  return null;
}

function vacantCell(state, color, type) {
  const home = state.buildings.find(item => item.type === 'home' && item.color === color);
  for (let attempt = 0; attempt < 100; attempt++) {
    const point = { x: 1 + Math.floor(random(state) * (state.cols - 2)), y: 1 + Math.floor(random(state) * (state.rows - 2)) };
    const cells = type === 'destination' ? [point, shopCell(point)] : [point];
    if (cells.some(cell => !inside(state, cell) || isWater(state, cell))) continue;
    if (state.buildings.some(item => footprint(item).some(occupied => cells.some(cell => distance(occupied, cell) < 2.1)))) continue;
    if (state.roads.some(road => cells.some(cell => incident(road, cell)))) continue;
    // New pairs start on the same bank; bridges remain a routing choice.
    if (type === 'destination' && home && (home.y < 8) !== (point.y < 8)) continue;
    return point;
  }
  return null;
}

function expand(state) {
  const wave = Math.floor(state.elapsed / 35);
  // Grow outward without moving existing roads, trips, or building coordinates.
  const cols = Math.min(29, 13 + 2 * Math.floor(wave / 2));
  const rows = Math.min(33, 17 + 2 * Math.floor(wave / 2));
  for (let x = state.cols; x < cols; x++) state.water.push({ x, y: 8 });
  state.cols = Math.max(state.cols, cols); state.rows = Math.max(state.rows, rows);
  if (state.buildings.length >= 100) return;
  const colors = [...new Set(state.buildings.map(item => item.color))];
  const unlocked = Math.min(COLORS.length, 2 + Math.floor(state.elapsed / 105));
  const color = colors.length < unlocked ? COLORS.find(item => !colors.includes(item)) : colors[(Math.max(1, wave) - 1) % colors.length];
  const point = vacantCell(state, color, 'home');
  if (!point) return;
  const home = building(`b${state.nextBuildingId++}`, 'home', color, point.x, point.y);
  state.buildings.push(home);
  let target = null, partner = null;
  // Every other opening can extend an existing lot with a different-color shop.
  if (wave % 2 === 0) {
    for (const candidate of state.buildings.filter(item => item.type === 'destination' && item.color !== color && !item.parkingId && (!item.shopSide || item.shopSide === 'north'))) {
      const cell = { x: candidate.x + 1, y: candidate.y };
      if ((home.y < 8) !== (candidate.y < 8)) continue;
      const cells = [cell, shopCell(cell)];
      if (cells.some(p => !inside(state, p) || isWater(state, p) || state.roads.some(road => incident(road, p)))) continue;
      if (state.buildings.some(item => item !== candidate && footprint(item).some(occupied => cells.some(p => distance(occupied, p) < 1.6)))) continue;
      target = cell; partner = candidate; break;
    }
  }
  target ||= vacantCell(state, color, 'destination');
  if (!target) { state.buildings.pop(); return; }
  const destination = building(`b${state.nextBuildingId++}`, 'destination', color, target.x, target.y);
  if (partner) { partner.parkingId = partner.id; destination.parkingId = partner.id; }
  state.buildings.push(destination);
  state.message = partner ? '雙色商圈開幕，共用同一座停車場' : '新目的地開幕，替同色住宅接上停車場吧';
}

function dispatch(state) {
  for (const destination of state.buildings.filter(item => item.type === 'destination')) {
    let reserved = state.cars.filter(car => car.destinationId === destination.id && !car.returning).length;
    while (destination.demand > reserved) {
      let selected = null;
      for (const home of state.buildings.filter(item => item.type === 'home' && item.color === destination.color)) {
        if (home.cooldown > 0 || state.cars.filter(car => car.homeId === home.id).length >= 2) continue;
        const route = getRoute(state, home.id, destination.id);
        if (!route) continue;
        const length = route.slice(1).reduce((total, point, i) => total + distance(route[i], point), 0);
        if (!selected || length < selected.length) selected = { home, route, length };
      }
      if (!selected) break;
      const { home, route } = selected;
      state.cars.push({ id: `c${state.nextCarId++}`, color: home.color, homeId: home.id, destinationId: destination.id, route, segment: 0, progress: 0, x: home.x, y: home.y, angle: Math.atan2(route[1].y - home.y, route[1].x - home.x), returning: false, stopTime: 0 });
      home.cooldown = 1.1; reserved++;
    }
  }
}

function advanceCars(state, dt) {
  const completed = new Set();
  const degree = new Map();
  for (const road of state.roads) for (const point of [road.a, road.b]) degree.set(key(point), (degree.get(key(point)) || 0) + 1);
  const buildings = new Set(state.buildings.map(key));
  for (const car of state.cars) {
    const next = car.route[car.segment + 1];
    if (car.junction && (!next || !same(next, car.junction)) && distance(car, car.junction) > 0.4) car.junction = null;
  }
  for (const car of state.cars) {
    if (car.stopTime > 0) { car.stopTime -= dt; continue; }
    let movement = 2.3 * dt;
    const start = car.route[car.segment], end = car.route[car.segment + 1];
    if (!start || !end) { completed.add(car.id); continue; }
    // Conservative single-car junction reservation. This approximates negotiation;
    // ordinary roads keep two-way traffic, while crossing streams take turns.
    if ((degree.get(key(end)) || 0) > 2 && !buildings.has(key(end)) && distance(car, end) <= 0.6) {
      if (state.cars.some(other => other.id !== car.id && other.junction && same(other.junction, end))) continue;
      car.junction = { ...end };
    }
    if (car.junction) movement = 1.15 * dt;
    const angle = Math.atan2(end.y - start.y, end.x - start.x);
    // Same-direction vehicles keep a visible gap, including shared bottlenecks.
    const blocked = state.cars.some(other => {
      if (other.id === car.id || other.stopTime > 0) return false;
      const ahead = (other.x - car.x) * Math.cos(angle) + (other.y - car.y) * Math.sin(angle);
      const lateral = Math.abs((other.x - car.x) * Math.sin(angle) - (other.y - car.y) * Math.cos(angle));
      return ahead > 0 && ahead < 0.43 && lateral < 0.15 && Math.cos(other.angle - angle) > 0.7;
    });
    if (blocked) continue;
    car.angle = angle;
    const length = distance(start, end);
    car.progress += movement / length;
    if (car.progress >= 1) {
      car.segment++; car.progress = 0; car.x = end.x; car.y = end.y;
      if (car.segment === car.route.length - 1) {
        if (car.returning) completed.add(car.id);
        else {
          const destination = state.buildings.find(item => item.id === car.destinationId);
          if (destination && destination.demand > 0) { destination.demand--; state.score++; destination.stress = Math.max(0, destination.stress - 0.14); }
          car.returning = true; car.route = [...car.route].reverse(); car.segment = 0; car.stopTime = 0.75;
        }
      }
    } else {
      car.x = start.x + (end.x - start.x) * car.progress;
      car.y = start.y + (end.y - start.y) * car.progress;
    }
  }
  state.cars = state.cars.filter(car => !completed.has(car.id));
}

function tick(state, dt) {
  state.elapsed += dt;
  for (const item of state.buildings) {
    if (item.type === 'home') { item.cooldown = Math.max(0, item.cooldown - dt); continue; }
    item.demandClock += dt;
    const interval = Math.max(2.6, 7.5 - (state.week - 1) * 0.55);
    while (item.demandClock >= interval) { item.demandClock -= interval; item.demand = Math.min(12, item.demand + 1); }
    item.stress = Math.max(0, Math.min(1, item.stress + (item.demand > item.capacity ? dt / 25 : -dt / 12)));
    if (item.stress >= 1) { state.status = 'gameover'; state.message = '目的地等待太久了。重新規劃，讓小城繼續流動。'; return; }
  }
  advanceCars(state, dt);
  finishRoadRemovals(state);
  state.dispatchClock += dt;
  if (state.dispatchClock >= 0.35) { state.dispatchClock = 0; dispatch(state); }
  if (state.elapsed >= state.nextExpansion) { state.nextExpansion += 35; expand(state); }
  if (state.elapsed + 1e-7 >= state.week * 60) { state.status = 'upgrade'; state.message = '新的一週，選擇你的城市補給'; }
}

/** Advances simulated seconds. A bounded fixed step keeps fast-forward stable. */
export function stepGame(state, dtSeconds) {
  if (state.status !== 'playing' || !Number.isFinite(dtSeconds) || dtSeconds <= 0) return state;
  let remaining = Math.min(dtSeconds, 120);
  while (remaining > 1e-9 && state.status === 'playing') {
    const dt = Math.min(STEP, remaining); tick(state, dt); remaining -= dt;
  }
  return state;
}

export function applyUpgrade(state, kind) {
  if (state.status !== 'upgrade') return { ok: false, reason: '每週結束後才能領取補給' };
  if (!state.upgradeChoices.includes(kind)) return { ok: false, reason: '請選擇道路或橋梁補給' };
  state.roadTiles += kind === 'roads' ? 12 : 8;
  if (kind === 'bridge') state.bridges += 1;
  state.week++; state.status = 'playing'; state.message = kind === 'roads' ? '收到 12 段道路，繼續建造吧' : '收到 8 段道路與 1 段橋梁';
  return { ok: true };
}

export function serializeGame(state) { return JSON.stringify(state); }

/** Reject incompatible/corrupt saves instead of allowing malformed simulation data. */
export function restoreGame(json) {
  try {
    const state = typeof json === 'string' ? JSON.parse(json) : JSON.parse(JSON.stringify(json));
    if (!state || ![1, 2, 3].includes(state.version) || !Number.isInteger(state.cols) || !Number.isInteger(state.rows) || state.cols < 13 || state.cols > 29 || state.rows < 17 || state.rows > 33 || !['playing', 'upgrade', 'gameover'].includes(state.status)) return null;
    if (!Array.isArray(state.buildings) || !Array.isArray(state.roads) || !Array.isArray(state.cars) || !Array.isArray(state.water)) return null;
    if (state.buildings.length < 6 || state.buildings.length > 100 || state.roads.length > 1000 || state.cars.length > 200 || state.water.length > 957) return null;
    for (const field of ['seed', 'rng', 'score', 'elapsed', 'week', 'roadTiles', 'bridges', 'nextCarId', 'nextBuildingId', 'nextExpansion', 'dispatchClock']) if (!Number.isFinite(state[field]) || state[field] < 0) return null;
    if (!Number.isInteger(state.week) || state.week < 1 || !Number.isInteger(state.roadTiles) || !Number.isInteger(state.bridges)) return null;
    if (!state.buildings.every(item => inside(state, item) && typeof item.id === 'string' && ['home', 'destination'].includes(item.type) && COLORS.includes(item.color) && ['demand', 'stress', 'capacity', 'demandClock', 'cooldown'].every(field => Number.isFinite(item[field]) && item[field] >= 0) && item.capacity > 0 && item.stress <= 1)) return null;
    if (state.buildings.some(item => item.shopSide !== undefined && !Object.hasOwn(SHOP_SIDES, item.shopSide))) return null;
    if (new Set(state.buildings.map(item => item.id)).size !== state.buildings.length) return null;
    if (!state.water.every(point => inside(state, point))) return null;
    if (!state.roads.every(road => inside(state, road.a) && inside(state, road.b) && distance(road.a, road.b) > 0 && distance(road.a, road.b) <= Math.SQRT2 && typeof road.bridge === 'boolean' && (road.pendingRemoval === undefined || typeof road.pendingRemoval === 'boolean'))) return null;
    const roadKeys = new Set([...state.roads, ...parkingLinks(state)].map(road => segmentKey(road.a, road.b)));
    if (!state.cars.every(car => typeof car.id === 'string' && COLORS.includes(car.color) && ['x', 'y', 'angle', 'progress', 'stopTime'].every(field => Number.isFinite(car[field])) && car.progress >= 0 && car.progress < 1 && car.x >= 0 && car.x < state.cols && car.y >= 0 && car.y < state.rows && typeof car.returning === 'boolean' && Array.isArray(car.route) && car.route.length > 1 && car.route.length <= 957 && car.route.every((point, i) => inside(state, point) && (i === 0 || roadKeys.has(segmentKey(car.route[i - 1], point)))) && Number.isInteger(car.segment) && car.segment >= 0 && car.segment < car.route.length - 1 && state.buildings.some(item => item.id === car.homeId && item.type === 'home' && item.color === car.color) && state.buildings.some(item => item.id === car.destinationId && item.type === 'destination' && item.color === car.color))) return null;
    if (!Array.isArray(state.upgradeChoices) || state.upgradeChoices.length !== 2 || !state.upgradeChoices.includes('roads') || !state.upgradeChoices.includes('bridge')) return null;
    if (state.cars.some(car => car.junction != null && !inside(state, car.junction))) return null;
    if (state.version === 1) {
      // Previous saves paid per water cell; return the difference for span pricing.
      const waterCells = new Set(state.roads.flatMap(road => [road.a, road.b]).filter(point => isWater(state, point)).map(key)).size;
      state.bridges += waterCells - bridgeSpans(state);
      state.version = 2;
      state.buildings.forEach(item => { item.capacity = 6; });
      state.roads.forEach(road => { road.pendingRemoval = false; });
      // Retire legacy branches while existing cars finish their trips.
      for (const point of state.water) state.roads.filter(road => !road.pendingRemoval && incident(road, point)).slice(2).forEach(road => { road.pendingRemoval = true; });
      finishRoadRemovals(state);
    }
    if (state.buildings.some(home => home.type === 'home' && state.cars.filter(car => car.homeId === home.id).length > 2)) return null;
    for (const item of state.buildings.filter(item => item.parkingId != null)) {
      const peers = state.buildings.filter(other => other.parkingId === item.parkingId);
      if (typeof item.parkingId !== 'string' || item.type !== 'destination' || peers.length !== 2 || peers.some(peer => peer.type !== 'destination') || peers[0].color === peers[1].color || peers[0].y !== peers[1].y || Math.abs(peers[0].x - peers[1].x) !== 1) return null;
    }
    if (state.water.some(point => state.roads.filter(road => !road.pendingRemoval && incident(road, point)).length > 2)) return null;
    if (bridgeReserve(state) > state.bridges) return null;
    if (state.version < 3 && !migrateShops(state)) return null;
    const occupied = state.buildings.flatMap(footprint);
    if (new Set(occupied.map(key)).size !== occupied.length) return null;
    if (state.buildings.some(item => item.type === 'destination' && (!inside(state, shopCell(item)) || isWater(state, shopCell(item))))) return null;
    if (state.roads.some(road => shopAt(state, road.a) || shopAt(state, road.b))) return null;
    return state;
  } catch { return null; }
}

// Keep old parking access and trips when a shop can move to a clear side of its lot.
function migrateShops(state) {
  const occupied = new Set(state.buildings.map(key));
  const assigned = new Set();
  for (const destination of state.buildings.filter(item => item.type === 'destination')) {
    if (assigned.has(destination.id)) continue;
    const group = destination.parkingId ? state.buildings.filter(item => item.parkingId === destination.parkingId) : [destination];
    const sides = group.length === 2 ? ['north', 'south'] : Object.keys(SHOP_SIDES);
    const choices = sides.filter(side => group.every(item => {
      const cell = shopCell({ ...item, shopSide: side });
      return inside(state, cell) && !isWater(state, cell) && !occupied.has(key(cell));
    }));
    const clear = choices.find(side => group.every(item => !state.roads.some(road => incident(road, shopCell({ ...item, shopSide: side })))));
    const side = clear || choices[0];
    if (!side) return false;
    for (const item of group) { item.shopSide = side; occupied.add(key(shopCell(item))); assigned.add(item.id); }
  }
  const removed = state.roads.filter(road => shopAt(state, road.a) || shopAt(state, road.b));
  if (removed.length) {
    const oldSpans = bridgeSpans(state);
    state.cars = state.cars.filter(car => !removed.some(road => usesRoad(car, road)));
    state.roads = state.roads.filter(road => !removed.includes(road));
    state.roadTiles += removed.length;
    state.bridges += oldSpans - bridgeSpans(state);
    state.message = '已回收穿過商場的舊道路，請從旁邊接入 P 停車場';
  }
  state.version = 3;
  return true;
}
