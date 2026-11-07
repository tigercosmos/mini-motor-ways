import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import vm from 'node:vm';

test('HTML assets and home link stay within the GitHub Pages project path', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const base = new URL('https://tigercosmos.github.io/mini-motor-ways/');
  const links = [...html.matchAll(/(?:href|src)="([^"]+)"/g)].map(match => match[1]).filter(path => !path.startsWith('#'));
  assert.ok(links.includes('./src/app.js'));
  for (const path of links) {
    const url = new URL(path, base);
    assert.equal(url.origin, base.origin);
    assert.ok(url.pathname.startsWith(base.pathname), `${path} escapes the project path`);
    await access(new URL(`../${url.pathname.slice(base.pathname.length) || 'index.html'}`, import.meta.url));
  }
});

test('service worker leaves other GitHub Pages projects and caches alone', async () => {
  const source = await readFile(new URL('../sw.js', import.meta.url), 'utf8');
  const handlers = new Map();
  const deleted = [];
  const scope = 'https://tigercosmos.github.io/mini-motor-ways/';
  vm.runInNewContext(source, {
    URL,
    self: { registration: { scope }, clients: { claim: async () => {} }, addEventListener: (name, handler) => handlers.set(name, handler) },
    caches: { keys: async () => ['little-roads-/mini-motor-ways-v2', 'little-roads-/mini-motor-ways/-v2', 'little-roads-/another-game/-v2'], delete: async key => deleted.push(key) },
  });
  let activated;
  handlers.get('activate')({ waitUntil: promise => { activated = promise; } });
  await activated;
  assert.deepEqual(deleted, ['little-roads-/mini-motor-ways/-v2']);
  for (const url of ['https://tigercosmos.github.io/another-game/', 'https://example.com/mini-motor-ways/']) {
    handlers.get('fetch')({ request: { method: 'GET', url }, respondWith() { assert.fail('must not intercept another project'); } });
  }
});
