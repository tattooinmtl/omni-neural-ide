import * as THREE from 'three';
import { moodColor, MOODS } from './moods';

/** Floating always-on assistant with Three.js face + gross lip sync */
export class FloatingAssistant {
  root!: HTMLElement;
  renderer!: THREE.WebGLRenderer;
  scene!: THREE.Scene;
  camera!: THREE.PerspectiveCamera;
  head!: THREE.Mesh;
  mouth!: THREE.Mesh;
  leftEye!: THREE.Mesh;
  rightEye!: THREE.Mesh;
  talking = false;
  mood = 'neutral';
  raf = 0;
  t0 = performance.now();

  static create(root: HTMLElement) {
    const a = new FloatingAssistant();
    a.root = root;
    root.classList.remove('assistant-hidden');
    root.innerHTML = `
      <div class="asst-bar" id="asst-drag"><span>OMNI Assistant</span><button id="asst-close">✕</button></div>
      <canvas id="assistant-canvas"></canvas>
      <div class="asst-status" id="asst-status">Ready · neutral</div>
    `;
    const canvas = root.querySelector('#assistant-canvas') as HTMLCanvasElement;
    a.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    a.renderer.setClearColor(0x041018, 1);
    a.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    a.scene = new THREE.Scene();
    a.camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
    a.camera.position.set(0, 0.05, 3.1);

    const amb = new THREE.AmbientLight(0x336688, 0.7);
    const key = new THREE.DirectionalLight(0x88ddff, 1.1);
    key.position.set(2, 2, 3);
    a.scene.add(amb, key);

    const headMat = new THREE.MeshStandardMaterial({
      color: 0x1a3040, metalness: 0.35, roughness: 0.45, emissive: 0x0a2030, emissiveIntensity: 0.4,
    });
    a.head = new THREE.Mesh(new THREE.SphereGeometry(0.9, 48, 48), headMat);
    a.scene.add(a.head);

    const eyeMat = new THREE.MeshStandardMaterial({ color: 0x22d3ee, emissive: 0x1188aa, emissiveIntensity: 0.8 });
    a.leftEye = new THREE.Mesh(new THREE.SphereGeometry(0.12, 16, 16), eyeMat);
    a.rightEye = new THREE.Mesh(new THREE.SphereGeometry(0.12, 16, 16), eyeMat);
    a.leftEye.position.set(-0.28, 0.18, 0.78);
    a.rightEye.position.set(0.28, 0.18, 0.78);
    a.head.add(a.leftEye, a.rightEye);

    const mouthMat = new THREE.MeshStandardMaterial({ color: 0x0a1520, emissive: 0x22d3ee, emissiveIntensity: 0.2 });
    a.mouth = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.06, 0.08), mouthMat);
    a.mouth.position.set(0, -0.28, 0.82);
    a.head.add(a.mouth);

    root.querySelector('#asst-close')?.addEventListener('click', () => a.hide());
    makeDraggable(root, root.querySelector('#asst-drag') as HTMLElement);
    a.resize();
    window.addEventListener('resize', () => a.resize());
    const loop = () => {
      a.raf = requestAnimationFrame(loop);
      a.tick();
    };
    loop();
    return a;
  }

  resize() {
    const canvas = this.root.querySelector('#assistant-canvas') as HTMLCanvasElement;
    const w = canvas.clientWidth || 220;
    const h = canvas.clientHeight || 220;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  tick() {
    const t = (performance.now() - this.t0) / 1000;
    this.head.rotation.y = Math.sin(t * 0.6) * 0.12;
    this.head.rotation.x = Math.sin(t * 0.4) * 0.05;
    if (this.talking) {
      const open = 0.06 + Math.abs(Math.sin(t * 14)) * 0.22;
      this.mouth.scale.y = open / 0.06;
      (this.mouth.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.6 + open;
    } else {
      this.mouth.scale.y = 1;
      (this.mouth.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.15;
    }
    if (Math.sin(t * 2.1) > 0.97) {
      this.leftEye.scale.y = 0.15;
      this.rightEye.scale.y = 0.15;
    } else {
      this.leftEye.scale.y = 1;
      this.rightEye.scale.y = 1;
    }
    this.renderer.render(this.scene, this.camera);
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

  setMood(mood: string) {
    this.mood = MOODS.includes(mood as any) ? mood : 'neutral';
    (this.head.material as THREE.MeshStandardMaterial).color.setHex(moodColor[this.mood] || moodColor.neutral);
    this.setStatus(`Ready · ${this.mood}`);
  }

  setStatus(s: string) {
    const el = this.root.querySelector('#asst-status');
    if (el) el.textContent = s;
  }

  show() { this.root.classList.remove('assistant-hidden'); this.resize(); }
  hide() { this.root.classList.add('assistant-hidden'); }
  greet() {
    this.speak('Hello. OMNI assistant online.');
    this.setMood('happy');
    setTimeout(() => this.setMood('neutral'), 2500);
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
