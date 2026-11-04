import { chromium } from 'playwright';
const OUT = '/workspace/omni-installer';
const BASE = 'http://127.0.0.1:8796';
const b = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-gpu'] });
const p = await b.newPage({ viewport: { width: 1600, height: 1000 } });
await p.goto(`${BASE}/?mode=plain`, { waitUntil: 'load', timeout: 120000 });
await p.waitForTimeout(2000);
await p.evaluate(() => document.getElementById('overlay')?.classList.add('hidden'));
await p.locator('[data-act="settings"]').first().click();
await p.waitForTimeout(1500);
await p.screenshot({ path: `${OUT}/v134-settings-providers-masked.png` });
const rc = p.locator('#set-run-code'); if (await rc.count()) { await rc.scrollIntoViewIfNeeded(); await p.waitForTimeout(300); await p.screenshot({ path: `${OUT}/v134-settings-runcode.png` }); }
await p.keyboard.press('Escape'); await p.waitForTimeout(400);
await p.evaluate(() => document.querySelector('.settings-overlay, .settings-root, #settings')?.remove());
let ti = p.locator('#term-input');
if (!(await ti.isVisible().catch(() => false))) { await p.keyboard.press('Control+`'); await p.waitForTimeout(800); }
ti = p.locator('#term-input');
console.log('term visible', await ti.isVisible().catch(() => false));
for (const cmd of ['py -c print("hello from OMNI-CODE python")', 'pytest']) {
  await ti.click(); await ti.fill(cmd); await ti.press('Enter'); await p.waitForTimeout(2500);
}
await p.screenshot({ path: `${OUT}/v134-terminal-python.png` });
await b.close();
