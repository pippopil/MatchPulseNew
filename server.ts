import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { exec } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseLiveAndUpcomingFootballMatches } from './src/server/realFootballParser';
import { DataSourceType } from './src/types/football';
import { EMBEDDED_FILES, EmbeddedAsset } from './src/server/embeddedAssets';

function resolveCurrentDir(): string {
  try {
    if (typeof __dirname === 'string' && __dirname.length > 0) {
      return __dirname;
    }
  } catch {}
  try {
    if (typeof import.meta !== 'undefined' && import.meta.url) {
      return path.dirname(fileURLToPath(import.meta.url));
    }
  } catch {}
  return process.cwd();
}

const CURRENT_DIR = resolveCurrentDir();

// Проверяем несколько возможных путей к папке dist
const CANDIDATE_DIST_DIRS = [
  path.join(CURRENT_DIR, 'dist'),
  path.join(process.cwd(), 'dist'),
  path.resolve('dist'),
  path.join(CURRENT_DIR, '..', 'dist')
];

function getExistingDistDir(): string | null {
  for (const dir of CANDIDATE_DIST_DIRS) {
    try {
      if (fs.existsSync(dir) && fs.existsSync(path.join(dir, 'index.html'))) {
        return dir;
      }
    } catch {}
  }
  return null;
}

const BASE_PORT = parseInt(process.env.PORT || '3000', 10);
const MAX_PORT = BASE_PORT + 20;
let activePort = BASE_PORT;

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf'
};

const decodedAssetCache = new Map<string, Buffer>();

function decodeEmbeddedAsset(key: string, asset: EmbeddedAsset): Buffer {
  const cached = decodedAssetCache.get(key);
  if (cached) return cached;

  let buf: Buffer;
  if (asset.encoding === 'gzip-base64') {
    buf = zlib.gunzipSync(Buffer.from(asset.content, 'base64'));
  } else {
    buf = Buffer.from(asset.content, asset.encoding as BufferEncoding);
  }
  decodedAssetCache.set(key, buf);
  return buf;
}

function serveFile(res: http.ServerResponse, reqPath: string, defaultContentType = 'application/octet-stream') {
  const normalizedKey = reqPath.replace(/^[/\\]+/, '').replace(/\\/g, '/');
  const assetKey = normalizedKey || 'index.html';

  // 1. В автономном режиме сначала отдаём встроенный бандл (гарантия актуальной версии)
  const embedded = EMBEDDED_FILES[assetKey];
  if (embedded) {
    const buf = decodeEmbeddedAsset(assetKey, embedded);
    res.writeHead(200, {
      'Content-Type': embedded.contentType,
      'Content-Length': buf.length,
      'Cache-Control': assetKey.endsWith('.html') ? 'no-cache' : 'public, max-age=31536000, immutable'
    });
    res.end(buf);
    return;
  }

  // 2. Попытка отдать файл с диска (если есть папка dist рядом)
  const distDir = getExistingDistDir();
  if (distDir) {
    const diskPath = path.join(distDir, assetKey);
    if (fs.existsSync(diskPath) && fs.statSync(diskPath).isFile()) {
      const ext = path.extname(diskPath).toLowerCase();
      const contentType = MIME_TYPES[ext] || defaultContentType;
      res.writeHead(200, {
        'Content-Type': contentType,
        'Content-Length': fs.statSync(diskPath).size,
        'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable'
      });
      fs.createReadStream(diskPath).pipe(res);
      return;
    }
  }

  // 3. SPA Fallback: отдаем index.html (встроенный либо с диска)
  const embeddedIndex = EMBEDDED_FILES['index.html'];
  if (embeddedIndex) {
    const buf = decodeEmbeddedAsset('index.html', embeddedIndex);
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Length': buf.length,
      'Cache-Control': 'no-cache'
    });
    res.end(buf);
    return;
  }

  if (distDir) {
    const indexPath = path.join(distDir, 'index.html');
    if (fs.existsSync(indexPath)) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      fs.createReadStream(indexPath).pipe(res);
      return;
    }
  }

  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('MatchPulse: Файл не найден.');
}

function openBrowserUrl(url: string) {
  if (process.env.MATCHPULSE_OPEN_BROWSER !== '1') return;

  if (process.platform === 'win32') {
    exec(`cmd /c start "" "${url}"`, () => {});
  } else if (process.platform === 'darwin') {
    exec(`open "${url}"`, () => {});
  } else {
    exec(`xdg-open "${url}"`, () => {});
  }
}

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const reqUrl = new URL(req.url || '/', `http://${req.headers.host || `localhost:${activePort}`}`);

  // 1. API endpoint: /api/matches
  if (reqUrl.pathname === '/api/matches') {
    try {
      const source = (reqUrl.searchParams.get('source') as DataSourceType) || 'all';
      const matches = await parseLiveAndUpcomingFootballMatches(source);
      const jsonStr = JSON.stringify(matches);

      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-cache, no-store, must-revalidate'
      });
      res.end(jsonStr);
    } catch (err: any) {
      console.error('[API Error]', err);
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: err?.message || 'Parser failure' }));
    }
    return;
  }

  // 2. API endpoint: /api/telegram/send
  if (reqUrl.pathname === '/api/telegram/send' && req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', async () => {
      try {
        const { token, chatId, text } = JSON.parse(body || '{}');
        if (!token || !chatId || !text) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, description: 'Missing token, chatId, or text' }));
          return;
        }

        const telegramRes = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text,
            parse_mode: 'HTML',
            disable_web_page_preview: true
          }),
          signal: AbortSignal.timeout(8000)
        });

        const telegramData = await telegramRes.json();
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(telegramData));
      } catch (err: any) {
        console.error('[Telegram API Proxy Error]', err);
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: false, description: err?.message || 'Telegram proxy error' }));
      }
    });
    return;
  }

  // 3. Healthcheck / Ping
  if (reqUrl.pathname === '/api/ping') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('pong');
    return;
  }

  // 3b. Скачивание автономного одного файла MatchPulse.bat
  if (reqUrl.pathname === '/api/download-launcher') {
    const candidates = [
      process.env.MP_SELF,
      path.join(CURRENT_DIR, 'MatchPulse.bat'),
      path.join(process.cwd(), 'MatchPulse.bat')
    ].filter((p): p is string => Boolean(p));

    const found = candidates.find((p) => {
      try {
        return fs.existsSync(p) && fs.statSync(p).isFile();
      } catch {
        return false;
      }
    });

    if (found) {
      const fileBuf = fs.readFileSync(found);
      res.writeHead(200, {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': 'attachment; filename="MatchPulse.bat"',
        'Content-Length': fileBuf.length
      });
      res.end(fileBuf);
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('MatchPulse.bat не найден.');
    return;
  }

  // 4. Статические файлы (встроенные или с диска dist)
  serveFile(res, reqUrl.pathname);
});

server.on('error', (err: any) => {
  if (err.code === 'EADDRINUSE' && activePort < MAX_PORT) {
    const busyPort = activePort;
    activePort += 1;
    console.warn(`[Внимание] Порт ${busyPort} занят. Пробуем порт ${activePort}...`);
    server.listen(activePort, '0.0.0.0');
  } else {
    console.error('Ошибка запуска сервера:', err);
  }
});

server.on('listening', () => {
  const url = `http://localhost:${activePort}`;
  console.log(`\n======================================================`);
  console.log(`   MatchPulse успешно запущен!`);
  console.log(`   Адрес в браузере: ${url}`);
  console.log(`   Для выхода просто закройте это окно.`);
  console.log(`======================================================\n`);
  openBrowserUrl(url);
});

server.listen(activePort, '0.0.0.0');

export default server;
