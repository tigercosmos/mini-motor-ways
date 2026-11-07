import { cp, mkdir, rm } from 'node:fs/promises';
await rm('dist', { recursive: true, force: true });
await mkdir('dist', { recursive: true });
for (const path of ['index.html', 'src', 'icon.svg', 'manifest.webmanifest', 'sw.js']) {
  await cp(path, `dist/${path}`, { recursive: true });
}
console.log('Built Little Roads → dist/');
