// Terreno, cielo, iluminación y obstáculos (edificios destructibles).
import * as THREE from 'three';

export const WORLD = 800;           // lado del mapa
export const BOUND = WORLD / 2 - 30; // límite jugable

export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function heightAt(x, z) {
  let h = Math.sin(x * 0.011 + 0.5) * Math.cos(z * 0.013) * 9
        + Math.sin(x * 0.027 + 1.3) * Math.sin(z * 0.031 + 0.7) * 3.5
        + Math.sin((x - z) * 0.0055) * 12
        + Math.cos(z * 0.06 + x * 0.02) * 1.2;
  const d = Math.hypot(x, z);
  h *= 0.25 + 0.75 * Math.min(1, d / 120);
  const e = Math.max(Math.abs(x), Math.abs(z));
  const edge = WORLD * 0.42;
  if (e > edge) h += Math.pow((e - edge) / (WORLD * 0.08), 2) * 45;
  return h;
}

function facadeTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, 64, 64);
  const r = mulberry32(7);
  for (let y = 4; y < 64; y += 10) for (let x = 3; x < 64; x += 8) {
    if (r() < 0.22) { g.fillStyle = r() < 0.5 ? '#ffcf70' : '#ff9a40'; g.fillRect(x, y, 4, 5); }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.NearestFilter;
  return t;
}

export function buildWorld(scene) {
  const rand = mulberry32(1337);

  // --- cielo (cúpula con degradado; sigue a la cámara) ---
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(900, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: {
        top: { value: new THREE.Color(0x141428) },
        mid: { value: new THREE.Color(0x6a3c30) },
        hor: { value: new THREE.Color(0xd08048) },
        sunDir: { value: new THREE.Vector3(-0.55, 0.18, -0.8).normalize() },
      },
      vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
      fragmentShader: `uniform vec3 top, mid, hor, sunDir; varying vec3 vP;
        void main(){ vec3 d = normalize(vP); float h = d.y;
          vec3 c = h > 0.12 ? mix(mid, top, smoothstep(0.12, 0.7, h)) : mix(hor, mid, smoothstep(-0.05, 0.12, h));
          float s = max(dot(d, sunDir), 0.0);
          c += vec3(1.0, 0.6, 0.3) * (pow(s, 600.0) * 3.0 + pow(s, 8.0) * 0.25);
          gl_FragColor = vec4(c, 1.0); }`,
    })
  );
  sky.renderOrder = -10;
  scene.add(sky);
  scene.fog = new THREE.Fog(0x8a5238, 140, 700);

  // --- luces ---
  scene.add(new THREE.HemisphereLight(0xb8a0b0, 0x3a2418, 1.1));
  const sun = new THREE.DirectionalLight(0xffc890, 2.2);
  sun.position.set(-110, 90, -160);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = -130; sc.right = 130; sc.top = 130; sc.bottom = -130; sc.near = 10; sc.far = 500;
  sun.shadow.bias = -0.0008;
  scene.add(sun, sun.target);
  const sunOffset = sun.position.clone();

  // --- terreno ---
  const seg = 160;
  const geo = new THREE.PlaneGeometry(WORLD, WORLD, seg, seg);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const cLow = new THREE.Color(0x4a3022), cHigh = new THREE.Color(0x9a7650), cRock = new THREE.Color(0x5e564c), tmp = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const y = heightAt(x, z);
    pos.setY(i, y);
    const t = THREE.MathUtils.clamp((y + 18) / 45, 0, 1);
    tmp.copy(cLow).lerp(cHigh, t);
    if (y > 30) tmp.lerp(cRock, Math.min(1, (y - 30) / 20));
    const patch = Math.sin(x * 0.045 + Math.sin(z * 0.03) * 2) * Math.cos(z * 0.05 + Math.sin(x * 0.02) * 2);
    const v = 0.82 + patch * 0.16 + rand() * 0.14;
    colors[i * 3] = tmp.r * v; colors[i * 3 + 1] = tmp.g * v; colors[i * 3 + 2] = tmp.b * v;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const terrain = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
  terrain.receiveShadow = true;
  scene.add(terrain);

  // --- rocas decorativas ---
  const rockGeo = new THREE.IcosahedronGeometry(1, 0);
  const rockMat = new THREE.MeshLambertMaterial({ color: 0x5a4a3e, flatShading: true });
  for (let i = 0; i < 160; i++) {
    const x = (rand() - 0.5) * WORLD * 0.85, z = (rand() - 0.5) * WORLD * 0.85;
    const r = 0.8 + rand() * rand() * 4;
    const m = new THREE.Mesh(rockGeo, rockMat);
    m.position.set(x, heightAt(x, z) + r * 0.2, z);
    m.scale.set(r * (0.8 + rand() * 0.6), r * (0.5 + rand() * 0.5), r * (0.8 + rand() * 0.6));
    m.rotation.set(rand() * 3, rand() * 3, rand() * 3);
    m.castShadow = true; m.receiveShadow = true;
    scene.add(m);
  }

  // --- edificios / instalaciones (obstáculos destructibles) ---
  const obstacles = [];
  const facade = facadeTexture();
  const clusters = [[70, -150], [-190, 70], [160, 180], [-100, -240], [260, -40], [-260, -120], [20, 260]];
  const palette = [0x6a665e, 0x5a5650, 0x7a6e60, 0x4e5254, 0x6e5c4c];
  for (const [cx, cz] of clusters) {
    const n = 4 + Math.floor(rand() * 5);
    for (let i = 0; i < n; i++) {
      const x = cx + (rand() - 0.5) * 70, z = cz + (rand() - 0.5) * 70;
      if (obstacles.some(o => Math.hypot(o.cx - x, o.cz - z) < 18)) continue;
      const tower = rand() < 0.18;
      const w = tower ? 7 : 8 + rand() * 14, d = tower ? 7 : 8 + rand() * 14, h = tower ? 26 + rand() * 14 : 6 + rand() * 16;
      const y0 = Math.min(heightAt(x - w / 2, z - d / 2), heightAt(x + w / 2, z + d / 2), heightAt(x, z)) - 1.5;
      const tex = facade.clone();
      tex.repeat.set(Math.max(1, Math.round(w / 8)), Math.max(1, Math.round(h / 8)));
      tex.needsUpdate = true;
      const mat = new THREE.MeshLambertMaterial({
        color: palette[Math.floor(rand() * palette.length)], flatShading: true,
        emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.9,
      });
      const g = tower ? new THREE.CylinderGeometry(w / 2, w / 2 + 1, h, 8) : new THREE.BoxGeometry(w, h, d);
      const m = new THREE.Mesh(g, mat);
      m.position.set(x, y0 + h / 2, z);
      m.castShadow = true; m.receiveShadow = true;
      scene.add(m);
      // tejado / detalle
      if (!tower && rand() < 0.6) {
        const r = new THREE.Mesh(new THREE.BoxGeometry(w * 0.3, 2, d * 0.3), new THREE.MeshLambertMaterial({ color: 0x3a3632, flatShading: true }));
        r.position.set((rand() - 0.5) * w * 0.4, h / 2 + 1, (rand() - 0.5) * d * 0.4);
        r.castShadow = true;
        m.add(r);
      }
      const box = new THREE.Box3().setFromObject(m);
      obstacles.push({ mesh: m, box, cx: x, cz: z, hp: 20 + w * d * h * 0.012, alive: true, h, y0 });
    }
  }

  return {
    terrain, obstacles, sky, sun,
    update(focus, camera) {
      sky.position.copy(camera.position);
      sun.position.copy(focus).add(sunOffset);
      sun.target.position.copy(focus);
    },
  };
}
