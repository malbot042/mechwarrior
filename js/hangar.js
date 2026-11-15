// Escena 3D del hangar: plataforma giratoria, pórtico, focos y el mech en exposición.
import * as THREE from 'three';
import { buildMech } from './models.js';

function stripes() {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 8;
  const g = c.getContext('2d');
  g.fillStyle = '#1a1814'; g.fillRect(0, 0, 64, 8);
  g.fillStyle = '#c8a020';
  for (let x = -8; x < 64; x += 16) { g.beginPath(); g.moveTo(x, 8); g.lineTo(x + 8, 0); g.lineTo(x + 16, 0); g.lineTo(x + 8, 8); g.fill(); }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  t.repeat.set(10, 1);
  return t;
}

export function buildHangar() {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x07090a);
  scene.fog = new THREE.Fog(0x07090a, 40, 110);
  const camera = new THREE.PerspectiveCamera(42, 16 / 9, 0.5, 300);

  scene.add(new THREE.HemisphereLight(0x90a0b0, 0x302418, 1.4));
  const key = new THREE.SpotLight(0xffe0b0, 900, 90, 0.45, 0.5, 1.6);
  key.position.set(14, 34, 18);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  scene.add(key, key.target);
  const rim = new THREE.SpotLight(0x60a0ff, 500, 80, 0.5, 0.6, 1.6);
  rim.position.set(-18, 22, -20);
  scene.add(rim, rim.target);
  const warm = new THREE.PointLight(0xff7020, 60, 40, 2);
  warm.position.set(0, 3, 14);
  scene.add(warm);

  const mat = (c) => new THREE.MeshLambertMaterial({ color: c, flatShading: true });
  // suelo
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), mat(0x24272a));
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);
  const grid = new THREE.GridHelper(200, 50, 0x3a4a40, 0x2a3230);
  grid.position.y = 0.02;
  scene.add(grid);

  // plataforma giratoria
  const turntable = new THREE.Group();
  scene.add(turntable);
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(9, 9.6, 0.8, 32), mat(0x34383a));
  disc.position.y = 0.4; disc.receiveShadow = true;
  turntable.add(disc);
  const ring = new THREE.Mesh(new THREE.CylinderGeometry(9.62, 9.62, 0.35, 48, 1, true),
    new THREE.MeshLambertMaterial({ map: stripes(), side: THREE.DoubleSide }));
  ring.position.y = 0.6;
  scene.add(ring);
  const lamps = [];
  for (let i = 0; i < 12; i++) {
    const a = i / 12 * Math.PI * 2;
    const l = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.15, 0.5), new THREE.MeshBasicMaterial({ color: 0x40ff80 }));
    l.position.set(Math.sin(a) * 10.2, 0.1, Math.cos(a) * 10.2);
    scene.add(l); lamps.push(l);
  }

  // pórtico de mantenimiento detrás
  const gantry = new THREE.Group();
  gantry.position.z = -14;
  scene.add(gantry);
  for (const x of [-12, 12]) {
    const col = new THREE.Mesh(new THREE.BoxGeometry(1.4, 26, 1.4), mat(0x3a3530));
    col.position.set(x, 13, 0); col.castShadow = true; gantry.add(col);
    for (let y = 4; y < 26; y += 5) {
      const brace = new THREE.Mesh(new THREE.BoxGeometry(0.3, 3.6, 0.3), mat(0x2a2622));
      brace.position.set(x + (x < 0 ? 1.2 : -1.2), y, 0); brace.rotation.z = 0.6; gantry.add(brace);
    }
  }
  const beam = new THREE.Mesh(new THREE.BoxGeometry(26, 1.6, 1.8), mat(0x3a3530));
  beam.position.y = 25; gantry.add(beam);
  const crane = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.4, 2.4), mat(0xb08a20));
  crane.position.set(0, 23.6, 0); gantry.add(crane);
  const cable = new THREE.Mesh(new THREE.BoxGeometry(0.1, 8, 0.1), mat(0x111111));
  cable.position.set(0, 19, 0); gantry.add(cable);
  // pared del fondo con paneles
  const wall = new THREE.Mesh(new THREE.BoxGeometry(120, 40, 1), mat(0x1c1f22));
  wall.position.set(0, 20, -30); scene.add(wall);
  for (let i = -5; i <= 5; i++) {
    const p = new THREE.Mesh(new THREE.BoxGeometry(8, 3, 0.4), new THREE.MeshBasicMaterial({ color: i % 2 ? 0x102018 : 0x182a20 }));
    p.position.set(i * 10, 30, -29.4); scene.add(p);
  }
  // cajas y contenedores
  for (const [x, z, w, h, d, c] of [[-20, -6, 6, 4, 4, 0x5a4a30], [-20, -6, 4, 3, 3, 0x4a5a40], [21, 2, 5, 5, 8, 0x3a4a5a], [17, -10, 3, 3, 3, 0x6a3a28]]) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(c));
    b.position.set(x, h / 2 + (x === -20 && w === 4 ? 4 : 0), z);
    b.castShadow = true; b.receiveShadow = true;
    scene.add(b);
  }

  let model = null;
  function setMech(colors, loadout, scale) {
    if (model) {
      turntable.remove(model.root);
      model.root.traverse(o => { if (o.geometry) o.geometry.dispose(); });
      for (const m of model.mats) m.dispose();
    }
    model = buildMech(colors, { loadout, scale });
    model.root.position.y = 0.8;
    model.root.traverse(o => { if (o.isMesh) o.castShadow = true; });
    turntable.add(model.root);
    return model;
  }

  let t = 0;
  function update(dt, aspect, scale = 1) {
    t += dt;
    turntable.rotation.y += dt * 0.35;
    // distancia de cámara según tamaño del chasis
    const d = 26 * scale + 6;
    const a = Math.sin(t * 0.15) * 0.35 + 0.5;
    camera.position.set(Math.sin(a) * d, 7 + 5 * scale, Math.cos(a) * d);
    // el mech queda algo a la izquierda del centro para dejar sitio a los paneles
    const look = new THREE.Vector3(0, 6.5 * scale, 0);
    camera.lookAt(look);
    camera.aspect = aspect;
    camera.updateProjectionMatrix();
    key.target.position.set(0, 5, 0);
    rim.target.position.set(0, 6, 0);
    lamps.forEach((l, i) => l.material.color.setHex(Math.floor(t * 6) % 12 === i ? 0xffffff : 0x30c060));
  }

  return { scene, camera, setMech, update };
}
