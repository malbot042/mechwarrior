// Interior de la cabina (hijo de la cámara): marco del parabrisas, salpicadero
// con tres pantallas vivas, palanca de aceleración, joystick, consolas laterales
// y luces de aviso.
import * as THREE from 'three';

function screen(w, h, px = 160) {
  const canvas = document.createElement('canvas');
  canvas.width = px; canvas.height = Math.round(px * h / w);
  const ctx = canvas.getContext('2d');
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex, fog: false }));
  return { canvas, ctx, tex, mesh };
}

export function buildCockpit() {
  const group = new THREE.Group();
  const frameMat = new THREE.MeshLambertMaterial({ color: 0x3c3a36, flatShading: true, fog: false });
  const frameDark = new THREE.MeshLambertMaterial({ color: 0x1e1d1b, flatShading: true, fog: false });
  const panelMat = new THREE.MeshLambertMaterial({ color: 0x2c2e2a, flatShading: true, fog: false });
  const hazard = new THREE.MeshLambertMaterial({ color: 0x7a5a18, flatShading: true, fog: false });
  const box = (w, h, d, mat) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);

  const light = new THREE.PointLight(0xffa060, 1.2, 4, 2);
  light.position.set(0, 0.25, 0.1);
  group.add(light);
  const warnLight = new THREE.PointLight(0xff2010, 0, 3, 2);
  warnLight.position.set(0, 0.3, -0.4);
  group.add(warnLight);

  // marco del parabrisas
  const top = box(1, 0.16, 0.35, frameMat);
  const topLip = box(1, 0.04, 0.05, hazard);
  const pillarL = box(0.14, 1.6, 0.3, frameMat), pillarR = pillarL.clone();
  const braceL = box(0.1, 0.5, 0.2, frameDark), braceR = braceL.clone();
  const overhead = box(1, 0.18, 0.5, panelMat);
  group.add(top, topLip, pillarL, pillarR, braceL, braceR, overhead);

  // salpicadero
  const dash = new THREE.Group();
  group.add(dash);
  const dashBody = box(1, 0.5, 0.5, panelMat);
  const dashLip = box(1, 0.018, 0.04, hazard);
  dash.add(dashBody, dashLip);
  const screens = {
    left: screen(0.24, 0.18),
    center: screen(0.26, 0.2),
    right: screen(0.24, 0.18),
  };
  const bezels = [];
  for (const k of ['left', 'center', 'right']) {
    const s = screens[k];
    const bz = box(s.mesh.geometry.parameters.width + 0.025, s.mesh.geometry.parameters.height + 0.025, 0.02, frameDark);
    dash.add(bz); bezels.push(bz);
    dash.add(s.mesh);
  }

  // consolas laterales con botones
  const sideL = new THREE.Group(), sideR = new THREE.Group();
  group.add(sideL, sideR);
  const buttons = [];
  const btnColors = [0x30ff70, 0xffb020, 0xff4030, 0x40c0ff];
  for (const side of [sideL, sideR]) {
    side.add(box(0.35, 0.7, 0.5, panelMat));
    for (let r = 0; r < 4; r++) for (let c = 0; c < 3; c++) {
      const mat = new THREE.MeshBasicMaterial({ color: btnColors[(r + c) % 4], fog: false });
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.025, 0.02), mat);
      b.position.set(-0.08 + c * 0.08, 0.25 - r * 0.07, 0.26);
      side.add(b);
      buttons.push({ mesh: b, base: mat.color.clone(), phase: Math.random() * 10, rate: 0.5 + Math.random() * 3 });
    }
  }

  // palanca de aceleración (izquierda)
  const throttle = new THREE.Group();
  group.add(throttle);
  throttle.add(box(0.1, 0.06, 0.26, frameDark));
  const lever = new THREE.Group();
  lever.position.y = 0.03;
  throttle.add(lever);
  const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.2, 6), frameMat);
  rod.position.y = 0.1;
  lever.add(rod);
  const knob = box(0.06, 0.05, 0.05, new THREE.MeshLambertMaterial({ color: 0xc03018, fog: false }));
  knob.position.y = 0.21;
  lever.add(knob);

  // joystick (derecha)
  const stick = new THREE.Group();
  group.add(stick);
  stick.add(box(0.12, 0.04, 0.12, frameDark));
  const stickPivot = new THREE.Group();
  stickPivot.position.y = 0.02;
  stick.add(stickPivot);
  const srod = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.018, 0.16, 6), frameMat);
  srod.position.y = 0.08;
  stickPivot.add(srod);
  const grip = box(0.045, 0.09, 0.05, frameDark);
  grip.position.y = 0.19;
  stickPivot.add(grip);
  const trigger = new THREE.Mesh(new THREE.BoxGeometry(0.015, 0.025, 0.02), new THREE.MeshBasicMaterial({ color: 0xff3020, fog: false }));
  trigger.position.set(0, 0.2, -0.03);
  stickPivot.add(trigger);

  // luces de aviso superiores
  const warnMat = new THREE.MeshBasicMaterial({ color: 0x400806, fog: false });
  const warnHeat = box(0.07, 0.03, 0.02, warnMat);
  const warnMat2 = new THREE.MeshBasicMaterial({ color: 0x402806, fog: false });
  const warnDmg = box(0.07, 0.03, 0.02, warnMat2);
  group.add(warnHeat, warnDmg);

  group.traverse(o => { o.renderOrder = 10; });

  function layout(aspect, fovDeg) {
    const tH = Math.tan(THREE.MathUtils.degToRad(fovDeg / 2));
    const fx = (f, z) => f * Math.abs(z) * tH * aspect;
    const fy = (f, z) => f * Math.abs(z) * tH;
    const wide = Math.min(aspect, 2.2);
    const fxw = (f, z) => f * Math.abs(z) * tH * wide;

    let z = -0.75;
    top.position.set(0, fy(1.02, z), z); top.scale.x = fx(2.4, z);
    topLip.position.set(0, fy(1.02, z) - 0.085, z + 0.15); topLip.scale.x = fx(2.4, z);
    overhead.position.set(0, fy(1.45, -0.45), -0.45); overhead.scale.x = fx(2.4, -0.45);
    pillarL.position.set(-fx(0.93, z), 0, z); pillarL.rotation.z = -0.12;
    pillarR.position.set(fx(0.93, z), 0, z); pillarR.rotation.z = 0.12;
    braceL.position.set(-fx(0.83, z), fy(0.78, z), z); braceL.rotation.z = 0.85;
    braceR.position.set(fx(0.83, z), fy(0.78, z), z); braceR.rotation.z = -0.85;

    z = -0.62;
    dash.position.set(0, fy(-0.52, z), z);
    dash.rotation.x = -0.55;
    dashBody.scale.x = fx(2.3, z);
    dashBody.position.set(0, -0.18, -0.05);
    dashLip.scale.x = fx(2.3, z);
    dashLip.position.set(0, 0.075, 0.2);
    const sp = fxw(0.36, z);
    const sx = { left: -sp, center: 0, right: sp };
    ['left', 'center', 'right'].forEach((k, i) => {
      screens[k].mesh.position.set(sx[k], -0.04, 0.215);
      bezels[i].position.set(sx[k], -0.04, 0.2);
    });

    z = -0.5;
    sideL.position.set(-fx(1.0, z), fy(-0.45, z), z); sideL.rotation.y = 0.7; sideL.scale.setScalar(0.5);
    sideR.position.set(fx(1.0, z), fy(-0.45, z), z); sideR.rotation.y = -0.7; sideR.scale.setScalar(0.5);

    z = -0.34;
    throttle.position.set(-fx(0.86, z), fy(-0.92, z), z); throttle.scale.setScalar(0.5);
    stick.position.set(fx(0.9, z), fy(-1.0, z), z); stick.scale.setScalar(0.55);

    z = -0.7;
    warnHeat.position.set(-0.06, fy(1.0, z) - 0.04, z + 0.18);
    warnDmg.position.set(0.06, fy(1.0, z) - 0.04, z + 0.18);
  }
  layout(16 / 9, 70);

  let stickX = 0, stickY = 0;
  function update(dt, t, s) {
    // s: { throttle, heat, damaged, mdx, mdy, firing }
    lever.rotation.x = 0.45 - s.throttle * 0.9;
    stickX += (THREE.MathUtils.clamp(s.mdx * 0.015, -0.5, 0.5) - stickX) * Math.min(1, dt * 10);
    stickY += (THREE.MathUtils.clamp(s.mdy * 0.015, -0.4, 0.4) - stickY) * Math.min(1, dt * 10);
    stickPivot.rotation.z = -stickX;
    stickPivot.rotation.x = -stickY;
    trigger.position.z = s.firing ? -0.02 : -0.03;
    for (const b of buttons) {
      const on = Math.sin(t * b.rate + b.phase) > 0.2;
      b.mesh.material.color.copy(b.base).multiplyScalar(on ? 1 : 0.18);
    }
    const blink = Math.sin(t * 10) > 0;
    const hot = s.heat > 0.8;
    warnMat.color.setHex(hot && blink ? 0xff2010 : 0x400806);
    warnMat2.color.setHex(s.damaged && !blink ? 0xffa010 : 0x402806);
    warnLight.intensity = hot && blink ? 1.5 : 0;
    light.intensity = s.shutdown ? 0.15 + Math.random() * 0.2 : 1.2;
  }

  return { group, screens, layout, update };
}
