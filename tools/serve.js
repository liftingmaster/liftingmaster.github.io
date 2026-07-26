/** 依存ゼロの開発用サーバー。実行: node tools/serve.js */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const PORT = 8123;
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

http.createServer((req, res) => {
  const urlPath = decodeURIComponent(req.url.split('?')[0]);
  const rel = urlPath === '/' ? '/index.html' : urlPath;
  const file = path.join(process.cwd(), rel);

  // ディレクトリ外への参照を防ぐ
  if (!file.startsWith(process.cwd())) {
    res.writeHead(403);
    res.end('forbidden');
    return;
  }

  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('not found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    res.end(data);
  });
}).listen(PORT, () => {
  console.log(`http://localhost:${PORT}/`);
});
