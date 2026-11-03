import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const OUT = '/workspace/omni-installer';
const BASE = 'http://127.0.0.1:8784/?mode=plain&demo=1';
fs.mkdirSync(OUT, { recursive: true });

async function main() {
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-gpu', '--use-gl=swiftshader', '--force-device-scale-factor=1'],
  });
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 }, deviceScaleFactor: 2 });
  await page.goto(BASE, { waitUntil: 'networkidle', timeout: 120000 });
  await page.waitForFunction(() => window.__omniAssistant, null, { timeout: 60000 });
  await page.waitForTimeout(800);

  await page.evaluate(() => {
    document.getElementById('overlay')?.classList.add('hidden');
    const a = document.getElementById('assistant-root');
    if (a) {
      a.classList.remove('assistant-hidden', 'assistant-tucked', 'prompt-open');
      a.dataset.freezeFace = '1';
      a.style.cssText = 'display:flex;flex-direction:column;position:fixed;left:40px;top:40px;width:280px;height:auto;max-height:none;z-index:2000;opacity:1;transform:none;overflow:hidden;';
    }
    // hide prompt chrome if present
    const prompt = document.getElementById('asst-prompt');
    if (prompt) prompt.style.display = 'none';
    const wrap = document.getElementById('asst-face-wrap');
    if (wrap) wrap.style.transform = 'none';
  });

  async function configure(avatar) {
    await page.evaluate((av) => {
      const a = window.__omniAssistant;
      a.cfg.avatar = av;
      a.cfg.faceMode = 'digital';
      a.cfg.effectIntensity = 0.95;
      a.cfg.pixelSize = 2;
      a.cfg.speak = false;
      localStorage.setItem('omni.presence', JSON.stringify(a.cfg));
      if (typeof a.applyConfig === 'function') a.applyConfig();
      else {
        a.digitalFace?.setAvatar(av);
        a.digitalFace?.setOpts({ intensity: 0.95, pixelSize: 2, eyeColorOverride: a.cfg.eyeColor });
      }
      a.digitalFace.boot = 1;
      a.setMood('neutral', true);
      a.digitalFace.setMood('neutral');
      a.digitalFace.setState('idle');
      a.talking = false;
      const st = document.getElementById('asst-status');
      if (st) st.textContent = `Ready · neutral`;
      // ensure portrait points at v124
      const img = document.getElementById('asst-face-a');
      if (img && !/v124/.test(img.src)) {
        img.src = `/omni-presence/digital/v124/${av}.jpg?v=1.2.4`;
      }
    }, avatar);
    await page.waitForFunction((av) => {
      const img = document.getElementById('asst-face-a');
      return img && img.complete && img.naturalWidth > 0 && img.src.includes('v124') && img.src.includes(av);
    }, avatar, { timeout: 15000 });
    await page.waitForTimeout(400);
  }

  async function setSpeak(on) {
    await page.evaluate((on) => {
      const a = window.__omniAssistant;
      a.digitalFace.boot = 1;
      if (a._speakPump) { clearInterval(a._speakPump); a._speakPump = 0; }
      if (on) {
        a.talking = true;
        a.digitalFace.setState('talking');
        a.digitalFace.nudgeSynth(0.9);
        a._speakPump = setInterval(() => a.digitalFace.nudgeSynth(0.65 + Math.random() * 0.35), 40);
        const st = document.getElementById('asst-status');
        if (st) st.textContent = 'Speaking…';
      } else {
        a.talking = false;
        a.digitalFace.setState('idle');
        a.digitalFace.nudgeSynth(0);
        const st = document.getElementById('asst-status');
        if (st) st.textContent = 'Ready · neutral';
      }
    }, on);
    await page.waitForTimeout(on ? 500 : 250);
  }

  async function shot(name) {
    const root = page.locator('#assistant-root');
    const wrap = page.locator('#asst-face-wrap');
    const rootBox = await root.boundingBox();
    const wrapBox = await wrap.boundingBox();
    console.log(name, JSON.stringify({ root: rootBox, wrap: wrapBox }));
    await wrap.screenshot({ path: path.join(OUT, name), type: 'png' });
    await root.screenshot({ path: path.join(OUT, name.replace('.png', '-window.png')), type: 'png' });
  }

  const sizes = [220, 280, 340, 420];
  for (const w of sizes) {
    await page.evaluate((w) => {
      const a = document.getElementById('assistant-root');
      a.style.width = w + 'px';
      a.style.maxHeight = 'none';
      a.style.height = 'auto';
    }, w);
    await configure('female');
    const info = await page.evaluate(() => {
      const root = document.getElementById('assistant-root').getBoundingClientRect();
      const wrap = document.getElementById('asst-face-wrap').getBoundingClientRect();
      const img = document.getElementById('asst-face-a');
      return {
        rootW: Math.round(root.width), rootH: Math.round(root.height),
        wrapW: Math.round(wrap.width), wrapH: Math.round(wrap.height),
        wrapInRoot: wrap.left >= root.left - 1 && wrap.right <= root.right + 1 && wrap.top >= root.top - 1 && wrap.bottom <= root.bottom + 1,
        clippedRight: wrap.right > root.right + 1,
        objectFit: getComputedStyle(img).objectFit,
        objectPosition: getComputedStyle(img).objectPosition,
      };
    });
    console.log('size', w, info);
    await page.locator('#asst-face-wrap').screenshot({ path: path.join(OUT, `v124-size-${w}.png`), type: 'png' });
  }

  // Canonical app-scale at 280
  await page.evaluate(() => {
    const a = document.getElementById('assistant-root');
    a.style.width = '280px';
  });

  for (const avatar of ['female', 'male']) {
    await configure(avatar);
    await setSpeak(false);
    await shot(`v124-${avatar}-idle.png`);
    await setSpeak(true);
    await shot(`v124-${avatar}-speak.png`);
    await setSpeak(false);
  }

  await browser.close();
  console.log('DONE');
}

main().catch((e) => { console.error(e); process.exit(1); });
