// Capture les pages publiques (non authentifiées) depuis un build SANS DEMO.
const http = require('http');
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');

const WEB_DIR = path.resolve(__dirname, '../build/web');
const OUT = path.resolve(process.argv[2] || path.join(__dirname, '../../shots'));
const CHROME = '/tmp/chrome-headless-shell-linux64/chrome-headless-shell';
const PORT = 8078;
const MIME = { '.html':'text/html','.js':'application/javascript','.json':'application/json','.css':'text/css','.wasm':'application/wasm','.png':'image/png','.ttf':'font/ttf','.otf':'font/otf','.ico':'image/x-icon','.bin':'application/octet-stream','.symbols':'application/octet-stream' };
const routes = [['00-landing','/'],['01-login','/login'],['02-register','/register']];

function serve() {
  return new Promise((resolve) => {
    const s = http.createServer((req, res) => {
      let f = path.join(WEB_DIR, decodeURIComponent(req.url.split('?')[0]));
      if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(WEB_DIR, 'index.html');
      fs.readFile(f, (e, d) => { if (e){res.writeHead(404);res.end();return;} res.writeHead(200,{'Content-Type':MIME[path.extname(f)]||'application/octet-stream'}); res.end(d); });
    });
    s.listen(PORT, () => resolve(s));
  });
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const server = await serve();
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox','--disable-gpu','--disable-dev-shm-usage','--force-color-profile=srgb'] });
  const page = await browser.newPage();
  await page.setCacheEnabled(false);
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
  await page.goto(`http://localhost:${PORT}/#/`, { waitUntil: 'networkidle2', timeout: 60000 });
  await new Promise((r) => setTimeout(r, 6000));
  for (const [name, route] of routes) {
    await page.goto(`http://localhost:${PORT}/#${route}`, { waitUntil: 'networkidle2', timeout: 30000 });
    await new Promise((r) => setTimeout(r, 2500));
    await page.screenshot({ path: path.join(OUT, `${name}.png`) });
    console.log('✓', name);
  }
  await browser.close();
  server.close();
})().catch((e) => { console.error(e); process.exit(1); });
