import * as THREE from "three";

const COLORS = {
  projects: 0x7aa2ff,
  files: 0x3ddc97,
  tools: 0x2ee6d6,
  skills: 0xc084fc,
  mcps: 0xf0a202,
  hooks: 0xff6b8a,
  workers: 0xe8e6d8,
};

const TYPES = ["projects", "files", "tools", "skills", "mcps", "hooks", "workers"];

function layout(typeIndex, index) {
  const ring = 1.8 + typeIndex * 0.95;
  const angle = index * 0.9 + typeIndex * 0.55;
  const y = Math.sin(typeIndex * 1.4 + index) * 1.15;
  return new THREE.Vector3(Math.cos(angle) * ring, y, Math.sin(angle) * ring * 0.7);
}

function labelSprite(text) {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#d5deea";
  ctx.font = "24px Segoe UI";
  ctx.textAlign = "center";
  ctx.fillText(text.slice(0, 24), 128, 40);
  const material = new THREE.SpriteMaterial({
    map: new THREE.CanvasTexture(canvas),
    transparent: true,
    depthWrite: false,
  });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(1.7, 0.42, 1);
  sprite.position.y = -0.42;
  return sprite;
}

export function nodesFrom(state) {
  const toggles = state.settings?.node_toggles ?? {};
  const nodes = [];
  const push = (type, label) => {
    if (toggles[type] === false) return;
    const index = nodes.filter((node) => node.type === type).length;
    nodes.push({
      type,
      label,
      color: COLORS[type],
      home: layout(TYPES.indexOf(type), index),
      radius: type === "workers" || type === "projects" ? 0.26 : 0.16,
    });
  };
  push("projects", "workspace");
  for (const file of (state.files ?? []).slice(0, 8)) push("files", file.split("/").pop());
  for (const name of Object.keys(state.registry?.tools ?? {})) push("tools", name);
  for (const name of Object.keys(state.registry?.skills ?? {})) push("skills", name);
  for (const name of Object.keys(state.registry?.mcps ?? {})) push("mcps", name);
  for (const name of Object.keys(state.registry?.hooks ?? {})) push("hooks", name);
  push("workers", "scribe");
  return nodes;
}

export function mountGraph(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setClearColor(0x000000, 0);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(48, 1, 0.1, 80);
  camera.position.set(0, 1.6, 10);
  scene.add(new THREE.AmbientLight(0x9eb0c8, 0.7));
  const key = new THREE.PointLight(0xffb020, 20, 40);
  key.position.set(3, 5, 6);
  scene.add(key);

  const group = new THREE.Group();
  scene.add(group);
  const links = [];
  const pulses = [];
  let neurons = [];
  let running = true;
  let animateOn = true;
  let particlesOn = true;
  let pixelCap = 1.5;
  let maxPulses = 24;

  function clearGroup() {
    while (group.children.length) {
      const child = group.children.pop();
      dispose(child);
    }
  }

  function dispose(object) {
    object.geometry?.dispose();
    const material = object.material;
    if (Array.isArray(material)) material.forEach((item) => item.dispose());
    else material?.dispose();
    object.children?.forEach(dispose);
  }

  function rebuild(nodes) {
    clearGroup();
    links.length = 0;
    neurons = nodes.map((node, index) => {
      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(node.radius, 22, 16),
        new THREE.MeshStandardMaterial({
          color: node.color,
          emissive: node.color,
          emissiveIntensity: 0.28,
          roughness: 0.42,
          metalness: 0.2,
        }),
      );
      mesh.position.copy(node.home);
      mesh.userData = { home: node.home.clone(), phase: index };
      mesh.add(labelSprite(node.label));
      group.add(mesh);
      return mesh;
    });
    for (let index = 0; index < neurons.length; index += 1) {
      const from = neurons[index].userData.home;
      const to = neurons[(index + 2) % neurons.length]?.userData.home;
      if (!to || from === to) continue;
      const points = curve(from, to).getPoints(16);
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(points),
        new THREE.LineBasicMaterial({ color: 0x355066, transparent: true, opacity: 0.7 }),
      );
      group.add(line);
      links.push({ from, to });
    }
  }

  function curve(from, to) {
    const mid = from.clone().add(to).multiplyScalar(0.5);
    mid.y += 0.55;
    return new THREE.QuadraticBezierCurve3(from, mid, to);
  }

  function pulse() {
    if (!particlesOn || links.length === 0 || pulses.length >= maxPulses) return;
    const link = links[Math.floor(Math.random() * links.length)];
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.055, 8, 8),
      new THREE.MeshBasicMaterial({ color: 0xffb020 }),
    );
    group.add(mesh);
    pulses.push({ mesh, link, t: 0 });
    const neuron = neurons[Math.floor(Math.random() * neurons.length)];
    if (neuron) neuron.material.emissiveIntensity = 1.5;
  }

  function resize() {
    const width = canvas.clientWidth || window.innerWidth;
    const height = canvas.clientHeight || window.innerHeight;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, pixelCap));
    renderer.setSize(width, height, false);
    camera.aspect = width / Math.max(height, 1);
    camera.updateProjectionMatrix();
  }

  let last = performance.now();
  function frame(now) {
    if (!running) return;
    requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (animateOn) {
      const t = now / 1000;
      group.rotation.y = t * 0.04;
      for (const neuron of neurons) {
        const home = neuron.userData.home;
        neuron.position.x = home.x + Math.sin(t * 0.7 + neuron.userData.phase) * 0.07;
        neuron.position.y = home.y + Math.cos(t * 0.55 + neuron.userData.phase) * 0.07;
        neuron.material.emissiveIntensity += (0.28 - neuron.material.emissiveIntensity) * 0.04;
      }
      for (const item of pulses) {
        item.t += dt * 0.45;
        item.mesh.position.copy(curve(item.link.from, item.link.to).getPoint(Math.min(item.t, 1)));
      }
    }
    for (let index = pulses.length - 1; index >= 0; index -= 1) {
      if (pulses[index].t < 1) continue;
      group.remove(pulses[index].mesh);
      dispose(pulses[index].mesh);
      pulses.splice(index, 1);
    }
    renderer.render(scene, camera);
  }

  resize();
  requestAnimationFrame(frame);
  return {
    rebuild,
    pulse,
    resize,
    configure(settings) {
      animateOn = settings.animation_enabled !== false;
      particlesOn = settings.particles !== false;
      const mode = settings.performance_mode;
      pixelCap = mode === "low" ? 1 : mode === "high" ? 2 : 1.5;
      maxPulses = mode === "low" ? 8 : mode === "high" ? 48 : 24;
      resize();
    },
  };
}
