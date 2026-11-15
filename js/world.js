// Mundo: zonas (terreno, ríos, bosques, edificios) y hora del día (cielo, luces, niebla).
import * as THREE from 'three';

export const WORLD = 800;            // lado del mapa
export const BOUND = WORLD / 2 - 30; // límite jugable

export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ------------------------------------------------------------------ catálogo
export const ZONES = {
  desierto: {
    name: 'DESIERTO ROJO', desc: 'dunas, ruinas industriales', seed: 1337, ph: 0, base: 0, waterY: null, rivers: [],
    forest: 0.12, treeTypes: ['dead'], low: 0x4a3022, high: 0x9a7650, rock: 0x5e564c, sand: 0x9a7650, clusters: 7, rocks: 160,
  },
  valle: {
    name: 'VALLE FLUVIAL', desc: 'ríos, lagos y arboledas', seed: 4242, ph: 2.1, base: 6, waterY: -12,
    rivers: [{ a: 0.35, off: -60, amp: 55, freq: 0.008, ph: 1.0, w: 10 }, { a: 1.95, off: 110, amp: 40, freq: 0.011, ph: 2.2, w: 7 }],
    forest: 0.45, treeTypes: ['pine', 'round'], low: 0x3c4a26, high: 0x7a7448, rock: 0x6a665e, sand: 0x8a7c5a, clusters: 5, rocks: 110,
  },
  bosque: {
    name: 'BOSQUE BOREAL', desc: 'bosque denso, un río', seed: 777, ph: 4.3, base: 5, waterY: -13,
    rivers: [{ a: -0.5, off: 40, amp: 70, freq: 0.009, ph: 0.4, w: 9 }],
    forest: 0.78, treeTypes: ['pine'], low: 0x26341f, high: 0x505a3a, rock: 0x55585a, sand: 0x5e5842, clusters: 3, rocks: 120,
  },
};

export const TIMES = {
  day: {
    name: 'DÍA', top: 0x1e4a8a, mid: 0x5a8ac0, hor: 0xc4d4dc, sunDir: [0.35, 0.75, -0.45], sunCol: 0xfff4e0, sunI: 2.8, disk: 1,
    hemiSky: 0xc0d4ec, hemiGround: 0x4a4030, hemiI: 1.3, fog: 0xa4b6c6, fogNear: 180, fogFar: 800, windows: 0.08, water: 0x2a5a78,
  },
  dusk: {
    name: 'ATARDECER', top: 0x141428, mid: 0x6a3c30, hor: 0xd08048, sunDir: [-0.55, 0.18, -0.8], sunCol: 0xffc890, sunI: 2.2, disk: 1,
    hemiSky: 0xb8a0b0, hemiGround: 0x3a2418, hemiI: 1.1, fog: 0x8a5238, fogNear: 140, fogFar: 700, windows: 0.9, water: 0x4a3a44,
  },
  night: {
    name: 'NOCHE', top: 0x010208, mid: 0x03060f, hor: 0x0a1222, sunDir: [0.4, 0.45, -0.6], sunCol: 0x7080b0, sunI: 0.5, disk: 0.35,
    hemiSky: 0x2a3a60, hemiGround: 0x060606, hemiI: 0.3, fog: 0x05080f, fogNear: 40, fogFar: 380, windows: 1.6, water: 0x081420,
    stars: true, headlights: true,
  },
};

// valores de "calor" (0..1) para la visión térmica
export const HEAT = { terrain: 0.3, water: 0.1, tree: 0.38, rock: 0.26, building: 0.42, ruin: 0.75 };

// ------------------------------------------------------------------ altura
let Z = ZONES.desierto;

function riverDist(x, z, r) {
  const c = Math.cos(r.a), s = Math.sin(r.a);
  const u = x * c + z * s, v = -x * s + z * c;
  const vc = r.off + r.amp * Math.sin(u * r.freq + r.ph) + r.amp * 0.4 * Math.sin(u * r.freq * 2.3 + r.ph * 1.7);
  return Math.abs(v - vc);
}

export function heightAt(x, z) {
  const p = Z.ph;
  let h = Math.sin(x * 0.011 + 0.5 + p) * Math.cos(z * 0.013 - p) * 9
        + Math.sin(x * 0.027 + 1.3 + p * 2) * Math.sin(z * 0.031 + 0.7) * 3.5
        + Math.sin((x - z) * 0.0055 + p) * 12
        + Math.cos(z * 0.06 + x * 0.02) * 1.2;
  const d = Math.hypot(x, z);
  h = h * (0.25 + 0.75 * Math.min(1, d / 120)) + Z.base;
  for (const r of Z.rivers) {
    const rd = riverDist(x, z, r);
    if (rd < r.w + 70) {
      const t = THREE.MathUtils.smoothstep(rd, r.w, r.w + 70);
      h = THREE.MathUtils.lerp(Z.waterY - 3.2, h, t);
    }
  }
  const e = Math.max(Math.abs(x), Math.abs(z));
  const edge = WORLD * 0.42;
  if (e > edge) h += Math.pow((e - edge) / (WORLD * 0.08), 2) * 45;
  return h;
}

export const waterLevel = () => (Z.waterY ?? -Infinity);

// ------------------------------------------------------------------ texturas
function facadeTexture(seed) {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, 64, 64);
  const r = mulberry32(seed);
  for (let y = 4; y < 64; y += 10) for (let x = 3; x < 64; x += 8) {
    if (r() < 0.22) { g.fillStyle = r() < 0.5 ? '#ffcf70' : '#ff9a40'; g.fillRect(x, y, 4, 5); }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.NearestFilter;
  return t;
}

// une geometrías (no indexadas) en una sola
function merge(geos) {
  const parts = geos.map(g => g.index ? g.toNonIndexed() : g);
  const n = parts.reduce((a, g) => a + g.attributes.position.count, 0);
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3);
  let o = 0;
  for (const g of parts) {
    pos.set(g.attributes.position.array, o * 3);
    nor.set(g.attributes.normal.array, o * 3);
    o += g.attributes.position.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  return out;
}
function treeGeometries() {
  const at = (g, y) => { g.translate(0, y, 0); return g; };
  return {
    trunk: at(new THREE.CylinderGeometry(0.3, 0.45, 4, 5), 2),
    pine: merge([
      at(new THREE.ConeGeometry(2.6, 5, 7), 5),
      at(new THREE.ConeGeometry(2.0, 4.2, 7), 7.6),
      at(new THREE.ConeGeometry(1.3, 3.4, 7), 9.8),
    ]),
    round: merge([
      at(new THREE.IcosahedronGeometry(2.9, 0), 6.6),
      at(new THREE.IcosahedronGeometry(2.0, 0), 8.6),
    ]),
    dead: merge([
      at(new THREE.CylinderGeometry(0.12, 0.2, 3, 4).rotateZ(0.7), 5),
      at(new THREE.CylinderGeometry(0.1, 0.18, 2.6, 4).rotateZ(-0.8), 5.6),
      at(new THREE.CylinderGeometry(0.1, 0.15, 2, 4).rotateX(0.7), 6.2),
    ]),
  };
}

// ------------------------------------------------------------------ construcción
export function buildWorld(scene, zoneId = 'desierto', timeId = 'dusk') {
  Z = ZONES[zoneId] ?? ZONES.desierto;
  const T = TIMES[timeId] ?? TIMES.dusk;
  const rand = mulberry32(Z.seed);
  const root = new THREE.Group();
  scene.add(root);
  const lights = [];

  // --- cielo (cúpula con degradado; sigue a la cámara) ---
  const sunDir = new THREE.Vector3(...T.sunDir).normalize();
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(900, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: {
        top: { value: new THREE.Color(T.top) }, mid: { value: new THREE.Color(T.mid) }, hor: { value: new THREE.Color(T.hor) },
        sunDir: { value: sunDir }, sunCol: { value: new THREE.Color(T.sunCol) }, disk: { value: T.disk },
      },
      vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
      fragmentShader: `uniform vec3 top, mid, hor, sunDir, sunCol; uniform float disk; varying vec3 vP;
        void main(){ vec3 d = normalize(vP); float h = d.y;
          vec3 c = h > 0.12 ? mix(mid, top, smoothstep(0.12, 0.7, h)) : mix(hor, mid, smoothstep(-0.05, 0.12, h));
          float s = max(dot(d, sunDir), 0.0);
          c += sunCol * (pow(s, 900.0) * 3.0 * disk + pow(s, 8.0) * 0.25 * disk);
          gl_FragColor = vec4(c, 1.0); }`,
    })
  );
  sky.renderOrder = -10;
  sky.userData.sky = true;
  root.add(sky);
  if (T.stars) {
    const n = 900, pts = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const v = new THREE.Vector3(rand() * 2 - 1, rand() * 0.9 + 0.05, rand() * 2 - 1).normalize().multiplyScalar(850);
      pts.set([v.x, v.y, v.z], i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pts, 3));
    const stars = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xcfd8ff, size: 1.6, sizeAttenuation: false, fog: false }));
    sky.add(stars);
  }
  scene.fog = new THREE.Fog(T.fog, T.fogNear, T.fogFar);

  // --- luces ---
  const hemi = new THREE.HemisphereLight(T.hemiSky, T.hemiGround, T.hemiI);
  const sun = new THREE.DirectionalLight(T.sunCol, T.sunI);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = -130; sc.right = 130; sc.top = 130; sc.bottom = -130; sc.near = 10; sc.far = 500;
  sun.shadow.bias = -0.0008;
  scene.add(hemi, sun, sun.target);
  lights.push(hemi, sun, sun.target);
  const sunOffset = sunDir.clone().multiplyScalar(220);

  // --- terreno ---
  const seg = 160;
  const geo = new THREE.PlaneGeometry(WORLD, WORLD, seg, seg);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const cLow = new THREE.Color(Z.low), cHigh = new THREE.Color(Z.high), cRock = new THREE.Color(Z.rock), cSand = new THREE.Color(Z.sand), tmp = new THREE.Color();
  const wy = waterLevel();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const y = heightAt(x, z);
    pos.setY(i, y);
    const t = THREE.MathUtils.clamp((y - Z.base + 18) / 45, 0, 1);
    tmp.copy(cLow).lerp(cHigh, t);
    if (y > 30) tmp.lerp(cRock, Math.min(1, (y - 30) / 20));
    if (y < wy + 1.8) tmp.lerp(cSand, THREE.MathUtils.clamp((wy + 1.8 - y) / 1.5, 0, 1));
    if (y < wy - 0.5) tmp.multiplyScalar(0.6);
    const patch = Math.sin(x * 0.045 + Math.sin(z * 0.03) * 2) * Math.cos(z * 0.05 + Math.sin(x * 0.02) * 2);
    const v = 0.82 + patch * 0.16 + rand() * 0.14;
    colors[i * 3] = tmp.r * v; colors[i * 3 + 1] = tmp.g * v; colors[i * 3 + 2] = tmp.b * v;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const terrain = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
  terrain.receiveShadow = true;
  terrain.userData.heat = HEAT.terrain;
  root.add(terrain);

  // --- agua (ríos y lagos a un nivel común) ---
  let water = null;
  if (Z.waterY !== null) {
    water = new THREE.Mesh(
      new THREE.PlaneGeometry(WORLD, WORLD, 1, 1).rotateX(-Math.PI / 2),
      new THREE.MeshPhongMaterial({ color: T.water, transparent: true, opacity: 0.8, shininess: 90, specular: 0x667788, depthWrite: false })
    );
    water.position.y = Z.waterY;
    water.userData.heat = HEAT.water;
    water.receiveShadow = true;
    root.add(water);
  }

  // --- rocas decorativas ---
  const rockGeo = new THREE.IcosahedronGeometry(1, 0);
  const rockMat = new THREE.MeshLambertMaterial({ color: Z.rock, flatShading: true });
  for (let i = 0; i < Z.rocks; i++) {
    const x = (rand() - 0.5) * WORLD * 0.85, z = (rand() - 0.5) * WORLD * 0.85;
    const r = 0.8 + rand() * rand() * 4;
    const m = new THREE.Mesh(rockGeo, rockMat);
    m.position.set(x, heightAt(x, z) + r * 0.2, z);
    m.scale.set(r * (0.8 + rand() * 0.6), r * (0.5 + rand() * 0.5), r * (0.8 + rand() * 0.6));
    m.rotation.set(rand() * 3, rand() * 3, rand() * 3);
    m.castShadow = true; m.receiveShadow = true;
    m.userData.heat = HEAT.rock;
    root.add(m);
  }

  // --- edificios / instalaciones (obstáculos destructibles) ---
  const obstacles = [];
  const facade = facadeTexture(Z.seed);
  const palette = [0x6a665e, 0x5a5650, 0x7a6e60, 0x4e5254, 0x6e5c4c];
  const centers = [];
  for (let k = 0; k < Z.clusters * 4 && centers.length < Z.clusters; k++) {
    const cx = (rand() - 0.5) * WORLD * 0.7, cz = (rand() - 0.5) * WORLD * 0.7;
    if (Math.hypot(cx, cz) < 70) continue;
    if (heightAt(cx, cz) < wy + 2) continue;
    if (centers.some(([x, z]) => Math.hypot(x - cx, z - cz) < 120)) continue;
    centers.push([cx, cz]);
  }
  for (const [cx, cz] of centers) {
    const n = 4 + Math.floor(rand() * 5);
    for (let i = 0; i < n; i++) {
      const x = cx + (rand() - 0.5) * 70, z = cz + (rand() - 0.5) * 70;
      if (obstacles.some(o => Math.hypot(o.cx - x, o.cz - z) < 18)) continue;
      const tower = rand() < 0.18;
      const w = tower ? 7 : 8 + rand() * 14, d = tower ? 7 : 8 + rand() * 14, h = tower ? 26 + rand() * 14 : 6 + rand() * 16;
      const y0 = Math.min(heightAt(x - w / 2, z - d / 2), heightAt(x + w / 2, z + d / 2), heightAt(x, z)) - 1.5;
      if (y0 < wy) continue;
      const tex = facade.clone();
      tex.repeat.set(Math.max(1, Math.round(w / 8)), Math.max(1, Math.round(h / 8)));
      tex.needsUpdate = true;
      const mat = new THREE.MeshLambertMaterial({
        color: palette[Math.floor(rand() * palette.length)], flatShading: true,
        emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: T.windows,
      });
      const g = tower ? new THREE.CylinderGeometry(w / 2, w / 2 + 1, h, 8) : new THREE.BoxGeometry(w, h, d);
      const m = new THREE.Mesh(g, mat);
      m.position.set(x, y0 + h / 2, z);
      m.castShadow = true; m.receiveShadow = true;
      m.userData.heat = HEAT.building;
      root.add(m);
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

  // --- árboles (instanciados, se pueden derribar) ---
  const TG = treeGeometries();
  const trees = [];               // {x,y,z,s,ry,type,fi,fallen,t,dx,dz}
  const cell = 16, grid = new Map();
  const key = (cx, cz) => cx * 1000 + cz;
  const forestN = (x, z) => Math.sin(x * 0.013 + Z.ph * 3) * Math.cos(z * 0.011 - Z.ph) + 0.5 * Math.sin((x + z) * 0.021 + Z.ph);
  if (Z.forest > 0) {
    for (let gx = -WORLD * 0.42; gx < WORLD * 0.42; gx += 7) {
      for (let gz = -WORLD * 0.42; gz < WORLD * 0.42; gz += 7) {
        const x = gx + rand() * 6, z = gz + rand() * 6;
        const dens = THREE.MathUtils.clamp((forestN(x, z) - (1.15 - Z.forest * 2)) * 1.4, 0, 0.85);
        if (rand() > dens) continue;
        if (Math.hypot(x, z) < 28) continue;
        const y = heightAt(x, z);
        if (y < wy + 0.8 || y > 40) continue;
        if (obstacles.some(o => x > o.box.min.x - 3 && x < o.box.max.x + 3 && z > o.box.min.z - 3 && z < o.box.max.z + 3)) continue;
        const type = Z.treeTypes[Math.floor(rand() * Z.treeTypes.length)];
        trees.push({ x, y: y - 0.3, z, s: 0.75 + rand() * 0.7, ry: rand() * 6.28, type, fallen: false, t: 0, dx: 0, dz: 1 });
      }
    }
  }
  const foliageMat = new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true });
  const trunkMat = new THREE.MeshLambertMaterial({ color: 0x4a3626, flatShading: true });
  const byType = {};
  for (const t of trees) (byType[t.type] ??= []).push(t);
  const trunkMesh = trees.length ? new THREE.InstancedMesh(TG.trunk, trunkMat, trees.length) : null;
  const foliage = {};
  const baseCol = { pine: 0x2c4a26, round: 0x4a6a2a, dead: 0x3a2c22 };
  const col = new THREE.Color();
  const mtx = new THREE.Matrix4(), q = new THREE.Quaternion(), qy = new THREE.Quaternion(), sv = new THREE.Vector3(), pv = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), ax = new THREE.Vector3();
  function treeMatrix(t, ang) {
    qy.setFromAxisAngle(up, t.ry);
    if (ang > 0) { ax.set(t.dz, 0, -t.dx).normalize(); q.setFromAxisAngle(ax, ang).multiply(qy); } else q.copy(qy);
    pv.set(t.x, t.y, t.z); sv.setScalar(t.s);
    return mtx.compose(pv, q, sv);
  }
  trees.forEach((t, i) => { t.i = i; });
  for (const [type, list] of Object.entries(byType)) {
    const im = new THREE.InstancedMesh(TG[type], foliageMat, list.length);
    list.forEach((t, k) => {
      t.fi = k; t.fm = im;
      im.setMatrixAt(k, treeMatrix(t, 0));
      col.setHex(baseCol[type]).multiplyScalar(0.8 + rand() * 0.45);
      im.setColorAt(k, col);
    });
    im.castShadow = true; im.receiveShadow = true;
    im.userData.heat = HEAT.tree;
    root.add(im);
    foliage[type] = im;
  }
  if (trunkMesh) {
    trees.forEach((t, i) => trunkMesh.setMatrixAt(i, treeMatrix(t, 0)));
    trunkMesh.castShadow = true;
    trunkMesh.userData.heat = HEAT.tree;
    root.add(trunkMesh);
  }
  for (const t of trees) {
    const k = key(Math.floor(t.x / cell), Math.floor(t.z / cell));
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(t);
  }
  function near(x, z, r, fn) {
    const c0 = Math.floor((x - r) / cell), c1 = Math.floor((x + r) / cell);
    const d0 = Math.floor((z - r) / cell), d1 = Math.floor((z + r) / cell);
    for (let cx = c0; cx <= c1; cx++) for (let cz = d0; cz <= d1; cz++) {
      const list = grid.get(key(cx, cz));
      if (list) for (const t of list) if (!t.fallen && Math.hypot(t.x - x, t.z - z) < r) fn(t);
    }
  }
  const falling = [];
  // un vehículo pasa por encima: los árboles caen en la dirección de avance
  function trample(x, z, r, dx, dz) {
    let n = 0;
    near(x, z, r, (t) => {
      t.fallen = true; t.t = 0;
      const l = Math.hypot(dx, dz) || 1;
      t.dx = dx / l + (Math.random() - 0.5) * 0.4; t.dz = dz / l + (Math.random() - 0.5) * 0.4;
      falling.push(t); n++;
    });
    return n;
  }
  function forestCover(x, z) {
    let n = 0;
    near(x, z, 14, () => { n++; });
    return n;
  }

  return {
    zone: zoneId, time: timeId, Z, T,
    terrain, obstacles, sky, sun, water, trees,
    headlights: !!T.headlights,
    trample, forestCover,
    update(focus, camera, dt = 0, t = 0) {
      sky.position.copy(camera.position);
      sun.position.copy(focus).add(sunOffset);
      sun.target.position.copy(focus);
      if (water) water.position.y = Z.waterY + Math.sin(t * 0.8) * 0.06;
      for (let i = falling.length - 1; i >= 0; i--) {
        const tr = falling[i];
        tr.t = Math.min(1, tr.t + dt * 1.4);
        const ang = tr.t * tr.t * 1.48;
        const m = treeMatrix(tr, ang);
        tr.fm.setMatrixAt(tr.fi, m); tr.fm.instanceMatrix.needsUpdate = true;
        trunkMesh.setMatrixAt(tr.i, m); trunkMesh.instanceMatrix.needsUpdate = true;
        if (tr.t >= 1) falling.splice(i, 1);
      }
    },
    dispose() {
      scene.remove(root);
      for (const l of lights) scene.remove(l);
      sun.shadow.map?.dispose();
      root.traverse(o => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => { m.map?.dispose(); m.emissiveMap?.dispose(); m.dispose(); });
      });
    },
  };
}
