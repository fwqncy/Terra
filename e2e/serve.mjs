// Serves the production web build with SPA fallback and proxies /api to the .NET API.
// usage: node serve.mjs <dist-dir> <port> [api-origin]
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

const root = path.resolve(process.argv[2] ?? '../web/dist/web/browser');
const port = Number(process.argv[3] ?? 4310);
const api = process.argv[4] ?? process.env.API_ORIGIN ?? 'http://localhost:5080';
const types = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };

if (!fs.existsSync(path.join(root, 'index.html'))) {
  console.error(`No build at ${root}. Run: (cd ../web && npm run build)`);
  process.exit(1);
}

http
  .createServer((req, res) => {
    const url = decodeURIComponent((req.url ?? '/').split('?')[0]);
    if (url.startsWith('/api/')) {
      const upstream = http.request(api + req.url, { method: req.method, headers: req.headers }, (r) => {
        res.writeHead(r.statusCode ?? 502, r.headers);
        r.pipe(res);
      });
      upstream.on('error', () => {
        res.statusCode = 503;
        res.end();
      });
      req.pipe(upstream);
      return;
    }
    let file = path.join(root, url);
    if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(root, 'index.html');
    res.setHeader('content-type', types[path.extname(file)] ?? 'application/octet-stream');
    fs.createReadStream(file)
      .on('error', () => {
        res.statusCode = 404;
        res.end();
      })
      .pipe(res);
  })
  .listen(port, () => console.log(`web on http://localhost:${port} (api → ${api})`));
