import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { createSearchService } from './lib/discovery.mjs';

const root = fileURLToPath(new URL('.', import.meta.url));
const port = Number(process.env.PORT || 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be between 1 and 65535.');
const service = createSearchService();
const assets = new Map([
  ['/', ['public/index.html', 'text/html; charset=utf-8']],
  ['/styles.css', ['public/styles.css', 'text/css; charset=utf-8']],
  ['/app.mjs', ['public/app.mjs', 'text/javascript; charset=utf-8']],
  ['/jobs.mjs', ['lib/jobs.mjs', 'text/javascript; charset=utf-8']],
  ['/boards.mjs', ['lib/boards.mjs', 'text/javascript; charset=utf-8']],
  ['/favicon.svg', ['public/favicon.svg', 'image/svg+xml']],
]);
const server = createServer(async (request, response) => {
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  response.setHeader('Cache-Control', 'no-store');
  // Bind to loopback and reject foreign Host headers to prevent DNS rebinding.
  const allowedHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
  if (!allowedHosts.has(request.headers.host)) { response.writeHead(403); response.end('Local access only.'); return; }
  if (request.method !== 'GET' && request.method !== 'HEAD') { response.writeHead(405, { Allow: 'GET, HEAD' }); response.end(); return; }
  try {
    const requestURL = new URL(request.url, `http://127.0.0.1:${port}`);
    const path = requestURL.pathname;
    if (path === '/api/jobs') {
      if (request.url.length > 3000) { response.writeHead(414); response.end('Search is too long.'); return; }
      const filters = Object.fromEntries(['role', 'roleFocus', 'keywords', 'days', 'dateFrom', 'dateTo', 'depth'].map(key => [key, requestURL.searchParams.get(key) ?? (key === 'days' ? '30' : '')]));
      const streaming = request.headers.accept?.includes('application/x-ndjson');
      if (request.method === 'HEAD') { response.writeHead(200, { 'Content-Type': 'application/json' }); response.end(); return; }
      const controller = new AbortController();
      response.on('close', () => { if (!response.writableEnded) controller.abort(); });
      const emit = event => { if (!response.destroyed) response.write(`${JSON.stringify(event)}\n`); };
      if (streaming) response.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'X-Accel-Buffering': 'no' });
      const data = await service.getJobs(filters, { signal: controller.signal,
        onProgress: streaming ? progress => emit({ type: 'progress', ...progress }) : undefined,
        onBatch: streaming ? jobs => emit({ type: 'batch', jobs }) : undefined });
      if (response.destroyed) return;
      if (streaming) { emit({ type: 'complete', data }); response.end(); }
      else { response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' }); response.end(JSON.stringify(data)); }
      return;
    }
    if (path === '/api/health') { response.writeHead(200, { 'Content-Type': 'application/json' }); response.end(request.method === 'HEAD' ? undefined : '{"status":"ok"}'); return; }
    const asset = assets.get(path);
    if (!asset) { response.writeHead(404); response.end('Not found.'); return; }
    const content = await readFile(resolve(root, asset[0]));
    response.writeHead(200, { 'Content-Type': asset[1] });
    response.end(request.method === 'HEAD' ? undefined : content);
  } catch (error) {
    console.error('Request failed:', error.message);
    if (response.destroyed) return;
    if (response.headersSent) { response.end(`${JSON.stringify({ type: 'error', error: 'Search could not finish. Try again.' })}\n`); return; }
    response.writeHead(500, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ error: 'Unable to load jobs. Check the terminal and try again.' }));
  }
});

server.on('error', (error) => {
  console.error(error.code === 'EADDRINUSE' ? `Port ${port} is in use. Close the other app or set the PORT environment variable.` : error.message);
  process.exitCode = 1;
});
server.listen(port, '127.0.0.1', () => {
  const url = `http://127.0.0.1:${port}`;
  console.log(`\n  JobFinder Extreme\n  ${url}\n\n  Local only. Press Ctrl+C to stop.\n`);
  if (process.argv.includes('--open')) {
    const [command, args] = process.platform === 'win32'
      ? ['powershell.exe', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', `Start-Process '${url}'`]]
      : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
    const child = spawn(command, args, { detached: true, stdio: 'ignore', windowsHide: true });
    child.on('error', () => console.log(`Open ${url} in your browser.`));
    child.unref();
  }
});
