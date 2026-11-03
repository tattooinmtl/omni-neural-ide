import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const OUT = '/workspace/omni-installer';
const BASE = process.env.OMNI_BASE || 'http://127.0.0.1:8822';
fs.mkdirSync(OUT, { recursive: true });

async function shot(page, name) {
  await page.screenshot({ path: path.join(OUT, name), type: 'png', fullPage: false });
  console.log('shot', name);
}

async function prep(page, mode) {
  await page.goto(`${BASE}/?mode=${mode}&demo=1`, { waitUntil: 'load', timeout: 120000 });
  await page.waitForTimeout(1800);
  await page.evaluate(() => {
    document.getElementById('overlay')?.classList.add('hidden');
    document.documentElement.classList.remove('shot');
    localStorage.removeItem('omni.layout.v2.plain');
    localStorage.removeItem('omni.layout.v2.ultra');
  });
  // reload so default layout applies cleanly
  await page.goto(`${BASE}/?mode=${mode}&demo=1`, { waitUntil: 'load', timeout: 120000 });
  await page.waitForTimeout(1800);
  await page.evaluate(() => {
    document.getElementById('overlay')?.classList.add('hidden');
    document.documentElement.classList.remove('shot');
    document.getElementById('assistant-root')?.classList.remove('assistant-hidden', 'assistant-tucked');
  });
  await page.waitForTimeout(700);
}

async function main() {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-gpu'] });
  for (const mode of ['plain', 'ultra']) {
    for (const [w, h, tag] of [[1920, 1080, '1920x1080'], [2560, 1440, '2560x1440']]) {
      const page = await browser.newPage({ viewport: { width: w, height: h } });
      await prep(page, mode);
      await shot(page, `v131-${mode}-${tag}.png`);
      await page.close();
    }
  }

  // Ultra menus + context
  {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    await prep(page, 'ultra');
    const tab = page.locator('#tabbar .tab').first();
    const box = await tab.boundingBox();
    await page.mouse.click(box.x + 20, box.y + 10, { button: 'right' });
    await page.waitForTimeout(350);
    await shot(page, 'v131-ultra-context-tab.png');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);

    const tree = page.locator('#file-tree .tree-item').nth(2);
    const tb = await tree.boundingBox();
    if (tb) {
      await page.mouse.click(tb.x + 40, tb.y + 8, { button: 'right' });
      await page.waitForTimeout(300);
      await shot(page, 'v131-ultra-context-explorer.png');
      await page.keyboard.press('Escape');
    }

    await page.locator('#menubar button[data-menu="app"]').click({ force: true });
    await page.waitForTimeout(200);
    await page.locator('.menu-item.has-sub', { hasText: 'Panels' }).hover();
    await page.waitForTimeout(350);
    await shot(page, 'v131-ultra-app-panels-menu.png');

    // Add Console via menu
    const consoleItem = page.locator('.menu-dropdown.sub .menu-item', { hasText: 'Console' });
    if (await consoleItem.count()) {
      await consoleItem.first().click();
      await page.waitForTimeout(500);
      await shot(page, 'v131-ultra-with-console.png');
    }
    await page.close();
  }

  // Plain app panels
  {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    await prep(page, 'plain');
    await page.locator('#menubar button[data-menu="app"]').click({ force: true });
    await page.waitForTimeout(200);
    await page.locator('.menu-item.has-sub', { hasText: 'Panels' }).hover();
    await page.waitForTimeout(350);
    await shot(page, 'v131-plain-app-panels-menu.png');
    await page.close();
  }

  await browser.close();
  console.log('DONE');
}

main().catch((e) => { console.error(e); process.exit(1); });
