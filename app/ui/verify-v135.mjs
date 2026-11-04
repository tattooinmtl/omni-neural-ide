import { chromium } from 'playwright';
import fs from 'fs';
const OUT = '/workspace/omni-installer/v135';
const BASE = process.env.OMNI_BASE || 'http://127.0.0.1:8799';
const MODE = process.env.MODE || 'ultra';
fs.mkdirSync(OUT, { recursive: true });
const results = [];
const check = (name, ok, info = '') => { results.push({ name, ok: !!ok, info }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  — ' + info : ''}`); };

const b = await chromium.launch({ args: ['--no-sandbox', '--disable-gpu'] });
const p = await b.newPage({ viewport: { width: 1920, height: 1080 } });
p.on('pageerror', e => { if (!/importScripts|ErrorEvent/.test(e.message)) console.log('PAGEERR', e.message); });
const L = () => p.evaluate(() => JSON.parse(JSON.stringify(window.__omniDock.layout)));
const shot = (n) => p.screenshot({ path: `${OUT}/${n}.png` });
async function load() {
  await p.goto(`${BASE}/?mode=${MODE}`, { waitUntil: 'load' });
  await p.waitForFunction(() => !!window.__omniDock, null, { timeout: 30000 });
  await p.waitForTimeout(1500);
}
async function preset(id) { await p.evaluate((id) => window.__omniDock.applyPreset(id), id); await p.waitForTimeout(400); }
async function rect(sel) { return p.evaluate((s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; }, sel); }
const pt = (r, zone) => ({
  top: [r.x + r.w / 2, r.y + r.h * 0.12], bottom: [r.x + r.w / 2, r.y + r.h * 0.88],
  left: [r.x + r.w * 0.1, r.y + r.h / 2], right: [r.x + r.w * 0.9, r.y + r.h / 2], center: [r.x + r.w / 2, r.y + r.h / 2],
}[zone]);
/** real mouse drag of panel `id` header onto `target` (panel id or 'edge-left'/'edge-right') zone */
async function drag(id, target, zone = 'center', { hold = null } = {}) {
  const h = await rect(`.dock-panel[data-panel="${id}"] .dock-title`);
  await p.mouse.move(h.x + 10, h.y + 6);
  await p.mouse.down();
  await p.mouse.move(h.x + 30, h.y + 30, { steps: 4 });
  let r;
  if (target.startsWith('edge-')) r = await rect(`.dock-${target}`);
  else r = await rect(`.dock-panel[data-panel="${target}"]`);
  const [x, y] = pt(r, zone);
  await p.mouse.move(x, y, { steps: 12 });
  await p.waitForTimeout(150);
  if (hold) await shot(hold);
  await p.mouse.up();
  await p.waitForTimeout(350);
}

await load();
await preset('default');
await shot(`default-${MODE}-1920x1080`);
let l = await L();
check('default: left=[explorer]', JSON.stringify(l.left.panels) === '["explorer"]');
check('default: middle editor|chat', l.middle.cells[0] === 'editor' && l.middle.cells[1] === 'chat');
check('default: right=[presence,terminal]', JSON.stringify(l.right.panels) === '["presence","terminal"]');

// ---- middle 1/1 (rows): drag chat to bottom of editor ----
await drag('chat', 'editor', 'bottom');
l = await L();
check('middle 1/1 rows via drag (chat→editor bottom)', JSON.stringify(l.middle.cells) === '["editor",null,"chat",null]', JSON.stringify(l.middle.cells));
await shot(`mid-rows-${MODE}`);
// ---- middle 1 : close chat ----
await p.click('.dock-panel[data-panel="chat"] [data-a="close"]'); await p.waitForTimeout(300);
l = await L();
check('middle 1 after closing chat (editor expands)', l.middle.cells.filter(Boolean).length === 1 && l.middle.cells[0] === 'editor');
const er = await rect('.dock-panel[data-panel="editor"]'), mr = await rect('.dock-region-middle');
check('editor fills whole middle', Math.abs(er.w - mr.w) < 2 && Math.abs(er.h - mr.h) < 2, `${er.w}x${er.h} vs ${mr.w}x${mr.h}`);
// ---- side 1 : close terminal on right ----
await p.click('.dock-panel[data-panel="terminal"] [data-a="close"]'); await p.waitForTimeout(300);
l = await L();
check('side 1 (right = presence only)', JSON.stringify(l.right.panels) === '["presence"]');
const pr = await rect('.dock-panel[data-panel="presence"]'), rr = await rect('.dock-region-right');
check('presence expands to full right column', Math.abs(pr.h - rr.h) < 2, `${pr.h} vs ${rr.h}`);
await shot(`side1-mid1-${MODE}`);

// ---- build side 1/1/1 + middle 2x2 using drags + App>Panels ----
await preset('default');
// App > Panels > Console via real menu
await p.click('#menubar [data-menu="app"]'); await p.waitForTimeout(200);
await p.hover('.menu-item.has-sub:has-text("Panels")'); await p.waitForTimeout(300);
await p.click('.menu-item:not(.has-sub):has-text("Console")'); await p.waitForTimeout(400);
l = await L();
check('App>Panels>Console → next free slot (right 1/1/1)', JSON.stringify(l.right.panels) === '["presence","terminal","console"]', JSON.stringify(l.right.panels));
// left 1/1 by dragging Output? open search & outline into left
await p.evaluate(() => window.__omniDock.open('outline')); await p.waitForTimeout(200);
l = await L(); check('left 1/1', l.left.panels.length === 2, JSON.stringify(l.left.panels));
await p.evaluate(() => window.__omniDock.open('search')); await p.waitForTimeout(200);
l = await L(); check('left 1/1/1', l.left.panels.length === 3, JSON.stringify(l.left.panels));
// middle: drag terminal from right to bottom of editor (with drop-zone screenshot)
await drag('terminal', 'editor', 'bottom', { hold: `drag-dropzones-${MODE}` });
l = await L(); check('middle 3 (terminal→editor bottom)', JSON.stringify(l.middle.cells) === '["editor","chat","terminal",null]', JSON.stringify(l.middle.cells));
// right now 1/1 → drag problems in? open problems (middle home) fills BR
await p.evaluate(() => window.__omniDock.open('problems')); await p.waitForTimeout(250);
l = await L(); check('middle 2x2', l.middle.cells.every(Boolean), JSON.stringify(l.middle.cells));
// make right 1/1/1 again: drag scm... open output → middle full → right
await p.evaluate(() => window.__omniDock.open('output')); await p.waitForTimeout(250);
l = await L(); check('right back to 1/1/1 (output → right, middle full)', l.right.panels.length === 3, JSON.stringify(l.right.panels));
await shot(`side111-mid2x2-${MODE}`);
// swap via center: drag chat onto problems center
await drag('chat', 'problems', 'center');
l = await L(); check('center drop swaps (chat↔problems)', l.middle.cells[1] === 'problems' && l.middle.cells[3] === 'chat', JSON.stringify(l.middle.cells));
// full side region + top drop → swap (max 3)
await drag('explorer', 'output', 'top');
l = await L(); check('drop into full side region swaps instead of exceeding 3', l.right.panels.length === 3 && l.left.panels.length === 3, `${l.left.panels}|${l.right.panels}`);
// drag to empty left edge
await preset('focus'); await p.evaluate(() => window.__omniDock.close('explorer')); await p.waitForTimeout(200);
await p.evaluate(() => window.__omniDock.open('chat')); await p.waitForTimeout(200);
await drag('chat', 'edge-left', 'center', { hold: `drag-edge-${MODE}` });
l = await L(); check('drop on empty left edge docks into left column', JSON.stringify(l.left.panels) === '["chat"]', JSON.stringify(l));

// ---- float & redock Omni ----
await preset('default');
await p.click('.dock-panel[data-panel="presence"] [data-a="float"]'); await p.waitForTimeout(400);
l = await L(); check('Omni floats', !!l.floating.presence && !l.right.panels.includes('presence'));
// move the floating window by its header
const fh = await rect('.dock-panel[data-panel="presence"] .dock-title');
await p.mouse.move(fh.x + 10, fh.y + 6); await p.mouse.down(); await p.mouse.move(fh.x - 500, fh.y + 120, { steps: 10 }); await p.mouse.up(); await p.waitForTimeout(300);
l = await L(); check('floating Omni draggable', l.floating.presence && l.floating.presence.x < fh.x - 300, JSON.stringify(l.floating.presence));
check('terminal expands into freed right column', JSON.stringify(l.right.panels) === '["terminal"]');
await shot(`omni-floating-${MODE}`);
await p.click('.dock-panel[data-panel="presence"] [data-a="dock"]'); await p.waitForTimeout(400);
l = await L(); check('Omni redocks to right', l.right.panels.includes('presence') && !l.floating.presence, JSON.stringify(l.right.panels));

// ---- persistence ----
await drag('chat', 'editor', 'bottom');
const before = await L();
await p.waitForTimeout(800);
await load();
const after = await L();
check('layout persists across reload', JSON.stringify(before) === JSON.stringify(after), JSON.stringify(before) === JSON.stringify(after) ? '' : JSON.stringify(before) + ' VS ' + JSON.stringify(after));
const stored = await p.evaluate(() => fetch('/api/store/setting?key=layout').then(r => r.json()));
check('layout stored in SQLite settings', !!stored?.value?.[MODE]?.middle, JSON.stringify(stored?.value?.[MODE]?.middle?.cells));
await preset('default'); await p.waitForTimeout(600);

// ---- resize sweep: face/mouth/eyes alignment, status visible, prompt at bottom ----
const sizes = [[2560, 1440], [1920, 1080], [1600, 900], [1366, 768], [1280, 720], [1024, 700], [900, 640], [800, 600]];
for (const [w, h] of sizes) {
  await p.setViewportSize({ width: w, height: h }); await p.waitForTimeout(700);
  const m = await p.evaluate(() => {
    const host = document.querySelector('.presence-host');
    const panel = document.querySelector('.dock-panel[data-panel="presence"] .dock-body').getBoundingClientRect();
    const wrap = document.querySelector('#asst-face-wrap').getBoundingClientRect();
    const st = document.querySelector('#asst-status').getBoundingClientRect();
    const row = document.querySelector('.asst-prompt-row').getBoundingClientRect();
    const cv = document.querySelector('#asst-digital').getBoundingClientRect();
    const img = document.querySelector('#asst-face-wrap .asst-face.active');
    const df = window.__omniAssistant.digitalFace;
    const dpr = df.canvas.width / Math.max(1, cv.width);
    // independent object-fit: cover math from the CSS
    const nw = img.naturalWidth, nh = img.naturalHeight;
    const s = Math.max(wrap.width / nw, wrap.height / nh);
    const rw = nw * s, rh = nh * s;
    const ix = (wrap.width - rw) * 0.5, iy = (wrap.height - rh) * 0.38;
    const P = { female: { m: [0.505, 0.663], le: [0.360, 0.385], re: [0.645, 0.378] }, male: { m: [0.502, 0.634], le: [0.348, 0.385], re: [0.655, 0.378] } }[df.avatar];
    const exp = (f) => [wrap.x + ix + f[0] * rw, wrap.y + iy + f[1] * rh];
    const got = (k) => { const r = df['panelRect'](df.constructor.name && ({ m: 'mouth', le: 'leftEye', re: 'rightEye' }[k]) ? (window.__panels || {}) : null); return r; };
    const pr = (name) => { const pp = (window.__PANELS || null); return pp; };
    const ir = df.imageRect();
    const toCss = (fx, fy) => [cv.x + (ir.x + fx * ir.w) / dpr, cv.y + (ir.y + fy * ir.h) / dpr];
    const d = (a, b2) => Math.hypot(a[0] - b2[0], a[1] - b2[1]);
    const errs = ['m', 'le', 're'].map((k) => d(toCss(...P[k]), exp(P[k])));
    const mouth = exp(P.m);
    return {
      wrap: [wrap.x, wrap.y, wrap.width, wrap.height], panelBottom: panel.bottom, rowBottom: row.bottom,
      statusTop: st.top, statusBottom: st.bottom, wrapBottom: wrap.bottom, canvasMatch: Math.abs(cv.width - wrap.width) < 1.5 && Math.abs(cv.height - wrap.height) < 1.5,
      maxErr: Math.max(...errs), mouthInside: mouth[1] > wrap.top + 2 && mouth[1] < wrap.bottom - 2 && mouth[0] > wrap.left && mouth[0] < wrap.right,
      eyesInside: exp(P.le)[1] > wrap.top && exp(P.le)[0] > wrap.left && exp(P.re)[0] < wrap.right,
      hostW: host.clientWidth, overflowX: document.documentElement.scrollWidth > innerWidth + 1, overflowY: document.documentElement.scrollHeight > innerHeight + 1,
    };
  });
  const tag = `${w}x${h}`;
  check(`[${tag}] face box above status (no overlap)`, m.wrapBottom <= m.statusTop + 0.5, `wrapBottom ${m.wrapBottom.toFixed(1)} statusTop ${m.statusTop.toFixed(1)}`);
  check(`[${tag}] status line visible inside panel`, m.statusBottom <= m.panelBottom, '');
  check(`[${tag}] Omni prompt pinned to bottom`, Math.abs(m.panelBottom - m.rowBottom) <= 10, `gap ${(m.panelBottom - m.rowBottom).toFixed(1)}px`);
  check(`[${tag}] digital canvas == face box`, m.canvasMatch);
  check(`[${tag}] mouth+eyes track image (object-fit math)`, m.maxErr < 1.5 && m.mouthInside && m.eyesInside, `max err ${m.maxErr.toFixed(2)}px`);
  check(`[${tag}] no page overflow`, !m.overflowX && !m.overflowY);
  await shot(`resize-${MODE}-${tag}`);
  // face crop
  const fr = await rect('.dock-panel[data-panel="presence"]');
  await p.screenshot({ path: `${OUT}/face-${MODE}-${tag}.png`, clip: { x: fr.x, y: fr.y, width: fr.w, height: Math.min(fr.h, 520) } });
}
// narrow right column via splitter + wide via splitter, check alignment
await p.setViewportSize({ width: 1600, height: 900 }); await p.waitForTimeout(500);
for (const dx of [140, -260]) {
  const s = await rect('.dock-col-split[data-k="right"]');
  await p.mouse.move(s.x + 2, s.y + 200); await p.mouse.down(); await p.mouse.move(s.x + 2 + dx, s.y + 200, { steps: 8 }); await p.mouse.up(); await p.waitForTimeout(500);
  const m = await p.evaluate(() => { const w = document.querySelector('#asst-face-wrap').getBoundingClientRect(); const st = document.querySelector('#asst-status').getBoundingClientRect(); return { w: w.width, h: w.height, ok: w.bottom <= st.top + 0.5, d: `${w.bottom.toFixed(1)}/${st.top.toFixed(1)}` }; });
  check(`col splitter ${dx > 0 ? 'narrow' : 'wide'} right column → face fits`, m.ok, `${m.w.toFixed(0)}x${m.h.toFixed(0)} ${m.d}`);
  await shot(`splitter-${dx > 0 ? 'narrow' : 'wide'}-${MODE}`);
}
// floating Omni small window
await preset('default');
await p.click('.dock-panel[data-panel="presence"] [data-a="float"]'); await p.waitForTimeout(300);
await p.evaluate(() => { const d = window.__omniDock; d.layout.floating.presence = { ...d.layout.floating.presence, x: 520, y: 160, w: 280, h: 360 }; d.changed(); });
await p.waitForTimeout(500);
const fm = await p.evaluate(() => { const w = document.querySelector('#asst-face-wrap').getBoundingClientRect(); const st = document.querySelector('#asst-status').getBoundingClientRect(); const pb = document.querySelector('.dock-panel[data-panel="presence"] .dock-body').getBoundingClientRect(); const row = document.querySelector('.asst-prompt-row').getBoundingClientRect(); return { ok: w.bottom <= st.top + 0.5 && Math.abs(pb.bottom - row.bottom) <= 10 }; });
check('small floating Omni (280x360): face fits, prompt at bottom', fm.ok);
await shot(`omni-floating-small-${MODE}`);
await p.click('.dock-panel[data-panel="presence"] [data-a="dock"]');
await preset('default');
fs.writeFileSync(`${OUT}/verify-${MODE}.json`, JSON.stringify(results, null, 2));
console.log(`\n${results.filter(r => r.ok).length}/${results.length} passed (${MODE})`);
await b.close();
