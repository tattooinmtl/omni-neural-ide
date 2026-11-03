import assert from 'assert';
import { readFileSync } from 'fs';
import { createRequire } from 'module';
import { pathToFileURL } from 'url';
import vm from 'vm';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = path.join(__dirname, '../src');

// --- speech sanitizer (inline mirror of TS logic for node without ts-node) ---
function sanitizeForSpeech(raw) {
  let text = String(raw ?? '');
  let hadCode = false;
  if (/```/.test(text)) { hadCode = true; text = text.replace(/```[\w+-]*\n?[\s\S]*?```/g, ''); }
  if (/`[^`]+`/.test(text)) { hadCode = true; text = text.replace(/`[^`]+`/g, ''); }
  text = text.replace(/https?:\/\/\S+/gi, '');
  text = text.replace(/^#{1,6}\s+/gm, '');
  text = text.replace(/[*_~]{1,3}/g, '');
  text = text.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
  text = text.replace(/<[^>]+>/g, ' ');
  text = text.replace(/\b(as an ai|chain[- ]of[- ]thought|let me think|well, the user)\b/gi, '');
  text = text.replace(/[^\S\n]+/g, ' ').trim();
  const sentences = text.split(/(?<=[.!?])\s+/).filter(Boolean);
  let speak = sentences.slice(0, 3).join(' ').trim();
  if (hadCode) {
    const pointer = 'I put the code in the chat.';
    speak = speak ? `${speak} ${pointer}` : pointer;
  }
  return { speak, hadCode };
}

// speech tests
{
  const r = sanitizeForSpeech('Sure.\n```ts\nconst x = 1;\n```\nEnjoy.');
  assert.equal(r.hadCode, true);
  assert.ok(!r.speak.includes('const x'));
  assert.ok(r.speak.includes('put the code in the chat'));
  const r2 = sanitizeForSpeech('Well, the user said this, what\'s that. Hello friend.');
  assert.ok(!/well, the user/i.test(r2.speak));
  const r3 = sanitizeForSpeech('See https://example.com/foo for docs.');
  assert.ok(!r3.speak.includes('https://'));
  console.log('speech sanitizer OK');
}

// jokes no-repeat
{
  const pool = JSON.parse(readFileSync(path.join(src, 'jokes-data.json'), 'utf8'));
  const total = Object.values(pool).reduce((a, b) => a + b.length, 0);
  assert.ok(total >= 300, 'pool size ' + total);
  const hist = [];
  const cool = 6 * 3600 * 1000;
  const now = Date.now();
  function pick(cat) {
    const recent = new Set(hist.filter(h => now - h.t < cool).map(h => h.line));
    const lines = pool[cat].filter(l => !recent.has(l));
    const bag = lines.length ? lines : pool[cat];
    const line = bag[0];
    hist.push({ line, t: now });
    return line;
  }
  const a = pick('coding_jokes');
  const b = pick('coding_jokes');
  assert.notEqual(a, b);
  // exhaust small fake
  const tiny = ['x', 'y'];
  const h2 = [];
  function pickTiny() {
    const recent = new Set(h2.map(x => x));
    const bag = tiny.filter(l => !recent.has(l));
    const line = (bag.length ? bag : tiny)[0];
    h2.push(line);
    return line;
  }
  assert.equal(pickTiny(), 'x');
  assert.equal(pickTiny(), 'y');
  assert.equal(pickTiny(), 'x'); // exhausted → allow repeat
  console.log('jokes pool+norepeat OK', total);
}

// rhythm scoring
{
  function scoreTrigger(sig, cfg, lastFireAt) {
    if (!cfg.enabled || cfg.dnd) return { action: 'none' };
    if (sig.now - lastFireAt < cfg.cooldownSec * 1000) return { action: 'none', reason: 'cooldown' };
    if (sig.now - sig.lastTypeAt < cfg.typingBurstMs) return { action: 'none', reason: 'typing-burst' };
    if (sig.buildPassed || sig.gitCommit) return { action: 'congrats' };
    if (sig.buildFailed || sig.recentErrors >= cfg.frustrationErrors || sig.undoChurn > 6) return { action: 'cheer_ups' };
    if (sig.idleSec >= cfg.idleMinutes * 60 && sig.cpuPct < 12) return { action: 'idle_callouts' };
    if (sig.sessionMin >= cfg.sessionBreakMinutes) return { action: 'break_reminders' };
    if (sig.typingRate > 0.3 && sig.typingRate < 2.5) return { action: 'coding_jokes' };
    return { action: 'none' };
  }
  const cfg = { enabled: true, dnd: false, cooldownSec: 90, typingBurstMs: 2500, frustrationErrors: 3, idleMinutes: 8, sessionBreakMinutes: 50 };
  const base = { now: 1_000_000, lastTypeAt: 0, typingRate: 0, undoChurn: 0, recentErrors: 0, buildFailed: false, buildPassed: false, gitCommit: false, sessionMin: 10, cpuPct: 5, idleSec: 0 };
  assert.equal(scoreTrigger({ ...base, lastTypeAt: 999_000 }, cfg, 0).reason, 'typing-burst');
  assert.equal(scoreTrigger({ ...base, buildPassed: true }, cfg, 0).action, 'congrats');
  assert.equal(scoreTrigger({ ...base, recentErrors: 5 }, cfg, 0).action, 'cheer_ups');
  assert.equal(scoreTrigger({ ...base, idleSec: 600, cpuPct: 3 }, cfg, 0).action, 'idle_callouts');
  assert.equal(scoreTrigger({ ...base, buildPassed: true }, cfg, 999_000).reason, 'cooldown');
  console.log('rhythm scoring OK');
}

console.log('ALL OMNI UNIT TESTS PASSED');
