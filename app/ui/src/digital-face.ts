/** Cyberpunk digital eyes (LED grid) + mouth waveform, masked to face panels. */

export type FaceState = 'idle' | 'talking' | 'thinking';

export type MoodPalette = {
  primary: [number, number, number];
  secondary: [number, number, number];
  glow: [number, number, number];
  pattern: 'shimmer' | 'pulse' | 'scan' | 'flash' | 'spinner' | 'waves' | 'dim';
};

const PALETTES: Record<string, MoodPalette> = {
  joyful: { primary: [180, 255, 255], secondary: [255, 230, 160], glow: [200, 255, 240], pattern: 'shimmer' },
  happy: { primary: [180, 255, 255], secondary: [255, 230, 160], glow: [200, 255, 240], pattern: 'shimmer' },
  angry: { primary: [255, 40, 40], secondary: [180, 0, 20], glow: [255, 80, 60], pattern: 'pulse' },
  sad: { primary: [80, 60, 180], secondary: [40, 30, 90], glow: [120, 90, 220], pattern: 'dim' },
  frustrated: { primary: [100, 40, 160], secondary: [40, 20, 80], glow: [160, 80, 220], pattern: 'pulse' },
  calm: { primary: [0, 255, 200], secondary: [255, 0, 200], glow: [120, 255, 220], pattern: 'waves' },
  cold: { primary: [0, 255, 200], secondary: [180, 0, 255], glow: [80, 255, 200], pattern: 'waves' },
  relaxed: { primary: [160, 255, 80], secondary: [255, 0, 180], glow: [200, 255, 120], pattern: 'waves' },
  playful: { primary: [255, 0, 200], secondary: [0, 255, 220], glow: [255, 120, 220], pattern: 'waves' },
  surprised: { primary: [255, 255, 255], secondary: [120, 220, 255], glow: [255, 255, 255], pattern: 'flash' },
  thinking: { primary: [80, 200, 255], secondary: [40, 100, 180], glow: [120, 220, 255], pattern: 'spinner' },
  focused: { primary: [100, 180, 255], secondary: [40, 80, 160], glow: [140, 200, 255], pattern: 'scan' },
  neutral: { primary: [80, 220, 255], secondary: [40, 140, 200], glow: [120, 230, 255], pattern: 'shimmer' },
  curious: { primary: [120, 255, 200], secondary: [80, 160, 255], glow: [160, 255, 230], pattern: 'shimmer' },
  worried: { primary: [100, 80, 180], secondary: [50, 40, 100], glow: [140, 110, 220], pattern: 'dim' },
  determined: { primary: [120, 200, 255], secondary: [255, 120, 60], glow: [160, 220, 255], pattern: 'scan' },
};

export function moodPalette(mood: string, overrideRgb?: string | null): MoodPalette {
  const base = PALETTES[(mood || 'neutral').toLowerCase()] || PALETTES.neutral;
  if (!overrideRgb) return base;
  const m = /^#?([0-9a-f]{6})$/i.exec(overrideRgb.trim());
  if (!m) return base;
  const n = parseInt(m[1], 16);
  const rgb: [number, number, number] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  return { ...base, primary: rgb, glow: rgb };
}

/** Panel layout in normalized face coords (0..1). Tuned to digital base portraits. */
export const PANELS = {
  leftEye: { cx: 0.355, cy: 0.415, rx: 0.105, ry: 0.072 },
  rightEye: { cx: 0.645, cy: 0.415, rx: 0.105, ry: 0.072 },
  mouth: { cx: 0.50, cy: 0.695, rx: 0.145, ry: 0.055 },
};

export type DigitalFaceOpts = {
  intensity: number; // 0..1
  pixelSize: number; // css px of logical pixel
  eyeColorOverride?: string | null;
};

export class DigitalFace {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  wrap: HTMLElement;
  mood = 'neutral';
  state: FaceState = 'idle';
  opts: DigitalFaceOpts = { intensity: 0.85, pixelSize: 3 };
  analyser: AnalyserNode | null = null;
  synthLevel = 0;
  synthTarget = 0;
  visible = true;
  raf = 0;
  t0 = performance.now();
  freq = new Uint8Array(128);
  time = new Uint8Array(256);
  lookX = 0;
  lookY = 0;
  lookTargetX = 0;
  lookTargetY = 0;
  blink = 0; // 0 open .. 1 closed
  nextBlink = 0;
  private running = false;

  constructor(wrap: HTMLElement) {
    this.wrap = wrap;
    let c = wrap.querySelector('#asst-digital') as HTMLCanvasElement | null;
    if (!c) {
      c = document.createElement('canvas');
      c.id = 'asst-digital';
      c.className = 'asst-digital';
      wrap.appendChild(c);
    }
    this.canvas = c;
    this.ctx = c.getContext('2d', { alpha: true })!;
    this.resize();
    const ro = new ResizeObserver(() => this.resize());
    ro.observe(wrap);
    document.addEventListener('visibilitychange', () => {
      this.visible = document.visibilityState === 'visible';
      if (this.visible) this.start();
      else this.stop();
    });
  }

  resize() {
    const r = this.wrap.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.floor(r.width * dpr));
    const h = Math.max(1, Math.floor(r.height * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
      this.canvas.style.width = `${r.width}px`;
      this.canvas.style.height = `${r.height}px`;
    }
  }

  setOpts(o: Partial<DigitalFaceOpts>) {
    this.opts = { ...this.opts, ...o };
  }

  setMood(mood: string) {
    this.mood = mood;
  }

  setState(s: FaceState) {
    this.state = s;
    if (s === 'thinking') {
      this.lookTargetX = 0.35;
      this.lookTargetY = -0.2;
    } else if (s === 'idle') {
      this.lookTargetX = 0;
      this.lookTargetY = 0;
    }
  }

  setAnalyser(a: AnalyserNode | null) {
    this.analyser = a;
    if (a) {
      this.freq = new Uint8Array(a.frequencyBinCount);
      this.time = new Uint8Array(a.fftSize);
    }
  }

  /** speechSynthesis fallback: nudge envelope */
  nudgeSynth(level: number) {
    this.synthTarget = Math.max(0, Math.min(1, level));
  }

  start() {
    if (this.running) return;
    this.running = true;
    const loop = () => {
      if (!this.running) return;
      this.raf = requestAnimationFrame(loop);
      if (!this.visible) return;
      this.draw();
    };
    loop();
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  private audioLevels(): { amp: number; bands: number[] } {
    if (this.analyser) {
      this.analyser.getByteTimeDomainData(this.time);
      this.analyser.getByteFrequencyData(this.freq);
      let sum = 0;
      for (let i = 0; i < this.time.length; i++) {
        const v = (this.time[i] - 128) / 128;
        sum += v * v;
      }
      const amp = Math.min(1, Math.sqrt(sum / this.time.length) * 4.2);
      const bands: number[] = [];
      const n = 16;
      const step = Math.floor(this.freq.length / n) || 1;
      for (let i = 0; i < n; i++) {
        let s = 0;
        for (let j = 0; j < step; j++) s += this.freq[i * step + j] || 0;
        bands.push((s / step) / 255);
      }
      return { amp, bands };
    }
    // synthetic envelope
    this.synthLevel += (this.synthTarget - this.synthLevel) * 0.25;
    this.synthTarget *= 0.92;
    const t = (performance.now() - this.t0) / 1000;
    const wiggle = Math.abs(Math.sin(t * 18)) * this.synthLevel;
    const amp = Math.min(1, this.synthLevel * 0.85 + wiggle * 0.4);
    const bands = Array.from({ length: 16 }, (_, i) => amp * (0.4 + 0.6 * Math.abs(Math.sin(t * 9 + i))));
    return { amp, bands };
  }

  private draw() {
    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;
    if (!w || !h) return;
    ctx.clearRect(0, 0, w, h);
    const intensity = this.opts.intensity;
    if (intensity <= 0.01) return;

    const now = performance.now();
    const t = (now - this.t0) / 1000;
    // look-around + blink
    if (now > this.nextBlink) {
      this.blink = 1;
      this.nextBlink = now + 2200 + Math.random() * 3500;
    }
    this.blink = Math.max(0, this.blink - 0.12);
    if (this.state === 'idle' && Math.random() < 0.004) {
      this.lookTargetX = (Math.random() - 0.5) * 0.7;
      this.lookTargetY = (Math.random() - 0.5) * 0.45;
    }
    this.lookX += (this.lookTargetX - this.lookX) * 0.06;
    this.lookY += (this.lookTargetY - this.lookY) * 0.06;

    const { amp, bands } = this.audioLevels();
    const pal = moodPalette(this.mood, this.opts.eyeColorOverride);
    const px = Math.max(2, Math.round(this.opts.pixelSize * (w / 320)));

    this.drawEye(PANELS.leftEye, t, pal, px, amp, -1);
    this.drawEye(PANELS.rightEye, t, pal, px, amp, 1);
    this.drawMouth(t, pal, px, amp, bands);
  }

  private panelRect(p: { cx: number; cy: number; rx: number; ry: number }) {
    const w = this.canvas.width;
    const h = this.canvas.height;
    return {
      x: (p.cx - p.rx) * w,
      y: (p.cy - p.ry) * h,
      w: p.rx * 2 * w,
      h: p.ry * 2 * h,
      cx: p.cx * w,
      cy: p.cy * h,
      rx: p.rx * w,
      ry: p.ry * h,
    };
  }

  private withEllipseClip(p: { cx: number; cy: number; rx: number; ry: number }, fn: () => void) {
    const ctx = this.ctx;
    const r = this.panelRect(p);
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(r.cx, r.cy, r.rx, r.ry, 0, 0, Math.PI * 2);
    ctx.clip();
    fn();
    // soft inner glow ring
    ctx.strokeStyle = `rgba(0,0,0,0.55)`;
    ctx.lineWidth = Math.max(1, r.rx * 0.04);
    ctx.beginPath();
    ctx.ellipse(r.cx, r.cy, r.rx * 0.98, r.ry * 0.98, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  private drawEye(
    panel: { cx: number; cy: number; rx: number; ry: number },
    t: number,
    pal: MoodPalette,
    px: number,
    amp: number,
    side: number,
  ) {
    const ctx = this.ctx;
    const r = this.panelRect(panel);
    const inten = this.opts.intensity;
    this.withEllipseClip(panel, () => {
      // dark panel fill
      ctx.fillStyle = '#05080c';
      ctx.fillRect(r.x, r.y, r.w, r.h);

      const cols = Math.max(6, Math.floor(r.w / px));
      const rows = Math.max(4, Math.floor(r.h / px));
      const cellW = r.w / cols;
      const cellH = r.h / rows;
      const pupilCx = cols * (0.5 + this.lookX * 0.18 * side);
      const pupilCy = rows * (0.5 + this.lookY * 0.2);
      const blinkRow = this.blink > 0 ? Math.floor(rows * (1 - this.blink)) : rows;

      for (let y = 0; y < rows; y++) {
        if (y >= blinkRow) continue;
        for (let x = 0; x < cols; x++) {
          // stay inside ellipse via clip already
          const dx = x + 0.5 - pupilCx;
          const dy = y + 0.5 - pupilCy;
          const dist = Math.sqrt(dx * dx + dy * dy);
          let on = 0;
          const pat = pal.pattern;
          if (this.state === 'thinking' || pat === 'spinner') {
            const ang = Math.atan2(dy, dx);
            const spin = (t * 3 + ang) % (Math.PI * 2);
            on = spin < 1.2 && dist < cols * 0.42 ? 1 : dist < cols * 0.12 ? 0.9 : 0.08;
          } else if (pat === 'scan') {
            const scan = ((t * 2.2) % 1) * rows;
            on = Math.abs(y - scan) < 1.2 ? 1 : dist < cols * 0.18 ? 0.85 : 0.12;
          } else if (pat === 'flash') {
            on = (Math.sin(t * 20) > 0 ? 1 : 0.15) * (dist < cols * 0.45 ? 1 : 0.2);
          } else if (pat === 'pulse') {
            on = dist < cols * (0.15 + 0.1 * Math.abs(Math.sin(t * 5))) ? 1 : 0.1 + 0.1 * Math.sin(t * 8 + x);
          } else if (pat === 'dim') {
            on = dist < cols * 0.14 ? 0.55 : 0.05 + 0.05 * Math.sin(t + x * 0.3);
          } else if (pat === 'waves') {
            on = 0.15 + 0.85 * Math.max(0, Math.sin(t * 3 + x * 0.45 + y * 0.3));
            if (dist < cols * 0.12) on = 1;
          } else {
            // shimmer + pupil
            on = dist < cols * 0.14 ? 1 : 0.08 + 0.25 * (0.5 + 0.5 * Math.sin(t * 2 + x * 0.5 + y * 0.4));
            if (dist < cols * 0.28) on = Math.max(on, 0.45);
          }
          if (this.state === 'talking') on = Math.max(on, amp * 0.35);
          on *= inten;
          if (on < 0.05) continue;
          const mix = dist < cols * 0.16 ? pal.secondary : pal.primary;
          const g = pal.glow;
          const a = Math.min(1, on);
          ctx.fillStyle = `rgba(${mix[0]},${mix[1]},${mix[2]},${a})`;
          const pad = Math.max(0.5, px * 0.12);
          ctx.fillRect(r.x + x * cellW + pad, r.y + y * cellH + pad, cellW - pad * 2, cellH - pad * 2);
          // bloom speck
          if (on > 0.7) {
            ctx.fillStyle = `rgba(${g[0]},${g[1]},${g[2]},${0.15 * a * inten})`;
            ctx.fillRect(r.x + x * cellW, r.y + y * cellH, cellW, cellH);
          }
        }
      }
    });
    // outer glow
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const g = ctx.createRadialGradient(r.cx, r.cy, r.rx * 0.2, r.cx, r.cy, r.rx * 1.35);
    const glow = pal.glow;
    g.addColorStop(0, `rgba(${glow[0]},${glow[1]},${glow[2]},${0.22 * inten})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(r.cx, r.cy, r.rx * 1.25, r.ry * 1.35, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  private drawMouth(t: number, pal: MoodPalette, px: number, amp: number, bands: number[]) {
    const ctx = this.ctx;
    const panel = PANELS.mouth;
    const r = this.panelRect(panel);
    const inten = this.opts.intensity;
    this.withEllipseClip(panel, () => {
      ctx.fillStyle = '#04060a';
      ctx.fillRect(r.x, r.y, r.w, r.h);

      const cols = Math.max(10, Math.floor(r.w / px));
      const rows = Math.max(5, Math.floor(r.h / px));
      const cellW = r.w / cols;
      const cellH = r.h / rows;

      if (this.state === 'thinking') {
        // slow scanning bars
        const scan = ((t * 0.7) % 1) * cols;
        for (let x = 0; x < cols; x++) {
          for (let y = 0; y < rows; y++) {
            const d = Math.abs(x - scan);
            const on = d < 1.5 ? 0.9 : 0.08 + 0.05 * Math.sin(t + y);
            if (on < 0.1) continue;
            const c = pal.primary;
            ctx.fillStyle = `rgba(${c[0]},${c[1]},${c[2]},${on * inten})`;
            ctx.fillRect(r.x + x * cellW + 0.5, r.y + y * cellH + 0.5, cellW - 1, cellH - 1);
          }
        }
        return;
      }

      if (this.state === 'idle' || amp < 0.04) {
        // faint breathing line
        const mid = rows / 2;
        const breath = 0.35 + 0.25 * Math.sin(t * 1.4);
        for (let x = 0; x < cols; x++) {
          const wave = Math.sin(t * 1.2 + x * 0.35) * 0.4;
          const y = mid + wave;
          const yi = Math.floor(y);
          const c = pal.primary;
          ctx.fillStyle = `rgba(${c[0]},${c[1]},${c[2]},${0.35 * breath * inten})`;
          ctx.fillRect(r.x + x * cellW + 0.4, r.y + yi * cellH + 0.4, cellW - 0.8, cellH - 0.8);
        }
        return;
      }

      // speaking: Siri-like multi-band waveform shaped as lip band
      for (let x = 0; x < cols; x++) {
        const b = bands[Math.floor((x / cols) * bands.length)] || amp;
        const height = Math.max(0.15, Math.min(0.95, b * 1.35 + amp * 0.35));
        const openRows = Math.max(1, Math.floor(rows * height));
        const y0 = Math.floor((rows - openRows) / 2);
        for (let y = 0; y < rows; y++) {
          const inBand = y >= y0 && y < y0 + openRows;
          // particle scatter near crest
          const crest = Math.abs(y - (y0 + openRows / 2));
          let on = inBand ? 0.55 + 0.45 * (1 - crest / (openRows / 2 + 0.01)) : 0;
          // particle flicker
          if (inBand && Math.random() < 0.08 * amp) on = 1;
          if (on < 0.08) continue;
          const mix = crest < 1 ? pal.secondary : pal.primary;
          const a = on * inten;
          ctx.fillStyle = `rgba(${mix[0]},${mix[1]},${mix[2]},${a})`;
          const pad = 0.4;
          ctx.fillRect(r.x + x * cellW + pad, r.y + y * cellH + pad, cellW - pad * 2, cellH - pad * 2);
          if (on > 0.75) {
            const g = pal.glow;
            ctx.fillStyle = `rgba(${g[0]},${g[1]},${g[2]},${0.2 * inten})`;
            ctx.fillRect(r.x + x * cellW, r.y + y * cellH, cellW, cellH);
          }
        }
      }
    });
    // bloom
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const glow = pal.glow;
    const gr = ctx.createRadialGradient(r.cx, r.cy, 0, r.cx, r.cy, r.rx * 1.4);
    gr.addColorStop(0, `rgba(${glow[0]},${glow[1]},${glow[2]},${0.18 * inten * Math.max(0.2, amp)})`);
    gr.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = gr;
    ctx.beginPath();
    ctx.ellipse(r.cx, r.cy, r.rx * 1.3, r.ry * 1.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}
