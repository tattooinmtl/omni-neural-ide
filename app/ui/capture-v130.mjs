import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const OUT = '/workspace/omni-installer';
const BASE = process.env.OMNI_BASE || 'http://127.0.0.1:8822';
fs.mkdirSync(OUT, { recursive: true });

async function shot(page, name) {
  const file = path.join(OUT, name);
  await page.screenshot({ path: file, type: 'png', fullPage: false });
  console.log('shot', name);
}

async function prep(page, mode) {
  await page.goto(`${BASE}/?mode=${mode}&demo=1`, { waitUntil: 'load', timeout: 120000 });
  await page.waitForTimeout(1800);
  await page.evaluate(() => {
    document.getElementById('overlay')?.classList.add('hidden');
    document.documentElement.classList.remove('shot');
    document.getElementById('assistant-root')?.classList.remove('assistant-hidden', 'assistant-tucked');
  });
  await page.waitForTimeout(600);
}

async function openAppPanels(page) {
  await page.locator('#menubar button[data-menu="app"]').click({ force: true });
  await page.waitForTimeout(250);
  const panels = page.locator('.menu-item.has-sub', { hasText: 'Panels' });
  if (await panels.count()) {
    await panels.first().hover();
    await page.waitForTimeout(300);
  }
}

async function main() {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-gpu'] });
  const sizes = [
    { w: 1280, h: 800, tag: '1280x800' },
    { w: 1920, h: 1080, tag: '1920x1080' },
    { w: 2560, h: 1440, tag: '2560x1440' },
  ];

  for (const mode of ['plain', 'ultra']) {
    for (const sz of sizes) {
      const page = await browser.newPage({ viewport: { width: sz.w, height: sz.h }, deviceScaleFactor: 1 });
      await prep(page, mode);
      await shot(page, `v130-${mode}-${sz.tag}.png`);
      await page.close();
    }
  }

  {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    await prep(page, 'ultra');
    const tab = page.locator('#tabbar .tab').first();
    if (await tab.count()) {
      const box = await tab.boundingBox();
      await page.mouse.click(box.x + 20, box.y + 10, { button: 'right' });
      await page.waitForTimeout(400);
      await shot(page, 'v130-ultra-context-tab.png');
      await page.keyboard.press('Escape');
      await page.waitForTimeout(200);
    }
    await openAppPanels(page);
    await shot(page, 'v130-ultra-app-panels-menu.png');
    const termItem = page.locator('.menu-dropdown.sub .menu-item', { hasText: 'Terminal' });
    if (await termItem.count()) {
      await termItem.first().click();
      await page.waitForTimeout(600);
      await shot(page, 'v130-ultra-with-terminal.png');
    } else {
      await page.keyboard.press('Escape');
    }
    const tree = page.locator('#file-tree .tree-item').first();
    if (await tree.count()) {
      const box = await tree.boundingBox();
      await page.mouse.click(box.x + 40, box.y + 8, { button: 'right' });
      await page.waitForTimeout(300);
      await shot(page, 'v130-ultra-context-explorer.png');
    }
    await page.close();
  }

  {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    await prep(page, 'plain');
    await page.locator('#menubar button[data-menu="app"]').click({ force: true });
    await page.waitForTimeout(250);
    const panels = page.locator('.menu-item.has-sub', { hasText: 'Panels' });
    if (await panels.count()) await panels.first().hover();
    await page.waitForTimeout(300);
    await shot(page, 'v130-plain-app-menu.png');
    await page.close();
  }

  // Maximized-ish (no chrome) large viewport
  {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1200 } });
    await prep(page, 'ultra');
    await shot(page, 'v130-ultra-maximized.png');
    await page.close();
  }

  await browser.close();
  console.log('DONE');
}

main().catch((e) => { console.error(e); process.exit(1); });
