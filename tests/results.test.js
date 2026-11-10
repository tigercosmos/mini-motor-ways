import test from 'node:test';
import assert from 'node:assert/strict';
import { readResults, recordResult } from '../src/results.js';
import { createGame, serializeGame, restoreGame } from '../src/engine.js';

test('results survive reload, retain newest 20, and do not duplicate the same game', () => {
  let items = [];
  for (let i = 0; i < 25; i++) items = recordResult(items, { runId: `run-${i}`, score: i, elapsed: 40, week: 1 }, 'gameover', 1000 + i);
  items = readResults(JSON.stringify(items));
  assert.equal(items.length, 20);
  assert.equal(items[0].score, 24);
  assert.equal(items.at(-1).score, 5);
  assert.equal(recordResult(items, { runId: 'run-24' }, 'restart'), items);
});

test('unfinished restart is recorded but an unplayed game is not', () => {
  const game = createGame(7); game.runId = 'persisted-id';
  assert.equal(restoreGame(serializeGame(game)).runId, game.runId);
  assert.deepEqual(recordResult([], game, 'restart'), []);
  game.elapsed = 10;
  const items = recordResult([], game, 'restart');
  assert.equal(items[0].reason, 'restart');
  assert.equal(items[0].elapsed, 10);
});

test('invalid history storage falls back safely', () => {
  for (const raw of [null, '{', '{}', '[null]', '[{"score":"<script>"}]']) assert.deepEqual(readResults(raw), []);
});
