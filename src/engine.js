const COLORS = ['coral', 'teal', 'gold'];
const STEP = 0.05;
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
    version: 2, cols: 13, rows: 17, seed: normalizedSeed, rng: normalizedSeed,
    buildings: [building('h1', 'home', 'coral', 2, 3), building('h2', 'home', 'coral', 3, 6), building('d1', 'destination', 'coral', 7, 4), building('h3', 'home', 'teal', 10, 11), building('h4', 'home', 'teal', 7, 14), building('d2', 'destination', 'teal', 3, 12)],
    roads: [], cars: [], water: [], score: 0, elapsed: 0, week: 1,
    roadTiles: 41, bridges: 2, status: 'playing', upgradeChoices: ['roads', 'bridge'],
    message: '', nextCarId: 1, nextBuildingId: 7, nextExpansion: 35, dispatchClock: 0,
  };
  for (let x = 0; x < state.cols; x++) {
    state.water.push({ x, y: x >= 5 && x <= 8 ? 9 : 8 });
    // Fill the bend so diagonal roads cannot slip through a river seam.
    if (x === 5 || x === 8) state.water.push({ x, y: 8 });
  }
  for (let x = 2; x < 7; x++) addRoad(state, { x, y: 3 }, { x: x + 1, y: 3 });
  addRoad(state, { x: 7, y: 3 }, { x: 7, y: 4 });
  state.message = '';
  return state;
}

function bridgeSpans(state, roads = state.roads) {
  const graph = new Map();
  for (const road of roads) {
    const water = [road.a, road.b].filter(point => isWater(state, point));
    for (const point of water) if (!graph.has(key(point))) graph.set(key(point), []);
    if (water.length === 2) { graph.get(key(water[0])).push(key(water[1])); graph.get(key(water[1])).push(key(water[0])); }
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
  const existing = state.roads.find(road => segmentKey(road.a, road.b) === segmentKey(a, b));
  if (existing && !existing.pendingRemoval) return { ok: true, existing: true, changed: false };
  for (const point of [a, b]) {
    if (state.buildings.some(item => item.type === 'home' && same(item, point)) && state.roads.some(road => road !== existing && !road.pendingRemoval && incident(road, point))) return { ok: false, reason: '住宅只能有一個出入口，請先拆除舊連接' };
  }
  if (existing) {
    const proposed = state.roads.map(road => road === existing ? { ...road, pendingRemoval: false } : road);
    if (bridgeReserve(state, proposed) > state.bridges) return { ok: false, reason: '恢復這段橋梁需要額外橋梁，請先恢復相鄰路段' };
    existing.pendingRemoval = false; return { ok: true, changed: true, restored: true };
  }
  if (state.roadTiles < 1) return { ok: false, reason: '道路用完了，移除舊道路可回收' };
  const bridge = isWater(state, a) || isWater(state, b);
  if (dx && dy) {
    if (bridge || isWater(state, { x: a.x, y: b.y }) || isWater(state, { x: b.x, y: a.y })) return { ok: false, reason: '過河時請沿水平或垂直格線鋪橋' };
    if (state.roads.some(road => road.a.x + road.b.x === a.x + b.x && road.a.y + road.b.y === a.y + b.y && Math.abs(road.a.x - road.b.x) === 1 && Math.abs(road.a.y - road.b.y) === 1)) return { ok: false, reason: '斜向道路不能交叉，請共用路口' };
  }
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
  for (const road of state.roads) {
    if (road.pendingRemoval) continue;
    const a = key(road.a), b = key(road.b);
    if (!graph.has(a)) graph.set(a, []);
    if (!graph.has(b)) graph.set(b, []);
    graph.get(a).push(road.b);
    graph.get(b).push(road.a);
  }
  const blocked = new Set(state.buildings.filter(item => item.id !== fromId && item.id !== toId).map(key));
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
    if (isWater(state, point)) continue;
    if (state.buildings.some(item => distance(item, point) < 2.1)) continue;
    if (state.roads.some(road => same(road.a, point) || same(road.b, point))) continue;
    // New pairs start on the same bank; bridges remain a routing choice.
    if (type === 'destination' && home && (home.y < 8) !== (point.y < 8)) continue;
    return point;
  }
  return null;
}

function expand(state) {
  if (state.buildings.length >= 18) return;
  const colors = [...new Set(state.buildings.map(item => item.color))];
  const color = colors.length < 3 && state.elapsed >= 65 ? 'gold' : COLORS[Math.floor(random(state) * colors.length)];
  const needsPair = !state.buildings.some(item => item.color === color);
  const point = vacantCell(state, color, 'home');
  if (!point) return;
  const home = building(`b${state.nextBuildingId++}`, 'home', color, point.x, point.y);
  state.buildings.push(home);
  if (needsPair) {
    const target = vacantCell(state, color, 'destination');
    if (target) state.buildings.push(building(`b${state.nextBuildingId++}`, 'destination', color, target.x, target.y));
    else { state.buildings.pop(); return; }
  }
  state.message = needsPair ? '新商圈開幕，連接黃色住宅與目的地' : '新住宅加入了，替它接上道路吧';
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
  state.roadTiles += kind === 'roads' ? 25 : 15;
  if (kind === 'bridge') state.bridges += 2;
  state.week++; state.status = 'playing'; state.message = kind === 'roads' ? '收到 25 段道路，繼續建造吧' : '收到 15 段道路與 2 段橋梁';
  return { ok: true };
}

export function serializeGame(state) { return JSON.stringify(state); }

/** Reject incompatible/corrupt saves instead of allowing malformed simulation data. */
export function restoreGame(json) {
  try {
    const state = typeof json === 'string' ? JSON.parse(json) : JSON.parse(JSON.stringify(json));
    if (!state || ![1, 2].includes(state.version) || state.cols !== 13 || state.rows !== 17 || !['playing', 'upgrade', 'gameover'].includes(state.status)) return null;
    if (!Array.isArray(state.buildings) || !Array.isArray(state.roads) || !Array.isArray(state.cars) || !Array.isArray(state.water)) return null;
    if (state.buildings.length < 6 || state.buildings.length > 18 || state.roads.length > 1000 || state.cars.length > 30 || state.water.length > 221) return null;
    for (const field of ['seed', 'rng', 'score', 'elapsed', 'week', 'roadTiles', 'bridges', 'nextCarId', 'nextBuildingId', 'nextExpansion', 'dispatchClock']) if (!Number.isFinite(state[field]) || state[field] < 0) return null;
    if (!Number.isInteger(state.week) || state.week < 1 || !Number.isInteger(state.roadTiles) || !Number.isInteger(state.bridges)) return null;
    if (!state.buildings.every(item => inside(state, item) && typeof item.id === 'string' && ['home', 'destination'].includes(item.type) && COLORS.includes(item.color) && ['demand', 'stress', 'capacity', 'demandClock', 'cooldown'].every(field => Number.isFinite(item[field]) && item[field] >= 0) && item.capacity > 0 && item.stress <= 1)) return null;
    if (new Set(state.buildings.map(item => item.id)).size !== state.buildings.length) return null;
    if (!state.water.every(point => inside(state, point))) return null;
    if (!state.roads.every(road => inside(state, road.a) && inside(state, road.b) && distance(road.a, road.b) > 0 && distance(road.a, road.b) <= Math.SQRT2 && typeof road.bridge === 'boolean' && (road.pendingRemoval === undefined || typeof road.pendingRemoval === 'boolean'))) return null;
    const roadKeys = new Set(state.roads.map(road => segmentKey(road.a, road.b)));
    if (!state.cars.every(car => typeof car.id === 'string' && COLORS.includes(car.color) && ['x', 'y', 'angle', 'progress', 'stopTime'].every(field => Number.isFinite(car[field])) && car.progress >= 0 && car.progress < 1 && car.x >= 0 && car.x < state.cols && car.y >= 0 && car.y < state.rows && typeof car.returning === 'boolean' && Array.isArray(car.route) && car.route.length > 1 && car.route.length <= 221 && car.route.every((point, i) => inside(state, point) && (i === 0 || roadKeys.has(segmentKey(car.route[i - 1], point)))) && Number.isInteger(car.segment) && car.segment >= 0 && car.segment < car.route.length - 1 && state.buildings.some(item => item.id === car.homeId && item.type === 'home' && item.color === car.color) && state.buildings.some(item => item.id === car.destinationId && item.type === 'destination' && item.color === car.color))) return null;
    if (!Array.isArray(state.upgradeChoices) || state.upgradeChoices.length !== 2 || !state.upgradeChoices.includes('roads') || !state.upgradeChoices.includes('bridge')) return null;
    if (state.cars.some(car => car.junction != null && !inside(state, car.junction))) return null;
    if (state.version === 1) {
      // Previous saves paid per water cell; return the difference for span pricing.
      const waterCells = new Set(state.roads.flatMap(road => [road.a, road.b]).filter(point => isWater(state, point)).map(key)).size;
      state.bridges += waterCells - bridgeSpans(state);
      state.version = 2;
      state.buildings.forEach(item => { item.capacity = 6; });
      state.roads.forEach(road => { road.pendingRemoval = false; });
      // Keep existing routes safe while retiring any legacy extra driveways/branches.
      for (const home of state.buildings.filter(item => item.type === 'home')) {
        state.roads.filter(road => incident(road, home)).slice(1).forEach(road => { road.pendingRemoval = true; });
      }
      for (const point of state.water) state.roads.filter(road => !road.pendingRemoval && incident(road, point)).slice(2).forEach(road => { road.pendingRemoval = true; });
      finishRoadRemovals(state);
    }
    if (state.buildings.some(home => home.type === 'home' && state.cars.filter(car => car.homeId === home.id).length > 2)) return null;
    if (state.buildings.some(home => home.type === 'home' && state.roads.filter(road => !road.pendingRemoval && incident(road, home)).length > 1)) return null;
    if (state.water.some(point => state.roads.filter(road => !road.pendingRemoval && incident(road, point)).length > 2)) return null;
    if (bridgeReserve(state) > state.bridges) return null;
    return state;
  } catch { return null; }
}
