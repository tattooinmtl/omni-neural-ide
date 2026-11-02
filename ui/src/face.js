// Simple Three.js face with gross lip sync.
// Mouth opens based on TTS amplitude or a fallback timer.

import * as THREE from "https://esm.sh/three@0.160.0";

export function mountFace(container) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 10);
  camera.position.z = 2.2;

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setSize(160, 180);
  container.appendChild(renderer.domElement);

  const light = new THREE.DirectionalLight(0xffffff, 1.2);
  light.position.set(1, 1, 2);
  scene.add(light);
  scene.add(new THREE.AmbientLight(0x404040));

  // Head
  const headGeo = new THREE.SphereGeometry(0.7, 32, 32);
  const headMat = new THREE.MeshStandardMaterial({ color: 0xe8c4a0, roughness: 0.6 });
  const head = new THREE.Mesh(headGeo, headMat);
  scene.add(head);

  // Eyes
  const eyeGeo = new THREE.SphereGeometry(0.12, 16, 16);
  const eyeMat = new THREE.MeshStandardMaterial({ color: 0xffffff });
  const leftEye = new THREE.Mesh(eyeGeo, eyeMat);
  leftEye.position.set(-0.22, 0.12, 0.55);
  const rightEye = new THREE.Mesh(eyeGeo, eyeMat);
  rightEye.position.set(0.22, 0.12, 0.55);
  scene.add(leftEye, rightEye);

  const pupilGeo = new THREE.SphereGeometry(0.05, 12, 12);
  const pupilMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a });
  const leftPupil = new THREE.Mesh(pupilGeo, pupilMat);
  leftPupil.position.set(-0.22, 0.12, 0.65);
  const rightPupil = new THREE.Mesh(pupilGeo, pupilMat);
  rightPupil.position.set(0.22, 0.12, 0.65);
  scene.add(leftPupil, rightPupil);

  // Mouth (opens on Y scale)
  const mouthGeo = new THREE.SphereGeometry(0.18, 16, 16);
  const mouthMat = new THREE.MeshStandardMaterial({ color: 0x8b3a3a });
  const mouth = new THREE.Mesh(mouthGeo, mouthMat);
  mouth.position.set(0, -0.28, 0.52);
  mouth.scale.set(1, 0.3, 0.6);
  scene.add(mouth);

  // Brows
  const browGeo = new THREE.BoxGeometry(0.22, 0.03, 0.04);
  const browMat = new THREE.MeshStandardMaterial({ color: 0x3a2a1a });
  const leftBrow = new THREE.Mesh(browGeo, browMat);
  leftBrow.position.set(-0.22, 0.32, 0.55);
  const rightBrow = new THREE.Mesh(browGeo, browMat);
  rightBrow.position.set(0.22, 0.32, 0.55);
  scene.add(leftBrow, rightBrow);

  let targetMouth = 0.3;
  let currentMouth = 0.3;
  let emotion = "calm";

  function setEmotion(name) {
    emotion = name;
    const colors = {
      happy: 0xf0d0a0,
      joyful: 0xf0d0a0,
      sad: 0xc8b8a8,
      angry: 0xe8a090,
      annoyed: 0xe8a090,
      surprised: 0xf0d0a0,
      calm: 0xe8c4a0,
      tired: 0xd8c8b8,
      lonely: 0xd0c8c0,
    };
    headMat.color.setHex(colors[name] || 0xe8c4a0);
    const browY = {
      angry: 0.28,
      annoyed: 0.28,
      surprised: 0.36,
      sad: 0.34,
      happy: 0.33,
    }[name] || 0.32;
    leftBrow.position.y = browY;
    rightBrow.position.y = browY;
  }

  function openMouth(amount) {
    targetMouth = Math.max(0.15, Math.min(0.8, amount));
  }

  function speak(durationMs) {
    const start = performance.now();
    function step() {
      const t = (performance.now() - start) / durationMs;
      if (t >= 1) {
        openMouth(0.25);
        return;
      }
      const wave = Math.abs(Math.sin(t * 12));
      openMouth(0.2 + wave * 0.5);
      requestAnimationFrame(step);
    }
    step();
  }

  function animate() {
    requestAnimationFrame(animate);
    currentMouth += (targetMouth - currentMouth) * 0.25;
    mouth.scale.y = currentMouth;
    renderer.render(scene, camera);
  }
  animate();

  return { setEmotion, openMouth, speak, renderer };
}
