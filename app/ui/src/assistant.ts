import { api } from './api';
import { CORE_MOODS, moodPortrait, nearestMood } from './moods';

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
  glow = 0;
  mouthPhase = 0;
  volunteerEnabled = true;
  lastVolunteer = 0;

  static create(root: HTMLElement) {
    const a = new FloatingAssistant();
    a.root = root;
    root.classList.remove('assistant-hidden');
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
    const sendBtn = root.querySelector('#omni-send') as HTMLButtonElement;
    sendBtn.addEventListener('click', () => a.sendOmni());
    input.addEventListener('keydown', (e) => {
      if (e.isComposing || (e as any).keyCode === 229) return;
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        e.stopPropagation();
        a.sendOmni();
      }
    });
    // Never let a parent form submit
    input.addEventListener('keypress', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) e.preventDefault();
    });
    makeDraggable(root, root.querySelector('#asst-drag') as HTMLElement);
    const loop = () => {
      a.raf = requestAnimationFrame(loop);
      a.tick();
    };
    loop();
    return a;
  }

  togglePrompt() {
    this.promptOpen = !this.promptOpen;
    const box = this.root.querySelector('#asst-prompt');
    box?.classList.toggle('hidden', !this.promptOpen);
    if (this.promptOpen) {
      (this.root.querySelector('#omni-input') as HTMLTextAreaElement)?.focus();
      this.root.classList.add('prompt-open');
    } else {
      this.root.classList.remove('prompt-open');
    }
  }

  async sendOmni() {
    const input = this.root.querySelector('#omni-input') as HTMLTextAreaElement;
    const text = (input?.value || '').trim();
    if (!text) return;
    input.value = '';
    this.appendLog('you', text);
    this.setStatus('Thinking…');
    try {
      const r = await api.omniChat(text);
      this.appendLog('omni', r.content);
      this.speak(r.content);
      // naive mood from reply length/punctuation
      if (/!/.test(r.content)) this.setMood('joyful');
      else if (/\?/.test(r.content)) this.setMood('curious');
      else this.setMood('playful');
    } catch (e: any) {
      this.appendLog('omni', e.message || 'Could not reach Omni');
      this.setMood('worried');
      this.setStatus('Offline');
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
    if (wrap) {
      const idle = Math.sin(t * 0.7) * 1.2;
      wrap.style.transform = `translateY(${idle}px)`;
    }
    const glow = this.root.querySelector('.asst-glow') as HTMLElement;
    if (glow) {
      const pulse = 0.35 + Math.sin(t * 1.6) * 0.12 + (this.talking ? 0.25 : 0);
      glow.style.opacity = String(pulse);
    }
    const mouth = this.root.querySelector('#asst-mouth') as HTMLElement;
    if (mouth) {
      if (this.talking) {
        const open = 0.15 + Math.abs(Math.sin(t * 14)) * 0.55;
        mouth.style.transform = `scaleY(${open})`;
        mouth.style.opacity = '0.55';
      } else {
        mouth.style.transform = 'scaleY(0.12)';
        mouth.style.opacity = '0';
      }
    }
    // blink: briefly dim face
    if (Math.sin(t * 2.05) > 0.992) {
      this.faceA.style.filter = this.usingA ? 'brightness(0.55)' : this.faceA.style.filter;
      this.faceB.style.filter = !this.usingA ? 'brightness(0.55)' : this.faceB.style.filter;
    } else {
      this.faceA.style.filter = '';
      this.faceB.style.filter = '';
    }
  }

  speak(text: string) {
    this.talking = true;
    this.setStatus('Speaking…');
    const ms = Math.min(8000, 900 + text.length * 40);
    window.setTimeout(() => {
      this.talking = false;
      this.setStatus(`Ready · ${this.mood}`);
    }, ms);
    this.speakTTS(text);
  }

  async speakTTS(text: string) {
    try {
      const r = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      if (!r.ok) return;
      const buf = await r.arrayBuffer();
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const audio = await ctx.decodeAudioData(buf.slice(0));
      const src = ctx.createBufferSource();
      src.buffer = audio;
      src.connect(ctx.destination);
      src.start();
    } catch {
      /* TTS optional */
    }
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

  show() { this.root.classList.remove('assistant-hidden'); }
  hide() { this.root.classList.add('assistant-hidden'); }
  greet() {
    this.speak('Hey. Omni the Presence is online — poke the Omni button anytime.');
    this.setMood('joyful');
    setTimeout(() => this.setMood('neutral'), 2800);
  }

  /** Occasional volunteer remark from coding context (rate-limited). */
  async maybeVolunteer(context: string) {
    if (!this.volunteerEnabled) return;
    const now = Date.now();
    if (now - this.lastVolunteer < 45000) return;
    this.lastVolunteer = now;
    try {
      const r = await api.omniVolunteer(context);
      if (r.content?.trim()) {
        this.setMood('curious');
        this.speak(r.content.trim());
        if (this.promptOpen) this.appendLog('omni', r.content.trim());
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
