// Modelos low-poly: mech de patas invertidas y tanque.
// Convención: el "frente" de cada modelo es -Z local.
import * as THREE from 'three';

const B = (w, h, d) => new THREE.BoxGeometry(w, h, d);

function adder(meshes) {
  return (parent, geo, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.rotation.set(rx, ry, rz);
    m.castShadow = true;
    parent.add(m);
    meshes.push(m);
    return m;
  };
}

export function buildMech(colors = {}) {
  const base = new THREE.MeshLambertMaterial({ color: colors.base ?? 0x7a7d68, flatShading: true });
  const dark = new THREE.MeshLambertMaterial({ color: colors.dark ?? 0x30332c, flatShading: true });
  const accent = new THREE.MeshLambertMaterial({ color: colors.accent ?? 0xc4561e, flatShading: true });
  const glass = new THREE.MeshBasicMaterial({ color: colors.glass ?? 0x50ffd8 });
  const meshes = [];
  const add = adder(meshes);
  const root = new THREE.Group();

  // pelvis + piernas de ave (articulación invertida)
  const pelvis = new THREE.Group();
  pelvis.position.y = 6.2;
  root.add(pelvis);
  add(pelvis, B(2.6, 1.0, 1.8), dark);
  const legs = [];
  for (const s of [-1, 1]) {
    const hip = new THREE.Group();
    hip.position.set(s * 1.6, 0, 0);
    pelvis.add(hip);
    add(hip, B(1.3, 1.3, 1.3), dark);
    add(hip, B(1.1, 3.1, 1.5), base, 0, -1.5, -0.35, 0.25);
    const knee = new THREE.Group();
    knee.position.set(0, -2.9, -0.8);
    hip.add(knee);
    add(knee, B(1.0, 1.0, 1.0), dark);
    add(knee, B(0.9, 3.0, 1.1), base, 0, -1.4, 0.5, -0.38);
    add(knee, B(0.3, 2.0, 0.3), dark, s * 0.55, -1.3, 0.7, -0.38);
    const ankle = new THREE.Group();
    ankle.position.set(0, -2.8, 1.0);
    knee.add(ankle);
    add(ankle, B(1.6, 0.5, 2.8), dark, 0, -0.2, -0.3);
    add(ankle, B(0.5, 0.4, 1.0), dark, s * 0.6, -0.25, 1.2);
    legs.push({ hip, knee, ankle });
  }

  // torso (gira independientemente de las piernas)
  const torso = new THREE.Group();
  torso.position.y = 7.4;
  root.add(torso);
  const torsoParts = new THREE.Group();
  torso.add(torsoParts);
  add(torsoParts, B(3.2, 2.6, 3.0), base, 0, 0.3, 0);
  add(torsoParts, B(2.2, 1.3, 1.8), base, 0, 0.6, -1.9);
  add(torsoParts, B(1.8, 0.55, 0.12), glass, 0, 0.85, -2.82);
  add(torsoParts, B(2.4, 0.6, 2.6), dark, 0, 1.75, 0.3);
  add(torsoParts, B(0.12, 2.0, 0.12), dark, 1.1, 2.8, 0.9);

  const sideL = new THREE.Group(), sideR = new THREE.Group();
  torsoParts.add(sideL, sideR);
  add(sideL, B(1.4, 2.2, 2.6), dark, -2.2, 0.2, 0.2);
  add(sideR, B(1.4, 2.2, 2.6), dark, 2.2, 0.2, 0.2);
  // lanzamisiles LRM (hombro izquierdo)
  add(sideL, B(1.7, 1.4, 2.2), accent, -2.3, 1.95, 0.2);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++)
    add(sideL, B(0.32, 0.32, 0.1), dark, -2.3 + (i - 1) * 0.48, 1.95 + (j - 0.5) * 0.5, -0.92);
  // láser de torso derecho
  add(sideR, B(0.4, 0.4, 1.6), dark, 2.2, 0.0, -1.3);

  // brazos
  const arms = [];
  for (const s of [-1, 1]) {
    const sh = new THREE.Group();
    sh.position.set(s * 3.4, 0.6, 0);
    torsoParts.add(sh);
    add(sh, B(1.1, 1.1, 1.5), dark);
    add(sh, B(0.9, 2.0, 1.0), base, 0, -1.2, 0);
    add(sh, B(0.85, 0.85, 3.0), s < 0 ? dark : accent, 0, -2.2, -1.0);
    if (s > 0) { // PPC con bobinas
      add(sh, B(1.15, 1.15, 0.3), dark, 0, -2.2, -1.7);
      add(sh, B(1.15, 1.15, 0.3), dark, 0, -2.2, -0.6);
    }
    add(sh, B(0.45, 0.45, 0.9), dark, 0, -2.2, -2.9);
    const muzzle = new THREE.Object3D();
    muzzle.position.set(0, -2.2, -3.4);
    sh.add(muzzle);
    arms.push({ group: sh, muzzle });
  }
  const lt = new THREE.Object3D(); lt.position.set(-2.3, 1.95, -1.1); sideL.add(lt);
  const rt = new THREE.Object3D(); rt.position.set(2.2, 0.0, -2.2); sideR.add(rt);
  const cockpit = new THREE.Object3D(); cockpit.position.set(0, 0.9, -2.3); torso.add(cockpit);

  return {
    root, pelvis, torso, torsoParts, legs, arms, sideL, sideR, cockpit, meshes,
    mats: [base, dark, accent],
    muzzles: { la: arms[0].muzzle, ra: arms[1].muzzle, lt, rt },
    sections: { LA: arms[0].group, RA: arms[1].group },
  };
}

export function animateMech(m, phase, amt, pitch = 0) {
  const a = Math.sin(phase);
  const k = Math.cos(phase);
  const [L, R] = m.legs;
  L.hip.rotation.x = a * 0.5 * amt;
  R.hip.rotation.x = -a * 0.5 * amt;
  L.knee.rotation.x = Math.max(0, k) * 0.6 * amt;
  R.knee.rotation.x = Math.max(0, -k) * 0.6 * amt;
  L.ankle.rotation.x = -(L.hip.rotation.x + L.knee.rotation.x) * 0.8;
  R.ankle.rotation.x = -(R.hip.rotation.x + R.knee.rotation.x) * 0.8;
  const bob = Math.abs(k) * 0.28 * amt;
  m.pelvis.position.y = 6.2 - bob;
  m.torso.position.y = 7.4 - bob;
  m.torso.rotation.z = a * 0.025 * amt;
  for (const arm of m.arms) arm.group.rotation.x = pitch;
}

export function buildTank(colors = {}) {
  const base = new THREE.MeshLambertMaterial({ color: colors.base ?? 0x6a5a40, flatShading: true });
  const dark = new THREE.MeshLambertMaterial({ color: colors.dark ?? 0x2a2620, flatShading: true });
  const accent = new THREE.MeshLambertMaterial({ color: colors.accent ?? 0xd0c040, flatShading: true });
  const meshes = [];
  const add = adder(meshes);
  const root = new THREE.Group();
  add(root, B(4.2, 1.6, 6.4), base, 0, 1.4, 0);
  add(root, B(3.6, 0.8, 1.2), base, 0, 1.2, -3.4, 0.5);
  for (const s of [-1, 1]) add(root, B(1.1, 1.5, 7.0), dark, s * 2.5, 0.85, 0);
  const turret = new THREE.Group();
  turret.position.y = 2.6;
  root.add(turret);
  add(turret, B(2.8, 1.1, 3.0), base, 0, 0, 0.2);
  add(turret, B(1.2, 0.4, 1.2), accent, 0.6, 0.7, 0.8);
  add(turret, B(0.45, 0.45, 4.2), dark, 0, 0.1, -2.8);
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0.1, -5.0);
  turret.add(muzzle);
  return { root, turret, meshes, mats: [base, dark, accent], muzzles: { main: muzzle }, sections: {} };
}
