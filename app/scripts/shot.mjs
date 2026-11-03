import { chromium } from 'playwright';
import { createServer } from 'http';
import { readFileSync, existsSync, mkdirSync } from 'fs';
import { extname, join } from 'path';
import { fileURLToPath } from 'url';

const root = fileURLToPath(new URL('..', import.meta.url));
const dist = join(root, 'ui', 'dist');
const shots = join(root, 'shots');
mkdirSync(shots, { recursive: true });
const mime = { '.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2','.ttf':'font/ttf' };
const server = createServer((req, res) => {
  let p = req.url.split('?')[0];
  if (p === '/') p = '/index.html';
  const file = join(dist, decodeURIComponent(p));
  if (!file.startsWith(dist) || !existsSync(file)) { res.writeHead(404); res.end('no'); return; }
  res.writeHead(200, { 'Content-Type': mime[extname(file)] || 'application/octet-stream' });
  res.end(readFileSync(file));
});
await new Promise(r => server.listen(8799, '127.0.0.1', r));
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-gpu', '--use-gl=swiftshader', '--force-device-scale-factor=1'] });

async function shot(mode) {
  const page = await browser.newPage({ viewport: { width: 1168, height: 784 }, deviceScaleFactor: 1 });
  await page.goto(`http://127.0.0.1:8799/?mode=${mode}&demo=1`, { waitUntil: 'networkidle', timeout: 120000 });
  await page.waitForTimeout(1500);
  await page.evaluate(async () => {
    document.getElementById('assistant-root')?.classList.add('assistant-hidden');
    document.getElementById('overlay')?.classList.add('hidden');
    await Promise.all([...document.images].map(img => img.complete ? null : new Promise(r => { img.onload=r; img.onerror=r; })));
  });
  await page.waitForTimeout(500);
  await page.screenshot({ path: join(shots, `omni-${mode}.png`), type: 'png', clip: { x:0,y:0,width:1168,height:784 } });
  console.log('wrote', mode);
  await page.evaluate(() => document.getElementById('assistant-root')?.classList.remove('assistant-hidden'));
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(shots, `omni-${mode}-with-assistant.png`), type: 'png', clip: { x:0,y:0,width:1168,height:784 } });
  await page.close();
}
await shot('plain');
await shot('ultra');
await browser.close();
server.close();
