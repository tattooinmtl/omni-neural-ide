import { chromium } from 'playwright';
const OUT='/workspace/omni-installer/v135';
const b = await chromium.launch({ args: ['--no-sandbox','--disable-gpu'] });
const p = await b.newPage({ viewport: { width: 1920, height: 1080 } });
p.on('pageerror', e => console.log('PAGEERR', e.message));
p.on('console', m => { if (m.type()==='error') console.log('CONSOLE', m.text()); });
for (const m of ['ultra','plain']) {
  await p.goto(`http://127.0.0.1:8799/?mode=${m}`, { waitUntil: 'load' }); await p.waitForTimeout(3500);
  await p.screenshot({ path: `${OUT}/default-${m}-1920x1080.png` });
}
await b.close();
