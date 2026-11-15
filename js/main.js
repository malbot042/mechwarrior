// STEEL HORIZON — combate mech con estética CRT.
// Dos modos independientes: TÁCTICO (vista cenital) y CABINA (primera persona).
import * as THREE from 'three';
import { createCRT } from './crt.js';
import { buildWorld, heightAt, BOUND, waterLevel, ZONES, TIMES, HEAT } from './world.js';
import { buildMech, buildTank, animateMech } from './models.js';
import { buildCockpit } from './cockpit.js';
import { buildHangar } from './hangar.js';
import { WEAPONS, CHASSIS, MOUNTS, MOUNT_NAME, SLOT_NAME, HEATSINK_PER_TON, chassisById, optionsFor, usedTons, stats, defaultConfig, defaultGroup } from './data.js';
import { C, txt, frame, drawDamage, drawRadar, drawWeapons, drawHeat, brackets } from './hud.js';
import { initAudio, sfx, setHum } from './audio.js';

// ---------------------------------------------------------------- render
const VH = 480;                       // líneas virtuales del CRT
let VW = 854;
const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
document.body.appendChild(renderer.domElement);
document.getElementById('boot')?.remove();

const rt = new THREE.WebGLRenderTarget(VW, VH, { type: THREE.HalfFloatType, depthBuffer: true });
rt.texture.minFilter = THREE.LinearFilter;
const hudCanvas = document.createElement('canvas');
const g = hudCanvas.getContext('2d');
const hudTex = new THREE.CanvasTexture(hudCanvas);
hudTex.minFilter = THREE.LinearFilter;
hudTex.colorSpace = THREE.NoColorSpace;
const crt = createCRT(renderer);
crt.uniforms.tScene.value = rt.texture;
crt.uniforms.tHud.value = hudTex;

const scene = new THREE.Scene();
const FOV_COCKPIT = 70, FOV_TOP = 40;
const camera = new THREE.PerspectiveCamera(FOV_TOP, 16 / 9, 0.05, 1400);
scene.add(camera);
let world = buildWorld(scene, 'desierto', 'dusk');
function ensureWorld(zone, time) {
  if (world.zone === zone && world.time === time) return;
  world.dispose();
  world = buildWorld(scene, zone, time);
}
const cockpit = buildCockpit();
camera.add(cockpit.group);
cockpit.group.userData.keep = true; // la cabina no se ve en térmico
cockpit.group.visible = false;

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h);
  VW = Math.round(VH * w / h);
  rt.setSize(VW, VH);
  hudCanvas.width = VW; hudCanvas.height = VH;
  hudTex.dispose();
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  crt.uniforms.uRes.value.set(VW, VH);
  crt.uniforms.uOut.value.set(w * renderer.getPixelRatio(), h * renderer.getPixelRatio());
  cockpit.layout(camera.aspect, FOV_COCKPIT);
}
window.addEventListener('resize', resize);
resize();

// ---------------------------------------------------------------- datos
const SECTIONS = ['LA', 'LT', 'CT', 'RT', 'RA', 'LEGS'];
const SEC_NAME = { LA: 'BRAZO IZQ', LT: 'TORSO IZQ', CT: 'TORSO CEN', RT: 'TORSO DER', RA: 'BRAZO DER', LEGS: 'PIERNAS' };

// ---------------------------------------------------------------- estado
const state = {
  screen: 'menu',     // menu | hangar | play | pause | dead
  mode: 'top',        // top | cockpit
  palette: 0,
  wave: 0, score: 0, kills: 0,
  waveTimer: 0, time: 0,
  shake: 0, flash: 0, staticN: 0,
  msgs: [],
  zoom: 70,
  input: 'keys',      // keys | mouse (último dispositivo usado para apuntar)
  track: false,       // seguimiento automático del blanco
  aimDist: 60,
  menuSel: 0,
  target: null,
  aim: new THREE.Vector3(),
  hitDirs: [],
};
let entities = [];
let player = null;
const projectiles = [], beams = [], particles = [];

const keys = {};
const mouse = { x: 0.5, y: 0.5, ndc: new THREE.Vector2(), b: [false, false, false], dx: 0, dy: 0, sdx: 0, sdy: 0 };

// ---------------------------------------------------------------- utilidades
const V = () => new THREE.Vector3();
const _v1 = V(), _v2 = V(), _v3 = V();
const ray = new THREE.Ray();
const raycaster = new THREE.Raycaster();
const wrap = (a) => { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; };
const clamp = THREE.MathUtils.clamp;
const yawTo = (from, to) => Math.atan2(-(to.x - from.x), -(to.z - from.z));
const fwd = (yaw, out = V()) => out.set(-Math.sin(yaw), 0, -Math.cos(yaw));
const center = (e, out = V()) => out.set(e.pos.x, e.pos.y + e.centerH, e.pos.z);
const volAt = (p) => player ? clamp(1 - p.distanceTo(player.pos) / 420, 0, 1) : 0.5;
function msg(text, color = C.main, dur = 3) { state.msgs.push({ text, color, t: dur, dur }); }

// ---------------------------------------------------------------- entidades
function createMech(o) {
  const sc = o.scale ?? 1;
  const model = buildMech(o.colors, { loadout: o.loadout, scale: sc });
  scene.add(model.root);
  return {
    kind: 'mech', name: o.name, model, isPlayer: !!o.isPlayer, scale: sc,
    pos: V(), heading: 0, torsoYaw: 0, pitch: 0, throttle: 0, speed: 0,
    maxSpeed: o.maxSpeed, baseSpeed: o.maxSpeed, turnRate: o.turnRate, heat: 0, dissip: o.dissip ?? 6,
    armor: { ...o.armor }, maxArmor: { ...o.armor },
    weapons: o.weapons.map(w => ({ ...w, def: WEAPONS[w.def], cd: Math.random() })),
    alive: true, phase: 0, lastStep: 0, radius: 4 * sc, centerH: 7.2 * sc, hitR: 4.6 * sc, shutdown: 0, deadT: 0,
    ai: o.ai ? { range: o.ai.range, skill: o.ai.skill, t: 2, strafe: Math.random() < 0.5 ? 1 : -1, fireT: 1.5, stuck: 0, avoid: 0 } : null,
    value: o.value ?? 100,
  };
}

// Construye un mech a partir de un chasis y su configuración de armas
function mechFromChassis(ch, cfg, o = {}) {
  const loadout = {};
  for (const m of MOUNTS) loadout[m] = cfg[m]?.w ?? null;
  const st = stats(ch, cfg);
  const armor = {};
  for (const k in ch.armor) armor[k] = Math.round(ch.armor[k] * (o.armorMult ?? 1));
  return createMech({
    isPlayer: o.isPlayer, name: o.name ?? ch.name, colors: o.colors ?? ch.colors, scale: ch.scale, loadout,
    maxSpeed: ch.maxSpeed * (o.speedMult ?? 1), turnRate: ch.turnRate, dissip: st.dissip, armor,
    weapons: MOUNTS.filter(m => cfg[m]?.w).map(m => ({ def: cfg[m].w, mount: m, sec: m, group: cfg[m].g })),
    ai: o.ai, value: o.value,
  });
}
const quickCfg = (obj) => Object.fromEntries(MOUNTS.map(m => [m, { w: obj[m] ?? null, g: defaultGroup(obj[m]) }]));

function createTank(o) {
  const model = buildTank(o.colors);
  scene.add(model.root);
  return {
    kind: 'tank', name: 'TANQUE', model, isPlayer: false,
    pos: V(), heading: 0, torsoYaw: 0, pitch: 0, throttle: 0, speed: 0,
    maxSpeed: 9, turnRate: 0.9, heat: 0, dissip: 10,
    armor: { CT: o.armor ?? 22 }, maxArmor: { CT: o.armor ?? 22 },
    weapons: [{ def: WEAPONS.cannon, mount: 'main', sec: 'CT', group: 0, cd: 1 + Math.random() * 2 }],
    alive: true, radius: 3.6, centerH: 2.2, shutdown: 0, deadT: 0,
    ai: { range: 140, skill: 0.6, t: 2, strafe: 1, fireT: 2, stuck: 0, avoid: 0 },
    value: 40,
  };
}

function newPlayer() {
  const ch = chassisById(hangar.chassis);
  return mechFromChassis(ch, cfgFor(ch), { isPlayer: true });
}
const ENEMY_COLORS = [
  { base: 0x8a3a2a, dark: 0x2a1c18, accent: 0xd0c040, glass: 0xff6040 },
  { base: 0x4a5a6a, dark: 0x1c2228, accent: 0xd04040, glass: 0xff6040 },
  { base: 0x3a3a3e, dark: 0x141416, accent: 0xff5020, glass: 0xff3020 },
];
const ENEMY_TYPES = {
  light: { ch: 'halcon', name: 'CHACAL', colors: 0, armorMult: 0.66, speedMult: 0.86, value: 100,
    cfg: { LA: 'laserS', RT: 'laser' }, ai: { range: 90, skill: 0.55 } },
  medium: { ch: 'centinela', name: 'MERODEADOR', colors: 1, armorMult: 0.72, speedMult: 0.72, value: 160,
    cfg: { LA: 'laser', LT: 'lrm6', RA: 'ppc' }, ai: { range: 170, skill: 0.75 } },
  heavy: { ch: 'titan', name: 'COLOSO', colors: 2, armorMult: 0.6, speedMult: 0.9, value: 250,
    cfg: { LA: 'laserL', LT: 'lrm6', RT: 'srm4', RA: 'ac5' }, ai: { range: 140, skill: 0.7 } },
};
function enemyMech(type) {
  const t = ENEMY_TYPES[type];
  return mechFromChassis(chassisById(t.ch), quickCfg(t.cfg), {
    name: t.name, colors: ENEMY_COLORS[t.colors], armorMult: t.armorMult, speedMult: t.speedMult, value: t.value, ai: t.ai,
  });
}

function placeFree(e, x, z) {
  for (let tries = 0; tries < 60; tries++) {
    const dry = heightAt(x, z) > waterLevel() + 0.8;
    const free = dry && !world.obstacles.some(o => o.alive &&
      x > o.box.min.x - e.radius - 2 && x < o.box.max.x + e.radius + 2 &&
      z > o.box.min.z - e.radius - 2 && z < o.box.max.z + e.radius + 2);
    if (free) break;
    const r = 20 + tries * 4;
    x += (Math.random() - 0.5) * r; z += (Math.random() - 0.5) * r;
  }
  e.pos.set(clamp(x, -BOUND, BOUND), 0, clamp(z, -BOUND, BOUND));
  e.pos.y = heightAt(e.pos.x, e.pos.z);
}

function spawnWave() {
  state.wave++;
  const n = state.wave;
  const mechs = Math.min(1 + Math.floor((n - 1) / 2), 5);
  const mediums = Math.min(Math.floor((n - 1) / 3), 3);
  const heavies = n >= 5 ? Math.min(Math.floor((n - 3) / 3), 2) : 0;
  const tanks = Math.min(1 + n, 7);
  const base = Math.random() * Math.PI * 2;
  const list = [];
  for (let i = 0; i < mechs; i++) list.push(enemyMech(i < heavies ? 'heavy' : i < heavies + mediums ? 'medium' : 'light'));
  for (let i = 0; i < tanks; i++) list.push(createTank({ armor: 18 + n * 2 }));
  list.forEach((e, i) => {
    const a = base + (i / list.length - 0.5) * 1.6 + (Math.random() - 0.5) * 0.3;
    const r = 230 + Math.random() * 60;
    placeFree(e, player.pos.x + Math.sin(a) * r, player.pos.z + Math.cos(a) * r);
    e.heading = yawTo(e.pos, player.pos);
    entities.push(e);
  });
  msg(`OLEADA ${n} — CONTACTOS: ${list.length}`, C.warn, 4);
  sfx.beep(1, 660); setTimeout(() => sfx.beep(1, 880), 140);
}

function clearWorld() {
  if (state.headlight) { scene.remove(state.headlight, state.headlight.target); state.headlight.dispose(); state.headlight = null; }
  for (const e of entities) scene.remove(e.model.root);
  entities = [];
  for (const arr of [projectiles, beams, particles]) { for (const p of arr) scene.remove(p.mesh); arr.length = 0; }
}

function startGame(mode) {
  initAudio();
  sfx.powerup();
  clearWorld();
  state.mode = mode;
  state.wave = 0; state.score = 0; state.kills = 0; state.msgs = []; state.waveTimer = 0;
  state.target = null; state.hitDirs = [];
  ensureWorld(hangar.zone, hangar.time);
  player = newPlayer();
  if (world.headlights) {
    // focos del mech para la noche (se colocan cada frame en la cabina)
    const sl = new THREE.SpotLight(0xfff0d0, 900, 220, 0.45, 0.55, 1.3);
    scene.add(sl, sl.target);
    state.headlight = sl;
  }
  placeFree(player, 0, 0);
  entities.push(player);
  state.screen = 'play';
  applyMode();
  if (mode === 'cockpit') lockPointer();
  state.thermal = false;
  if (world.time === 'night') setTimeout(() => msg('VISIBILIDAD NOCTURNA — PULSE V PARA VISIÓN TÉRMICA', C.warn, 5), 1200);
  spawnWave();
  msg(mode === 'top' ? 'MODO TÁCTICO — FLECHAS APUNTAR · Q BLANCO' : 'MODO CABINA — FLECHAS APUNTAR · Q BLANCO', C.cyan, 4);
  state.track = false; state.aimDist = 60;
}

function applyMode() {
  const cock = state.mode === 'cockpit' && state.screen !== 'menu';
  cockpit.group.visible = cock;
  if (player) player.model.root.visible = !cock;
  camera.fov = cock ? FOV_COCKPIT : FOV_TOP;
  camera.near = cock ? 0.05 : 1;
  camera.updateProjectionMatrix();
  setHum(cock ? 0.05 : 0.015);
}

// ---------------------------------------------------------------- trazado y daño
function traceSegment(from, dir, maxDist, ignore) {
  let best = maxDist, ent = null, obs = null;
  // terreno (marcha)
  for (let t = 1; t < maxDist; t += 2) {
    const x = from.x + dir.x * t, y = from.y + dir.y * t, z = from.z + dir.z * t;
    if (y < heightAt(x, z)) { best = t; break; }
  }
  ray.set(from, dir);
  for (const o of world.obstacles) {
    if (!o.alive) continue;
    if (ray.intersectBox(o.box, _v3)) {
      const d = _v3.distanceTo(from);
      if (d < best) { best = d; obs = o; ent = null; }
    }
  }
  const sph = new THREE.Sphere();
  for (const e of entities) {
    if (!e.alive || e === ignore) continue;
    center(e, sph.center); sph.radius = e.kind === 'tank' ? 3.4 : e.hitR;
    if (ray.intersectSphere(sph, _v3)) {
      const d = _v3.distanceTo(from);
      if (d < best) { best = d; ent = e; obs = null; }
    }
  }
  return { dist: best, ent, obs, point: from.clone().addScaledVector(dir, best) };
}

function pickGround(r) {
  for (let t = 0; t < 1500; t += 2) {
    const p = r.at(t, _v3);
    if (p.y < heightAt(p.x, p.z)) {
      let a = Math.max(0, t - 2), b = t;
      for (let i = 0; i < 8; i++) { const m = (a + b) / 2; const q = r.at(m, _v3); if (q.y < heightAt(q.x, q.z)) b = m; else a = m; }
      return r.at(b, V());
    }
  }
  return r.at(200, V());
}

function hitSection(e, p) {
  if (e.kind === 'tank') return 'CT';
  const k = e.scale ?? 1;
  const y = p.y - e.pos.y;
  if (y < 5.6 * k) return 'LEGS';
  const ty = e.heading + e.torsoYaw;
  const x = (p.x - e.pos.x) * Math.cos(ty) - (p.z - e.pos.z) * Math.sin(ty);
  let s = x < -2.9 * k ? 'LA' : x < -1.3 * k ? 'LT' : x < 1.3 * k ? 'CT' : x < 2.9 * k ? 'RT' : 'RA';
  if (e.armor[s] <= 0) s = (s === 'LA' ? 'LT' : s === 'RA' ? 'RT' : 'CT');
  if (e.armor[s] <= 0) s = 'CT';
  return s;
}

function damage(e, amount, point, src) {
  if (!e.alive) return;
  const sec = hitSection(e, point);
  const before = e.armor[sec];
  e.armor[sec] -= amount;
  if (e.armor[sec] < 0) {
    const over = -e.armor[sec];
    e.armor[sec] = 0;
    if (sec !== 'CT' && sec !== 'LEGS') e.armor.CT = Math.max(0, e.armor.CT - over * 0.6);
  }
  if (before > 0 && e.armor[sec] <= 0 && e.kind === 'mech' && sec !== 'CT') {
    if (sec === 'LA' || sec === 'RA') e.model.sections[sec].visible = false;
    if (sec === 'LT') e.model.sideL.visible = false;
    if (sec === 'RT') e.model.sideR.visible = false;
    explosion(point, 0.8);
    if (e.isPlayer) msg(`${SEC_NAME[sec]} DESTRUIDO`, C.bad, 3);
    else if (sec === 'LEGS') e.maxSpeed *= 0.4;
  }
  if (e.isPlayer) {
    state.shake = Math.min(1, state.shake + amount * 0.04);
    state.flash = Math.min(0.25, state.flash + amount * 0.01);
    sfx.hit(0.9);
    if (src) state.hitDirs.push({ yaw: yawTo(e.pos, src.pos), t: 1.2 });
    if (e.armor.LEGS <= e.maxArmor.LEGS * 0.5) e.maxSpeed = e.baseSpeed * (0.45 + e.armor.LEGS / e.maxArmor.LEGS);
  } else if (src === player) {
    sfx.hit(0.3);
  }
  if (e.armor.CT <= 0 || (e.armor.LEGS !== undefined && e.armor.LEGS <= 0)) kill(e);
}

function damageObs(o, amount, point) {
  if (!o.alive) return;
  o.hp -= amount;
  spark(point, 0xffaa60, 4);
  if (o.hp <= 0) {
    o.alive = false;
    const m = o.mesh;
    m.scale.y = 0.25;
    m.position.y = o.y0 + o.h * 0.125;
    m.material.emissiveIntensity = 0;
    m.userData.heat = HEAT.ruin;
    m.material.color.multiplyScalar(0.35);
    const c = m.position.clone(); c.y = o.y0 + o.h * 0.4;
    explosion(c, 1.6);
    for (let i = 0; i < 12; i++) smoke(c.clone().add(V().set((Math.random() - 0.5) * 8, Math.random() * 6, (Math.random() - 0.5) * 8)), 3 + Math.random() * 3);
    if (player) state.score += 10;
  }
}

function kill(e) {
  e.alive = false;
  e.throttle = 0; e.speed = 0;
  const c = center(e);
  explosion(c, e.kind === 'tank' ? 1.4 : 2.4);
  for (const m of e.model.mats) m.color.multiplyScalar(0.3);
  if (e.isPlayer) {
    state.screen = 'dead';
    state.flash = 0.8;
    msg('MECH DESTRUIDO', C.bad, 99);
    document.exitPointerLock?.();
    cockpit.group.visible = false;
    player.model.root.visible = true;
  } else {
    state.score += e.value; state.kills++;
    if (state.target === e) state.target = null;
    msg(`${e.name} ELIMINADO +${e.value}`, C.main, 2);
  }
}

// ---------------------------------------------------------------- efectos
const sphereGeo = new THREE.IcosahedronGeometry(1, 0);
const boxGeo = new THREE.BoxGeometry(1, 1, 1);
const cylGeo = new THREE.CylinderGeometry(1, 1, 1, 6, 1, true);
function particle(pos, vel, color, life, size, grow, additive = true, gravity = 0, geo = sphereGeo) {
  if (particles.length > 500) return;
  const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 1, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.copy(pos); mesh.scale.setScalar(size);
  mesh.rotation.set(Math.random() * 3, Math.random() * 3, 0);
  scene.add(mesh);
  particles.push({ mesh, vel, life, max: life, size, grow, gravity });
}
function smoke(pos, size = 2) {
  particle(pos, V().set((Math.random() - 0.5) * 2, 3 + Math.random() * 3, (Math.random() - 0.5) * 2), 0x2a2420, 2.5 + Math.random() * 2, size, 1.2, false);
}
function spark(pos, color, n = 6) {
  for (let i = 0; i < n; i++)
    particle(pos, V().set(Math.random() - 0.5, Math.random() * 0.8, Math.random() - 0.5).multiplyScalar(30), color, 0.3 + Math.random() * 0.3, 0.3, -0.5, true, 40);
}
function splash(pos, n = 8, vol = 0) {
  for (let i = 0; i < n; i++)
    particle(pos, V().set(Math.random() - 0.5, 1.2 + Math.random(), Math.random() - 0.5).multiplyScalar(8), 0xb8d0e0, 0.6 + Math.random() * 0.4, 0.4, 0.6, false, 25);
  if (vol) sfx.splash(vol);
}
function explosion(pos, scale = 1) {
  const n = Math.round(10 * scale + 4);
  for (let i = 0; i < n; i++) {
    const v = V().set(Math.random() - 0.5, Math.random() * 0.9, Math.random() - 0.5).multiplyScalar(14 * scale);
    particle(pos.clone().addScaledVector(v, 0.05), v, i % 3 ? 0xff8a20 : 0xffe080, 0.5 + Math.random() * 0.5, 1.2 * scale, 2.5, true);
  }
  for (let i = 0; i < n / 2; i++) smoke(pos.clone().add(V().set((Math.random() - 0.5) * 4 * scale, 0, (Math.random() - 0.5) * 4 * scale)), 2 * scale);
  for (let i = 0; i < n / 2; i++) {
    const v = V().set(Math.random() - 0.5, 0.6 + Math.random(), Math.random() - 0.5).multiplyScalar(22 * scale);
    particle(pos, v, 0x222018, 1.5 + Math.random(), 0.4 + Math.random() * 0.4 * scale, 0, false, 30, boxGeo);
  }
  const v = volAt(pos);
  sfx.explosion(v, scale > 1.5);
  if (player) {
    const d = pos.distanceTo(player.pos);
    state.shake = Math.min(1, state.shake + scale * clamp(1 - d / 120, 0, 1) * 0.6);
    if (d < 60) state.flash = Math.min(0.5, state.flash + scale * 0.1 * (1 - d / 60));
  }
}
function beam(from, to, color, width = 0.35) {
  const len = from.distanceTo(to);
  const dir = _v1.copy(to).sub(from).normalize();
  const make = (c, w) => {
    const mat = new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 1, depthWrite: false, blending: THREE.AdditiveBlending });
    const mesh = new THREE.Mesh(cylGeo, mat);
    mesh.position.copy(from).addScaledVector(dir, len / 2);
    mesh.quaternion.setFromUnitVectors(_v2.set(0, 1, 0), dir);
    mesh.scale.set(w, len, w);
    scene.add(mesh);
    beams.push({ mesh, life: 0.16, max: 0.16 });
  };
  make(color, width);
  make(0xffffff, width * 0.35);
}
function projectile(o) {
  let mesh;
  if (o.type === 'missile') {
    mesh = new THREE.Mesh(boxGeo, new THREE.MeshBasicMaterial({ color: 0xcfc8b0 }));
    mesh.scale.set(0.35, 0.35, 1.2);
  } else {
    mesh = new THREE.Mesh(sphereGeo, new THREE.MeshBasicMaterial({ color: o.color, blending: THREE.AdditiveBlending, transparent: true }));
    const r = o.type === 'bolt' ? 0.9 : (o.size ?? 0.4);
    mesh.scale.set(r, r, o.type === 'bolt' ? 2.6 : r * 2.5);
  }
  mesh.position.copy(o.pos);
  scene.add(mesh);
  projectiles.push({ ...o, mesh });
}

// ---------------------------------------------------------------- armas
function fireGroup(e, group, aimPoint, target) {
  if (e.shutdown > 0 || !e.alive) return false;
  let fired = false;
  for (const w of e.weapons) {
    if (w.group !== group || w.cd > 0 || e.armor[w.sec] <= 0) continue;
    fireWeapon(e, w, aimPoint, target);
    fired = true;
  }
  return fired;
}

function fireWeapon(e, w, aimPoint, target) {
  const d = w.def;
  const M = e.model.muzzles[w.mount].getWorldPosition(V());
  w.cd = d.cd * (e.isPlayer ? 1 : 1.6);
  e.heat += d.heat;
  const dir = aimPoint.clone().sub(M).normalize();
  const vol = volAt(M);
  if (d.type === 'beam') {
    const tr = traceSegment(M, dir, d.range, e);
    beam(M, tr.point, d.color, d.width ?? 0.32);
    if (tr.ent) damage(tr.ent, d.dmg, tr.point, e);
    else if (tr.obs) damageObs(tr.obs, d.dmg, tr.point);
    else if (tr.dist < d.range) { if (tr.point.y < waterLevel()) splash(tr.point, 6, vol); else spark(tr.point, 0xff6030, 4); }
    sfx.laser(vol * (e.isPlayer ? 0.8 : 0.6));
  } else if (d.type === 'bolt' || d.type === 'shell') {
    projectile({ type: d.type, pos: M, vel: dir.multiplyScalar(d.speed), dmg: d.dmg, owner: e, color: d.color, size: d.size, life: d.range / d.speed + 0.3 });
    (d.type === 'bolt' ? sfx.ppc : sfx.cannon)(vol * 0.8);
    spark(M, d.color, 3);
  } else if (d.type === 'missile') {
    for (let i = 0; i < d.count; i++) {
      const arc = d.guided ? 0.55 + Math.random() * 0.3 : 0.05 + Math.random() * 0.08;
      const spr = d.guided ? 0.5 : 0.12;
      const v = dir.clone().add(V().set((Math.random() - 0.5) * spr, arc, (Math.random() - 0.5) * spr)).normalize().multiplyScalar(d.speed * (d.guided ? 0.5 : 0.8));
      projectile({ type: 'missile', pos: M.clone().add(V().set((Math.random() - 0.5), (Math.random() - 0.5), 0)), vel: v, dmg: d.dmg, owner: e, target: d.guided ? target : null, aim: aimPoint.clone(), speed: d.speed, life: d.guided ? 6 : d.range / d.speed + 0.5, delay: i * (d.guided ? 0.07 : 0.05) });
    }
    sfx.missile(vol);
  }
}

// ---------------------------------------------------------------- movimiento
function moveEntity(e, dt) {
  const target = e.throttle * e.maxSpeed * (e.shutdown > 0 ? 0 : 1) * (e.inWater ? 0.6 : 1);
  e.speed += clamp(target - e.speed, -12 * dt, 7 * dt);
  const f = fwd(e.heading, _v1);
  const px = e.pos.x, pz = e.pos.z;
  e.pos.x += f.x * e.speed * dt;
  e.pos.z += f.z * e.speed * dt;
  // obstáculos (círculo vs AABB en XZ)
  for (const o of world.obstacles) {
    if (!o.alive) continue;
    const cx = clamp(e.pos.x, o.box.min.x, o.box.max.x), cz = clamp(e.pos.z, o.box.min.z, o.box.max.z);
    const dx = e.pos.x - cx, dz = e.pos.z - cz;
    const d2 = dx * dx + dz * dz;
    if (d2 < e.radius * e.radius) {
      const d = Math.sqrt(d2) || 0.001;
      e.pos.x = cx + dx / d * e.radius; e.pos.z = cz + dz / d * e.radius;
    }
  }
  for (const o of entities) {
    if (o === e || !o.alive) continue;
    const dx = e.pos.x - o.pos.x, dz = e.pos.z - o.pos.z;
    const r = e.radius + o.radius, d2 = dx * dx + dz * dz;
    if (d2 < r * r) { const d = Math.sqrt(d2) || 0.01; const push = (r - d) * 0.5; e.pos.x += dx / d * push; e.pos.z += dz / d * push; }
  }
  e.pos.x = clamp(e.pos.x, -BOUND, BOUND); e.pos.z = clamp(e.pos.z, -BOUND, BOUND);
  e.pos.y = heightAt(e.pos.x, e.pos.z);
  e.inWater = waterLevel() - e.pos.y > 0.6;
  // derribar árboles al pasar
  if (Math.abs(e.speed) > 1.5) {
    const sg = Math.sign(e.speed);
    const n = world.trample(e.pos.x, e.pos.z, e.radius * 0.85, f.x * sg, f.z * sg);
    if (n) {
      sfx.tree(e.isPlayer ? 0.7 : volAt(e.pos) * 0.6);
      for (let i = 0; i < n * 4; i++) particle(_v3.set(e.pos.x, e.pos.y + 5 + Math.random() * 4, e.pos.z), V().set(Math.random() - 0.5, Math.random(), Math.random() - 0.5).multiplyScalar(6), 0x3a5a2a, 1.2, 0.35, 0, false, 12, boxGeo);
      if (e.isPlayer) state.shake = Math.min(1, state.shake + 0.15);
    }
  }
  e.realSpeed = Math.hypot(e.pos.x - px, e.pos.z - pz) / Math.max(dt, 1e-4);

  // calor
  e.heat = Math.max(0, e.heat - e.dissip * dt * (e.shutdown > 0 ? 2.5 : 1) * (e.speed > e.maxSpeed * 0.7 ? 0.8 : 1) * (e.inWater ? 1.7 : 1));
  e.model.root.userData.heat = (e.kind === 'mech' ? 0.72 : 0.66) + e.heat / 100 * 0.28;
  if (e.shutdown > 0) {
    e.shutdown -= dt;
    if (e.shutdown <= 0 && e.isPlayer) { sfx.powerup(); msg('REACTOR EN LÍNEA', C.main, 2); }
  } else if (e.heat >= 100) {
    e.shutdown = 4;
    if (e.isPlayer) { sfx.shutdown(); msg('¡APAGADO POR SOBRECALENTAMIENTO!', C.bad, 4); }
  }
  for (const w of e.weapons) w.cd -= dt;

  // modelo
  const m = e.model;
  m.root.position.copy(e.pos);
  m.root.rotation.y = e.heading;
  if (e.kind === 'mech') {
    m.torso.rotation.y = e.torsoYaw;
    const amt = clamp(Math.abs(e.speed) / (12 * e.scale), 0, 1);
    e.phase += e.speed * dt * 0.33 / e.scale;
    animateMech(m, e.phase, amt, e.pitch);
    const step = Math.floor(e.phase / Math.PI);
    if (step !== e.lastStep) {
      e.lastStep = step;
      if (amt > 0.15) {
        const v = e.isPlayer ? (state.mode === 'cockpit' ? 0.8 : 0.45) : volAt(e.pos) * 0.5;
        sfx.step(v * amt);
        if (e.inWater) splash(_v3.set(e.pos.x, waterLevel(), e.pos.z), 6, v);
        if (e.isPlayer && state.mode === 'cockpit') state.shake = Math.min(1, state.shake + 0.12 * amt);
      }
    }
  } else {
    m.turret.rotation.y = e.torsoYaw;
    // inclinación según pendiente
    const fx = fwd(e.heading, _v2);
    const hF = heightAt(e.pos.x + fx.x * 3, e.pos.z + fx.z * 3), hB = heightAt(e.pos.x - fx.x * 3, e.pos.z - fx.z * 3);
    m.root.rotation.x = Math.atan2(hF - hB, 6);
  }
}

// ---------------------------------------------------------------- jugador
// Control por teclado: flechas apuntan el torso, Q/Tab cicla blancos (y activa
// el seguimiento automático del torso), R activa/desactiva el seguimiento.
function cycleTarget() {
  const list = entities.filter(e => e.alive && !e.isPlayer)
    .sort((a, b) => a.pos.distanceTo(player.pos) - b.pos.distanceTo(player.pos));
  if (!list.length) { msg('SIN BLANCOS', C.dim, 1.2); return; }
  const i = list.indexOf(state.target);
  state.target = list[(i + 1) % list.length];
  state.track = true;
  state.input = 'keys';
  sfx.beep(0.7, 1320);
}

// gira el torso hacia una guiñada mundial con velocidad limitada
function turnTorsoTo(p, worldYaw, rate, dt) {
  const diff = wrap(worldYaw - (p.heading + p.torsoYaw));
  p.torsoYaw = clamp(wrap(p.torsoYaw + clamp(diff, -rate * dt, rate * dt)), -1.9, 1.9);
}

function updatePlayer(dt) {
  const p = player;
  if (p.shutdown <= 0) {
    if (keys.KeyW) p.throttle = Math.min(1, p.throttle + dt * 0.9);
    if (keys.KeyS) p.throttle = Math.max(-0.4, p.throttle - dt * 0.9);
    if (keys.KeyX) p.throttle = 0;
    const turn = (keys.KeyA ? 1 : 0) - (keys.KeyD ? 1 : 0);
    p.heading += turn * p.turnRate * dt * (1 - 0.35 * Math.abs(p.speed) / p.baseSpeed);
  }
  if (Math.abs(p.throttle) < 0.04 && !keys.KeyW && !keys.KeyS) p.throttle = 0;

  const ax = (keys.ArrowLeft ? 1 : 0) - (keys.ArrowRight ? 1 : 0);
  const ay = (keys.ArrowUp ? 1 : 0) - (keys.ArrowDown ? 1 : 0);
  if (ax) state.track = false;
  if (state.track && !(state.target && state.target.alive)) state.track = false;
  const powered = p.shutdown <= 0;

  if (state.mode === 'top') {
    let aim = null, tgt = null;
    if (state.input === 'mouse') {
      // apuntar con el cursor
      raycaster.setFromCamera(mouse.ndc, camera);
      let best = 12;
      let ground = pickGround(raycaster.ray);
      const hits = raycaster.intersectObjects(world.obstacles.filter(o => o.alive).map(o => o.mesh), false);
      const onObs = hits.length && hits[0].distance < ground.distanceTo(raycaster.ray.origin);
      if (onObs) ground = hits[0].point.clone();
      for (const e of entities) {
        if (!e.alive || e === p) continue;
        const d = Math.hypot(e.pos.x - ground.x, e.pos.z - ground.z);
        const onRay = raycaster.ray.intersectsSphere(new THREE.Sphere(center(e), 5.5));
        const score = onRay ? 0 : d;
        if (score < best) { best = score; tgt = e; }
      }
      aim = tgt ? center(tgt) : ground.clone().add(_v2.set(0, onObs ? 0 : 1.5, 0));
      if (powered) turnTorsoTo(p, yawTo(p.pos, aim), 2.6, dt);
    } else {
      // apuntar con teclado
      if (powered) p.torsoYaw = clamp(p.torsoYaw + ax * 1.7 * dt, -1.9, 1.9);
      state.aimDist = clamp(state.aimDist + ay * 90 * dt, 15, 260);
      if (state.track) {
        tgt = state.target;
        if (powered) turnTorsoTo(p, yawTo(p.pos, tgt.pos), 2.6, dt);
      } else {
        // fijación suave: enemigo dentro del cono del torso
        const ty = p.heading + p.torsoYaw;
        let best = 0.14;
        for (const e of entities) {
          if (!e.alive || e === p || e.pos.distanceTo(p.pos) > 400) continue;
          const ang = Math.abs(wrap(yawTo(p.pos, e.pos) - ty));
          if (ang < best) { best = ang; tgt = e; }
        }
      }
      if (tgt) aim = center(tgt);
      else {
        const f = fwd(p.heading + p.torsoYaw, _v2);
        aim = V().set(p.pos.x + f.x * state.aimDist, 0, p.pos.z + f.z * state.aimDist);
        aim.y = heightAt(aim.x, aim.z) + 1.5;
      }
    }
    state.target = tgt;
    state.aim.copy(aim);
    p.pitch = 0;
  } else {
    // cabina: ratón y/o flechas mueven torso y pitch
    if (powered) {
      p.torsoYaw = clamp(p.torsoYaw - mouse.dx * 0.0022 + ax * 1.5 * dt, -1.9, 1.9);
      p.pitch = clamp(p.pitch - mouse.dy * 0.0022 + (state.track ? 0 : ay * 0.8 * dt), -0.45, 0.35);
      if (ax || ay) { mouse.sdx -= ax * 8; mouse.sdy -= ay * 8; }
    }
    const cp = camera.getWorldPosition(V());
    if (state.track && powered) {
      const tc = center(state.target);
      turnTorsoTo(p, yawTo(p.pos, tc), 2.2, dt);
      const desiredPitch = clamp(Math.atan2(tc.y - cp.y, Math.hypot(tc.x - cp.x, tc.z - cp.z)), -0.45, 0.35);
      p.pitch += clamp(desiredPitch - p.pitch, -1.2 * dt, 1.2 * dt);
    }
    const cd = camera.getWorldDirection(V());
    const tr = traceSegment(cp, cd, 600, p);
    state.aim.copy(tr.point);
    if (!state.track) {
      // fijación de blanco: el enemigo más cercano al centro de la vista
      let tgt = null, best = 0.12;
      for (const e of entities) {
        if (!e.alive || e === p) continue;
        const to = center(e).sub(cp);
        if (to.length() > 500) continue;
        const ang = to.normalize().angleTo(cd);
        if (ang < best) { best = ang; tgt = e; }
      }
      if (tgt) state.target = tgt;
      else if (state.target && (!state.target.alive || center(state.target).sub(cp).normalize().angleTo(cd) > 0.6)) state.target = null;
    }
  }
  if (keys.KeyC) { state.track = false; p.torsoYaw *= Math.max(0, 1 - dt * 5); p.pitch *= Math.max(0, 1 - dt * 5); }

  // disparo (ratón o teclado)
  if (mouse.b[0] || keys.Space || keys.KeyJ) fireGroup(p, 0, state.aim, state.target);
  if (mouse.b[2] || keys.KeyF || keys.KeyK) fireGroup(p, 1, state.aim, state.target);
  if (keys.KeyE || keys.KeyL) fireGroup(p, 2, state.aim, state.target);
}

// ---------------------------------------------------------------- IA
function updateAI(e, dt) {
  const ai = e.ai;
  if (!player.alive || e.shutdown > 0) { e.throttle = 0; return; }
  ai.t -= dt; ai.fireT -= dt;
  const toYaw = yawTo(e.pos, player.pos);
  const dist = Math.hypot(player.pos.x - e.pos.x, player.pos.z - e.pos.z);
  let desired = toYaw;
  if (dist > ai.range + 40) { desired = toYaw; e.throttle = 1; }
  else if (dist < ai.range - 40) { desired = toYaw + Math.PI * 0.75 * ai.strafe; e.throttle = 0.7; }
  else { desired = toYaw + Math.PI / 2 * ai.strafe; e.throttle = 0.75; }
  if (ai.t < 0) { ai.t = 3 + Math.random() * 4; if (Math.random() < 0.6) ai.strafe *= -1; }
  // atasco -> rodeo
  if (e.throttle > 0.5 && (e.realSpeed ?? 1) < e.maxSpeed * 0.15) ai.stuck += dt; else ai.stuck = Math.max(0, ai.stuck - dt);
  if (ai.stuck > 0.8) { ai.avoid = 1.5; ai.stuck = 0; ai.strafe *= -1; }
  if (ai.avoid > 0) { ai.avoid -= dt; desired = e.heading + 1.2 * ai.strafe; }
  e.heading = wrap(e.heading + clamp(wrap(desired - e.heading), -e.turnRate * dt, e.turnRate * dt));
  // torso / torreta
  const lim = e.kind === 'tank' ? Math.PI : 1.7;
  const tDes = clamp(wrap(toYaw - e.heading), -lim, lim);
  e.torsoYaw += clamp(wrap(tDes - e.torsoYaw), -2 * dt, 2 * dt);
  const aligned = Math.abs(wrap(toYaw - e.heading - e.torsoYaw)) < 0.18;
  if (!aligned || ai.fireT > 0 || e.heat > 70) return;
  // línea de visión
  const eye = center(e);
  const pc = center(player);
  const dir = pc.clone().sub(eye);
  const d3 = dir.length(); dir.normalize();
  const tr = traceSegment(eye, dir, d3 + 2, e);
  if (tr.ent !== player) { ai.fireT = 0.5; return; }
  const cover = world.forestCover(player.pos.x, player.pos.z) >= 4;
  if (cover && d3 > 150) { ai.fireT = 0.6; return; }   // oculto en el bosque
  const usable = e.weapons.filter(w => w.cd <= 0 && e.armor[w.sec] > 0 && d3 < w.def.range);
  if (!usable.length) return;
  const w = usable[Math.floor(Math.random() * usable.length)];
  const spread = ((1 - ai.skill) * (d3 * 0.05 + player.speed * 0.25) + 0.8) * (cover ? 1.8 : 1);
  const aim = pc.add(V().set((Math.random() - 0.5) * spread, (Math.random() - 0.5) * spread * 0.6, (Math.random() - 0.5) * spread));
  fireWeapon(e, w, aim, player);
  ai.fireT = 0.35 + Math.random() * 0.9;
}

// ---------------------------------------------------------------- proyectiles
function updateProjectiles(dt) {
  for (let i = projectiles.length - 1; i >= 0; i--) {
    const p = projectiles[i];
    if (p.delay > 0) { p.delay -= dt; p.mesh.visible = false; continue; }
    p.mesh.visible = true;
    p.life -= dt;
    if (p.type === 'missile') {
      const goal = p.target && p.target.alive ? center(p.target) : p.aim;
      const desired = goal.clone().sub(p.mesh.position).normalize();
      const sp = Math.min(p.speed, p.vel.length() + 70 * dt);
      p.vel.lerp(desired.multiplyScalar(sp), Math.min(1, dt * (p.target ? 2.2 : 1.6))).setLength(sp);
      if (Math.random() < 0.7) particle(p.mesh.position.clone(), V().set(0, 1, 0), 0x6a625a, 1.0, 0.5, 1.5, false);
      particle(p.mesh.position.clone(), V(), 0xffa040, 0.08, 0.5, 0, true);
    } else if (p.type === 'bolt') {
      particle(p.mesh.position.clone(), V(), 0x80c0ff, 0.15, 0.7, -2, true);
    }
    const step = p.vel.length() * dt;
    const dir = p.vel.clone().normalize();
    const tr = traceSegment(p.mesh.position, dir, step + 0.5, p.owner);
    p.mesh.quaternion.setFromUnitVectors(_v2.set(0, 0, 1), dir);
    let done = p.life <= 0;
    if (tr.dist < step + 0.5) {
      if (tr.ent) damage(tr.ent, p.dmg, tr.point, p.owner);
      else if (tr.obs) damageObs(tr.obs, p.dmg, tr.point);
      const sc = p.type === 'bolt' ? 0.7 : p.type === 'shell' ? 0.45 : 0.35;
      if (!tr.ent && !tr.obs && tr.point.y < waterLevel()) splash(_v3.copy(tr.point).setY(waterLevel()), 14, volAt(tr.point));
      else explosion(tr.point, sc);
      if (p.type === 'bolt') spark(tr.point, 0x80d0ff, 10);
      done = true;
    } else p.mesh.position.addScaledVector(p.vel, dt);
    if (done) { scene.remove(p.mesh); p.mesh.material.dispose(); projectiles.splice(i, 1); }
  }
}

function updateEffects(dt) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.life -= dt;
    if (p.life <= 0) { scene.remove(p.mesh); p.mesh.material.dispose(); particles.splice(i, 1); continue; }
    p.vel.y -= p.gravity * dt;
    p.mesh.position.addScaledVector(p.vel, dt);
    p.vel.multiplyScalar(1 - Math.min(1, dt * 1.5));
    const k = p.life / p.max;
    p.mesh.scale.setScalar(Math.max(0.01, p.size * (1 + p.grow * (1 - k))));
    p.mesh.material.opacity = Math.min(1, k * 1.5);
    if (p.gravity && p.mesh.position.y < heightAt(p.mesh.position.x, p.mesh.position.z)) { p.vel.set(0, 0, 0); p.gravity = 0; }
  }
  for (let i = beams.length - 1; i >= 0; i--) {
    const b = beams[i];
    b.life -= dt;
    if (b.life <= 0) { scene.remove(b.mesh); b.mesh.material.dispose(); beams.splice(i, 1); continue; }
    b.mesh.material.opacity = b.life / b.max;
  }
}

function updateDead(e, dt) {
  e.deadT += dt;
  e.model.root.userData.heat = Math.max(0.5, 0.95 - e.deadT * 0.03);
  const m = e.model;
  if (e.kind === 'mech') {
    const k = Math.min(1, e.deadT / 1.6);
    m.root.rotation.x = -k * k * 1.35;
    m.root.position.y = e.pos.y - k * 2;
  } else m.root.position.y = e.pos.y - Math.min(1, e.deadT) * 0.6;
  if (Math.random() < dt * 6) smoke(center(e).add(V().set((Math.random() - 0.5) * 3, -2, (Math.random() - 0.5) * 3)), 2.2);
  if (Math.random() < dt * 2) particle(center(e), V().set(0, 3, 0), 0xff7020, 0.4, 1.2, 1, true);
  return e.deadT > 14 && !e.isPlayer;
}

// ---------------------------------------------------------------- cámara
const camLook = V();
function updateCamera(dt) {
  if (state.screen === 'menu' || state.screen === 'hangar') {
    const t = state.time * 0.12;
    const c = player ? player.pos : V();
    camera.position.set(c.x + Math.sin(t) * 26, c.y + 9, c.z + Math.cos(t) * 26);
    camera.lookAt(c.x, c.y + 6, c.z);
    return;
  }
  const p = player;
  const shake = state.shake;
  if (state.mode === 'top' || state.screen === 'dead') {
    const z = state.zoom;
    camLook.lerp(_v1.set(p.pos.x, p.pos.y, p.pos.z), Math.min(1, dt * 6));
    camera.position.set(camLook.x, camLook.y + z, camLook.z + z * 0.42);
    camera.lookAt(camLook);
    if (shake > 0) camera.position.add(_v1.set((Math.random() - 0.5) * shake * 2, 0, (Math.random() - 0.5) * shake * 2));
  } else {
    p.model.root.updateMatrixWorld(true);
    p.model.cockpit.getWorldPosition(camera.position);
    const amt = clamp(Math.abs(p.speed) / 12, 0, 1);
    const bobY = Math.abs(Math.cos(p.phase)) * 0.25 * amt;
    camera.position.y += -bobY + (Math.random() - 0.5) * shake * 0.25;
    camera.position.x += (Math.random() - 0.5) * shake * 0.2;
    camera.rotation.set(p.pitch + (Math.random() - 0.5) * shake * 0.02, p.heading + p.torsoYaw, Math.sin(p.phase) * 0.012 * amt, 'YXZ');
  }
}

// ---------------------------------------------------------------- HUD
const proj = (v) => { const p = v.clone().project(camera); return { x: (p.x + 1) / 2 * VW, y: (1 - p.y) / 2 * VH, ok: p.z < 1 && p.z > -1 }; };

function radarBlips() {
  const list = [];
  for (const e of entities) if (e.alive && !e.isPlayer) list.push({ x: e.pos.x, z: e.pos.z, type: e.kind, targeted: e === state.target });
  return list;
}

function drawMessages() {
  let y = VH * 0.3;
  for (let i = state.msgs.length - 1; i >= 0; i--) {
    const m = state.msgs[i];
    if (m.t <= 0) { state.msgs.splice(i, 1); continue; }
    const a = Math.min(1, m.t * 2);
    g.globalAlpha = a;
    txt(g, m.text, VW / 2, y, { size: 14, align: 'center', color: m.color, glow: 10 });
    g.globalAlpha = 1;
    y += 18;
  }
}

function drawTopHud() {
  const p = player;
  // marcadores de enemigos
  for (const e of entities) {
    if (!e.alive || e.isPlayer) continue;
    const s = proj(center(e));
    if (!s.ok) continue;
    const isT = e === state.target;
    const w = e.kind === 'tank' ? 14 : 20;
    brackets(g, s.x - w / 2, s.y - w / 2, w, w, isT ? C.white : 'rgba(255,90,64,0.8)', 4);
    const r = e.armor.CT / e.maxArmor.CT;
    g.fillStyle = 'rgba(0,0,0,0.5)'; g.fillRect(s.x - 10, s.y - w / 2 - 6, 20, 3);
    g.fillStyle = r > 0.5 ? C.main : r > 0.25 ? C.warn : C.bad; g.fillRect(s.x - 10, s.y - w / 2 - 6, 20 * r, 3);
    if (isT) txt(g, `${e.name} ${Math.round(e.pos.distanceTo(p.pos))}m`, s.x, s.y + w / 2 + 10, { size: 9, align: 'center', color: C.white, glow: 3 });
  }
  // dirección de piernas y torso
  const ps = proj(_v3.set(p.pos.x, p.pos.y + 1, p.pos.z));
  const lf = proj(_v3.copy(p.pos).addScaledVector(fwd(p.heading, _v2), 14));
  g.strokeStyle = 'rgba(134,255,156,0.45)'; g.setLineDash([3, 3]);
  g.beginPath(); g.moveTo(ps.x, ps.y); g.lineTo(lf.x, lf.y); g.stroke(); g.setLineDash([]);
  // cursor / retícula
  let mx = mouse.x * VW, my = mouse.y * VH;
  if (state.input === 'keys') { const a = proj(state.aim); mx = a.x; my = a.y; }
  const col = state.target ? C.bad : C.main;
  g.strokeStyle = col; g.lineWidth = 1.5;
  g.beginPath(); g.arc(mx, my, 7, 0, Math.PI * 2); g.stroke();
  g.beginPath();
  g.moveTo(mx - 13, my); g.lineTo(mx - 4, my); g.moveTo(mx + 4, my); g.lineTo(mx + 13, my);
  g.moveTo(mx, my - 13); g.lineTo(mx, my - 4); g.moveTo(mx, my + 4); g.lineTo(mx, my + 13);
  g.stroke(); g.lineWidth = 1;
  // línea torso -> cursor
  g.strokeStyle = 'rgba(255,176,32,0.35)';
  g.beginPath(); g.moveTo(ps.x, ps.y); g.lineTo(mx, my); g.stroke();

  // paneles
  txt(g, `OLEADA ${state.wave}`, 12, 20, { size: 13 });
  txt(g, `PUNTOS ${String(state.score).padStart(6, '0')}`, 12, 36, { size: 11 });
  txt(g, `HOSTILES ${entities.filter(e => e.alive && !e.isPlayer).length}`, 12, 50, { size: 11, color: C.enemy });
  if (state.track) txt(g, 'SEGUIMIENTO DE BLANCO [R]', 12, 66, { size: 10, color: C.cyan });
  else if (state.input === 'keys') txt(g, `ALCANCE MIRA ${Math.round(state.aimDist)}m [↑↓]`, 12, 66, { size: 9, color: C.dim, glow: 0 });

  const R = 58;
  frame(g, VW - R * 2 - 18, 8, R * 2 + 10, R * 2 + 10, C.dim, 'RADAR 300m');
  drawRadar(g, VW - R - 13, 13 + R, R, p.pos, 0, radarBlips(), 300, state.time);

  const py = VH - 100;
  frame(g, 8, py, 110, 92, C.dim, 'DAÑOS');
  drawDamage(g, 25, py + 5, 7.5, p.armor, p.maxArmor, state.time);

  frame(g, 126, py, 176, 92, C.dim, 'ARMAS');
  drawWeapons(g, 132, py + 8, 164, p.weapons, p.armor, 15, 10);
  txt(g, 'ESP/J G1 · F/K G2 · E/L G3', 132, py + 86, { size: 8, color: C.dim, glow: 0 });

  frame(g, VW - 160, py, 152, 92, C.dim, 'SISTEMAS');
  txt(g, 'CALOR', VW - 152, py + 16, { size: 9 });
  drawHeat(g, VW - 152, py + 20, 136, 12, p.heat, false, state.time);
  txt(g, 'ACELERADOR', VW - 152, py + 46, { size: 9 });
  const tx = VW - 152, tw = 136;
  g.strokeStyle = C.dim; g.strokeRect(tx + 0.5, py + 50.5, tw - 1, 11);
  const zero = tx + tw * 0.4 / 1.4;
  g.fillStyle = p.throttle < 0 ? C.warn : C.main;
  const tv = p.throttle / 1.4 * tw;
  g.fillRect(Math.min(zero, zero + tv), py + 52, Math.abs(tv), 8);
  g.strokeStyle = C.white; g.beginPath(); g.moveTo(zero, py + 48); g.lineTo(zero, py + 64); g.stroke();
  txt(g, `${Math.round(p.speed * 4.5)} KPH`, VW - 152, py + 82, { size: 12 });
  txt(g, `TORSO ${Math.round(THREE.MathUtils.radToDeg(p.torsoYaw))}°`, VW - 16, py + 82, { size: 9, align: 'right' });
}

function drawCockpitHud() {
  const p = player;
  const cx = VW / 2, cy = VH * 0.42;
  // marcadores de enemigos
  for (const e of entities) {
    if (!e.alive || e.isPlayer) continue;
    const c = center(e);
    const s = proj(c);
    if (!s.ok || s.x < 0 || s.x > VW || s.y < 0 || s.y > VH) continue;
    const d = c.distanceTo(camera.position);
    const w = clamp(1600 / d, 8, 90) * (e.kind === 'tank' ? 0.7 : 1);
    const isT = e === state.target;
    brackets(g, s.x - w / 2, s.y - w / 2, w, w, isT ? C.white : 'rgba(255,90,64,0.85)', Math.max(3, w * 0.2));
    if (isT) {
      txt(g, `${e.name}`, s.x + w / 2 + 4, s.y - w / 2 + 8, { size: 9, color: C.white, glow: 3 });
      txt(g, `${Math.round(d)}m`, s.x + w / 2 + 4, s.y - w / 2 + 19, { size: 9, color: C.white, glow: 3 });
      if (Math.sin(state.time * 8) > -0.3) txt(g, state.track ? 'SEGUIMIENTO' : 'BLOQUEO', s.x, s.y + w / 2 + 11, { size: 9, align: 'center', color: state.track ? C.cyan : C.bad });
    }
  }
  // punto de convergencia del arma (proyección del punto de mira)
  const a = proj(state.aim);
  // retícula central
  const col = state.target ? C.bad : C.main;
  g.strokeStyle = col; g.lineWidth = 1.5;
  g.beginPath(); g.arc(cx, cy, 16, -0.4, 0.4); g.stroke();
  g.beginPath(); g.arc(cx, cy, 16, Math.PI - 0.4, Math.PI + 0.4); g.stroke();
  g.beginPath();
  g.moveTo(cx - 30, cy); g.lineTo(cx - 20, cy); g.moveTo(cx + 20, cy); g.lineTo(cx + 30, cy);
  g.moveTo(cx, cy - 26); g.lineTo(cx, cy - 18); g.moveTo(cx, cy + 18); g.lineTo(cx, cy + 26);
  g.stroke();
  g.fillStyle = col; g.fillRect(cx - 1, cy - 1, 2, 2);
  if (a.ok) { g.strokeStyle = 'rgba(255,176,32,0.7)'; g.strokeRect(a.x - 3, a.y - 3, 6, 6); }
  g.lineWidth = 1;

  // brújula superior
  const yaw = p.heading + p.torsoYaw;
  const bearing = ((-THREE.MathUtils.radToDeg(yaw)) % 360 + 360) % 360;
  const bw = 260, bx = cx - bw / 2, by = 22;
  g.fillStyle = 'rgba(0,12,4,0.45)'; g.fillRect(bx, by - 12, bw, 22);
  g.save(); g.beginPath(); g.rect(bx, by - 14, bw, 26); g.clip();
  for (let d = Math.floor((bearing - 60) / 5) * 5; d <= bearing + 60; d += 5) {
    const x = cx + (d - bearing) * (bw / 120);
    const dd = ((d % 360) + 360) % 360;
    g.strokeStyle = C.dim; g.beginPath(); g.moveTo(x, by + 8); g.lineTo(x, by + (dd % 15 === 0 ? 0 : 4)); g.stroke();
    if (dd % 45 === 0) txt(g, { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SO', 270: 'O', 315: 'NO' }[dd], x, by - 2, { size: 9, align: 'center', glow: 3 });
  }
  // marcador de piernas en la brújula
  const legB = ((-THREE.MathUtils.radToDeg(p.heading)) % 360 + 360) % 360;
  let ld = legB - bearing; if (ld > 180) ld -= 360; if (ld < -180) ld += 360;
  const lx = cx + clamp(ld, -60, 60) * (bw / 120);
  g.fillStyle = C.warn; g.beginPath(); g.moveTo(lx, by + 9); g.lineTo(lx - 4, by + 15); g.lineTo(lx + 4, by + 15); g.closePath(); g.fill();
  g.restore();
  txt(g, String(Math.round(bearing)).padStart(3, '0'), cx, by + 24, { size: 10, align: 'center', color: C.white });

  // indicador de giro de torso
  const tyw = 140, tyx = cx - tyw / 2, tyy = cy + 46;
  g.strokeStyle = C.dim; g.beginPath(); g.moveTo(tyx, tyy); g.lineTo(tyx + tyw, tyy); g.stroke();
  const tp = cx + (p.torsoYaw / 1.9) * (-tyw / 2);
  g.fillStyle = C.warn; g.fillRect(cx - 1, tyy - 4, 2, 8);
  g.fillStyle = C.main; g.fillRect(tp - 3, tyy - 3, 6, 6);

  // escala de pitch
  for (let k = -2; k <= 2; k++) {
    const yy = cy + (p.pitch * 180 / Math.PI - k * 10) * 3;
    if (k === 0 || yy < cy - 70 || yy > cy + 70) continue;
    g.strokeStyle = C.faint; g.beginPath(); g.moveTo(cx - 70, yy); g.lineTo(cx - 50, yy); g.moveTo(cx + 50, yy); g.lineTo(cx + 70, yy); g.stroke();
  }

  // acelerador y calor (laterales del parabrisas)
  const bh = 120, byy = cy - bh / 2;
  const lx2 = VW * 0.22;
  g.strokeStyle = C.dim; g.strokeRect(lx2 + 0.5, byy + 0.5, 10, bh);
  const zeroY = byy + bh * (1 / 1.4);
  const th = p.throttle / 1.4 * bh;
  g.fillStyle = p.throttle < 0 ? C.warn : C.main;
  g.fillRect(lx2 + 2, Math.min(zeroY, zeroY - th), 7, Math.abs(th));
  g.strokeStyle = C.white; g.beginPath(); g.moveTo(lx2 - 3, zeroY); g.lineTo(lx2 + 13, zeroY); g.stroke();
  txt(g, `${Math.round(p.speed * 4.5)}`, lx2 + 5, byy + bh + 14, { size: 11, align: 'center' });
  txt(g, 'KPH', lx2 + 5, byy + bh + 24, { size: 8, align: 'center', color: C.dim, glow: 0 });

  const rx = VW * 0.78 - 10;
  drawHeat(g, rx, byy, 11, bh, p.heat, true, state.time);
  txt(g, `${Math.round(p.heat)}`, rx + 5, byy + bh + 14, { size: 11, align: 'center', color: p.heat > 80 ? C.bad : C.main });
  txt(g, 'CALOR', rx + 5, byy + bh + 24, { size: 8, align: 'center', color: C.dim, glow: 0 });

  txt(g, `OLEADA ${state.wave}  ·  ${String(state.score).padStart(6, '0')}`, VW * 0.17 - 8, 22, { size: 10 });
  txt(g, `HOSTILES ${entities.filter(e => e.alive && !e.isPlayer).length}`, VW * 0.83 + 8, 22, { size: 10, align: 'right', color: C.enemy });

  // indicadores de impacto (direccional)
  for (const h of state.hitDirs) {
    const rel = wrap(h.yaw - yaw);
    const ang = -rel - Math.PI / 2;
    g.strokeStyle = `rgba(255,74,48,${Math.min(1, h.t)})`; g.lineWidth = 4;
    g.beginPath(); g.arc(cx, cy, 70, ang - 0.25, ang + 0.25); g.stroke(); g.lineWidth = 1;
  }
}

let screenTimer = 0;
function updateCockpitScreens(dt) {
  screenTimer -= dt;
  if (screenTimer > 0) return;
  screenTimer = 1 / 15;
  const p = player, S = cockpit.screens, t = state.time;
  const bg = (s, title) => {
    const c = s.ctx, w = s.canvas.width, h = s.canvas.height;
    c.fillStyle = '#020a04'; c.fillRect(0, 0, w, h);
    c.strokeStyle = 'rgba(134,255,156,0.08)';
    for (let y = 0; y < h; y += 3) { c.beginPath(); c.moveTo(0, y); c.lineTo(w, y); c.stroke(); }
    txt(c, title, 5, 12, { size: 10, glow: 3 });
    return c;
  };
  if (p.shutdown > 0) {
    for (const k of ['left', 'center', 'right']) {
      const c = S[k].ctx; c.fillStyle = '#000'; c.fillRect(0, 0, S[k].canvas.width, S[k].canvas.height);
      if (Math.sin(t * 6) > 0) txt(c, 'SIN ENERGÍA', S[k].canvas.width / 2, S[k].canvas.height / 2, { size: 12, align: 'center', color: C.bad });
      S[k].tex.needsUpdate = true;
    }
    return;
  }
  let c = bg(S.left, 'DAÑOS');
  drawDamage(c, 37, 18, 8.5, p.armor, p.maxArmor, t);
  S.left.tex.needsUpdate = true;

  c = bg(S.center, 'RADAR');
  const w = S.center.canvas.width, h = S.center.canvas.height;
  drawRadar(c, w / 2, h / 2 + 6, h / 2 - 10, p.pos, p.heading + p.torsoYaw, radarBlips(), 300, t, 0.62);
  txt(c, '300m', w - 5, 12, { size: 9, align: 'right', color: C.dim, glow: 0 });
  S.center.tex.needsUpdate = true;

  c = bg(S.right, 'ARMAS');
  drawWeapons(c, 5, 18, 150, p.weapons, p.armor, 16, 11);
  txt(c, 'CALOR', 5, 96, { size: 9 });
  drawHeat(c, 44, 88, 110, 10, p.heat, false, t);
  S.right.tex.needsUpdate = true;
}

function drawMenu() {
  g.fillStyle = 'rgba(0,8,3,0.55)';
  g.fillRect(0, 0, VW, VH);
  const cx = VW / 2;
  txt(g, 'STEEL HORIZON', cx, 110, { size: 46, align: 'center', glow: 18 });
  txt(g, 'SIMULADOR DE COMBATE MECH  ·  CLASE BATTLETECH', cx, 136, { size: 12, align: 'center', color: C.warn });
  const opts = [
    ['1', 'MODO TÁCTICO', 'vista cenital · el torso sigue al cursor'],
    ['2', 'MODO CABINA', 'primera persona · controles e instrumentos'],
  ];
  menuRects = [];
  opts.forEach(([k, a, b], i) => {
    const y = 190 + i * 64, w = 380, x = cx - w / 2;
    const hover = state.menuSel === i;
    frame(g, x, y, w, 50, hover ? C.main : C.dim);
    if (hover) { g.fillStyle = 'rgba(134,255,156,0.08)'; g.fillRect(x, y, w, 50); }
    txt(g, `[${k}] ${a}`, x + 16, y + 22, { size: 16 });
    txt(g, b, x + 16, y + 40, { size: 10, color: C.dim, glow: 0 });
    menuRects.push({ x, y, w, h: 50, mode: i === 0 ? 'top' : 'cockpit' });
  });
  const lines = [
    'W/S ACELERADOR · A/D GIRAR PIERNAS · X PARAR · C CENTRAR TORSO',
    'FLECHAS APUNTAR TORSO · Q/TAB SIGUIENTE BLANCO · R SEGUIMIENTO',
    'ESPACIO/J LÁSERES · F/K PPC · E/L MISILES LRM',
    'V VISIÓN TÉRMICA · T PALETA CRT · ESC PAUSA',
    'RATÓN OPCIONAL: CLIC IZQ/DER DISPARA · RUEDA ZOOM',
  ];
  lines.forEach((l, i) => txt(g, l, cx, 350 + i * 16, { size: 10, align: 'center', color: C.main, glow: 2 }));
  if (Math.sin(state.time * 4) > 0) txt(g, '↑↓ + ENTER  ·  O PULSE 1 / 2', cx, 432, { size: 12, align: 'center', color: C.white });
  txt(g, `PALETA: ${['COLOR', 'ÁMBAR', 'FÓSFORO VERDE'][state.palette]}`, 10, VH - 10, { size: 9, color: C.dim, glow: 0 });
}
let menuRects = [];

function drawHud() {
  g.clearRect(0, 0, VW, VH);
  if (state.screen === 'menu') { drawMenu(); return; }
  if (state.screen === 'hangar') { drawHangar(); return; }
  if (state.mode === 'top' || state.screen === 'dead') drawTopHud(); else drawCockpitHud();
  if (state.thermal) txt(g, '◉ TÉRMICO [V]', VW / 2, state.mode === 'cockpit' && state.screen !== 'dead' ? 64 : 16, { size: 10, align: 'center', color: C.warn });
  drawMessages();
  if (player.shutdown > 0 && state.screen === 'play') {
    txt(g, `APAGADO — REINICIO EN ${player.shutdown.toFixed(1)}s`, VW / 2, VH * 0.6, { size: 14, align: 'center', color: C.bad });
  } else if (player.heat > 80 && state.screen === 'play' && Math.sin(state.time * 10) > 0) {
    txt(g, '¡PELIGRO: CALOR CRÍTICO!', VW / 2, VH * 0.6, { size: 13, align: 'center', color: C.bad });
  }
  if (state.screen === 'pause') {
    g.fillStyle = 'rgba(0,0,0,0.55)'; g.fillRect(0, 0, VW, VH);
    txt(g, 'PAUSA', VW / 2, VH / 2 - 20, { size: 30, align: 'center' });
    txt(g, 'ENTER / CLIC CONTINUAR  ·  H HANGAR  ·  M MENÚ', VW / 2, VH / 2 + 10, { size: 11, align: 'center', color: C.dim });
  }
  if (state.screen === 'dead') {
    g.fillStyle = 'rgba(30,0,0,0.35)'; g.fillRect(0, 0, VW, VH);
    txt(g, `OLEADA ${state.wave} · ${state.kills} DERRIBOS · ${state.score} PUNTOS`, VW / 2, VH / 2 + 30, { size: 13, align: 'center', color: C.white });
    txt(g, 'ENTER HANGAR  ·  M MENÚ PRINCIPAL', VW / 2, VH / 2 + 52, { size: 11, align: 'center', color: C.dim });
  }
}

// ---------------------------------------------------------------- visión térmica
// Cada objeto con userData.heat (0..1) se dibuja con un material gris según su
// calor; el shader CRT convierte después la luminancia a la paleta térmica.
const thermalMats = new Map();
function thermalMat(h) {
  const k = Math.round(clamp(h, 0, 1) * 40);
  let m = thermalMats.get(k);
  if (!m) {
    const v = Math.pow(k / 40, 2.2);
    m = new THREE.MeshLambertMaterial({ color: new THREE.Color(v * 0.45, v * 0.45, v * 0.45), emissive: new THREE.Color(v * 0.8, v * 0.8, v * 0.8), flatShading: true });
    thermalMats.set(k, m);
  }
  return m;
}
const swapped = [];
const fogSave = new THREE.Color();
function swapThermal(o, h) {
  if (o.userData.keep || o.userData.sky) return;
  if (o.userData.heat !== undefined) h = o.userData.heat;
  if (h !== undefined && o.isMesh) { swapped.push(o, o.material); o.material = thermalMat(h); }
  for (const c of o.children) swapThermal(c, h);
}
function beginThermal() {
  swapped.length = 0;
  swapThermal(scene, undefined);
  world.sky.visible = false;
  fogSave.copy(scene.fog.color);
  scene.fog.color.setRGB(0, 0, 0);
}
function endThermal() {
  for (let i = 0; i < swapped.length; i += 2) swapped[i].material = swapped[i + 1];
  swapped.length = 0;
  world.sky.visible = true;
  scene.fog.color.copy(fogSave);
}
function toggleThermal() {
  state.thermal = !state.thermal;
  sfx.beep(0.7, state.thermal ? 1500 : 700);
  msg(state.thermal ? 'VISIÓN TÉRMICA ACTIVA' : 'VISIÓN NORMAL', C.cyan, 1.5);
}

// ---------------------------------------------------------------- hangar
const SAVE_KEY = 'steelhorizon.hangar.v1';
const hangar = { chassis: 'centinela', cfgs: {}, row: 0, zone: 'desierto', time: 'dusk' };
const HROWS = MOUNTS.length + 4;   // chasis + monturas + zona + hora + desplegar
const ROW_ZONE = MOUNTS.length + 1, ROW_TIME = MOUNTS.length + 2;
const ZONE_IDS = Object.keys(ZONES), TIME_IDS = Object.keys(TIMES);
try {
  const saved = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null');
  if (saved && saved.cfgs) { hangar.chassis = saved.chassis; hangar.cfgs = saved.cfgs; }
  if (saved && ZONES[saved.zone]) hangar.zone = saved.zone;
  if (saved && TIMES[saved.time]) hangar.time = saved.time;
} catch (_) { /* sin almacenamiento */ }

function cfgFor(ch) {
  let cfg = hangar.cfgs[ch.id];
  const valid = cfg && MOUNTS.every(m => cfg[m] && (cfg[m].w === null || optionsFor(ch, m).includes(cfg[m].w)))
    && usedTons(cfg) <= ch.weaponTons;
  if (!valid) cfg = hangar.cfgs[ch.id] = defaultConfig(ch);
  return cfg;
}
function saveHangar() {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify({ chassis: hangar.chassis, cfgs: hangar.cfgs, zone: hangar.zone, time: hangar.time })); } catch (_) { /* ignorar */ }
}

const hangar3d = buildHangar();
function refreshHangarModel() {
  const ch = chassisById(hangar.chassis);
  const cfg = cfgFor(ch);
  const loadout = {};
  for (const m of MOUNTS) loadout[m] = cfg[m].w;
  hangar3d.setMech(ch.colors, loadout, ch.scale);
}

function enterHangar(mode) {
  initAudio();
  state.pendingMode = mode;
  state.screen = 'hangar';
  state.msgs = [];
  hangar.row = 0;
  cockpit.group.visible = false;
  document.exitPointerLock?.();
  refreshHangarModel();
  sfx.ui();
}

function hangarChange(dir) {
  const ch = chassisById(hangar.chassis);
  if (hangar.row === 0) {
    const i = CHASSIS.indexOf(ch);
    hangar.chassis = CHASSIS[(i + dir + CHASSIS.length) % CHASSIS.length].id;
  } else if (hangar.row === ROW_ZONE) {
    hangar.zone = ZONE_IDS[(ZONE_IDS.indexOf(hangar.zone) + dir + ZONE_IDS.length) % ZONE_IDS.length];
    sfx.ui(); saveHangar(); return;
  } else if (hangar.row === ROW_TIME) {
    hangar.time = TIME_IDS[(TIME_IDS.indexOf(hangar.time) + dir + TIME_IDS.length) % TIME_IDS.length];
    sfx.ui(); saveHangar(); return;
  } else if (hangar.row <= MOUNTS.length) {
    const m = MOUNTS[hangar.row - 1];
    const cfg = cfgFor(ch);
    const opts = optionsFor(ch, m);
    const cur = opts.indexOf(cfg[m].w);
    const curT = cfg[m].w ? WEAPONS[cfg[m].w].tons : 0;
    for (let k = 1; k <= opts.length; k++) {
      const cand = opts[((cur + dir * k) % opts.length + opts.length) % opts.length];
      const t = cand ? WEAPONS[cand].tons : 0;
      if (usedTons(cfg) - curT + t <= ch.weaponTons) { cfg[m] = { w: cand, g: defaultGroup(cand) }; break; }
    }
  } else return;
  sfx.ui();
  refreshHangarModel();
  saveHangar();
}
function hangarGroup() {
  const m = MOUNTS[hangar.row - 1];
  if (!m) return;
  const cfg = cfgFor(chassisById(hangar.chassis));
  if (!cfg[m].w) return;
  cfg[m].g = (cfg[m].g + 1) % 3;
  sfx.ui(); saveHangar();
}
function hangarReset() {
  const ch = chassisById(hangar.chassis);
  hangar.cfgs[ch.id] = defaultConfig(ch);
  sfx.beep(0.6, 520); refreshHangarModel(); saveHangar();
}
function deploy() {
  saveHangar();
  startGame(state.pendingMode || 'top');
}

let hangarRects = [];
function bar(x, y, w, h, f, col = C.main) {
  g.strokeStyle = C.dim; g.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  g.fillStyle = col; g.fillRect(x + 2, y + 2, Math.max(0, (w - 4) * clamp(f, 0, 1)), h - 4);
}
function drawHangar() {
  const ch = chassisById(hangar.chassis);
  const cfg = cfgFor(ch);
  const st = stats(ch, cfg);
  const t = state.time;
  hangarRects = [];
  const sel = (r) => hangar.row === r;

  txt(g, `HANGAR · ${state.pendingMode === 'cockpit' ? 'MODO CABINA' : 'MODO TÁCTICO'}`, VW / 2, 24, { size: 15, align: 'center' });
  txt(g, 'CONFIGURACIÓN DEL MECH', VW / 2, 38, { size: 9, align: 'center', color: C.dim, glow: 0 });

  // ---- panel izquierdo: chasis
  const PW = 236, lx = 12, ly = 52;
  frame(g, lx, ly, PW, 262, C.dim, 'CHASIS');
  if (sel(0)) { g.fillStyle = 'rgba(134,255,156,0.10)'; g.fillRect(lx + 2, ly + 4, PW - 4, 44); }
  const arrowCol = sel(0) ? C.white : C.dim;
  txt(g, '◄', lx + 12, ly + 26, { size: 16, color: arrowCol });
  txt(g, '►', lx + PW - 12, ly + 26, { size: 16, align: 'right', color: arrowCol });
  txt(g, ch.name, lx + PW / 2, ly + 26, { size: 18, align: 'center', color: sel(0) ? C.white : C.main });
  txt(g, `${ch.cls} · ${ch.tons} t · ${CHASSIS.indexOf(ch) + 1}/${CHASSIS.length}`, lx + PW / 2, ly + 41, { size: 9, align: 'center', color: C.warn, glow: 2 });
  hangarRects.push({ x: lx, y: ly, w: PW, h: 48, row: 0, arrows: true });

  const rows = [
    ['VELOCIDAD', `${st.kph} KPH`, st.kph / 95],
    ['BLINDAJE', `${st.armor}`, st.armor / 515],
    ['DISIPACIÓN', `${st.dissip.toFixed(1)}/s`, st.dissip / 18],
    ['DAÑO ALFA', `${st.alpha.toFixed(0)}`, st.alpha / 80],
    ['DAÑO/SEG', `${st.dps.toFixed(1)}`, st.dps / 30],
    ['CALOR ALFA', `${st.heat.toFixed(0)}`, st.heat / 40],
  ];
  rows.forEach(([k, v, f], i) => {
    const y = ly + 66 + i * 26;
    txt(g, k, lx + 10, y, { size: 9, glow: 2 });
    txt(g, v, lx + PW - 10, y, { size: 10, align: 'right', color: C.white, glow: 2 });
    bar(lx + 10, y + 4, PW - 20, 8, f, k === 'CALOR ALFA' && st.heat > st.dissip * 3 ? C.warn : C.main);
  });
  const secs = st.heat / st.dissip;
  txt(g, `ALFA COMPLETA → ${secs.toFixed(1)} s PARA DISIPAR`, lx + 10, ly + 230, { size: 9, color: secs > 4 ? C.warn : C.dim, glow: 0 });
  txt(g, `ALCANCE MÁX ${st.maxRange} m`, lx + 10, ly + 246, { size: 9, color: C.dim, glow: 0 });

  // ---- panel de misión: zona y hora
  const my = ly + 270;
  frame(g, lx, my, PW, 76, C.dim, 'MISIÓN');
  [[ROW_ZONE, 'ZONA', ZONES[hangar.zone].name], [ROW_TIME, 'HORA', TIMES[hangar.time].name]].forEach(([r, k, v], i) => {
    const y = my + 4 + i * 35;
    if (sel(r)) { g.fillStyle = 'rgba(134,255,156,0.10)'; g.fillRect(lx + 2, y, PW - 4, 32); }
    txt(g, k, lx + 10, y + 20, { size: 9, color: C.dim, glow: 0 });
    txt(g, '◄', lx + 52, y + 21, { size: 12, color: sel(r) ? C.white : C.faint });
    txt(g, v, lx + 52 + (PW - 72) / 2, y + 21, { size: 12, align: 'center', color: sel(r) ? C.white : C.main });
    txt(g, '►', lx + PW - 10, y + 21, { size: 12, align: 'right', color: sel(r) ? C.white : C.faint });
    hangarRects.push({ x: lx, y, w: PW, h: 32, row: r, arrows: true });
  });

  // ---- panel derecho: armamento
  const rx = VW - PW - 12, ry = 52;
  frame(g, rx, ry, PW, 262, C.dim, 'ARMAMENTO');
  MOUNTS.forEach((m, i) => {
    const r = i + 1, y = ry + 6 + i * 44;
    const w = cfg[m].w ? WEAPONS[cfg[m].w] : null;
    if (sel(r)) { g.fillStyle = 'rgba(134,255,156,0.10)'; g.fillRect(rx + 2, y, PW - 4, 40); }
    const slots = ch.hard[m].split('').map(c => c).join('/');
    txt(g, `${MOUNT_NAME[m]}`, rx + 10, y + 12, { size: 9, color: C.dim, glow: 0 });
    txt(g, `[${slots}]`, rx + PW - 10, y + 12, { size: 9, align: 'right', color: C.cyan, glow: 2 });
    const col = sel(r) ? C.white : w ? C.main : C.dim;
    txt(g, '◄', rx + 10, y + 31, { size: 12, color: sel(r) ? C.white : C.faint });
    txt(g, w ? w.name : '— VACÍO —', rx + 26, y + 31, { size: 13, color: col });
    if (w) txt(g, `${w.tons}t G${cfg[m].g + 1}`, rx + PW - 26, y + 31, { size: 10, align: 'right', color: C.warn, glow: 2 });
    txt(g, '►', rx + PW - 10, y + 31, { size: 12, align: 'right', color: sel(r) ? C.white : C.faint });
    hangarRects.push({ x: rx, y, w: PW, h: 40, row: r, arrows: true });
  });
  // detalle del arma seleccionada
  const sm = MOUNTS[hangar.row - 1];
  const sw = sm && cfg[sm].w ? WEAPONS[cfg[sm].w] : null;
  const dy = ry + 186;
  g.strokeStyle = C.faint; g.beginPath(); g.moveTo(rx + 8, dy - 6); g.lineTo(rx + PW - 8, dy - 6); g.stroke();
  if (sw) {
    const dmg = sw.count ? `${sw.dmg}×${sw.count}` : `${sw.dmg}`;
    txt(g, `${sw.name} · ${SLOT_NAME[sw.slot]}${sw.guided ? ' · GUIADO' : ''}`, rx + 10, dy + 8, { size: 10, color: C.white, glow: 2 });
    txt(g, `DAÑO ${dmg}   CALOR ${sw.heat}   RECARGA ${sw.cd}s`, rx + 10, dy + 24, { size: 9, glow: 1 });
    txt(g, `ALCANCE ${sw.range}m   PESO ${sw.tons}t`, rx + 10, dy + 38, { size: 9, glow: 1 });
    txt(g, 'G CAMBIA GRUPO DE DISPARO', rx + 10, dy + 56, { size: 8, color: C.dim, glow: 0 });
  } else if (hangar.row === ROW_ZONE) {
    const zz = ZONES[hangar.zone];
    txt(g, `${zz.name}: ${zz.desc}`.toUpperCase(), rx + 10, dy + 8, { size: 9, color: C.white, glow: 1 });
    if (zz.waterY !== null) txt(g, 'AGUA: −40% VELOCIDAD, +70% REFRIGERACIÓN', rx + 10, dy + 24, { size: 8, color: C.cyan, glow: 0 });
    if (zz.forest > 0.3) txt(g, 'BOSQUE: COBERTURA, LOS ÁRBOLES CAEN', rx + 10, dy + 38, { size: 8, color: C.main, glow: 0 });
  } else if (hangar.row === ROW_TIME) {
    txt(g, TIMES[hangar.time].name, rx + 10, dy + 8, { size: 10, color: C.white, glow: 1 });
    if (hangar.time === 'night') {
      txt(g, 'VISIBILIDAD REDUCIDA · FOCOS ENCENDIDOS', rx + 10, dy + 24, { size: 8, color: C.warn, glow: 0 });
      txt(g, 'V ACTIVA LA VISIÓN TÉRMICA', rx + 10, dy + 38, { size: 8, color: C.cyan, glow: 0 });
    } else txt(g, 'V VISIÓN TÉRMICA DISPONIBLE', rx + 10, dy + 24, { size: 8, color: C.dim, glow: 0 });
  } else if (sm) {
    txt(g, `MONTURA ${ch.hard[sm].split('').map(c => SLOT_NAME[c]).join(' / ')}`, rx + 10, dy + 8, { size: 9, color: C.dim, glow: 0 });
  } else {
    txt(g, 'E ENERGÍA · B BALÍSTICA · M MISILES', rx + 10, dy + 8, { size: 9, color: C.dim, glow: 0 });
    txt(g, 'TONELAJE LIBRE = DISIPADORES EXTRA', rx + 10, dy + 24, { size: 9, color: C.dim, glow: 0 });
  }

  // ---- carga de armas
  const bw = Math.max(200, Math.min(380, VW - 2 * PW - 64)), bx = VW / 2 - bw / 2, by = VH - 112;
  txt(g, `CARGA DE ARMAS  ${st.tons} / ${ch.weaponTons} t`, bx, by - 6, { size: 11 });
  txt(g, st.free > 0 ? `${st.free} t LIBRES → +${(st.free * HEATSINK_PER_TON).toFixed(1)} DISIPACIÓN` : 'CARGA COMPLETA', VW / 2, by + 24, { size: 9, align: 'center', color: st.free > 0 ? C.cyan : C.warn, glow: 2 });
  const seg = bw / ch.weaponTons;
  for (let i = 0; i < ch.weaponTons; i++) {
    g.fillStyle = i < st.tons ? C.main : 'rgba(95,224,255,0.25)';
    g.fillRect(bx + i * seg + 1, by, Math.max(1, seg - 2), 12);
  }

  // ---- botón desplegar
  const dr = HROWS - 1, dw = 240, dx = VW / 2 - dw / 2, dyb = VH - 82;
  const on = sel(dr);
  frame(g, dx, dyb, dw, 34, on ? C.main : C.dim);
  if (on && Math.sin(t * 6) > -0.2) { g.fillStyle = 'rgba(134,255,156,0.16)'; g.fillRect(dx, dyb, dw, 34); }
  txt(g, '▶ DESPLEGAR  [ENTER]', VW / 2, dyb + 22, { size: 14, align: 'center', color: on ? C.white : C.main });
  hangarRects.push({ x: dx, y: dyb, w: dw, h: 34, row: dr, deploy: true });

  txt(g, '↑↓ ELEGIR · ←→ CAMBIAR · G GRUPO · R RESTABLECER · ENTER DESPLEGAR · ESC MENÚ', VW / 2, VH - 22, { size: 9, align: 'center', color: C.dim, glow: 0 });
}

function hangarKey(code) {
  if (code === 'ArrowUp' || code === 'KeyW') { hangar.row = (hangar.row - 1 + HROWS) % HROWS; sfx.ui(); }
  else if (code === 'ArrowDown' || code === 'KeyS' || code === 'Tab') { hangar.row = (hangar.row + 1) % HROWS; sfx.ui(); }
  else if (code === 'ArrowLeft' || code === 'KeyA') hangarChange(-1);
  else if (code === 'ArrowRight' || code === 'KeyD') hangarChange(1);
  else if (code === 'KeyG') hangarGroup();
  else if (code === 'KeyR') hangarReset();
  else if (code === 'Enter' || (code === 'Space' && hangar.row === HROWS - 1)) deploy();
  else if (code === 'Escape' || code === 'Backspace') toMenu();
}
function hangarClick(x, y) {
  for (const r of hangarRects) {
    if (x < r.x || x > r.x + r.w || y < r.y || y > r.y + r.h) continue;
    hangar.row = r.row;
    if (r.deploy) { deploy(); return; }
    if (r.arrows) {
      if (x < r.x + r.w * 0.3) hangarChange(-1);
      else if (x > r.x + r.w * 0.7) hangarChange(1);
      else sfx.ui();
    }
    return;
  }
}

// ---------------------------------------------------------------- bucle
let last = performance.now();
function frameLoop(now) {
  requestAnimationFrame(frameLoop);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  state.time += dt;

  if (state.screen === 'play') {
    updatePlayer(dt);
    for (const e of entities) if (e.alive && e.ai) updateAI(e, dt);
    for (let i = entities.length - 1; i >= 0; i--) {
      const e = entities[i];
      if (e.alive) moveEntity(e, dt);
      else if (updateDead(e, dt)) { scene.remove(e.model.root); entities.splice(i, 1); }
    }
    updateProjectiles(dt);
    // oleadas
    if (!entities.some(e => e.alive && !e.isPlayer)) {
      if (state.waveTimer <= 0) {
        state.waveTimer = 6;
        msg(`OLEADA ${state.wave} SUPERADA — REPARANDO`, C.cyan, 4);
        for (const k of Object.keys(player.armor)) player.armor[k] = Math.min(player.maxArmor[k], player.armor[k] + player.maxArmor[k] * 0.35);
        for (const k of ['LA', 'RA']) if (player.armor[k] > 0) player.model.sections[k].visible = true;
        if (player.armor.LT > 0) player.model.sideL.visible = true;
        if (player.armor.RT > 0) player.model.sideR.visible = true;
        player.maxSpeed = player.baseSpeed * (player.armor.LEGS < player.maxArmor.LEGS * 0.5 ? 0.45 + player.armor.LEGS / player.maxArmor.LEGS : 1);
      }
      state.waveTimer -= dt;
      if (state.waveTimer <= 0) spawnWave();
    }
    if (player.heat > 80 && Math.floor(state.time * 3) !== Math.floor((state.time - dt) * 3)) sfx.beep(0.6, 1200);
  } else if (state.screen === 'dead') {
    for (let i = entities.length - 1; i >= 0; i--) { const e = entities[i]; if (!e.alive) updateDead(e, dt); else if (e.ai) { e.throttle = 0; moveEntity(e, dt); } }
    updateProjectiles(dt);
  }
  if (state.screen !== 'pause') updateEffects(dt);
  for (const m of state.msgs) if (m.dur < 99) m.t -= dt;
  for (let i = state.hitDirs.length - 1; i >= 0; i--) { state.hitDirs[i].t -= dt; if (state.hitDirs[i].t <= 0) state.hitDirs.splice(i, 1); }

  updateCamera(dt);
  camera.updateMatrixWorld();
  world.update(player ? player.pos : V(), camera, state.screen === 'pause' ? 0 : dt, state.time);

  if (cockpit.group.visible && player) {
    cockpit.update(dt, state.time, {
      throttle: player.throttle, heat: player.heat / 100, damaged: SECTIONS.some(k => k in player.armor && player.armor[k] < player.maxArmor[k] * 0.33),
      mdx: mouse.sdx, mdy: mouse.sdy, firing: mouse.b[0] || mouse.b[2] || keys.Space || keys.KeyJ || keys.KeyF || keys.KeyK, shutdown: player.shutdown > 0,
    });
    updateCockpitScreens(dt);
  }
  mouse.sdx *= 0.8; mouse.sdy *= 0.8;
  mouse.dx = 0; mouse.dy = 0;

  drawHud();
  hudTex.needsUpdate = true;

  state.shake = Math.max(0, state.shake - dt * 2.5);
  state.flash = Math.max(0, state.flash - dt * 2);
  const u = crt.uniforms;
  u.uTime.value = state.time;
  u.uShake.value = state.shake;
  u.uFlash.value = state.flash;
  u.uPalette.value = state.palette;
  u.uThermal.value = state.thermal && state.screen !== 'menu' && state.screen !== 'hangar' ? 1 : 0;
  u.uStatic.value = player && player.shutdown > 0 && state.screen === 'play' ? 0.25 : (state.screen === 'dead' ? 0.12 : 0);

  renderer.setRenderTarget(rt);
  if (state.screen === 'hangar') {
    hangar3d.update(dt, camera.aspect, chassisById(hangar.chassis).scale);
    renderer.render(hangar3d.scene, hangar3d.camera);
  } else {
    if (state.headlight && player) {
      const hl = state.headlight;
      player.model.cockpit.getWorldPosition(hl.position);
      const y = player.heading + player.torsoYaw, pt = player.pitch;
      // por delante y por debajo de la cabina para no iluminar el interior
      hl.position.x -= Math.sin(y) * 4; hl.position.z -= Math.cos(y) * 4; hl.position.y -= 1.5;
      hl.target.position.set(hl.position.x - Math.sin(y) * Math.cos(pt) * 40, hl.position.y + Math.sin(pt) * 40 - 5, hl.position.z - Math.cos(y) * Math.cos(pt) * 40);
    }
    const thermal = state.thermal && state.screen !== 'menu';
    if (thermal) beginThermal();
    renderer.render(scene, camera);
    if (thermal) endThermal();
  }
  crt.render();
}

// ---------------------------------------------------------------- menú de fondo
function setupMenuScene() {
  player = newPlayer();
  placeFree(player, 0, 0);
  player.heading = 0.6;
  moveEntity(player, 0.016);
  entities.push(player);
  applyMode();
}

// ---------------------------------------------------------------- entrada
window.addEventListener('keydown', (e) => {
  keys[e.code] = true;
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code)) e.preventDefault();
  if (e.code.startsWith('Arrow')) state.input = 'keys';
  if (e.code === 'KeyT') { state.palette = (state.palette + 1) % 3; sfx.ui(); }
  if (state.screen === 'menu') {
    if (e.code === 'Digit1' || e.code === 'Numpad1') enterHangar('top');
    if (e.code === 'Digit2' || e.code === 'Numpad2') enterHangar('cockpit');
    if (['ArrowUp', 'ArrowDown', 'KeyW', 'KeyS'].includes(e.code)) { state.menuSel = 1 - state.menuSel; sfx.ui(); }
    if (e.code === 'Enter' || e.code === 'Space') enterHangar(state.menuSel === 0 ? 'top' : 'cockpit');
  } else if (state.screen === 'hangar') {
    if (!e.repeat || e.code.startsWith('Arrow')) hangarKey(e.code);
  } else if (state.screen === 'play') {
    if ((e.code === 'KeyQ' || e.code === 'Tab') && !e.repeat) cycleTarget();
    if (e.code === 'KeyV' && !e.repeat) toggleThermal();
    if (e.code === 'KeyR' && !e.repeat) {
      if (state.track) state.track = false;
      else if (state.target && state.target.alive) { state.track = true; state.input = 'keys'; }
      else cycleTarget();
      sfx.ui();
    }
    if (e.code === 'Escape' || e.code === 'KeyP') { state.screen = 'pause'; document.exitPointerLock?.(); }
  } else if (state.screen === 'pause') {
    if (e.code === 'Enter' || e.code === 'KeyP') resume();
    if (e.code === 'KeyM') toMenu();
    if (e.code === 'KeyH') { clearWorld(); setupMenuScene(); enterHangar(state.mode); }
  } else if (state.screen === 'dead') {
    if (e.code === 'Enter') { clearWorld(); setupMenuScene(); enterHangar(state.mode); }
    if (e.code === 'KeyM') toMenu();
  }
});
window.addEventListener('keyup', (e) => { keys[e.code] = false; });
window.addEventListener('blur', () => { for (const k in keys) keys[k] = false; mouse.b = [false, false, false]; });

function lockPointer() {
  try { const r = renderer.domElement.requestPointerLock?.(); r?.catch?.(() => {}); } catch (_) { /* sin soporte */ }
}
function resume() {
  state.screen = 'play';
  if (state.mode === 'cockpit') lockPointer();
}
function toMenu() {
  clearWorld();
  state.screen = 'menu';
  state.msgs = [];
  setupMenuScene();
}

const cv = renderer.domElement;
cv.addEventListener('mousemove', (e) => {
  mouse.x = e.clientX / window.innerWidth;
  mouse.y = e.clientY / window.innerHeight;
  mouse.ndc.set(mouse.x * 2 - 1, -(mouse.y * 2 - 1));
  if (Math.abs(e.movementX) + Math.abs(e.movementY) > 2 && !state.track) state.input = 'mouse';
  if (state.screen === 'menu') menuRects.forEach((r, i) => {
    const x = mouse.x * VW, y = mouse.y * VH;
    if (x > r.x && x < r.x + r.w && y > r.y && y < r.y + r.h) state.menuSel = i;
  });
  if (document.pointerLockElement === cv) {
    mouse.dx += e.movementX; mouse.dy += e.movementY;
    mouse.sdx += e.movementX; mouse.sdy += e.movementY;
  }
});
cv.addEventListener('mousedown', (e) => {
  initAudio();
  if (state.screen === 'menu') {
    const x = mouse.x * VW, y = mouse.y * VH;
    for (const r of menuRects) if (x > r.x && x < r.x + r.w && y > r.y && y < r.y + r.h) enterHangar(r.mode);
    return;
  }
  if (state.screen === 'hangar') { hangarClick(mouse.x * VW, mouse.y * VH); return; }
  if (state.screen === 'pause') { resume(); return; }
  if (state.screen === 'play' && state.mode === 'cockpit' && document.pointerLockElement !== cv) {
    lockPointer();
    return;
  }
  mouse.b[e.button] = true;
});
window.addEventListener('mouseup', (e) => { mouse.b[e.button] = false; });
cv.addEventListener('contextmenu', (e) => e.preventDefault());
cv.addEventListener('wheel', (e) => { state.zoom = clamp(state.zoom + e.deltaY * 0.06, 35, 160); }, { passive: true });
document.addEventListener('pointerlockchange', () => {
  if (document.pointerLockElement !== cv && state.screen === 'play' && state.mode === 'cockpit') state.screen = 'pause';
});

setupMenuScene();
requestAnimationFrame(frameLoop);
// acceso para depuración
window.__game = { state, hangar, heightAt, get world() { return world; }, get player() { return player; }, get entities() { return entities; }, startGame, enterHangar };
