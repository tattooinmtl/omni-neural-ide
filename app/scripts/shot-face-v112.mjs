import { chromium } from 'playwright';
import { spawn } from 'child_process';
import { mkdirSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';

const root = fileURLToPath(new URL('..', import.meta.url));
const out = '/workspace/omni-installer';
mkdirSync(out, { recursive: true });
const coreBin = join(root, 'dist', 'omni-core');
const uiDir = join(root, 'ui', 'dist');
const fixtures = join(root, 'fixtures');
const port = 8763;

function sleep(ms){ return new Promise(r=>setTimeout(r,ms)); }
async function waitHealth(tries=100) {
  for (let i=0;i<tries;i++) {
    try { const r = await fetch(`http://127.0.0.1:${port}/api/health`); if (r.ok) return true; } catch {}
    await sleep(100);
  }
  return false;
}

async function shotClip(page, path, box, pad=0) {
  await page.screenshot({
    path, type: 'png',
    clip: {
      x: Math.max(0, box.x - pad),
      y: Math.max(0, box.y - pad),
      width: box.width + pad*2,
      height: box.height + pad*2,
    }
  });
}

const child = spawn(coreBin, [
  '--mode','plain','--port', String(port),
  '--ui-dir', uiDir,
  '--fixtures-dir', fixtures,
  '--data-dir', join(root, '.omni-data-face2'),
], { stdio: ['ignore','pipe','pipe'] });
child.stdout.on('data', d => process.stdout.write(`[core] ${d}`));
child.stderr.on('data', d => process.stderr.write(`[core] ${d}`));
if (!(await waitHealth())) { console.error('core fail'); child.kill(); process.exit(1); }

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox','--disable-gpu','--force-device-scale-factor=1'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 });
await page.goto(`http://127.0.0.1:${port}/?mode=plain&demo=1`, { waitUntil: 'networkidle', timeout: 120000 });
await page.waitForTimeout(1500);

await page.evaluate(() => {
  document.getElementById('overlay')?.classList.add('hidden');
  const a = document.getElementById('assistant-root');
  if (a) {
    a.classList.remove('assistant-hidden','assistant-tucked');
    a.dataset.freezeFace = '1';
    a.style.cssText = 'display:block;position:fixed;left:40px;top:40px;width:340px;z-index:2000;opacity:1;transform:none;';
  }
  document.getElementById('asst-face-wrap')?.style && (document.getElementById('asst-face-wrap').style.transform = 'none');
  document.getElementById('asst-mouth')?.remove();
});
await page.waitForSelector('#asst-face-a');
await page.waitForFunction(() => {
  const img = document.getElementById('asst-face-a');
  return img && img.complete && img.naturalWidth > 0;
});
await page.waitForTimeout(600);

async function setIdle() {
  await page.evaluate(() => {
    const talk = document.getElementById('asst-face-talk');
    if (talk) { talk.style.opacity='0'; talk.style.visibility='hidden'; }
    const a = document.getElementById('asst-face-a');
    const b = document.getElementById('asst-face-b');
    a.src='/omni-presence/neutral.jpg';
    a.classList.add('active'); a.style.opacity='1'; a.style.visibility='visible'; a.style.filter='';
    b.classList.remove('active'); b.style.opacity='0'; b.style.visibility='hidden';
    const glow = document.querySelector('.asst-glow');
    if (glow) glow.style.opacity = '0.25';
    const st = document.getElementById('asst-status');
    if (st) st.textContent = 'Ready · neutral';
  });
  await page.waitForTimeout(500);
}

await setIdle();
let faceBox = await page.locator('#asst-face-wrap').boundingBox();
let rootBox = await page.locator('#assistant-root').boundingBox();
await shotClip(page, join(out, 'omni-face-idle.png'), faceBox);
await shotClip(page, join(out, 'omni-presence-idle.png'), rootBox);
await shotClip(page, join(out, 'omni-face-idle-mouth-zoom.png'), {
  x: faceBox.x + faceBox.width * 0.22,
  y: faceBox.y + faceBox.height * 0.48,
  width: faceBox.width * 0.56,
  height: faceBox.height * 0.32,
});
console.log('idle ok');

// mid-talk
await page.evaluate(() => {
  const talk = document.getElementById('asst-face-talk');
  talk.src = '/omni-presence/talking.jpg';
  talk.style.visibility = 'visible';
  talk.style.opacity = '0.70';
  const a = document.getElementById('asst-face-a');
  a.src='/omni-presence/neutral.jpg';
  a.classList.add('active'); a.style.opacity='1'; a.style.visibility='visible';
  const st = document.getElementById('asst-status');
  if (st) st.textContent = 'Speaking…';
});
await page.waitForTimeout(500);
faceBox = await page.locator('#asst-face-wrap').boundingBox();
rootBox = await page.locator('#assistant-root').boundingBox();
await shotClip(page, join(out, 'omni-face-midtalk.png'), faceBox);
await shotClip(page, join(out, 'omni-presence-midtalk.png'), rootBox);
await shotClip(page, join(out, 'omni-face-midtalk-mouth-zoom.png'), {
  x: faceBox.x + faceBox.width * 0.22,
  y: faceBox.y + faceBox.height * 0.48,
  width: faceBox.width * 0.56,
  height: faceBox.height * 0.32,
});
console.log('midtalk ok');

// mood transition mid-crossfade
await page.evaluate(() => {
  const talk = document.getElementById('asst-face-talk');
  talk.style.opacity='0'; talk.style.visibility='hidden';
  const a = document.getElementById('asst-face-a');
  const b = document.getElementById('asst-face-b');
  a.src='/omni-presence/neutral.jpg';
  a.classList.add('active'); a.style.opacity='0.42'; a.style.visibility='visible';
  b.src='/omni-presence/happy.jpg';
  b.classList.add('active'); b.style.opacity='0.58'; b.style.visibility='visible';
  const st = document.getElementById('asst-status');
  if (st) st.textContent = 'Ready · happy';
});
await page.waitForTimeout(450);
faceBox = await page.locator('#asst-face-wrap').boundingBox();
rootBox = await page.locator('#assistant-root').boundingBox();
await shotClip(page, join(out, 'omni-face-mood-transition.png'), faceBox);
await shotClip(page, join(out, 'omni-presence-mood-transition.png'), rootBox);
await shotClip(page, join(out, 'omni-face-mood-transition-mouth-zoom.png'), {
  x: faceBox.x + faceBox.width * 0.22,
  y: faceBox.y + faceBox.height * 0.48,
  width: faceBox.width * 0.56,
  height: faceBox.height * 0.32,
});
console.log('mood ok');

await setIdle();
rootBox = await page.locator('#assistant-root').boundingBox();
await shotClip(page, join(out, 'omni-presence-crop.png'), rootBox);
console.log('crop ok');

await browser.close();
child.kill();
console.log('face shots done');
