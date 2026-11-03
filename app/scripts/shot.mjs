import { chromium } from 'playwright';
import { spawn } from 'child_process';
import { mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const root = fileURLToPath(new URL('..', import.meta.url));
const shots = join(root, 'shots');
mkdirSync(shots, { recursive: true });
const coreBin = join(root, 'dist', 'omni-core');
const uiDir = join(root, 'ui', 'dist');
const fixtures = join(root, 'fixtures');

function sleep(ms){ return new Promise(r=>setTimeout(r,ms)); }

async function waitHealth(port, tries=80) {
  for (let i=0;i<tries;i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (r.ok) return true;
    } catch {}
    await sleep(100);
  }
  return false;
}

async function shot(mode, port) {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox','--disable-gpu','--force-device-scale-factor=1'] });
  const page = await browser.newPage({ viewport: { width: 1168, height: 784 }, deviceScaleFactor: 1 });
  await page.goto(`http://127.0.0.1:${port}/?mode=${mode}&demo=1`, { waitUntil: 'networkidle', timeout: 120000 });
  await page.waitForTimeout(3500);

  await page.evaluate(() => {
    document.getElementById('assistant-root')?.classList.add('assistant-hidden');
    document.getElementById('overlay')?.classList.add('hidden');
    document.documentElement.style.cssText = 'margin:0;padding:0;overflow:hidden;width:1168px;height:784px';
    document.body.style.cssText += ';margin:0;padding:0;overflow:hidden;width:1168px;height:784px;position:fixed;inset:0';
    const app=document.getElementById('app');
    if (app) app.style.cssText += ';margin:0;padding:0;width:1168px;height:784px;position:fixed;inset:0;border:none;box-shadow:none';
    const mode = new URLSearchParams(location.search).get('mode') || 'plain';
    const side = document.getElementById('sidebar');
    const chat = document.getElementById('chat');
    if (side) side.style.width = mode === 'ultra' ? '197px' : '207px';
    if (chat) { chat.style.width = mode === 'ultra' ? '341px' : '348px'; chat.style.minWidth = '0'; }
    document.querySelectorAll('.resizer-v').forEach(el => { el.style.width = '0px'; el.style.minWidth = '0'; });
    document.documentElement.style.setProperty('--activity-w', mode === 'ultra' ? '50px' : '48px');
    const msgs=document.getElementById('chat-msgs');
    if (msgs) msgs.scrollTop = 0;
  });
  await page.waitForTimeout(800);
  const path = join(shots, `omni-${mode}.png`);
  await page.screenshot({ path, type: 'png', clip: { x:0,y:0,width:1168,height:784 } });
  console.log('wrote', path);
  await page.evaluate(() => document.getElementById('assistant-root')?.classList.remove('assistant-hidden'));
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(shots, `omni-${mode}-with-assistant.png`), type:'png', clip:{x:0,y:0,width:1168,height:784} });
  await browser.close();
}

const port = 8755;
const child = spawn(coreBin, [
  '--mode','plain','--port', String(port),
  '--ui-dir', uiDir,
  '--fixtures-dir', fixtures,
  '--data-dir', join(root, '.omni-data-shot'),
], { stdio: ['ignore','pipe','pipe'] });
child.stdout.on('data', d => process.stdout.write(`[core] ${d}`));
child.stderr.on('data', d => process.stderr.write(`[core] ${d}`));

const ok = await waitHealth(port);
if (!ok) {
  console.error('core failed to start');
  child.kill();
  process.exit(1);
}
await shot('plain', port);
await shot('ultra', port);
child.kill();
console.log('done');
