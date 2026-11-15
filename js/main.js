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
  zoom: 260,          // altura fija de la cámara táctica (apertura máxima)
  input: 'keys',      // keys | mouse (último dispositivo usado para apuntar)
  track: false,       // seguimiento automático del blanco
  aimDist: 120,
  menuSel: 0,
  training: false, trainArmed: false, showLessons: true, lessons: null, respawns: [],
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
function msg(text, color = C.main, dur = 3) {
  state.msgs.push({ text, color, t: dur, dur });
  // como máximo 4 mensajes temporales en pantalla
  const temp = state.msgs.filter(m => m.dur < 99);
  if (temp.length > 4) state.msgs.splice(state.msgs.indexOf(temp[0]), 1);
}

// ---------------------------------------------------------------- entidades
function createMech(o) {
  const sc = o.scale ?? 1;
  const model = buildMech(o.colors, { loadout: o.loadout, scale: sc });
  scene.add(model.root);
  return {
    kind: 'mech', name: o.name, model, isPlayer: !!o.isPlayer, scale: sc, team: o.team ?? (o.isPlayer ? 'A' : 'B'),
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
    isPlayer: o.isPlayer, team: o.team, name: o.name ?? ch.name, colors: o.colors ?? ch.colors, scale: ch.scale, loadout,
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
    kind: 'tank', name: 'TANQUE', model, isPlayer: false, team: 'B',
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
  for (const p of pods) scene.remove(p.mesh);
  pods.length = 0;
  if (state.battle?.beacon) scene.remove(state.battle.beacon.group);
  state.battle = null; state.ejected = false; state.ejectHold = 0;
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
  state.battle = null;
  if (state.training) startTraining();
  else if (state.battleMode) startBattle();
  else spawnWave();
  if (!state.training && !state.battleMode) msg(mode === 'top' ? 'MODO TÁCTICO — FLECHAS APUNTAR · Q BLANCO' : 'MODO CABINA — FLECHAS APUNTAR · Q BLANCO', C.cyan, 4);
  state.track = false; state.aimDist = 120;
}

function applyMode() {
  const cock = state.mode === 'cockpit' && state.screen !== 'menu' && !state.ejected;
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
  if (src) e.lastHitBy = src;
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
  const dead = e.armor.CT <= 0 || (e.armor.LEGS !== undefined && e.armor.LEGS <= 0);
  if (dead && e.isPlayer && state.training) { repairPlayer(1); msg('MECH DESTRUIDO — REPARADO (ENTRENAMIENTO)', C.warn, 3); return; }
  if (dead) kill(e);
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
  if (state.battleMode) battleKill(e);
  if (e.isPlayer && state.battleMode) {
    state.ejected = true; state.deaths++;
    state.flash = 0.6; state.target = null; state.track = false;
    msg('MECH PERDIDO — ¡EYECCIÓN!', C.bad, 3);
    cockpit.group.visible = false;
    player.model.root.visible = true;
  } else if (e.isPlayer) {
    state.screen = 'dead';
    state.flash = 0.8;
    msg('MECH DESTRUIDO', C.bad, 99);
    document.exitPointerLock?.();
    cockpit.group.visible = false;
    player.model.root.visible = true;
  } else if (state.battleMode && e.team === 'A') {
    if (state.target === e) state.target = null;
    msg(`${e.name} DERRIBADO — PILOTO EYECTADO`, C.ally, 2.5);
  } else {
    const mine = !state.battleMode || e.lastHitBy === player;
    if (mine) { state.score += e.value; state.kills++; }
    else state.score += Math.round(e.value * 0.25);
    if (state.training) { lesson('kill'); state.respawns.push({ type: e.trainType ?? 'static', t: 4 }); }
    if (state.target === e) state.target = null;
    msg(mine ? `${e.name} ELIMINADO +${e.value}` : `${e.name} ELIMINADO POR LA ESCUADRA`, C.main, 2);
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
  if (fired && e.isPlayer) lesson('g' + group);
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

// ---------------------------------------------------------------- visibilidad
// Un enemigo es "visible" (y por tanto fijable) si está en pantalla, dentro del
// alcance visual (niebla / noche; la térmica ve más lejos y a través del follaje)
// y en línea de visión desde la cabina del jugador. Se recalcula 10 veces por
// segundo y se mantiene 0,6 s para que el blanco no parpadee.
const VIS_GRACE = 0.6;
let visTimer = 0;
function visRange() { return state.thermal ? 650 : world.T.fogFar * 0.85; }
function updateVisibility(dt) {
  visTimer -= dt;
  if (visTimer > 0 || !player || !player.alive) return;
  visTimer = 0.1;
  player.model.root.updateMatrixWorld(true);
  const eye = player.model.cockpit.getWorldPosition(V());
  const range = visRange();
  for (const e of entities) {
    if (!e.alive || !hostile(e, player)) continue;
    const c = center(e);
    const p = c.clone().project(camera);
    if (p.z > 1 || Math.abs(p.x) > 1.02 || Math.abs(p.y) > 1.02) continue;
    const d = Math.hypot(c.x - eye.x, c.z - eye.z);
    if (d > range) continue;
    if (!state.thermal && d > 150 && world.forestCover(e.pos.x, e.pos.z) >= 4) continue;
    const dir = c.clone().sub(eye);
    const len = dir.length(); dir.normalize();
    const tr = traceSegment(eye, dir, len + 2, player);
    if (tr.ent === e) e.seenT = state.time;
  }
}
const isVisible = (e) => e.alive && e.seenT !== undefined && state.time - e.seenT < VIS_GRACE;

// ---------------------------------------------------------------- jugador
// Control por teclado: flechas apuntan el torso, Q/Tab cicla blancos (y activa
// el seguimiento automático del torso), R activa/desactiva el seguimiento.
function cycleTarget() {
  const list = entities.filter(e => e.alive && hostile(e, player) && isVisible(e))
    .sort((a, b) => a.pos.distanceTo(player.pos) - b.pos.distanceTo(player.pos));
  if (!list.length) { msg('SIN BLANCOS VISIBLES', C.dim, 1.2); return; }
  const i = list.indexOf(state.target);
  state.target = list[(i + 1) % list.length];
  lesson('target');
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
  if (state.target && !isVisible(state.target)) {
    if (state.track) msg('BLANCO PERDIDO — SIN LÍNEA DE VISIÓN', C.warn, 1.5);
    state.target = null; state.track = false;
  }
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
        if (!e.alive || !hostile(e, p) || !isVisible(e)) continue;
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
      state.aimDist = clamp(state.aimDist + ay * 120 * dt, 15, 320);
      if (state.track) {
        tgt = state.target;
        if (powered) turnTorsoTo(p, yawTo(p.pos, tgt.pos), 2.6, dt);
      } else {
        // fijación suave: enemigo dentro del cono del torso
        const ty = p.heading + p.torsoYaw;
        let best = 0.14;
        for (const e of entities) {
          if (!e.alive || !hostile(e, p) || !isVisible(e)) continue;
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
        if (!e.alive || !hostile(e, p) || !isVisible(e)) continue;
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
// Cada IA elige como blanco al enemigo (de otro equipo) más cercano. Con
// ai.goal (batalla) los atacantes van al punto y los defensores lo vigilan;
// el torso dispara mientras las piernas se mueven hacia el objetivo.
const hostile = (a, b) => a.team !== b.team;
function updateAI(e, dt) {
  const ai = e.ai;
  if (e.shutdown > 0) { e.throttle = 0; return; }
  ai.t -= dt; ai.fireT -= dt; ai.scan = (ai.scan ?? 0) - dt;
  // orden de escuadra (sólo aliados del jugador en batalla)
  const ord = state.battleMode && state.battle && e.team === 'A' ? state.battle.order : null;
  const ordType = ord ? ord.type : 'free';
  if (ordType === 'attack' && ord.target.alive) ai.target = ord.target;
  else if (ai.scan <= 0 || !ai.target || !ai.target.alive) {
    ai.scan = 0.8 + Math.random() * 0.8;
    let best = null, bd = ai.sense ?? Infinity;
    for (const o of entities) {
      if (!o.alive || !hostile(e, o)) continue;
      const d = Math.hypot(o.pos.x - e.pos.x, o.pos.z - e.pos.z) * (o.isPlayer ? 0.85 : 1);
      if (d < bd) { bd = d; best = o; }
    }
    ai.target = best;
  }
  const tgt = ai.target;
  let desired = e.heading;
  e.throttle = 0;
  const goal = ai.goal;
  const dGoal = goal ? Math.hypot(goal.x - e.pos.x, goal.z - e.pos.z) : 0;
  const dT = tgt ? Math.hypot(tgt.pos.x - e.pos.x, tgt.pos.z - e.pos.z) : Infinity;
  const R = state.battle ? state.battle.radius : 0;
  if (ordType === 'follow' && player.alive) {
    // formación en cuña detrás del jugador
    const slot = followSlot(e);
    const d = Math.hypot(slot.x - e.pos.x, slot.z - e.pos.z);
    if (d > 10) { desired = yawTo(e.pos, slot); e.throttle = d > 30 ? 1 : 0.35 + (d - 10) / 20 * 0.65; }
    else { desired = player.heading; e.throttle = clamp(player.speed / e.maxSpeed, -0.3, 1); }
    ai.status = 'SIGUIENDO';
  } else if (ordType === 'attack' && tgt && tgt.alive) {
    const toYaw = yawTo(e.pos, tgt.pos);
    if (dT > ai.range) { desired = toYaw; e.throttle = 1; }
    else { desired = toYaw + Math.PI / 2 * ai.strafe; e.throttle = 0.75; }
    ai.status = 'ATACANDO';
  } else if (ordType === 'point' && goal) {
    if (dGoal > R * 0.5) { desired = yawTo(e.pos, goal); e.throttle = 1; ai.status = 'AL PUNTO'; }
    else { desired = yawTo(e.pos, goal) + Math.PI / 2 * ai.strafe; e.throttle = 0.35; ai.status = 'EN EL PUNTO'; }
  } else if (goal && ai.role === 'attack' && dGoal > R * 0.6) {
    desired = yawTo(e.pos, goal); e.throttle = 1;                   // avanzar hacia el punto
    ai.status = 'AVANZANDO';
  } else if (goal && ai.role === 'defend' && dGoal > ai.leash) {
    desired = yawTo(e.pos, goal); e.throttle = 1;                   // volver a la zona
    ai.status = 'REPLEGANDO';
  } else if (tgt && dT < (goal ? 320 : Infinity)) {
    ai.status = 'COMBATE';
    const toYaw = yawTo(e.pos, tgt.pos);
    if (dT > ai.range + 40) { desired = toYaw; e.throttle = 1; }
    else if (dT < ai.range - 40) { desired = toYaw + Math.PI * 0.75 * ai.strafe; e.throttle = 0.7; }
    else { desired = toYaw + Math.PI / 2 * ai.strafe; e.throttle = 0.75; }
  } else if (goal) {
    desired = yawTo(e.pos, goal) + Math.PI / 2 * ai.strafe; e.throttle = 0.4;  // patrullar el punto
    ai.status = 'PATRULLANDO';
  }
  if (ai.t < 0) { ai.t = 3 + Math.random() * 4; if (Math.random() < 0.6) ai.strafe *= -1; }
  // atasco -> rodeo
  if (e.throttle > 0.5 && (e.realSpeed ?? 1) < e.maxSpeed * 0.15) ai.stuck += dt; else ai.stuck = Math.max(0, ai.stuck - dt);
  if (ai.stuck > 0.8) { ai.avoid = 1.5; ai.stuck = 0; ai.strafe *= -1; }
  if (ai.avoid > 0) { ai.avoid -= dt; desired = e.heading + 1.2 * ai.strafe; if (!e.throttle) e.throttle = 0.6; }
  if (ai.static) e.throttle = 0;   // diana fija: sólo gira el torso
  else e.heading = wrap(e.heading + clamp(wrap(desired - e.heading), -e.turnRate * dt, e.turnRate * dt));
  // torso / torreta
  const lim = e.kind === 'tank' ? Math.PI : 1.7;
  if (!tgt || dT > 480) { e.torsoYaw += clamp(-e.torsoYaw, -2 * dt, 2 * dt); return; }
  const toYaw = yawTo(e.pos, tgt.pos);
  const tDes = clamp(wrap(toYaw - e.heading), -lim, lim);
  e.torsoYaw += clamp(wrap(tDes - e.torsoYaw), -2 * dt, 2 * dt);
  const aligned = Math.abs(wrap(toYaw - e.heading - e.torsoYaw)) < 0.18;
  if (!aligned || ai.fireT > 0 || e.heat > 70) return;
  if (state.training && !state.trainArmed) return;   // dianas sin munición
  // línea de visión
  const eye = center(e);
  const pc = center(tgt);
  const dir = pc.clone().sub(eye);
  const d3 = dir.length(); dir.normalize();
  const tr = traceSegment(eye, dir, d3 + 2, e);
  if (tr.ent !== tgt) { ai.fireT = 0.5; return; }
  const cover = world.forestCover(tgt.pos.x, tgt.pos.z) >= 4;
  if (cover && d3 > 150) { ai.fireT = 0.6; return; }   // oculto en el bosque
  const usable = e.weapons.filter(w => w.cd <= 0 && e.armor[w.sec] > 0 && d3 < w.def.range);
  if (!usable.length) return;
  const w = usable[Math.floor(Math.random() * usable.length)];
  const spread = ((1 - ai.skill) * (d3 * 0.05 + tgt.speed * 0.25) + 0.8) * (cover ? 1.8 : 1);
  const aim = pc.add(V().set((Math.random() - 0.5) * spread, (Math.random() - 0.5) * spread * 0.6, (Math.random() - 0.5) * spread));
  fireWeapon(e, w, aim, tgt);
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
  const pod = state.ejected ? playerPod() : null;
  const focus = pod ? pod.mesh.position : p.pos;
  if (pod && state.mode === 'cockpit' && state.screen !== 'result') {
    // cámara de persecución detrás de la cápsula de eyección
    const y = pod.mesh.rotation.y;
    camLook.lerp(_v1.set(focus.x + Math.sin(y) * 18, focus.y + 7, focus.z + Math.cos(y) * 18), Math.min(1, dt * 3));
    camera.position.copy(camLook);
    camera.lookAt(focus.x, focus.y + 1, focus.z);
    return;
  }
  if (state.mode === 'top' || state.screen === 'dead' || state.screen === 'result' || pod) {
    const z = state.zoom;
    // anticipación: la cámara se adelanta hacia donde apunta el torso
    const ahead = pod || !p.alive ? 0 : 45;
    const fy = p.heading + p.torsoYaw;
    camLook.lerp(_v1.set(focus.x - Math.sin(fy) * ahead, focus.y, focus.z - Math.cos(fy) * ahead), Math.min(1, dt * 2.5));
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
  for (const e of entities) {
    if (!e.alive || e === player) continue;
    const ally = !hostile(e, player);
    list.push({ x: e.pos.x, z: e.pos.z, type: e.kind, targeted: e === state.target, color: ally ? C.ally : isVisible(e) ? undefined : 'rgba(255,90,64,0.35)' });
  }
  if (state.battleMode && state.battle) list.push({ x: state.battle.point.x, z: state.battle.point.z, type: 'obj', r: state.battle.radius, color: C.white });
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

const isSquadTarget = (e) => state.battleMode && state.battle?.order.type === 'attack' && state.battle.order.target === e;
function squadTag(x, y) {
  g.strokeStyle = C.ally; g.lineWidth = 1.5;
  g.beginPath(); g.moveTo(x, y - 5); g.lineTo(x + 5, y); g.lineTo(x, y + 5); g.lineTo(x - 5, y); g.closePath(); g.stroke();
  g.lineWidth = 1;
  txt(g, 'ESCUADRA', x + 8, y + 3, { size: 7, color: C.ally, glow: 2 });
}

// aliado: chevrón azul y nombre
function allyMarker(e, x, y, label) {
  g.fillStyle = C.ally; g.shadowColor = C.ally; g.shadowBlur = 4;
  g.beginPath(); g.moveTo(x - 5, y - 4); g.lineTo(x, y + 2); g.lineTo(x + 5, y - 4); g.lineTo(x, y - 1); g.closePath(); g.fill();
  g.shadowBlur = 0;
  if (label) txt(g, e.name, x, y - 7, { size: 8, align: 'center', color: C.ally, glow: 2 });
}

function drawTopHud() {
  const p = player;
  // marcadores de enemigos
  for (const e of entities) {
    if (!e.alive || e.isPlayer) continue;
    const s = proj(center(e));
    if (!s.ok) continue;
    if (!hostile(e, p)) { allyMarker(e, s.x, s.y - 14, true); continue; }
    if (!isVisible(e)) {
      // en pantalla pero sin línea de visión / fuera de alcance visual: no fijable
      g.setLineDash([2, 3]);
      brackets(g, s.x - 8, s.y - 8, 16, 16, 'rgba(255,90,64,0.35)', 4);
      g.setLineDash([]);
      continue;
    }
    const isT = e === state.target;
    const w = e.kind === 'tank' ? 14 : 20;
    brackets(g, s.x - w / 2, s.y - w / 2, w, w, isT ? C.white : 'rgba(255,90,64,0.8)', 4);
    if (isSquadTarget(e)) squadTag(s.x, s.y - w / 2 - 12);
    const r = e.armor.CT / e.maxArmor.CT;
    g.fillStyle = 'rgba(0,0,0,0.5)'; g.fillRect(s.x - 10, s.y - w / 2 - 6, 20, 3);
    g.fillStyle = r > 0.5 ? C.main : r > 0.25 ? C.warn : C.bad; g.fillRect(s.x - 10, s.y - w / 2 - 6, 20 * r, 3);
    if (isT) txt(g, `${e.name} ${Math.round(e.pos.distanceTo(p.pos))}m`, s.x, s.y + w / 2 + 10, { size: 9, align: 'center', color: C.white, glow: 3 });
  }
  // dirección de piernas y torso
  const ps = proj(_v3.set(p.pos.x, p.pos.y + 1, p.pos.z));
  if (p.alive) {
    const pc = proj(center(p));
    g.strokeStyle = 'rgba(134,255,156,0.7)'; g.lineWidth = 1.5;
    g.beginPath(); g.arc(pc.x, pc.y, 13, 0, Math.PI * 2); g.stroke(); g.lineWidth = 1;
  }
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
  txt(g, state.training ? 'ENTRENAMIENTO' : state.battleMode ? 'BATALLA 5 VS 5' : `OLEADA ${state.wave}`, 12, 20, { size: 13, color: state.training ? C.cyan : C.main });
  txt(g, `PUNTOS ${String(state.score).padStart(6, '0')}`, 12, 36, { size: 11 });
  txt(g, `HOSTILES ${entities.filter(e => e.alive && hostile(e, player)).length}`, 12, 50, { size: 11, color: C.enemy });
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
    if (!hostile(e, p)) { allyMarker(e, s.x, s.y - clamp(1600 / d, 8, 90) * 0.6, d < 220); continue; }
    if (!isVisible(e)) continue;
    const w = clamp(1600 / d, 8, 90) * (e.kind === 'tank' ? 0.7 : 1);
    const isT = e === state.target;
    brackets(g, s.x - w / 2, s.y - w / 2, w, w, isT ? C.white : 'rgba(255,90,64,0.85)', Math.max(3, w * 0.2));
    if (isSquadTarget(e)) squadTag(s.x, s.y - w / 2 - 10);
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

  txt(g, `${state.training ? 'ENTRENAMIENTO' : state.battleMode ? 'BATALLA' : 'OLEADA ' + state.wave}  ·  ${String(state.score).padStart(6, '0')}`, VW * 0.17 - 8, 22, { size: 10 });
  txt(g, `HOSTILES ${entities.filter(e => e.alive && hostile(e, player)).length}`, VW * 0.83 + 8, 22, { size: 10, align: 'right', color: C.enemy });

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
    ['1', 'MODO TÁCTICO', 'vista cenital · campaña por oleadas'],
    ['2', 'MODO CABINA', 'primera persona · campaña por oleadas'],
    ['3', 'ENTRENAMIENTO', 'práctica libre · dianas · lecciones · B cambia de vista'],
    ['4', 'BATALLA 5 VS 5', 'asalto o defensa de un punto · escuadra aliada · eyección'],
  ];
  menuRects = [];
  opts.forEach(([k, a, b], i) => {
    const y = 152 + i * 49, w = 420, x = cx - w / 2;
    const hover = state.menuSel === i;
    frame(g, x, y, w, 42, hover ? C.main : C.dim);
    if (hover) { g.fillStyle = 'rgba(134,255,156,0.08)'; g.fillRect(x, y, w, 42); }
    txt(g, `[${k}] ${a}`, x + 16, y + 19, { size: 15, color: i === 2 ? C.cyan : i === 3 ? C.warn : C.main });
    txt(g, b, x + 16, y + 34, { size: 10, color: C.dim, glow: 0 });
    menuRects.push({ x, y, w, h: 42, sel: i });
  });
  const lines = [
    'W/S ACELERADOR · A/D GIRAR PIERNAS · X PARAR · C CENTRAR TORSO',
    'FLECHAS APUNTAR TORSO · Q/TAB SIGUIENTE BLANCO · R SEGUIMIENTO',
    'ESPACIO/J GRUPO 1 · F/K GRUPO 2 · E/L GRUPO 3',
    'V VISIÓN TÉRMICA · T PALETA CRT · ESC PAUSA',
    'RATÓN OPCIONAL: CLIC IZQ/DER DISPARA',
  ];
  lines.forEach((l, i) => txt(g, l, cx, 358 + i * 15, { size: 10, align: 'center', color: C.main, glow: 2 }));
  if (Math.sin(state.time * 4) > 0) txt(g, '↑↓ + ENTER  ·  O PULSE 1 / 2 / 3 / 4', cx, 442, { size: 12, align: 'center', color: C.white });
  txt(g, `PALETA: ${['COLOR', 'ÁMBAR', 'FÓSFORO VERDE'][state.palette]}`, 10, VH - 10, { size: 9, color: C.dim, glow: 0 });
}
let menuRects = [];

function drawHud() {
  g.clearRect(0, 0, VW, VH);
  if (state.screen === 'menu') { drawMenu(); return; }
  if (state.screen === 'hangar') { drawHangar(); return; }
  if (state.mode === 'top' || state.screen === 'dead' || state.screen === 'result' || state.ejected) drawTopHud(); else drawCockpitHud();
  if (state.battleMode) { drawBattleHud(); if (state.battle && state.screen !== 'result') drawSquadPanel(); }
  if (state.training && state.screen === 'play') drawLessons();
  if (state.thermal) txt(g, '◉ TÉRMICO [V]', VW / 2, state.battleMode ? (state.mode === 'cockpit' && !state.ejected ? 140 : 68) : state.mode === 'cockpit' && state.screen !== 'dead' ? 64 : 16, { size: 10, align: 'center', color: C.warn });
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
  if (state.screen === 'result') drawResult();
  if (state.screen === 'dead') {
    g.fillStyle = 'rgba(30,0,0,0.35)'; g.fillRect(0, 0, VW, VH);
    txt(g, `OLEADA ${state.wave} · ${state.kills} DERRIBOS · ${state.score} PUNTOS`, VW / 2, VH / 2 + 30, { size: 13, align: 'center', color: C.white });
    txt(g, 'ENTER HANGAR  ·  M MENÚ PRINCIPAL', VW / 2, VH / 2 + 52, { size: 11, align: 'center', color: C.dim });
  }
}

// ---------------------------------------------------------------- batalla 5 vs 5
// Dos escuadras de 5 mechs. Asalto: tu equipo debe capturar el punto ALFA.
// Defensa: debe impedirlo hasta que acabe el tiempo. Refuerzos limitados
// (tickets); al ser destruido el piloto se eyecta y reaparece en su base.
const ALLY_COLORS = { base: 0x56667c, dark: 0x20252c, accent: 0x3a80d0, glass: 0x60c0ff };
const ROSTER = { A: ['medium', 'light', 'heavy', 'medium'], B: ['light', 'medium', 'heavy', 'medium', 'light'] };
const BATTLE = { radius: 32, time: 360, tickets: 10, respawnAI: 10, respawnPlayer: 8 };
const other = (t) => (t === 'A' ? 'B' : 'A');
const pods = [];

function battleMech(type, team, idx) {
  const t = ENEMY_TYPES[type];
  const e = mechFromChassis(chassisById(t.ch), quickCfg(t.cfg), {
    team, name: team === 'A' ? `LANZA-${idx}` : `${t.name}-${idx}`,
    colors: team === 'A' ? ALLY_COLORS : ENEMY_COLORS[t.colors],
    armorMult: 0.9, speedMult: t.speedMult, value: t.value, ai: t.ai,
  });
  e.btype = type;
  if (team === 'A') e.slot = (idx - 2) % 4;
  const b = state.battle;
  e.ai.goal = b.point;
  e.ai.role = team === b.attackers ? 'attack' : 'defend';
  e.ai.leash = 40 + Math.random() * 50;
  e.ai.sense = 420;
  return e;
}

function spawnAtBase(e, team) {
  const base = state.battle.base[team];
  placeFree(e, base.x + (Math.random() - 0.5) * 50, base.z + (Math.random() - 0.5) * 50);
  e.heading = yawTo(e.pos, state.battle.point);
  entities.push(e);
  moveEntity(e, 0.016);
  return e;
}

function buildBeacon(p, r) {
  const group = new THREE.Group();
  group.userData.keep = true;
  const capMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const postMat = new THREE.MeshLambertMaterial({ color: 0x2a2a28, flatShading: true });
  for (let i = 0; i < 28; i++) {
    const a = i / 28 * Math.PI * 2;
    const x = p.x + Math.sin(a) * r, z = p.z + Math.cos(a) * r, y = heightAt(x, z);
    const post = new THREE.Mesh(boxGeo, postMat);
    post.scale.set(0.5, 2.6, 0.5); post.position.set(x, y + 1.3, z);
    const cap = new THREE.Mesh(boxGeo, capMat);
    cap.scale.set(0.8, 0.45, 0.8); cap.position.set(x, y + 2.8, z);
    group.add(post, cap);
  }
  const beamMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false });
  const beamMesh = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.4, 220, 10, 1, true), beamMat);
  beamMesh.position.set(p.x, p.y + 110, p.z);
  group.add(beamMesh);
  scene.add(group);
  return { group, capMat, beamMat };
}

function startBattle() {
  const att = hangar.objective === 'assault' ? 'A' : 'B';
  const b = state.battle = {
    attackers: att, radius: BATTLE.radius, capture: 0, timer: BATTLE.time,
    tickets: { A: BATTLE.tickets, B: BATTLE.tickets }, respawns: [], over: false,
    milestone: 0, contested: false, wasContested: false, inside: { A: 0, B: 0 },
    deaths: 0, counter: { A: 5, B: 5 }, order: { type: 'free' },
  };
  // punto ALFA cerca del centro, en seco y libre de edificios
  const tmp = { radius: 14, pos: V() };
  placeFree(tmp, (Math.random() - 0.5) * 140, (Math.random() - 0.5) * 140);
  b.point = tmp.pos.clone();
  const a = Math.random() * Math.PI * 2;
  const dir = V().set(Math.sin(a), 0, Math.cos(a));
  const lim = (v) => { v.x = clamp(v.x, -BOUND + 30, BOUND - 30); v.z = clamp(v.z, -BOUND + 30, BOUND - 30); return v; };
  b.base = { [att]: lim(b.point.clone().addScaledVector(dir, 290)), [other(att)]: lim(b.point.clone().addScaledVector(dir, -95)) };
  b.beacon = buildBeacon(b.point, b.radius);
  // escuadras
  player.name = 'LANZA-1';
  entities.splice(entities.indexOf(player), 1);
  spawnAtBase(player, 'A');
  ROSTER.A.forEach((t, i) => spawnAtBase(battleMech(t, 'A', i + 2), 'A'));
  ROSTER.B.forEach((t, i) => spawnAtBase(battleMech(t, 'B', i + 1), 'B'));
  state.ejected = false; state.ejectHold = 0; state.deaths = 0;
  msg(att === 'A' ? 'ASALTO — CAPTURAD EL PUNTO ALFA' : 'DEFENSA — PROTEGED EL PUNTO ALFA', C.warn, 5);
  msg('1-4 ÓRDENES A LA ESCUADRA · Z MANTENIDO: EYECCIÓN · B VISTA', C.dim, 6);
}

function eject(e, isPlayer) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(boxGeo, new THREE.MeshLambertMaterial({ color: 0x8a8a80, flatShading: true }));
  body.scale.set(1.4, 1.1, 1.8);
  const glass = new THREE.Mesh(boxGeo, new THREE.MeshBasicMaterial({ color: e.team === 'A' ? 0x60c0ff : 0xff6040 }));
  glass.scale.set(1.0, 0.4, 0.1); glass.position.set(0, 0.2, -0.92);
  const chute = new THREE.Mesh(new THREE.ConeGeometry(4.5, 2.4, 8, 1, true),
    new THREE.MeshLambertMaterial({ color: e.team === 'A' ? 0x3a70c0 : 0xd06020, side: THREE.DoubleSide, flatShading: true }));
  chute.position.y = 7; chute.visible = false;
  const cable = new THREE.Mesh(boxGeo, new THREE.MeshBasicMaterial({ color: 0x222222 }));
  cable.scale.set(0.08, 5.5, 0.08); cable.position.y = 3.6; cable.visible = false;
  g.add(body, glass, chute, cable);
  e.model.root.updateMatrixWorld(true);
  e.model.cockpit.getWorldPosition(g.position);
  g.rotation.y = e.heading + (e.torsoYaw || 0);
  g.userData.heat = 0.85;
  scene.add(g);
  pods.push({ mesh: g, chute, cable, vel: V().set((Math.random() - 0.5) * 6, 34, (Math.random() - 0.5) * 6), t: 0, landed: false, player: isPlayer });
  sfx.missile(volAt(g.position));
  return pods[pods.length - 1];
}

function updatePods(dt) {
  for (let i = pods.length - 1; i >= 0; i--) {
    const p = pods[i];
    p.t += dt;
    if (!p.landed) {
      p.vel.y -= 20 * dt;
      if (p.vel.y < 3 && !p.chute.visible) { p.chute.visible = p.cable.visible = true; }
      if (p.chute.visible) { p.vel.y = Math.max(p.vel.y, -5); p.vel.x *= 1 - dt * 0.3; p.vel.z *= 1 - dt * 0.3; p.mesh.rotation.z = Math.sin(p.t * 1.7) * 0.12; }
      else if (Math.random() < 0.8) { particle(p.mesh.position.clone(), V().set(0, -4, 0), 0x6a625a, 1.2, 0.7, 1.4, false); particle(p.mesh.position.clone(), V(), 0xffa040, 0.1, 0.8, 0, true); }
      p.mesh.position.addScaledVector(p.vel, dt);
      const gy = heightAt(p.mesh.position.x, p.mesh.position.z) + 0.6;
      if (p.mesh.position.y <= gy && p.vel.y < 0) {
        p.landed = true; p.mesh.position.y = gy; p.mesh.rotation.z = 0.25;
        p.chute.scale.set(1.2, 0.15, 1.2); p.chute.position.set(3, -0.4, 0); p.cable.visible = false;
      }
    }
    if (!p.player && p.t > 20) { scene.remove(p.mesh); pods.splice(i, 1); }
  }
}
const playerPod = () => pods.find(p => p.player);

function respawnPlayer() {
  const old = player;
  old.isPlayer = false;                      // el resto se limpia solo
  const pp = pods.findIndex(p => p.player);
  if (pp >= 0) { scene.remove(pods[pp].mesh); pods.splice(pp, 1); }
  player = newPlayer();
  player.name = 'LANZA-1';
  spawnAtBase(player, 'A');
  state.ejected = false;
  state.target = null; state.track = false;
  applyMode();
  if (state.mode === 'cockpit') lockPointer();
  sfx.powerup();
  msg('NUEVO MECH DESPLEGADO EN LA BASE', C.cyan, 3);
}

function updateBattle(dt) {
  const b = state.battle;
  if (!b || b.over) return;
  b.timer -= dt;
  const ins = { A: 0, B: 0 };
  for (const e of entities) if (e.alive && Math.hypot(e.pos.x - b.point.x, e.pos.z - b.point.z) < b.radius) ins[e.team]++;
  b.inside = ins;
  const att = b.attackers, def = other(att);
  b.contested = ins[att] > 0 && ins[def] > 0;
  if (ins[att] > 0 && ins[def] === 0) b.capture = Math.min(100, b.capture + (1.4 + 0.6 * Math.min(ins[att], 3)) * dt);
  else if (ins[def] > 0 && ins[att] === 0) b.capture = Math.max(0, b.capture - 1.5 * dt);
  const ours = att === 'A';
  for (const m of [25, 50, 75]) if (b.capture >= m && b.milestone < m) {
    b.milestone = m;
    msg(ours ? `CAPTURA AL ${m}%` : `¡EL ENEMIGO CAPTURA EL PUNTO: ${m}%!`, ours ? C.ally : C.bad, 2.5);
    sfx.beep(0.7, ours ? 1100 : 500);
  }
  if (b.capture < b.milestone - 25) b.milestone -= 25;
  if (b.contested && !b.wasContested) msg('PUNTO ALFA DISPUTADO', C.warn, 2);
  b.wasContested = b.contested;
  // baliza: color del atacante según el progreso
  const ac = new THREE.Color(att === 'A' ? 0x4090ff : 0xff4020);
  const col = new THREE.Color(0xffffff).lerp(ac, b.capture / 100);
  if (b.contested && Math.sin(state.time * 10) > 0) col.setHex(0xffb020);
  b.beacon.capMat.color.copy(col);
  b.beacon.beamMat.color.copy(col);
  b.beacon.beamMat.opacity = 0.22 + 0.1 * Math.sin(state.time * 3);
  // refuerzos
  for (let i = b.respawns.length - 1; i >= 0; i--) {
    const r = b.respawns[i];
    r.t -= dt;
    if (r.t > 0) continue;
    b.respawns.splice(i, 1);
    if (r.player) respawnPlayer();
    else spawnAtBase(battleMech(r.type, r.team, ++b.counter[r.team]), r.team);
  }
  if (b.order.type === 'attack' && !b.order.target.alive) {
    b.order = { type: 'free' };
    msg('BLANCO DE LA ESCUADRA ELIMINADO — LIBRE ACCIÓN', C.ally, 2.5);
    sfx.radio();
  }
  // final
  if (b.capture >= 100) return endBattle(att, ours ? 'PUNTO ALFA CAPTURADO' : 'EL ENEMIGO HA CAPTURADO EL PUNTO ALFA');
  if (b.timer <= 0) return endBattle(def, ours ? 'TIEMPO AGOTADO — NO SE CAPTURÓ EL PUNTO' : 'PUNTO ALFA DEFENDIDO HASTA EL FINAL');
  for (const t of ['A', 'B']) {
    if (b.tickets[t] <= 0 && !entities.some(e => e.alive && e.team === t) && !b.respawns.some(r => r.team === t))
      return endBattle(other(t), t === 'A' ? 'ESCUADRA ANIQUILADA — SIN REFUERZOS' : 'FUERZAS ENEMIGAS ANIQUILADAS');
  }
  // eyección manual (mantener Z)
  if (player.alive && keys.KeyZ) {
    state.ejectHold += dt;
    if (state.ejectHold > 1.2) { state.ejectHold = 0; damageLog(player, null); kill(player); }
  } else state.ejectHold = 0;
}
function damageLog(e, src) { e.lastHitBy = src; }

function endBattle(winner, reason) {
  const b = state.battle;
  b.over = true;
  state.screen = 'result';
  state.result = { win: winner === 'A', reason };
  document.exitPointerLock?.();
  cockpit.group.visible = false;
  player.model.root.visible = true;
  camera.fov = FOV_TOP; camera.near = 1; camera.updateProjectionMatrix();
  if (state.result.win) sfx.powerup(); else sfx.shutdown();
}

function battleKill(e) {
  const b = state.battle;
  if (!b || b.over) return;
  if (e.kind === 'mech') eject(e, e.isPlayer);
  if (b.tickets[e.team] > 0) {
    b.tickets[e.team]--;
    b.respawns.push({ team: e.team, type: e.btype, player: e.isPlayer, t: e.isPlayer ? BATTLE.respawnPlayer : BATTLE.respawnAI });
  }
}

// marcador del punto ALFA (se pega al borde si queda fuera de pantalla)
function drawObjectiveMarker() {
  const b = state.battle;
  const wp = b.point.clone(); wp.y += 14;
  const pr = wp.clone().project(camera);
  let x = (pr.x + 1) / 2 * VW, y = (1 - pr.y) / 2 * VH;
  if (pr.z > 1) { x = VW - x; y = VH - 10; }
  const m = 30, top = 60, bottom = VH - 140;
  const off = x < m || x > VW - m || y < top || y > bottom || pr.z > 1;
  x = clamp(x, m, VW - m); y = clamp(y, top, bottom);
  const ours = b.attackers === 'A';
  const col = b.contested ? C.warn : b.capture > 0 ? (ours ? C.ally : C.enemy) : C.white;
  const focus = state.ejected && playerPod() ? playerPod().mesh.position : player.pos;
  const d = Math.round(Math.hypot(b.point.x - focus.x, b.point.z - focus.z));
  if (d < b.radius && state.mode === 'cockpit' && !state.ejected) {
    txt(g, 'EN ZONA ALFA', VW / 2, VH * 0.42 + 64, { size: 10, align: 'center', color: col, glow: 4 });
    return;
  }
  g.strokeStyle = col; g.lineWidth = 2;
  g.beginPath(); g.moveTo(x, y - 8); g.lineTo(x + 8, y); g.lineTo(x, y + 8); g.lineTo(x - 8, y); g.closePath(); g.stroke();
  g.lineWidth = 1;
  txt(g, `ALFA ${d}m${off ? ' ►' : ''}`, x, y + 20, { size: 9, align: 'center', color: col, glow: 3 });
}

function drawBattleHud() {
  const b = state.battle;
  if (!b) return;
  drawObjectiveMarker();
  const cock = state.mode === 'cockpit' && !state.ejected && state.screen === 'play';
  const cx = VW / 2, y = cock ? 76 : 8;
  const ours = b.attackers === 'A';
  txt(g, ours ? 'ASALTO · CAPTURA EL PUNTO ALFA' : 'DEFENSA · PROTEGE EL PUNTO ALFA', cx, y + 10, { size: 10, align: 'center', color: C.white, glow: 3 });
  const w = 220, x = cx - w / 2, by = y + 15;
  g.fillStyle = 'rgba(0,10,4,0.6)'; g.fillRect(x, by, w, 10);
  g.strokeStyle = C.dim; g.strokeRect(x + 0.5, by + 0.5, w - 1, 10);
  g.fillStyle = ours ? C.ally : C.enemy;
  g.fillRect(x + 2, by + 2, (w - 4) * b.capture / 100, 6);
  const status = b.contested ? (Math.sin(state.time * 8) > 0 ? 'DISPUTADO' : '') : b.inside[b.attackers] > 0 ? `CAPTURANDO ×${b.inside[b.attackers]}` : b.inside[other(b.attackers)] > 0 ? 'RECUPERANDO' : '';
  txt(g, `${Math.floor(b.capture)}%  ${status}`, cx, by + 22, { size: 9, align: 'center', color: b.contested ? C.warn : C.white, glow: 2 });
  const mm = Math.max(0, Math.ceil(b.timer)), tt = `${Math.floor(mm / 60)}:${String(mm % 60).padStart(2, '0')}`;
  txt(g, `AZUL ${b.tickets.A}`, x, by + 22, { size: 10, color: C.ally });
  txt(g, `ROJO ${b.tickets.B}`, x + w, by + 22, { size: 10, align: 'right', color: C.enemy });
  txt(g, tt, cx, by - 16 < 0 ? by + 34 : by + 34, { size: 11, align: 'center', color: b.timer < 60 ? C.bad : C.white });
  // mechs vivos por equipo
  const alive = (t) => entities.filter(e => e.alive && e.team === t).length;
  for (let i = 0; i < 5; i++) {
    g.fillStyle = i < alive('A') ? C.ally : 'rgba(95,168,255,0.2)'; g.fillRect(x + i * 8, by + 28, 6, 4);
    g.fillStyle = i < alive('B') ? C.enemy : 'rgba(255,90,64,0.2)'; g.fillRect(x + w - 6 - i * 8, by + 28, 6, 4);
  }
  // eyección
  if (state.ejected && state.screen === 'play') {
    txt(g, 'EYECTADO', cx, VH * 0.56, { size: 26, align: 'center', color: C.warn, glow: 14 });
    const r = b.respawns.find(r => r.player);
    txt(g, r ? `REAPARICIÓN EN LA BASE EN ${Math.ceil(r.t)}s` : 'SIN REFUERZOS — ESPERA EL FINAL DE LA BATALLA', cx, VH * 0.56 + 22, { size: 12, align: 'center', color: C.white });
  } else if (state.ejectHold > 0) {
    const f = state.ejectHold / 1.2;
    txt(g, 'EYECCIÓN…', cx, VH * 0.62, { size: 12, align: 'center', color: C.bad });
    g.strokeStyle = C.bad; g.strokeRect(cx - 60.5, VH * 0.62 + 6.5, 120, 8);
    g.fillStyle = C.bad; g.fillRect(cx - 58, VH * 0.62 + 9, 116 * f, 4);
  }
}

function drawResult() {
  const r = state.result, b = state.battle;
  g.fillStyle = r.win ? 'rgba(0,20,40,0.45)' : 'rgba(40,0,0,0.45)'; g.fillRect(0, 0, VW, VH);
  txt(g, r.win ? 'VICTORIA' : 'DERROTA', VW / 2, VH / 2 - 30, { size: 40, align: 'center', color: r.win ? C.ally : C.bad, glow: 18 });
  txt(g, r.reason, VW / 2, VH / 2, { size: 13, align: 'center', color: C.white });
  txt(g, `DERRIBOS ${state.kills} · MECHS PERDIDOS ${state.deaths} · PUNTOS ${state.score}`, VW / 2, VH / 2 + 24, { size: 11, align: 'center', color: C.main });
  txt(g, `REFUERZOS RESTANTES  AZUL ${b.tickets.A} · ROJO ${b.tickets.B}`, VW / 2, VH / 2 + 42, { size: 10, align: 'center', color: C.dim, glow: 0 });
  txt(g, 'ENTER HANGAR  ·  M MENÚ PRINCIPAL', VW / 2, VH / 2 + 68, { size: 11, align: 'center', color: C.dim });
}

// ---------------------------------------------------------------- órdenes de escuadra
// 1 SEGUIDME · 2 ATACAD MI BLANCO · 3 AL PUNTO · 4 LIBRE ACCIÓN
const SLOTS = [[-14, 12], [14, 12], [-26, 24], [26, 24]];   // [derecha, atrás] relativo al jugador
function followSlot(e) {
  const [ox, oz] = SLOTS[(e.slot ?? 0) % SLOTS.length];
  const h = player.heading, c = Math.cos(h), sn = Math.sin(h);
  // derecha = (cos, -sin) · atrás = (sin, cos)
  return _v3.set(player.pos.x + c * ox + sn * oz, 0, player.pos.z - sn * ox + c * oz).clone();
}
const ORDER_KEYS = { Digit1: 'follow', Numpad1: 'follow', Digit2: 'attack', Numpad2: 'attack', Digit3: 'point', Numpad3: 'point', Digit4: 'free', Numpad4: 'free' };
function orderName(o) {
  const b = state.battle;
  if (o.type === 'follow') return 'SEGUIDME';
  if (o.type === 'attack') return `ATACAD A ${o.target.name}`;
  if (o.type === 'point') return b.attackers === 'A' ? 'TOMAD EL PUNTO ALFA' : 'DEFENDED EL PUNTO ALFA';
  return 'LIBRE ACCIÓN';
}
function issueOrder(type) {
  const b = state.battle;
  if (!b || b.over) return;
  if (type === 'attack') {
    if (!state.target || !state.target.alive || !hostile(state.target, player)) { msg('SIN BLANCO FIJADO — PULSA Q PRIMERO', C.warn, 2); sfx.beep(0.5, 300); return; }
    b.order = { type, target: state.target };
  } else b.order = { type };
  msg(`ORDEN: ${orderName(b.order)}`, C.ally, 2.5);
  sfx.radio();
  for (const e of entities) if (e.alive && e.ai && e.team === 'A') e.ai.scan = 0;
  const allies = entities.filter(e => e.alive && e.ai && e.team === 'A');
  if (allies.length) {
    const a = allies[Math.floor(Math.random() * allies.length)];
    const reply = ['RECIBIDO', 'ENTENDIDO', 'EN MARCHA', 'AFIRMATIVO', 'A LA ORDEN'][Math.floor(Math.random() * 5)];
    setTimeout(() => { if (state.battle === b) { msg(`${a.name}: ${reply}`, C.ally, 2); sfx.radio(); } }, 450);
  } else msg('NO QUEDAN ALIADOS EN COMBATE', C.dim, 2);
}

// panel de estado de la escuadra
function drawSquadPanel() {
  const b = state.battle;
  const allies = entities.filter(e => e.team === 'A' && !e.isPlayer && e.ai && (e.alive || e.deadT < 6))
    .sort((a, c) => (a.slot ?? 0) - (c.slot ?? 0)).slice(0, 4);
  const cock = state.mode === 'cockpit' && !state.ejected && state.screen === 'play';
  const w = 176, x = VW - w - 8, y = cock ? 36 : 140;
  const h = 36 + allies.length * 12 + 14;
  g.fillStyle = 'rgba(0,8,20,0.6)'; g.fillRect(x, y, w, h);
  g.strokeStyle = 'rgba(95,168,255,0.45)'; g.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  txt(g, 'ESCUADRA', x + 6, y + 11, { size: 9, color: C.ally, glow: 2 });
  txt(g, `ORDEN: ${orderName(b.order)}`, x + 6, y + 23, { size: 8, color: C.white, glow: 2 });
  allies.forEach((e, i) => {
    const yy = y + 36 + i * 12;
    const r = e.alive ? e.armor.CT / e.maxArmor.CT : 0;
    txt(g, e.name, x + 6, yy, { size: 8, color: e.alive ? C.ally : 'rgba(95,168,255,0.35)', glow: 0 });
    g.fillStyle = 'rgba(95,168,255,0.15)'; g.fillRect(x + 58, yy - 6, 40, 4);
    g.fillStyle = r > 0.5 ? C.main : r > 0.25 ? C.warn : C.bad; g.fillRect(x + 58, yy - 6, 40 * r, 4);
    txt(g, e.alive ? (e.ai.status ?? '—') : 'EYECTADO', x + w - 6, yy, { size: 7, align: 'right', color: e.alive ? C.dim : C.bad, glow: 0 });
  });
  txt(g, '1 SEGUIR 2 ATACAR 3 PUNTO 4 LIBRE', x + 6, y + h - 4, { size: 7, color: C.dim, glow: 0 });
}

// ---------------------------------------------------------------- entrenamiento
// Práctica libre: dianas que reaparecen, sin muerte, lecciones que se marcan solas
// y cambio de vista en caliente (B).
const LESSONS = [
  ['throttle', 'ACELERA', 'W / S'],
  ['turn', 'GIRA LAS PIERNAS', 'A / D'],
  ['torso', 'GIRA EL TORSO', '← → o ratón'],
  ['target', 'FIJA UN BLANCO', 'Q / TAB'],
  ['g0', 'DISPARA GRUPO 1', 'ESPACIO / J'],
  ['g1', 'DISPARA GRUPO 2', 'F / K'],
  ['g2', 'DISPARA GRUPO 3', 'E / L'],
  ['kill', 'DESTRUYE UNA DIANA', ''],
  ['heat', 'SUPERA 70% DE CALOR', 'dispara seguido'],
  ['water', 'REFRÍGERATE EN EL AGUA', 'zona con agua'],
  ['trees', 'DERRIBA UN ÁRBOL', 'atraviesa bosque'],
  ['thermal', 'VISIÓN TÉRMICA', 'V'],
  ['view', 'CAMBIA DE VISTA', 'B'],
];
function lesson(id) {
  if (!state.training || !state.lessons || state.lessons[id] === undefined || state.lessons[id]) return;
  state.lessons[id] = true;
  sfx.beep(0.6, 1760);
  const all = Object.values(state.lessons).every(Boolean);
  if (all) msg('¡ENTRENAMIENTO COMPLETADO! SIGUE PRACTICANDO O ESC → M MENÚ', C.cyan, 6);
}

function repairPlayer(frac) {
  for (const k of Object.keys(player.armor)) player.armor[k] = Math.min(player.maxArmor[k], player.armor[k] + player.maxArmor[k] * frac);
  for (const k of ['LA', 'RA']) if (player.armor[k] > 0) player.model.sections[k].visible = true;
  if (player.armor.LT > 0) player.model.sideL.visible = true;
  if (player.armor.RT > 0) player.model.sideR.visible = true;
  player.maxSpeed = player.baseSpeed;
}

function spawnTrainingTarget(type, near = false) {
  let e;
  if (type === 'tank') e = createTank({ armor: 25 });
  else e = enemyMech(type === 'mover' ? 'medium' : 'light');
  e.trainType = type;
  e.name = type === 'static' ? 'DIANA' : type === 'mover' ? 'DIANA MÓVIL' : 'TANQUE DIANA';
  e.value = type === 'mover' ? 150 : 50;
  if (type === 'static') e.ai.static = true;
  const fy = player.heading + (Math.random() - 0.5) * (near ? 0.9 : 3.2);
  const r = type === 'static' ? 60 + Math.random() * 70 : 130 + Math.random() * 60;
  placeFree(e, player.pos.x - Math.sin(fy) * r, player.pos.z - Math.cos(fy) * r);
  e.heading = yawTo(e.pos, player.pos);
  entities.push(e);
  moveEntity(e, 0.016);
  return e;
}

function startTraining() {
  state.trainArmed = false;
  state.showLessons = true;
  state.respawns = [];
  state.lessons = {};
  for (const [id] of LESSONS) state.lessons[id] = false;
  if (world.Z.waterY === null) delete state.lessons.water;
  if (!world.trees.length) delete state.lessons.trees;
  for (let i = 0; i < 3; i++) spawnTrainingTarget('static', true);
  for (let i = 0; i < 2; i++) spawnTrainingTarget('mover');
  spawnTrainingTarget('tank');
  msg('ENTRENAMIENTO — SIGUE LAS LECCIONES DE LA IZQUIERDA', C.cyan, 5);
}

function updateTraining(dt) {
  const p = player;
  if (p.throttle > 0.5) lesson('throttle');
  if (keys.KeyA || keys.KeyD) lesson('turn');
  if (Math.abs(p.torsoYaw) > 0.5) lesson('torso');
  if (p.heat > 70) lesson('heat');
  if (p.inWater && p.heat > 0) lesson('water');
  if (world.trees.some(t => t.fallen)) lesson('trees');
  for (let i = state.respawns.length - 1; i >= 0; i--) {
    const r = state.respawns[i];
    r.t -= dt;
    if (r.t <= 0) { spawnTrainingTarget(r.type); state.respawns.splice(i, 1); }
  }
  // reparación lenta para no tener que salir nunca
  for (const k of Object.keys(p.armor)) if (p.armor[k] > 0) p.armor[k] = Math.min(p.maxArmor[k], p.armor[k] + p.maxArmor[k] * 0.02 * dt);
}

function switchView() {
  state.mode = state.mode === 'top' ? 'cockpit' : 'top';
  applyMode();
  if (state.mode === 'cockpit') lockPointer(); else document.exitPointerLock?.();
  lesson('view');
  sfx.ui();
  msg(state.mode === 'top' ? 'VISTA TÁCTICA' : 'VISTA CABINA', C.cyan, 1.5);
}

function drawLessons() {
  const cock = state.mode === 'cockpit';
  const x = cock ? 8 : 10;
  const y0 = cock ? 72 : 76;
  if (!state.showLessons) { txt(g, 'I LECCIONES', x, y0 + 10, { size: 9, color: C.dim, glow: 0 }); return; }
  const all = LESSONS.filter(([id]) => state.lessons[id] !== undefined);
  const done = all.filter(([id]) => state.lessons[id]).length;
  // en cabina sólo las 3 siguientes pendientes, para no tapar el parabrisas
  const list = cock ? all.filter(([id]) => !state.lessons[id]).slice(0, 3) : all;
  const w = cock ? Math.min(176, VW * 0.22 - 14) : 206, h = 22 + list.length * 12 + 26;
  g.fillStyle = 'rgba(0,10,4,0.6)'; g.fillRect(x, y0, w, h);
  g.strokeStyle = C.dim; g.strokeRect(x + 0.5, y0 + 0.5, w - 1, h - 1);
  txt(g, `LECCIONES ${done}/${all.length}`, x + 6, y0 + 13, { size: 10, color: C.cyan });
  list.forEach(([id, name, keyTxt], i) => {
    const yy = y0 + 27 + i * 12;
    const ok = state.lessons[id];
    txt(g, ok ? '■' : '□', x + 6, yy, { size: 9, color: ok ? C.main : C.dim, glow: ok ? 4 : 0 });
    txt(g, name, x + 18, yy, { size: 8, color: ok ? C.dim : C.white, glow: 0 });
    if (keyTxt && !cock) txt(g, keyTxt, x + w - 6, yy, { size: 8, align: 'right', color: ok ? C.faint : C.warn, glow: 0 });
    else if (keyTxt && keyTxt.length <= 11) txt(g, keyTxt, x + w - 6, yy, { size: 8, align: 'right', color: C.warn, glow: 0 });
  });
  const yb = y0 + 27 + list.length * 12 + 4;
  txt(g, `B VISTA · N DIANA · I OCULTAR`, x + 6, yb, { size: 8, color: C.dim, glow: 0 });
  txt(g, `O BLANCOS ARMADOS: ${state.trainArmed ? 'SÍ' : 'NO'}`, x + 6, yb + 11, { size: 8, color: state.trainArmed ? C.bad : C.dim, glow: 0 });
}

function menuStart(i) {
  if (i === 2) enterHangar('top', 'training');
  else if (i === 3) enterHangar('top', 'battle');
  else enterHangar(i === 0 ? 'top' : 'cockpit', 'waves');
}
const gameKind = () => state.training ? 'training' : state.battleMode ? 'battle' : 'waves';

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
  lesson('thermal');
  sfx.beep(0.7, state.thermal ? 1500 : 700);
  msg(state.thermal ? 'VISIÓN TÉRMICA ACTIVA' : 'VISIÓN NORMAL', C.cyan, 1.5);
}

// ---------------------------------------------------------------- hangar
const SAVE_KEY = 'steelhorizon.hangar.v1';
const hangar = { chassis: 'centinela', cfgs: {}, row: 0, zone: 'desierto', time: 'dusk', objective: 'assault', view: 'top' };
// filas: chasis · monturas · zona · hora · [objetivo · vista en batalla] · desplegar
const ROW_ZONE = MOUNTS.length + 1, ROW_TIME = MOUNTS.length + 2;
const ROW_OBJ = MOUNTS.length + 3, ROW_VIEW = MOUNTS.length + 4;
const hrows = () => MOUNTS.length + 4 + (state.battleMode ? 2 : 0);
const ZONE_IDS = Object.keys(ZONES), TIME_IDS = Object.keys(TIMES);
try {
  const saved = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null');
  if (saved && saved.cfgs) { hangar.chassis = saved.chassis; hangar.cfgs = saved.cfgs; }
  if (saved && ZONES[saved.zone]) hangar.zone = saved.zone;
  if (saved && TIMES[saved.time]) hangar.time = saved.time;
  if (saved && saved.objective) hangar.objective = saved.objective;
  if (saved && saved.view) hangar.view = saved.view;
} catch (_) { /* sin almacenamiento */ }

function cfgFor(ch) {
  let cfg = hangar.cfgs[ch.id];
  const valid = cfg && MOUNTS.every(m => cfg[m] && (cfg[m].w === null || optionsFor(ch, m).includes(cfg[m].w)))
    && usedTons(cfg) <= ch.weaponTons;
  if (!valid) cfg = hangar.cfgs[ch.id] = defaultConfig(ch);
  return cfg;
}
function saveHangar() {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify({ chassis: hangar.chassis, cfgs: hangar.cfgs, zone: hangar.zone, time: hangar.time, objective: hangar.objective, view: hangar.view })); } catch (_) { /* ignorar */ }
}

const hangar3d = buildHangar();
function refreshHangarModel() {
  const ch = chassisById(hangar.chassis);
  const cfg = cfgFor(ch);
  const loadout = {};
  for (const m of MOUNTS) loadout[m] = cfg[m].w;
  hangar3d.setMech(ch.colors, loadout, ch.scale);
}

function enterHangar(mode, kind = 'waves') {
  initAudio();
  state.training = kind === 'training';
  state.battleMode = kind === 'battle';
  state.pendingMode = state.battleMode ? hangar.view : mode;
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
  } else if (state.battleMode && hangar.row === ROW_OBJ) {
    hangar.objective = hangar.objective === 'assault' ? 'defense' : 'assault';
    sfx.ui(); saveHangar(); return;
  } else if (state.battleMode && hangar.row === ROW_VIEW) {
    state.pendingMode = state.pendingMode === 'top' ? 'cockpit' : 'top';
    hangar.view = state.pendingMode;
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

  txt(g, `HANGAR · ${state.training ? 'ENTRENAMIENTO' : state.battleMode ? 'BATALLA 5 VS 5' : state.pendingMode === 'cockpit' ? 'MODO CABINA' : 'MODO TÁCTICO'}`, VW / 2, 24, { size: 15, align: 'center' });
  txt(g, 'CONFIGURACIÓN DEL MECH', VW / 2, 38, { size: 9, align: 'center', color: C.dim, glow: 0 });

  // ---- panel izquierdo: chasis
  const PW = 236, lx = 12, ly = 52;
  frame(g, lx, ly, PW, 228, C.dim, 'CHASIS');
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
    const y = ly + 62 + i * 22;
    txt(g, k, lx + 10, y, { size: 9, glow: 2 });
    txt(g, v, lx + PW - 10, y, { size: 10, align: 'right', color: C.white, glow: 2 });
    bar(lx + 10, y + 4, PW - 20, 8, f, k === 'CALOR ALFA' && st.heat > st.dissip * 3 ? C.warn : C.main);
  });
  const secs = st.heat / st.dissip;
  txt(g, `ALFA COMPLETA → ${secs.toFixed(1)} s PARA DISIPAR`, lx + 10, ly + 202, { size: 9, color: secs > 4 ? C.warn : C.dim, glow: 0 });
  txt(g, `ALCANCE MÁX ${st.maxRange} m`, lx + 10, ly + 217, { size: 9, color: C.dim, glow: 0 });

  // ---- panel de misión: zona y hora
  const my = ly + 238;
  const mrows = [[ROW_ZONE, 'ZONA', ZONES[hangar.zone].name], [ROW_TIME, 'HORA', TIMES[hangar.time].name]];
  if (state.battleMode) mrows.push([ROW_OBJ, 'OBJET.', hangar.objective === 'assault' ? 'ASALTO' : 'DEFENSA'], [ROW_VIEW, 'VISTA', state.pendingMode === 'cockpit' ? 'CABINA' : 'TÁCTICA']);
  frame(g, lx, my, PW, 6 + mrows.length * 30, C.dim, 'MISIÓN');
  mrows.forEach(([r, k, v], i) => {
    const y = my + 3 + i * 30;
    if (sel(r)) { g.fillStyle = 'rgba(134,255,156,0.10)'; g.fillRect(lx + 2, y, PW - 4, 28); }
    txt(g, k, lx + 10, y + 18, { size: 9, color: C.dim, glow: 0 });
    txt(g, '◄', lx + 52, y + 19, { size: 12, color: sel(r) ? C.white : C.faint });
    txt(g, v, lx + 52 + (PW - 72) / 2, y + 19, { size: 12, align: 'center', color: sel(r) ? C.white : C.main });
    txt(g, '►', lx + PW - 10, y + 19, { size: 12, align: 'right', color: sel(r) ? C.white : C.faint });
    hangarRects.push({ x: lx, y, w: PW, h: 28, row: r, arrows: true });
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
  } else if (state.battleMode && hangar.row === ROW_OBJ) {
    const as = hangar.objective === 'assault';
    txt(g, as ? 'ASALTO: CAPTURA EL PUNTO ALFA' : 'DEFENSA: PROTEGE EL PUNTO ALFA', rx + 10, dy + 8, { size: 9, color: C.white, glow: 1 });
    txt(g, as ? 'QUÉDATE EN LA ZONA HASTA EL 100%' : 'AGUANTA HASTA QUE ACABE EL TIEMPO', rx + 10, dy + 24, { size: 8, color: C.cyan, glow: 0 });
    txt(g, '5 VS 5 · REFUERZOS LIMITADOS · EYECCIÓN', rx + 10, dy + 38, { size: 8, color: C.dim, glow: 0 });
  } else if (state.battleMode && hangar.row === ROW_VIEW) {
    txt(g, 'VISTA INICIAL DE LA BATALLA', rx + 10, dy + 8, { size: 9, color: C.white, glow: 1 });
    txt(g, 'B CAMBIA DE VISTA DURANTE LA PARTIDA', rx + 10, dy + 24, { size: 8, color: C.cyan, glow: 0 });
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
  const dr = hrows() - 1, dw = 240, dx = VW / 2 - dw / 2, dyb = VH - 82;
  const on = sel(dr);
  frame(g, dx, dyb, dw, 34, on ? C.main : C.dim);
  if (on && Math.sin(t * 6) > -0.2) { g.fillStyle = 'rgba(134,255,156,0.16)'; g.fillRect(dx, dyb, dw, 34); }
  txt(g, '▶ DESPLEGAR  [ENTER]', VW / 2, dyb + 22, { size: 14, align: 'center', color: on ? C.white : C.main });
  hangarRects.push({ x: dx, y: dyb, w: dw, h: 34, row: dr, deploy: true });

  txt(g, '↑↓ ELEGIR · ←→ CAMBIAR · G GRUPO · R RESTABLECER · ENTER DESPLEGAR · ESC MENÚ', VW / 2, VH - 22, { size: 9, align: 'center', color: C.dim, glow: 0 });
}

function hangarKey(code) {
  if (code === 'ArrowUp' || code === 'KeyW') { hangar.row = (hangar.row - 1 + hrows()) % hrows(); sfx.ui(); }
  else if (code === 'ArrowDown' || code === 'KeyS' || code === 'Tab') { hangar.row = (hangar.row + 1) % hrows(); sfx.ui(); }
  else if (code === 'ArrowLeft' || code === 'KeyA') hangarChange(-1);
  else if (code === 'ArrowRight' || code === 'KeyD') hangarChange(1);
  else if (code === 'KeyG') hangarGroup();
  else if (code === 'KeyR') hangarReset();
  else if (code === 'Enter' || (code === 'Space' && hangar.row === hrows() - 1)) deploy();
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
    updateVisibility(dt);
    if (player.alive) updatePlayer(dt);
    for (const e of entities) if (e.alive && e.ai) updateAI(e, dt);
    for (let i = entities.length - 1; i >= 0; i--) {
      const e = entities[i];
      if (e.alive) moveEntity(e, dt);
      else if (updateDead(e, dt)) { scene.remove(e.model.root); entities.splice(i, 1); }
    }
    updateProjectiles(dt);
    // oleadas (o dianas en entrenamiento)
    if (state.training) updateTraining(dt);
    else if (state.battleMode) updateBattle(dt);
    else if (!entities.some(e => e.alive && hostile(e, player))) {
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
  } else if (state.screen === 'dead' || state.screen === 'result') {
    for (let i = entities.length - 1; i >= 0; i--) { const e = entities[i]; if (!e.alive) updateDead(e, dt); else if (e.ai) { e.throttle = 0; moveEntity(e, dt); } }
    updateProjectiles(dt);
  }
  if (state.screen !== 'pause') { updateEffects(dt); updatePods(dt); }
  for (const m of state.msgs) if (m.dur < 99) m.t -= dt;
  for (let i = state.hitDirs.length - 1; i >= 0; i--) { state.hitDirs[i].t -= dt; if (state.hitDirs[i].t <= 0) state.hitDirs.splice(i, 1); }

  updateCamera(dt);
  camera.updateMatrixWorld();
  const topView = state.screen !== 'menu' && state.screen !== 'hangar' && (state.mode === 'top' || state.ejected || state.screen === 'dead' || state.screen === 'result');
  world.setView(topView ? state.zoom : 0);
  world.update(topView ? camLook : (player ? player.pos : V()), camera, state.screen === 'pause' ? 0 : dt, state.time);

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
      hl.visible = player.alive;
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
    if (e.code === 'Digit1' || e.code === 'Numpad1') menuStart(0);
    if (e.code === 'Digit2' || e.code === 'Numpad2') menuStart(1);
    if (e.code === 'Digit3' || e.code === 'Numpad3') menuStart(2);
    if (e.code === 'Digit4' || e.code === 'Numpad4') menuStart(3);
    if (e.code === 'ArrowUp' || e.code === 'KeyW') { state.menuSel = (state.menuSel + 3) % 4; sfx.ui(); }
    if (e.code === 'ArrowDown' || e.code === 'KeyS') { state.menuSel = (state.menuSel + 1) % 4; sfx.ui(); }
    if (e.code === 'Enter' || e.code === 'Space') menuStart(state.menuSel);
  } else if (state.screen === 'hangar') {
    if (!e.repeat || e.code.startsWith('Arrow')) hangarKey(e.code);
  } else if (state.screen === 'play') {
    if ((e.code === 'KeyQ' || e.code === 'Tab') && !e.repeat) cycleTarget();
    if (e.code === 'KeyV' && !e.repeat) toggleThermal();
    if (state.battleMode && !e.repeat && e.code === 'KeyB') switchView();
    if (state.battleMode && !e.repeat && ORDER_KEYS[e.code]) issueOrder(ORDER_KEYS[e.code]);
    if (state.training && !e.repeat) {
      if (e.code === 'KeyB') switchView();
      if (e.code === 'KeyO') { state.trainArmed = !state.trainArmed; sfx.beep(0.7, state.trainArmed ? 400 : 900); msg(state.trainArmed ? 'BLANCOS ARMADOS: DISPARAN' : 'BLANCOS DESARMADOS', state.trainArmed ? C.bad : C.main, 2); }
      if (e.code === 'KeyI') state.showLessons = !state.showLessons;
      if (e.code === 'KeyN') { spawnTrainingTarget('static'); sfx.ui(); }
    }
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
    if (e.code === 'KeyH') { clearWorld(); setupMenuScene(); enterHangar(state.mode, gameKind()); }
  } else if (state.screen === 'dead' || state.screen === 'result') {
    if (e.code === 'Enter') { clearWorld(); setupMenuScene(); enterHangar(state.mode, gameKind()); }
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
    for (const r of menuRects) if (x > r.x && x < r.x + r.w && y > r.y && y < r.y + r.h) menuStart(r.sel);
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
document.addEventListener('pointerlockchange', () => {
  if (document.pointerLockElement !== cv && state.screen === 'play' && state.mode === 'cockpit' && !state.ejected) state.screen = 'pause';
});

setupMenuScene();
requestAnimationFrame(frameLoop);
// acceso para depuración
window.__game = { state, hangar, heightAt, get world() { return world; }, get player() { return player; }, get entities() { return entities; }, startGame, enterHangar };
