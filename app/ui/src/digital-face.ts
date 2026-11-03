/** Cyberpunk digital eyes (LED grid) + mouth waveform, soft-masked to face panels. */

export type FaceState = 'idle' | 'talking' | 'thinking';
export type AvatarId = 'female' | 'male';

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

type Panel = { cx: number; cy: number; rx: number; ry: number };

/** Tight panels tuned to v1.2.2 digital bases (inside sockets/slit only). */
export const PANELS_BY_AVATAR: Record<AvatarId, { leftEye: Panel; rightEye: Panel; mouth: Panel }> = {
  female: {
    leftEye: { cx: 0.355, cy: 0.395, rx: 0.082, ry: 0.048 },
    rightEye: { cx: 0.645, cy: 0.395, rx: 0.082, ry: 0.048 },
    mouth: { cx: 0.5, cy: 0.675, rx: 0.092, ry: 0.0135 },
  },
  male: {
    leftEye: { cx: 0.355, cy: 0.392, rx: 0.08, ry: 0.045 },
    rightEye: { cx: 0.645, cy: 0.392, rx: 0.08, ry: 0.045 },
    mouth: { cx: 0.5, cy: 0.665, rx: 0.096, ry: 0.014 },
  },
};

export type DigitalFaceOpts = {
  intensity: number;
  pixelSize: number;
  eyeColorOverride?: string | null;
};

export class DigitalFace {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  wrap: HTMLElement;
  layer: HTMLCanvasElement;
  lctx: CanvasRenderingContext2D;
  mask: HTMLCanvasElement;
  mctx: CanvasRenderingContext2D;
  avatar: AvatarId = 'female';
  mood = 'neutral';
  state: FaceState = 'idle';
  opts: DigitalFaceOpts = { intensity: 0.9, pixelSize: 2 };
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
  blink = 0;
  nextBlink = 0;
  private running = false;
  private boot = 0; // 0..1 pixel turn-on reveal

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
    this.layer = document.createElement('canvas');
    this.lctx = this.layer.getContext('2d', { alpha: true })!;
    this.mask = document.createElement('canvas');
    this.mctx = this.mask.getContext('2d', { alpha: true })!;
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
      this.layer.width = w;
      this.layer.height = h;
      this.mask.width = w;
      this.mask.height = h;
    }
  }

  setOpts(o: Partial<DigitalFaceOpts>) {
    this.opts = { ...this.opts, ...o };
  }

  setAvatar(a: AvatarId) {
    this.avatar = a === 'male' ? 'male' : 'female';
    this.boot = 0;
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

  private panels() {
    return PANELS_BY_AVATAR[this.avatar] || PANELS_BY_AVATAR.female;
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
      const n = 24;
      const step = Math.floor(this.freq.length / n) || 1;
      for (let i = 0; i < n; i++) {
        let s = 0;
        for (let j = 0; j < step; j++) s += this.freq[i * step + j] || 0;
        bands.push(s / step / 255);
      }
      return { amp, bands };
    }
    this.synthLevel += (this.synthTarget - this.synthLevel) * 0.28;
    this.synthTarget *= 0.9;
    const t = (performance.now() - this.t0) / 1000;
    const wiggle = Math.abs(Math.sin(t * 18)) * this.synthLevel;
    const amp = Math.min(1, this.synthLevel * 0.9 + wiggle * 0.45);
    const bands = Array.from({ length: 24 }, (_, i) => {
      const mirror = 1 - Math.abs(i - 11.5) / 12;
      return amp * (0.35 + 0.65 * Math.abs(Math.sin(t * 10 + i * 0.55))) * (0.55 + 0.45 * mirror);
    });
    return { amp, bands };
  }

  private panelRect(p: Panel) {
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

  /** Soft almond/lens alpha mask via scaled radial gradient (works for flat ellipses). */
  private buildSoftMask(p: Panel, feather = 0.18) {
    const m = this.mctx;
    const r = this.panelRect(p);
    m.clearRect(0, 0, this.mask.width, this.mask.height);
    m.save();
    // Normalize ellipse to a unit circle so feathering is even on both axes
    m.translate(r.cx, r.cy);
    m.scale(Math.max(1, r.rx), Math.max(1, r.ry));
    const inner = Math.max(0.05, 1 - feather);
    const g = m.createRadialGradient(0, 0, inner, 0, 0, 1);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.78, 'rgba(255,255,255,0.98)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    m.fillStyle = g;
    m.beginPath();
    m.arc(0, 0, 1, 0, Math.PI * 2);
    m.fill();
    m.restore();
  }

  private withSoftPanel(p: Panel, feather: number, draw: (ctx: CanvasRenderingContext2D, r: ReturnType<DigitalFace['panelRect']>) => void) {
    const r = this.panelRect(p);
    const l = this.lctx;
    l.clearRect(0, 0, this.layer.width, this.layer.height);
    draw(l, r);
    // apply soft mask
    this.buildSoftMask(p, feather);
    l.globalCompositeOperation = 'destination-in';
    l.drawImage(this.mask, 0, 0);
    l.globalCompositeOperation = 'source-over';
    // composite onto main (normal alpha — no screen-bleed rectangles)
    this.ctx.drawImage(this.layer, 0, 0);
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
    this.boot = Math.min(1, this.boot + 0.018);

    if (now > this.nextBlink) {
      this.blink = 1;
      this.nextBlink = now + 2200 + Math.random() * 3500;
    }
    this.blink = Math.max(0, this.blink - 0.14);
    if (this.state === 'idle' && Math.random() < 0.004) {
      this.lookTargetX = (Math.random() - 0.5) * 0.65;
      this.lookTargetY = (Math.random() - 0.5) * 0.4;
    }
    this.lookX += (this.lookTargetX - this.lookX) * 0.06;
    this.lookY += (this.lookTargetY - this.lookY) * 0.06;

    const { amp, bands } = this.audioLevels();
    const pal = moodPalette(this.mood, this.opts.eyeColorOverride);
    // finer grid: base pixelSize 2, scale gently with canvas
    const px = Math.max(1.5, this.opts.pixelSize * (w / 420));
    const panels = this.panels();

    this.drawEye(panels.leftEye, t, pal, px, amp, -1);
    this.drawEye(panels.rightEye, t, pal, px, amp, 1);
    this.drawMouth(panels.mouth, t, pal, px, amp, bands);
  }

  private drawEye(panel: Panel, t: number, pal: MoodPalette, px: number, amp: number, side: number) {
    const inten = this.opts.intensity;
    this.withSoftPanel(panel, 0.30, (ctx, r) => {
      // dark recessed panel (only inside soft mask)
      ctx.fillStyle = '#020508';
      ctx.beginPath();
      ctx.ellipse(r.cx, r.cy, r.rx, r.ry, 0, 0, Math.PI * 2);
      ctx.fill();

      const cols = Math.max(10, Math.floor(r.w / px));
      const rows = Math.max(6, Math.floor(r.h / px));
      const cellW = r.w / cols;
      const cellH = r.h / rows;
      const pupilCx = cols * (0.5 + this.lookX * 0.16 * side);
      const pupilCy = rows * (0.5 + this.lookY * 0.18);
      const blinkRow = this.blink > 0 ? Math.floor(rows * (1 - this.blink)) : rows;

      // inner bloom halo (masked)
      const bloom = ctx.createRadialGradient(r.cx, r.cy, 0, r.cx, r.cy, r.rx);
      const gcol = pal.glow;
      bloom.addColorStop(0, `rgba(${gcol[0]},${gcol[1]},${gcol[2]},${0.28 * inten})`);
      bloom.addColorStop(0.55, `rgba(${gcol[0]},${gcol[1]},${gcol[2]},${0.08 * inten})`);
      bloom.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = bloom;
      ctx.fillRect(r.x, r.y, r.w, r.h);

      for (let y = 0; y < rows; y++) {
        if (y >= blinkRow) continue;
        for (let x = 0; x < cols; x++) {
          // ellipse occupancy (extra safety inside soft mask)
          const nx = (x + 0.5) / cols * 2 - 1;
          const ny = (y + 0.5) / rows * 2 - 1;
          if (nx * nx + ny * ny > 1.02) continue;

          // staggered pixel turn-on wave
          const reveal = this.boot * 1.35;
          const gate = (x / cols) * 0.55 + (y / rows) * 0.45;
          if (gate > reveal) continue;
          const turn = Math.min(1, (reveal - gate) * 4);

          const dx = x + 0.5 - pupilCx;
          const dy = y + 0.5 - pupilCy;
          const dist = Math.sqrt(dx * dx + dy * dy);
          let on = 0;
          const pat = pal.pattern;
          if (this.state === 'thinking' || pat === 'spinner') {
            const ang = Math.atan2(dy, dx);
            const spin = ((t * 3.2 + ang) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
            on = spin < 1.1 && dist < cols * 0.4 ? 1 : dist < cols * 0.11 ? 0.95 : 0.06 + 0.06 * Math.sin(t * 2 + x);
          } else if (pat === 'scan') {
            const scan = ((t * 2.4) % 1) * rows;
            on = Math.abs(y - scan) < 1.1 ? 1 : dist < cols * 0.16 ? 0.9 : 0.1;
          } else if (pat === 'flash') {
            on = (Math.sin(t * 22) > 0 ? 1 : 0.12) * (dist < cols * 0.42 ? 1 : 0.15);
          } else if (pat === 'pulse') {
            on = dist < cols * (0.14 + 0.1 * Math.abs(Math.sin(t * 5))) ? 1 : 0.08 + 0.1 * Math.sin(t * 8 + x * 0.4);
          } else if (pat === 'dim') {
            on = dist < cols * 0.13 ? 0.6 : 0.04 + 0.05 * Math.sin(t + x * 0.3);
          } else if (pat === 'waves') {
            on = 0.12 + 0.88 * Math.max(0, Math.sin(t * 3.2 + x * 0.5 + y * 0.35));
            if (dist < cols * 0.11) on = 1;
          } else {
            on = dist < cols * 0.13 ? 1 : 0.06 + 0.28 * (0.5 + 0.5 * Math.sin(t * 2.2 + x * 0.55 + y * 0.4));
            if (dist < cols * 0.26) on = Math.max(on, 0.5);
          }
          if (this.state === 'talking') on = Math.max(on, amp * 0.3);
          on *= inten * turn;
          if (on < 0.04) continue;
          const mix = dist < cols * 0.14 ? pal.secondary : pal.primary;
          const a = Math.min(1, on);
          const pad = Math.max(0.35, px * 0.1);
          ctx.fillStyle = `rgba(${mix[0]},${mix[1]},${mix[2]},${a})`;
          ctx.fillRect(r.x + x * cellW + pad, r.y + y * cellH + pad, cellW - pad * 2, cellH - pad * 2);
          if (on > 0.65) {
            const g = pal.glow;
            ctx.fillStyle = `rgba(${g[0]},${g[1]},${g[2]},${0.22 * a * inten})`;
            ctx.fillRect(r.x + x * cellW, r.y + y * cellH, cellW, cellH);
          }
        }
      }
    });
  }

  private drawMouth(panel: Panel, t: number, pal: MoodPalette, px: number, amp: number, bands: number[]) {
    const inten = this.opts.intensity;
    // flatter lens feather for mouth slit
    this.withSoftPanel(panel, 0.28, (ctx, r) => {
      ctx.fillStyle = '#010307';
      ctx.beginPath();
      ctx.ellipse(r.cx, r.cy, r.rx, r.ry, 0, 0, Math.PI * 2);
      ctx.fill();

      const cols = Math.max(16, Math.floor(r.w / px));
      const rows = Math.max(5, Math.floor(r.h / px));
      const cellW = r.w / cols;
      const cellH = r.h / rows;

      // subtle inner glow
      const glow = pal.glow;
      const gr = ctx.createRadialGradient(r.cx, r.cy, 0, r.cx, r.cy, r.rx);
      const glowAmp = this.state === 'talking' ? Math.max(0.25, amp) : 0.2;
      gr.addColorStop(0, `rgba(${glow[0]},${glow[1]},${glow[2]},${0.22 * inten * glowAmp})`);
      gr.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = gr;
      ctx.fillRect(r.x, r.y, r.w, r.h);

      const edgeFade = (x: number) => {
        const u = x / (cols - 1);
        // fade toward mouth corners
        return Math.pow(Math.sin(Math.PI * u), 1.15);
      };

      if (this.state === 'thinking') {
        const scan = ((t * 0.75) % 1) * cols;
        for (let x = 0; x < cols; x++) {
          const fade = edgeFade(x);
          for (let y = 0; y < rows; y++) {
            const nx = (x + 0.5) / cols * 2 - 1;
            const ny = (y + 0.5) / rows * 2 - 1;
            if (nx * nx + ny * ny > 1) continue;
            const d = Math.abs(x - scan);
            const on = (d < 1.6 ? 0.95 : 0.06 + 0.04 * Math.sin(t + y)) * fade;
            if (on < 0.08) continue;
            const c = pal.primary;
            ctx.fillStyle = `rgba(${c[0]},${c[1]},${c[2]},${on * inten})`;
            ctx.fillRect(r.x + x * cellW + 0.3, r.y + y * cellH + 0.3, cellW - 0.6, cellH - 0.6);
          }
        }
        return;
      }

      if (this.state === 'idle' || amp < 0.045) {
        const mid = (rows - 1) / 2;
        const breath = 0.4 + 0.25 * Math.sin(t * 1.35);
        for (let x = 0; x < cols; x++) {
          const fade = edgeFade(x);
          const wave = Math.sin(t * 1.25 + x * 0.4) * 0.55;
          const y = mid + wave;
          const yi = Math.round(y);
          if (yi < 0 || yi >= rows) continue;
          const nx = (x + 0.5) / cols * 2 - 1;
          const ny = (yi + 0.5) / rows * 2 - 1;
          if (nx * nx + ny * ny > 1) continue;
          const c = pal.primary;
          ctx.fillStyle = `rgba(${c[0]},${c[1]},${c[2]},${0.4 * breath * fade * inten})`;
          ctx.fillRect(r.x + x * cellW + 0.25, r.y + yi * cellH + 0.25, cellW - 0.5, cellH - 0.5);
        }
        return;
      }

      // speaking: symmetric vertical pixel columns (Siri-like), mouth-shaped
      for (let x = 0; x < cols; x++) {
        const fade = edgeFade(x);
        // mirror bands for left/right symmetry around center
        const bi = Math.floor((x / cols) * bands.length);
        const bj = bands.length - 1 - bi;
        const b = ((bands[bi] || 0) + (bands[bj] || 0)) * 0.5;
        const height = Math.max(0.35, Math.min(0.98, b * 1.55 + amp * 0.5));
        const openRows = Math.max(1, Math.round(rows * height * fade));
        const y0 = Math.floor((rows - openRows) / 2);
        for (let y = 0; y < rows; y++) {
          const nx = (x + 0.5) / cols * 2 - 1;
          const ny = (y + 0.5) / rows * 2 - 1;
          if (nx * nx + ny * ny > 1) continue;
          const inBand = y >= y0 && y < y0 + openRows;
          if (!inBand) continue;
          const crest = Math.abs(y - (y0 + openRows / 2));
          let on = 0.5 + 0.5 * (1 - crest / (openRows / 2 + 0.01));
          on *= fade;
          if (Math.random() < 0.06 * amp) on = 1;
          if (on < 0.07) continue;
          const mix = crest < 0.8 ? pal.secondary : pal.primary;
          ctx.fillStyle = `rgba(${mix[0]},${mix[1]},${mix[2]},${on * inten})`;
          const pad = 0.25;
          ctx.fillRect(r.x + x * cellW + pad, r.y + y * cellH + pad, cellW - pad * 2, cellH - pad * 2);
          if (on > 0.7) {
            ctx.fillStyle = `rgba(${glow[0]},${glow[1]},${glow[2]},${0.25 * inten})`;
            ctx.fillRect(r.x + x * cellW, r.y + y * cellH, cellW, cellH);
          }
        }
      }
    });
  }
}
