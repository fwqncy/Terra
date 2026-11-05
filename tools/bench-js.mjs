// Times the app's Bootcamp episode code in Node or in headless Chromium (Playwright from e2e/).
// usage: node tools/bench-js.mjs --world trainer/worlds/brisbane.json --brains brains.json [--browser]
// Prints {"runtime", "seconds", "scores"} as JSON. Brains are JS brain objects (the Python bench writes them).
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const worldPath = path.resolve(arg('world') ?? 'trainer/worlds/brisbane.json');
const brainsPath = path.resolve(arg('brains') ?? '');
const world = JSON.parse(fs.readFileSync(worldPath, 'utf8'));
const brains = JSON.parse(fs.readFileSync(brainsPath, 'utf8'));

if (!process.argv.includes('--browser')) {
  const { bench } = await import('./bench/bench-core.mjs');
  bench(world, brains.slice(0, 2)); // warm the JIT
  const r = bench(world, brains);
  console.log(JSON.stringify({ runtime: `node ${process.version}`, ...r }));
} else {
  // Serve the repo read-only on localhost so the page can import the engine's ES modules.
  const types = { '.mjs': 'text/javascript', '.js': 'text/javascript', '.json': 'application/json', '.html': 'text/html' };
  const server = http.createServer((req, res) => {
    const url = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (url === '/') {
      res.writeHead(200, { 'content-type': 'text/html' }).end('<!doctype html><title>bench</title>');
      return;
    }
    const file = path.join(root, url);
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { 'content-type': types[path.extname(file)] ?? 'application/octet-stream' }).end(fs.readFileSync(file));
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  const { chromium } = await import(path.join(root, 'e2e/node_modules/playwright/index.mjs'));
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    const r = await page.evaluate(
      async ({ world, brains }) => {
        const { bench } = await import('/tools/bench/bench-core.mjs');
        bench(world, brains.slice(0, 2));
        return { runtime: navigator.userAgent.match(/(Headless)?Chrome\/[\d.]+/)?.[0] ?? 'chromium', ...bench(world, brains) };
      },
      { world, brains },
    );
    console.log(JSON.stringify(r));
  } finally {
    await browser.close();
    server.close();
  }
}
