export const RESULTS_KEY = 'little-roads-results-v1';
export function readResults(raw) {
  try {
    const items = JSON.parse(raw);
    if (!Array.isArray(items)) return [];
    return items.filter(item => item && typeof item.id === 'string' && Number.isFinite(item.endedAt) && item.endedAt > 0 && item.endedAt < 8.64e15 && Number.isInteger(item.score) && item.score >= 0 && Number.isFinite(item.elapsed) && item.elapsed >= 0 && Number.isInteger(item.week) && item.week >= 1 && ['gameover', 'restart'].includes(item.reason)).slice(0, 20);
  } catch { return []; }
}
export function recordResult(items, state, reason, now = Date.now()) {
  if (!state.runId || items.some(item => item.id === state.runId) || (state.elapsed <= 0 && reason !== 'gameover')) return items;
  return [{ id: state.runId, score: state.score, elapsed: state.elapsed, week: state.week, endedAt: now, reason }, ...items].slice(0, 20);
}
