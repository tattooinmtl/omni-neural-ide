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
  faceTalk!: HTMLImageElement;
  usingA = true;
  moodFadeTimer = 0;
  idleMood = 'neutral';
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
        <img class="asst-face talk-layer" id="asst-face-talk" alt="" draggable="false"/>
        <div class="asst-glow"></div>
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
    a.faceTalk = root.querySelector('#asst-face-talk') as HTMLImageElement;
    a.faceTalk.src = '/omni-presence/talking.jpg';
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
    const freeze = this.root.dataset.freezeFace === '1';
    if (freeze) {
      const wrap = this.root.querySelector('#asst-face-wrap') as HTMLElement;
      if (wrap) wrap.style.transform = 'none';
      return; // screenshots / debug: do not mutate face layers
    }
    const t = (performance.now() - this.t0) / 1000;
    const wrap = this.root.querySelector('#asst-face-wrap') as HTMLElement;
    if (wrap) wrap.style.transform = `translateY(${Math.sin(t * 0.7) * 1.2}px)`;
    const glow = this.root.querySelector('.asst-glow') as HTMLElement;
    if (glow) glow.style.opacity = String(0.28 + Math.sin(t * 1.6) * 0.1 + (this.talking ? 0.2 : 0));
    // Talking: show FULL talking portrait only (no blend with closed-mouth idle — that caused a smear band)
    if (this.faceTalk) {
      if (this.talking) {
        const pulse = 0.92 + Math.abs(Math.sin(t * 12)) * 0.08; // tiny brightness-like opacity pulse
        this.faceTalk.style.opacity = String(pulse);
        this.faceTalk.style.visibility = 'visible';
        // dim base mood under talk so lips don't double-expose
        const active = this.usingA ? this.faceA : this.faceB;
        active.style.opacity = '0';
      } else {
        this.faceTalk.style.opacity = '0';
        this.faceTalk.style.visibility = 'hidden';
      }
    }
    // blink only on the active mood layer (not the talk layer)
    const active = this.usingA ? this.faceA : this.faceB;
    const other = this.usingA ? this.faceB : this.faceA;
    // Hard-hide inactive mood layer except during an in-progress crossfade
    if (!this.moodFadeTimer) {
      other.style.opacity = '0';
      other.style.visibility = 'hidden';
      other.classList.remove('active');
      active.style.opacity = '1';
      active.style.visibility = 'visible';
      active.classList.add('active');
    }
    other.style.filter = '';
    if (!this.talking && Math.sin(t * 2.05) > 0.992) {
      active.style.filter = 'brightness(0.55)';
    } else {
      active.style.filter = '';
    }
  }

  async speak(text: string) {
    const { speak } = sanitizeForSpeech(text);
    if (!speak || !this.cfg.speak) {
      this.setStatus(`Ready · ${this.mood}`);
      return;
    }
    this.talking = true;
    if (this.faceTalk) {
      if (!this.faceTalk.getAttribute('src')) this.faceTalk.src = '/omni-presence/talking.jpg';
      this.faceTalk.style.visibility = 'visible';
      this.faceTalk.style.opacity = '1';
      const active = this.usingA ? this.faceA : this.faceB;
      active.style.opacity = '0';
    }
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
      if (this.faceTalk) {
        this.faceTalk.style.opacity = '0';
        this.faceTalk.style.visibility = 'hidden';
      }
      this.setMood(this.idleMood || this.mood, true);
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
    this.idleMood = m;
    const src = moodPortrait(m);
    if (this.moodFadeTimer) {
      window.clearTimeout(this.moodFadeTimer);
      this.moodFadeTimer = 0;
    }
    const showOnlyA = () => {
      this.faceA.src = src;
      this.faceA.classList.add('active');
      this.faceA.style.opacity = '1';
      this.faceA.style.visibility = 'visible';
      this.faceB.classList.remove('active');
      this.faceB.style.opacity = '0';
      this.faceB.style.visibility = 'hidden';
      this.usingA = true;
    };
    if (instant) {
      showOnlyA();
    } else {
      const incoming = this.usingA ? this.faceB : this.faceA;
      const outgoing = this.usingA ? this.faceA : this.faceB;
      if (outgoing.getAttribute('src') === src) {
        // already on this mood — keep single layer
        outgoing.classList.add('active');
        outgoing.style.opacity = '1';
        outgoing.style.visibility = 'visible';
        incoming.classList.remove('active');
        incoming.style.opacity = '0';
        incoming.style.visibility = 'hidden';
      } else {
        let started = false;
        const beginFade = () => {
          if (started) return;
          started = true;
          // start fully transparent so both frames are never solidly stacked
          incoming.classList.add('active');
          incoming.style.visibility = 'visible';
          incoming.style.opacity = '0';
          void incoming.offsetWidth;
          incoming.style.opacity = '1';
          this.moodFadeTimer = window.setTimeout(() => {
            outgoing.classList.remove('active');
            outgoing.style.opacity = '0';
            outgoing.style.visibility = 'hidden';
            this.moodFadeTimer = 0;
          }, 380);
          this.usingA = !this.usingA;
        };
        incoming.onload = () => beginFade();
        if (incoming.getAttribute('src') !== src) incoming.src = src;
        if (incoming.complete && incoming.getAttribute('src') === src) beginFade();
      }
    }
    if (!this.talking) this.setStatus(`Ready · ${this.mood}`);
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
