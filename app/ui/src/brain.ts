import * as THREE from 'three';

export class BrainView {
  root: HTMLElement;
  renderer!: THREE.WebGLRenderer;
  scene!: THREE.Scene;
  camera!: THREE.PerspectiveCamera;
  particles!: THREE.Points;
  links: THREE.LineSegments[] = [];
  raf = 0;
  perf = false;
  nodes: { mesh?: THREE.Mesh; pos: THREE.Vector3; kind: string; label: string }[] = [];

  static create(root: HTMLElement) {
    const b = new BrainView();
    b.root = root;
    root.classList.remove('brain-hidden');
    root.innerHTML = `
      <div class="brain-hud" id="brain-hud">BRAIN VIEW · mapping project neurons</div>
      <canvas id="brain-canvas"></canvas>
      <div class="brain-bar">
        <button id="brain-close">Close</button>
        <button id="brain-perf">Performance mode</button>
        <span id="brain-hw" style="color:#c9a227;margin-left:auto;font-size:12px"></span>
      </div>`;
    const canvas = root.querySelector('#brain-canvas') as HTMLCanvasElement;
    b.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    b.renderer.setClearColor(0x050308);
    b.scene = new THREE.Scene();
    b.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 200);
    b.camera.position.set(0, 0, 28);
    const light = new THREE.PointLight(0xffb000, 2, 80); light.position.set(5, 8, 10);
    b.scene.add(light, new THREE.AmbientLight(0x402000, 0.6));
    b.buildGraph();
    root.querySelector('#brain-close')?.addEventListener('click', () => b.hide());
    root.querySelector('#brain-perf')?.addEventListener('click', () => { b.perf = !b.perf; b.setHud(b.perf ? 'PERF MODE · reduced effects' : 'BRAIN VIEW'); });
    const hw = root.querySelector('#brain-hw')!;
    const mem = (performance as any).memory;
    hw.textContent = `CPU cores: ${navigator.hardwareConcurrency || '?'} · RAM est: ${mem ? Math.round(mem.jsHeapSizeLimit/1e6)+'MB' : 'n/a'} · GPU: WebGL`;
    const loop = () => { b.raf = requestAnimationFrame(loop); b.tick(); };
    b.resize(); window.addEventListener('resize', () => b.resize()); loop();
    return b;
  }

  buildGraph() {
    const kinds = [
      ...Array.from({length: 18}, (_,i)=>({kind:'file', label:`file_${i}`})),
      ...Array.from({length: 8}, (_,i)=>({kind:'skill', label:`skill_${i}`})),
      ...Array.from({length: 6}, (_,i)=>({kind:'tool', label:`tool_${i}`})),
      ...Array.from({length: 4}, (_,i)=>({kind:'mcp', label:`mcp_${i}`})),
    ];
    const colors: Record<string,number> = { file:0xf5b942, skill:0xff7a18, tool:0xffd27a, mcp:0xffeeaa };
    const positions: number[] = [];
    kinds.forEach((k, i) => {
      const phi = Math.acos(1 - 2 * (i+0.5)/kinds.length);
      const theta = Math.PI * (1 + 5**0.5) * i;
      const r = 10 + (k.kind==='file'?0:k.kind==='skill'?2:4);
      const pos = new THREE.Vector3(
        r * Math.sin(phi) * Math.cos(theta),
        r * Math.sin(phi) * Math.sin(theta),
        r * Math.cos(phi),
      );
      this.nodes.push({ pos, kind: k.kind, label: k.label });
      positions.push(pos.x, pos.y, pos.z);
      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(k.kind==='file'?0.18:0.28, 12, 12),
        new THREE.MeshStandardMaterial({ color: colors[k.kind], emissive: colors[k.kind], emissiveIntensity: 0.55 }),
      );
      mesh.position.copy(pos);
      this.scene.add(mesh);
    });
    // particle field
    const N = 1200;
    const ppos = new Float32Array(N*3);
    for (let i=0;i<N;i++) {
      ppos[i*3]=(Math.random()-0.5)*40;
      ppos[i*3+1]=(Math.random()-0.5)*40;
      ppos[i*3+2]=(Math.random()-0.5)*40;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(ppos, 3));
    this.particles = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xffb000, size: 0.05, transparent: true, opacity: 0.7 }));
    this.scene.add(this.particles);
    // links
    const linkPos: number[] = [];
    for (let i=0;i<this.nodes.length;i++) {
      for (let j=i+1;j<this.nodes.length;j++) {
        if (this.nodes[i].pos.distanceTo(this.nodes[j].pos) < 5.5) {
          linkPos.push(...this.nodes[i].pos.toArray(), ...this.nodes[j].pos.toArray());
        }
      }
    }
    const lgeo = new THREE.BufferGeometry();
    lgeo.setAttribute('position', new THREE.Float32BufferAttribute(linkPos, 3));
    const lines = new THREE.LineSegments(lgeo, new THREE.LineBasicMaterial({ color: 0xaa7000, transparent: true, opacity: 0.35 }));
    this.scene.add(lines); this.links.push(lines);
  }

  tick() {
    const t = performance.now()/1000;
    this.camera.position.x = Math.sin(t*0.15)*28;
    this.camera.position.z = Math.cos(t*0.15)*28;
    this.camera.lookAt(0,0,0);
    if (!this.perf) this.particles.rotation.y = t*0.05;
    this.renderer.render(this.scene, this.camera);
  }
  resize() {
    const c = this.root.querySelector('#brain-canvas') as HTMLCanvasElement;
    const w = this.root.clientWidth, h = this.root.clientHeight - 40;
    this.renderer.setSize(w,h,false); this.camera.aspect=w/h; this.camera.updateProjectionMatrix();
  }
  setHud(s: string) { const el=this.root.querySelector('#brain-hud'); if(el) el.textContent=s; }
  show() { this.root.classList.remove('brain-hidden'); this.resize(); }
  hide() { this.root.classList.add('brain-hidden'); }
}
