import { api, ApiError } from './api';
import { moodPortrait, nearestMood } from './moods';
import { sanitizeForSpeech } from './speech';
import { loadOmniConfig, personalitySystemPrompt, type OmniConfig } from './omni-config';
import { scoreTrigger, fireLine, type ActivitySignals } from './rhythm';
import type { JokeCategory } from './jokes';

/** Omni the Presence — floating face + own chat prompt (separate from coding chat). */
export class FloatingAssistant {
  root!: HTMLElement;
  mood = 'neutral';
  talking = false;
  promptOpen = false;
  raf = 0;
  t0 = performance.now();
  faceA!: HTMLImageElement;
  faceB!: HTMLImageElement;
  usingA = true;
  volunteerEnabled = true;
  lastVolunteer = 0;
  lastRhythmFire = 0;
  cfg: OmniConfig = loadOmniConfig();
  audioCtx: AudioContext | null = null;
  // activity
  keyTimes: number[] = [];
  lastTypeAt = 0;
  undoChurn = 0;
  recentErrors = 0;
  sessionStart = Date.now();

  static create(root: HTMLElement) {
    const a = new FloatingAssistant();
    a.root = root;
    a.cfg = loadOmniConfig();
    root.classList.toggle('assistant-hidden', !a.cfg.show);
    root.innerHTML = `
      <div class="asst-bar" id="asst-drag"><span>Omni the Presence</span><button id="asst-close" type="button">✕</button></div>
      <div class="asst-face-wrap" id="asst-face-wrap">
        <img class="asst-face active" id="asst-face-a" alt="Omni" draggable="false"/>
        <img class="asst-face" id="asst-face-b" alt="" draggable="false"/>
        <div class="asst-glow"></div>
        <div class="asst-mouth-overlay" id="asst-mouth"></div>
      </div>
      <div class="asst-status" id="asst-status">Ready · neutral</div>
      <button type="button" class="asst-omni-btn" id="asst-omni-btn">Omni</button>
      <div class="asst-prompt hidden" id="asst-prompt">
        <div class="asst-prompt-log" id="asst-prompt-log"></div>
        <div class="asst-prompt-row">
          <textarea id="omni-input" rows="2" placeholder="Talk to Omni…" autocomplete="off"></textarea>
          <button type="button" class="asst-send" id="omni-send" title="Send" aria-label="Send">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="12" cy="12" r="10"/><path d="M12 16V8M8 12l4-4 4 4"/></svg>
          </button>
        </div>
      </div>
    `;
    a.faceA = root.querySelector('#asst-face-a') as HTMLImageElement;
    a.faceB = root.querySelector('#asst-face-b') as HTMLImageElement;
    a.setMood('neutral', true);
    root.querySelector('#asst-close')?.addEventListener('click', () => a.hide());
    root.querySelector('#asst-omni-btn')?.addEventListener('click', () => a.togglePrompt());
    const input = root.querySelector('#omni-input') as HTMLTextAreaElement;
    root.querySelector('#omni-send')?.addEventListener('click', () => a.sendOmni());
    input.addEventListener('keydown', (e) => {
      if (e.isComposing || (e as any).keyCode === 229) return;
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        e.stopPropagation();
        a.sendOmni();
      }
    });
    input.addEventListener('keypress', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) e.preventDefault();
    });
    makeDraggable(root, root.querySelector('#asst-drag') as HTMLElement);
    window.addEventListener('keydown', (e) => a.noteKey(e));
    const loop = () => {
      a.raf = requestAnimationFrame(loop);
      a.tick();
    };
    loop();
    setInterval(() => a.rhythmTick(), 5000);
    return a;
  }

  reloadConfig() {
    this.cfg = loadOmniConfig();
    this.volunteerEnabled = this.cfg.volunteer;
    this.root.classList.toggle('assistant-hidden', !this.cfg.show);
  }

  noteKey(e: KeyboardEvent) {
    const now = Date.now();
    this.lastTypeAt = now;
    this.keyTimes.push(now);
    this.keyTimes = this.keyTimes.filter((t) => now - t < 5000);
    if (e.key === 'z' && (e.ctrlKey || e.metaKey)) this.undoChurn++;
  }

  noteError() { this.recentErrors++; setTimeout(() => { this.recentErrors = Math.max(0, this.recentErrors - 1); }, 120000); }
  noteBuild(ok: boolean) { void this.onSignal({ buildPassed: ok, buildFailed: !ok }); }
  noteCommit() { void this.onSignal({ gitCommit: true }); }

  async onSignal(partial: Partial<ActivitySignals>) {
    const now = Date.now();
    const typingRate = this.keyTimes.length / 5;
    let cpuPct = 0, idleSec = 0, onBattery = false;
    try {
      const m = await api.activity();
      cpuPct = m.cpuPct ?? 0;
      idleSec = m.idleSec ?? 0;
      onBattery = !!m.onBattery;
    } catch { /* offline */ }
    const sig: ActivitySignals = {
      now,
      typingRate,
      lastTypeAt: this.lastTypeAt,
      editRate: typingRate,
      undoChurn: this.undoChurn,
      recentErrors: this.recentErrors,
      buildFailed: false,
      buildPassed: false,
      gitCommit: false,
      sessionMin: (now - this.sessionStart) / 60000,
      cpuPct,
      idleSec,
      onBattery,
      ...partial,
    };
    const hit = scoreTrigger(sig, this.cfg.rhythm, this.lastRhythmFire);
    if (hit.action === 'none') return;
    const line = fireLine(hit.action as JokeCategory);
    if (!line) return;
    this.lastRhythmFire = now;
    if (hit.action === 'cheer_ups') this.setMood('supportive');
    else if (hit.action === 'congrats') this.setMood('joyful');
    else if (hit.action === 'idle_callouts') this.setMood('curious');
    else if (hit.action === 'break_reminders') this.setMood('calm');
    else this.setMood('playful');
    this.speak(line);
    if (this.promptOpen) this.appendLog('omni', line);
  }

  async rhythmTick() {
    if (!this.cfg.volunteer) return;
    await this.onSignal({});
  }

  togglePrompt() {
    this.promptOpen = !this.promptOpen;
    this.root.querySelector('#asst-prompt')?.classList.toggle('hidden', !this.promptOpen);
    this.root.classList.toggle('prompt-open', this.promptOpen);
    if (this.promptOpen) (this.root.querySelector('#omni-input') as HTMLTextAreaElement)?.focus();
  }

  async sendOmni() {
    const input = this.root.querySelector('#omni-input') as HTMLTextAreaElement;
    const text = (input?.value || '').trim();
    if (!text) return;
    input.value = '';
    this.appendLog('you', text);
    this.setStatus('Thinking…');
    try {
      const r = await api.omniChat(text, {
        system: personalitySystemPrompt(this.cfg),
        max_tokens: this.cfg.maxTokens,
        temperature: this.cfg.temperature,
        timeout_ms: this.cfg.timeoutMs,
      });
      const clean = sanitizeForSpeech(r.content);
      // Bubble shows sanitized display — never raw CoT/code
      this.appendLog('omni', clean.display || clean.speak);
      await this.speak(clean.speak);
      if (/!/.test(clean.speak)) this.setMood('joyful');
      else if (/\?/.test(clean.speak)) this.setMood('curious');
      else this.setMood('playful');
    } catch (e: any) {
      const human = e instanceof ApiError ? e.message : (e?.message && !/<!DOCTYPE|<html/i.test(e.message) ? e.message : "Can't reach my brain right now.");
      const safe = human.replace(/<[^>]+>/g, ' ').slice(0, 160);
      this.appendLog('omni', safe);
      this.setMood(e instanceof ApiError && e.kind === 'nokey' ? 'worried' : 'sad');
      this.setStatus(e instanceof ApiError && e.kind === 'nokey' ? 'Needs key' : 'Offline');
      // don't speak HTML; short line only
      void this.speak(safe);
    }
  }

  appendLog(who: 'you' | 'omni', text: string) {
    const log = this.root.querySelector('#asst-prompt-log');
    if (!log) return;
    const div = document.createElement('div');
    div.className = `asst-line ${who}`;
    div.textContent = text;
    log.appendChild(div);
    log.scrollTop = log.scrollHeight;
  }

  tick() {
    const t = (performance.now() - this.t0) / 1000;
    const wrap = this.root.querySelector('#asst-face-wrap') as HTMLElement;
    if (wrap) wrap.style.transform = `translateY(${Math.sin(t * 0.7) * 1.2}px)`;
    const glow = this.root.querySelector('.asst-glow') as HTMLElement;
    if (glow) glow.style.opacity = String(0.35 + Math.sin(t * 1.6) * 0.12 + (this.talking ? 0.25 : 0));
    const mouth = this.root.querySelector('#asst-mouth') as HTMLElement;
    if (mouth) {
      if (this.talking) {
        mouth.style.transform = `scaleY(${0.15 + Math.abs(Math.sin(t * 14)) * 0.55})`;
        mouth.style.opacity = '0.55';
      } else {
        mouth.style.transform = 'scaleY(0.12)';
        mouth.style.opacity = '0';
      }
    }
    if (Math.sin(t * 2.05) > 0.992) {
      this.faceA.style.filter = this.usingA ? 'brightness(0.55)' : '';
      this.faceB.style.filter = !this.usingA ? 'brightness(0.55)' : '';
    } else {
      this.faceA.style.filter = '';
      this.faceB.style.filter = '';
    }
  }

  async speak(text: string) {
    const { speak } = sanitizeForSpeech(text);
    if (!speak || !this.cfg.speak) {
      this.setStatus(`Ready · ${this.mood}`);
      return;
    }
    this.talking = true;
    this.setStatus('Speaking…');
    const approxMs = Math.min(10000, 700 + speak.length * (55 / Math.max(0.7, this.cfg.speechSpeed)));
    try {
      const ok = await this.speakTTS(speak);
      if (!ok) await this.speakBrowser(speak);
    } catch {
      await this.speakBrowser(speak);
    }
    window.setTimeout(() => {
      this.talking = false;
      this.setStatus(`Ready · ${this.mood}`);
    }, approxMs);
  }

  async speakTTS(text: string): Promise<boolean> {
    const r = await fetch('/api/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, speed: this.cfg.speechSpeed, voice_id: this.cfg.voiceId }),
    });
    if (r.status === 204 || !r.ok) return false;
    const buf = await r.arrayBuffer();
    if (!buf.byteLength) return false;
    this.audioCtx = this.audioCtx || new (window.AudioContext || (window as any).webkitAudioContext)();
    const audio = await this.audioCtx.decodeAudioData(buf.slice(0));
    const src = this.audioCtx.createBufferSource();
    src.buffer = audio;
    src.playbackRate.value = this.cfg.speechSpeed;
    src.connect(this.audioCtx.destination);
    src.start();
    return true;
  }

  speakBrowser(text: string): Promise<void> {
    return new Promise((resolve) => {
      if (!('speechSynthesis' in window)) { resolve(); return; }
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.rate = Math.min(1.4, Math.max(0.7, this.cfg.speechSpeed));
      u.onend = () => resolve();
      u.onerror = () => resolve();
      window.speechSynthesis.speak(u);
    });
  }

  setMood(mood: string, instant = false) {
    const m = nearestMood(mood);
    this.mood = m;
    const src = moodPortrait(m);
    const incoming = this.usingA ? this.faceB : this.faceA;
    const outgoing = this.usingA ? this.faceA : this.faceB;
    if (instant || outgoing.getAttribute('src') === src) {
      this.faceA.src = src;
      this.faceA.classList.add('active');
      this.faceB.classList.remove('active');
      this.usingA = true;
    } else {
      incoming.onload = () => {
        incoming.classList.add('active');
        outgoing.classList.remove('active');
        this.usingA = !this.usingA;
      };
      incoming.src = src;
    }
    this.setStatus(`Ready · ${this.mood}`);
  }

  setStatus(s: string) {
    const el = this.root.querySelector('#asst-status');
    if (el) el.textContent = s;
  }

  show() { this.root.classList.remove('assistant-hidden'); this.cfg.show = true; }
  hide() { this.root.classList.add('assistant-hidden'); }
  greet() {
    const line = 'Hey. Omni here — tap Omni anytime.';
    void this.speak(line);
    this.setMood('joyful');
    setTimeout(() => this.setMood('neutral'), 2800);
  }

  async maybeVolunteer(context: string) {
    if (!this.cfg.volunteer) return;
    const now = Date.now();
    if (now - this.lastVolunteer < 45000) return;
    this.lastVolunteer = now;
    try {
      const r = await api.omniVolunteer(context);
      const clean = sanitizeForSpeech(r.content || '');
      if (clean.speak) {
        this.setMood('curious');
        await this.speak(clean.speak);
        if (this.promptOpen) this.appendLog('omni', clean.display || clean.speak);
      }
    } catch { /* ignore */ }
  }
}

function makeDraggable(box: HTMLElement, handle: HTMLElement) {
  let ox = 0, oy = 0, dragging = false;
  handle.addEventListener('pointerdown', e => {
    dragging = true;
    ox = e.clientX - box.offsetLeft;
    oy = e.clientY - box.offsetTop;
    handle.setPointerCapture(e.pointerId);
  });
  handle.addEventListener('pointermove', e => {
    if (!dragging) return;
    box.style.left = `${e.clientX - ox}px`;
    box.style.top = `${e.clientY - oy}px`;
    box.style.right = 'auto';
    box.style.bottom = 'auto';
  });
  handle.addEventListener('pointerup', () => { dragging = false; });
}
