// Capture chaque vue de l'app Flutter Web (mode démo) en viewport mobile.
// Usage: node tool/shoot.js [outDir]
const http = require('http');
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');

const WEB_DIR = path.resolve(__dirname, '../build/web');
const OUT = path.resolve(process.argv[2] || path.join(__dirname, '../../shots'));
const CHROME = '/tmp/chrome-headless-shell-linux64/chrome-headless-shell';
const PORT = 8077;

const MIME = {
  '.html': 'text/html', '.js': 'application/javascript', '.json': 'application/json',
  '.css': 'text/css', '.wasm': 'application/wasm', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.ttf': 'font/ttf', '.otf': 'font/otf', '.ico': 'image/x-icon',
  '.bin': 'application/octet-stream', '.symbols': 'application/octet-stream',
};

const routes = [
  ['landing', '/'],
  ['login', '/login'],
  ['register', '/register'],
  ['dashboard', '/dashboard'],
  ['content', '/content'],
  ['calendar', '/calendar'],
  ['assistant', '/assistant'],
  ['performance', '/performance'],
  ['knowledge', '/knowledge'],
  ['approvals', '/approvals'],
  ['config', '/config'],
  ['plan', '/plan'],
];

function serve() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let urlPath = decodeURIComponent(req.url.split('?')[0]);
      let file = path.join(WEB_DIR, urlPath);
      if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        file = path.join(WEB_DIR, 'index.html'); // SPA fallback
      }
      fs.readFile(file, (err, data) => {
        if (err) { res.writeHead(404); res.end('404'); return; }
        res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
        res.end(data);
      });
    });
    server.listen(PORT, () => resolve(server));
  });
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const server = await serve();
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--force-color-profile=srgb'],
  });
  const page = await browser.newPage();
  await page.setCacheEnabled(false);
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
  page.on('pageerror', (e) => console.log('  [pageerror]', e && e.message ? e.message : e));

  // Premier chargement : laisser Flutter + polices Google s'initialiser.
  await page.goto(`http://localhost:${PORT}/#/dashboard`, { waitUntil: 'networkidle2', timeout: 60000 });
  await new Promise((r) => setTimeout(r, 6000));

  for (const [name, route] of routes) {
    try {
      await page.goto(`http://localhost:${PORT}/#${route}`, { waitUntil: 'networkidle2', timeout: 30000 });
      await new Promise((r) => setTimeout(r, 2500));
      const out = path.join(OUT, `${String(routes.findIndex(r => r[0] === name)).padStart(2, '0')}-${name}.png`);
      await page.screenshot({ path: out });
      console.log('✓', name, '→', out);
    } catch (e) {
      console.log('✗', name, e.message);
    }
  }

  await browser.close();
  server.close();
  console.log('\nDone. Screenshots in', OUT);
})().catch((e) => { console.error(e); process.exit(1); });
