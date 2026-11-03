import { api, ApiError } from './api';
import { moodPortrait, mouthFrame, nearestMood, type AvatarId } from './moods';
import { DigitalFace } from './digital-face';
import { VOICE_IDS } from './omni-config';
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
  digitalFace: DigitalFace | null = null;
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
          <textarea id="omni-input" rows="2" placeholder="Talk to Omni…" autocomplete="off" spellcheck="true" style="user-select:text;-webkit-user-select:text"></textarea>
          <button type="button" class="asst-send" id="omni-send" title="Send" aria-label="Send">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="12" cy="12" r="10"/><path d="M12 16V8M8 12l4-4 4 4"/></svg>
          </button>
        </div>
      </div>
    `;
    a.faceA = root.querySelector('#asst-face-a') as HTMLImageElement;
    a.faceB = root.querySelector('#asst-face-b') as HTMLImageElement;
    a.faceTalk = root.querySelector('#asst-face-talk') as HTMLImageElement;
    a.faceTalk.src = mouthFrame(2, (a.cfg.avatar || 'female') as AvatarId);
    const wrap = root.querySelector('#asst-face-wrap') as HTMLElement;
    a.digitalFace = new DigitalFace(wrap);
    a.applyFaceMode();
    (window as any).__omniAssistant = a;
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
    // Keep voice paired with avatar
    if (this.cfg.avatar === 'male' && this.cfg.voiceId === VOICE_IDS.female) this.cfg.voiceId = VOICE_IDS.male;
    if (this.cfg.avatar === 'female' && this.cfg.voiceId === VOICE_IDS.male) this.cfg.voiceId = VOICE_IDS.female;
    this.applyFaceMode();
    this.setMood(this.mood || 'neutral', true);
  }

  applyFaceMode() {
    const digital = (this.cfg.faceMode || 'digital') === 'digital';
    const wrap = this.root.querySelector('#asst-face-wrap') as HTMLElement | null;
    wrap?.classList.toggle('digital-mode', digital);
    if (this.digitalFace) {
      this.digitalFace.setAvatar(((this.cfg.avatar || 'female') as 'female' | 'male'));
      this.digitalFace.setOpts({
        intensity: digital ? (this.cfg.effectIntensity ?? 0.9) : 0,
        pixelSize: this.cfg.pixelSize ?? 2,
        eyeColorOverride: this.cfg.eyeColorOverride || null,
      });
      if (digital) this.digitalFace.start();
      else this.digitalFace.stop();
    }
    if (this.faceTalk) {
      this.faceTalk.style.display = digital ? 'none' : '';
    }
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

  thinkingTimer = 0;
  ummIndex = 0;
  lipRaf = 0;
  analyser: AnalyserNode | null = null;
  lipSource: AudioBufferSourceNode | null = null;

  async sendOmni() {
    const input = this.root.querySelector('#omni-input') as HTMLTextAreaElement;
    const text = (input?.value || '').trim();
    if (!text) return;
    input.value = '';
    this.appendLog('you', text);
    this.beginThinking();
    try {
      const r = await api.omniChat(text, {
        system: personalitySystemPrompt(this.cfg),
        max_tokens: this.cfg.maxTokens,
        temperature: this.cfg.temperature,
        timeout_ms: this.cfg.timeoutMs,
      });
      this.endThinking();
      if (r.delegate) {
        (window as any).__codingChat?.injectFromOmni?.(r.delegate);
      }
      if (r.update?.ok) {
        // updater helper relaunches — exit cleanly soon
        window.setTimeout(() => { try { (window as any).__omniQuit?.(); } catch {} }, 800);
      }
      const clean = sanitizeForSpeech(r.content);
      this.appendLog('omni', clean.display || clean.speak || r.content);
      await this.speak(clean.speak || r.content);
      if ((r.tools_used || []).includes('delegate_to_coding_agent')) this.setMood('joyful');
      else if (/!/.test(clean.speak)) this.setMood('joyful');
      else if (/\?/.test(clean.speak)) this.setMood('curious');
      else this.setMood('playful');
    } catch (e: any) {
      this.endThinking();
      const human = e instanceof ApiError ? e.message : (e?.message && !/<!DOCTYPE|<html/i.test(e.message) ? e.message : "Can't reach my brain right now.");
      const safe = human.replace(/<[^>]+>/g, ' ').slice(0, 160);
      this.appendLog('omni', safe);
      this.setMood(e instanceof ApiError && e.kind === 'nokey' ? 'worried' : 'sad');
      this.setStatus(e instanceof ApiError && e.kind === 'nokey' ? 'Needs key' : 'Offline');
      void this.speak(safe);
    }
  }

  beginThinking() {
    this.setMood('thinking');
    this.digitalFace?.setState('thinking');
    this.setStatus('Thinking…');
    const lines = ['umm… ok!', 'umm… okay!', 'umm… still on it!', 'umm… ok, almost!'];
    void this.speak(lines[0]);
    this.ummIndex = 1;
    if (this.thinkingTimer) window.clearInterval(this.thinkingTimer);
    this.thinkingTimer = window.setInterval(() => {
      const line = lines[this.ummIndex % lines.length];
      this.ummIndex++;
      this.setMood('thinking');
      void this.speak(line);
    }, 60000);
  }

  endThinking() {
    if (this.thinkingTimer) { window.clearInterval(this.thinkingTimer); this.thinkingTimer = 0; }
    this.digitalFace?.setState(this.talking ? 'talking' : 'idle');
  }

  appendLog(who: 'you' | 'omni', text: string) {
    const log = this.root.querySelector('#asst-prompt-log');
    if (!log) return;
    const row = document.createElement('div');
    row.className = `asst-line-row ${who}`;
    const div = document.createElement('div');
    div.className = `asst-line ${who}`;
    div.textContent = text;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'asst-copy';
    btn.title = 'Copy';
    btn.textContent = '⧉';
    btn.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(text); btn.textContent = '✓'; setTimeout(() => btn.textContent = '⧉', 800); } catch {}
    });
    row.appendChild(div);
    row.appendChild(btn);
    log.appendChild(row);
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
    // Lip frames driven by analyser / boundary events via setMouthLevel; tick only clears when idle
    if (this.faceTalk && !this.talking) {
      this.faceTalk.style.opacity = '0';
      this.faceTalk.style.visibility = 'hidden';
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
    this.digitalFace?.setState('talking');
    const digital = (this.cfg.faceMode || 'digital') === 'digital';
    if (!digital && this.faceTalk) {
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
      this.digitalFace?.setState('idle');
      this.digitalFace?.setAnalyser(null);
      if (this.faceTalk) {
        this.faceTalk.style.opacity = '0';
        this.faceTalk.style.visibility = 'hidden';
      }
      this.setMood(this.idleMood || this.mood, true);
      this.setStatus(`Ready · ${this.mood}`);
    }, approxMs);
  }

  async speakTTS(text: string): Promise<boolean> {
    const voice = this.cfg.voiceId || (this.cfg.avatar === 'male' ? VOICE_IDS.male : VOICE_IDS.female);
    const r = await fetch('/api/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, speed: this.cfg.speechSpeed, voice_id: voice }),
    });
    if (r.status === 204 || !r.ok) return false;
    const buf = await r.arrayBuffer();
    if (!buf.byteLength) return false;
    this.audioCtx = this.audioCtx || new (window.AudioContext || (window as any).webkitAudioContext)();
    const audio = await this.audioCtx.decodeAudioData(buf.slice(0));
    const src = this.audioCtx.createBufferSource();
    src.buffer = audio;
    src.playbackRate.value = this.cfg.speechSpeed;
    const analyser = this.audioCtx.createAnalyser();
    analyser.fftSize = 256;
    src.connect(analyser);
    analyser.connect(this.audioCtx.destination);
    this.analyser = analyser;
    this.lipSource = src;
    this.digitalFace?.setAnalyser(analyser);
    this.digitalFace?.setState('talking');
    if ((this.cfg.faceMode || 'digital') !== 'digital') this.startLipSync();
    src.start();
    src.onended = () => { this.stopLipSync(); this.digitalFace?.setAnalyser(null); };
    return true;
  }

  startLipSync() {
    const data = new Uint8Array(this.analyser?.frequencyBinCount || 0);
    const tick = () => {
      this.lipRaf = requestAnimationFrame(tick);
      if (!this.analyser || !this.talking) return;
      this.analyser.getByteTimeDomainData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i++) {
        const v = (data[i] - 128) / 128;
        sum += v * v;
      }
      const rms = Math.sqrt(sum / data.length);
      const level = Math.min(3, Math.floor(rms * 14));
      this.setMouthLevel(level);
    };
    cancelAnimationFrame(this.lipRaf);
    tick();
  }

  stopLipSync() {
    cancelAnimationFrame(this.lipRaf);
    this.lipRaf = 0;
    this.setMouthLevel(0);
  }

  setMouthLevel(level: number) {
    // Digital mode: drive synthetic envelope for speechSynthesis / classic unused
    if ((this.cfg.faceMode || 'digital') === 'digital') {
      this.digitalFace?.nudgeSynth(level / 3);
      return;
    }
    if (!this.faceTalk) return;
    const avatar = (this.cfg.avatar || 'female') as AvatarId;
    if (level <= 0) {
      this.faceTalk.style.opacity = '0';
      this.faceTalk.style.visibility = 'hidden';
      const active = this.usingA ? this.faceA : this.faceB;
      active.style.opacity = '1';
      return;
    }
    this.faceTalk.src = mouthFrame(level, avatar);
    this.faceTalk.style.visibility = 'visible';
    this.faceTalk.style.opacity = '1';
    const active = this.usingA ? this.faceA : this.faceB;
    active.style.opacity = '0';
  }

  speakBrowser(text: string): Promise<void> {
    return new Promise((resolve) => {
      if (!('speechSynthesis' in window)) { resolve(); return; }
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.rate = this.cfg.speechSpeed;
      const wantFemale = (this.cfg.avatar || 'female') === 'female';
      const voices = window.speechSynthesis.getVoices();
      const pick = voices.find(v => wantFemale
        ? /female|zira|samantha|victoria|karen|moira|fiona/i.test(v.name)
        : /male|david|daniel|alex|fred|microsoft david/i.test(v.name))
        || voices.find(v => wantFemale ? v.lang.startsWith('en') : v.lang.startsWith('en'));
      if (pick) u.voice = pick;
      let i = 0;
      u.onboundary = () => {
        i++;
        this.setMouthLevel(1 + (i % 3));
      };
      u.onend = () => { this.stopLipSync(); resolve(); };
      u.onerror = () => { this.stopLipSync(); resolve(); };
      this.digitalFace?.setState('talking');
      if ((this.cfg.faceMode || 'digital') !== 'digital') this.startLipSyncEstimate();
      else this.startLipSyncEstimate(); // still nudges synth via setMouthLevel
      window.speechSynthesis.speak(u);
    });
  }

  startLipSyncEstimate() {
    cancelAnimationFrame(this.lipRaf);
    const t0 = performance.now();
    const tick = () => {
      this.lipRaf = requestAnimationFrame(tick);
      if (!this.talking) return;
      const t = (performance.now() - t0) / 1000;
      const level = 1 + Math.floor((Math.abs(Math.sin(t * 10)) * 2.9));
      this.setMouthLevel(level);
    };
    tick();
  }

  setMood(mood: string, instant = false) {
    const m = nearestMood(mood);
    this.mood = m;
    this.idleMood = m;
    this.digitalFace?.setMood(m);
    const src = moodPortrait(m, (this.cfg.avatar || 'female') as AvatarId, (this.cfg.faceMode || 'digital') as any);
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
