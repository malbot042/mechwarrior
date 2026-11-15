// Utilidades de dibujo 2D para el HUD y las pantallas de cabina.
export const C = {
  main: '#86ff9c', dim: 'rgba(134,255,156,0.35)', faint: 'rgba(134,255,156,0.12)',
  warn: '#ffb020', bad: '#ff4a30', cyan: '#5fe0ff', white: '#eaffea', enemy: '#ff5a40', ally: '#5fa8ff',
};

export function txt(g, s, x, y, o = {}) {
  const size = o.size ?? 12;
  g.font = `${o.bold === false ? '' : 'bold '}${size}px "Courier New", monospace`;
  g.textAlign = o.align ?? 'left';
  g.textBaseline = o.base ?? 'alphabetic';
  g.fillStyle = o.color ?? C.main;
  g.shadowColor = o.color ?? C.main;
  g.shadowBlur = o.glow ?? 6;
  g.fillText(s, x, y);
  g.shadowBlur = 0;
}

export function frame(g, x, y, w, h, color = C.dim, title) {
  g.strokeStyle = color; g.lineWidth = 1;
  g.fillStyle = 'rgba(0,12,4,0.55)';
  g.fillRect(x, y, w, h);
  g.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  const c = 5;
  g.strokeStyle = C.main;
  g.beginPath();
  g.moveTo(x, y + c); g.lineTo(x, y); g.lineTo(x + c, y);
  g.moveTo(x + w - c, y); g.lineTo(x + w, y); g.lineTo(x + w, y + c);
  g.moveTo(x, y + h - c); g.lineTo(x, y + h); g.lineTo(x + c, y + h);
  g.moveTo(x + w - c, y + h); g.lineTo(x + w, y + h); g.lineTo(x + w, y + h - c);
  g.stroke();
  if (title) txt(g, title, x + 4, y - 3, { size: 9, color: C.main, glow: 3 });
}

const ratioColor = (r) => r <= 0 ? null : r > 0.66 ? C.main : r > 0.33 ? C.warn : C.bad;

// Esquema de daños del mech (vista frontal)
export function drawDamage(g, x, y, s, armor, max, t = 0) {
  const R = {
    LA: [0, 1.2, 1.8, 4.6], LT: [2, 0.6, 1.9, 4.4], CT: [4.1, 0, 1.8, 5.6],
    RT: [6.1, 0.6, 1.9, 4.4], RA: [8.2, 1.2, 1.8, 4.6],
  };
  const draw = (r, ratio) => {
    const col = ratioColor(ratio);
    const [rx, ry, rw, rh] = r.map(v => v * s);
    if (col) {
      g.fillStyle = col; g.globalAlpha = 0.28 + 0.5 * ratio;
      if (ratio < 0.33 && Math.sin(t * 12) > 0) g.globalAlpha = 0.15;
      g.fillRect(x + rx, y + ry, rw, rh); g.globalAlpha = 1;
      g.strokeStyle = col;
    } else {
      g.strokeStyle = 'rgba(255,74,48,0.5)';
      g.beginPath(); g.moveTo(x + rx, y + ry); g.lineTo(x + rx + rw, y + ry + rh);
      g.moveTo(x + rx + rw, y + ry); g.lineTo(x + rx, y + ry + rh); g.stroke();
    }
    g.lineWidth = 1; g.strokeRect(x + rx + 0.5, y + ry + 0.5, rw - 1, rh - 1);
  };
  for (const k of Object.keys(R)) if (k in armor) draw(R[k], armor[k] / max[k]);
  if ('LEGS' in armor) {
    const r = armor.LEGS / max.LEGS;
    draw([2.6, 6.0, 1.9, 5.2], r);
    draw([5.5, 6.0, 1.9, 5.2], r);
  }
}

// Radar: rot = ángulo del observador (0 = norte arriba)
export function drawRadar(g, cx, cy, r, origin, rot, blips, range, t, cone) {
  g.save();
  g.fillStyle = 'rgba(0,14,6,0.7)';
  g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fill();
  g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.clip();
  g.strokeStyle = C.faint; g.lineWidth = 1;
  for (const k of [0.33, 0.66, 1]) { g.beginPath(); g.arc(cx, cy, r * k, 0, Math.PI * 2); g.stroke(); }
  g.beginPath(); g.moveTo(cx - r, cy); g.lineTo(cx + r, cy); g.moveTo(cx, cy - r); g.lineTo(cx, cy + r); g.stroke();
  if (cone !== undefined) {
    g.fillStyle = 'rgba(134,255,156,0.10)';
    g.beginPath(); g.moveTo(cx, cy); g.arc(cx, cy, r, -Math.PI / 2 - cone, -Math.PI / 2 + cone); g.closePath(); g.fill();
  }
  // barrido
  const a = t * 2.2;
  const grad = g.createConicGradient ? g.createConicGradient(a, cx, cy) : null;
  if (grad) {
    grad.addColorStop(0, 'rgba(134,255,156,0.0)');
    grad.addColorStop(0.9, 'rgba(134,255,156,0.0)');
    grad.addColorStop(1, 'rgba(134,255,156,0.25)');
    g.fillStyle = grad; g.fillRect(cx - r, cy - r, r * 2, r * 2);
  }
  const s = r / range;
  const cs = Math.cos(rot), sn = Math.sin(rot);
  for (const b of blips) {
    const dx = b.x - origin.x, dz = b.z - origin.z;
    // ejes del observador: derecha (cos, -sin), adelante (-sin, -cos)
    const sx = (dx * cs - dz * sn) * s;
    const sy = -(-dx * sn - dz * cs) * s;
    let px = cx + sx, py = cy + sy;
    const d = Math.hypot(sx, sy);
    if (d > r - 3) { px = cx + sx / d * (r - 3); py = cy + sy / d * (r - 3); }
    g.fillStyle = b.color ?? C.enemy;
    g.shadowColor = g.fillStyle; g.shadowBlur = 5;
    if (b.type === 'obj') {
      g.strokeStyle = b.color; g.globalAlpha = 0.5 + 0.4 * Math.sin(t * 4);
      g.beginPath(); g.arc(px, py, Math.max(3, (b.r ?? 10) * s), 0, Math.PI * 2); g.stroke();
      g.globalAlpha = 1; g.shadowBlur = 0; continue;
    }
    if (b.type === 'obs') { g.shadowBlur = 0; g.globalAlpha = 0.35; g.fillRect(px - 2, py - 2, 4, 4); g.globalAlpha = 1; }
    else if (b.type === 'tank') g.fillRect(px - 2, py - 2, 4, 4);
    else { g.beginPath(); g.moveTo(px, py - 4); g.lineTo(px + 3.5, py + 3); g.lineTo(px - 3.5, py + 3); g.closePath(); g.fill(); }
    if (b.targeted) { g.strokeStyle = C.white; g.strokeRect(px - 6, py - 6, 12, 12); }
    g.shadowBlur = 0;
  }
  g.restore();
  // jugador
  g.fillStyle = C.main;
  g.beginPath(); g.moveTo(cx, cy - 5); g.lineTo(cx + 4, cy + 4); g.lineTo(cx - 4, cy + 4); g.closePath(); g.fill();
  g.strokeStyle = C.dim; g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.stroke();
}

export function drawWeapons(g, x, y, w, weapons, armor, rowH = 13, size = 10) {
  const groups = ['G1', 'G2', 'G3'];
  weapons.forEach((wp, i) => {
    const yy = y + i * rowH;
    const dead = armor[wp.sec] <= 0;
    const ready = wp.cd <= 0;
    const col = dead ? 'rgba(255,74,48,0.6)' : ready ? C.main : C.warn;
    txt(g, `${groups[wp.group]} ${wp.def.name}`, x, yy + size, { size, color: col, glow: 3 });
    const bx = x + w * 0.62, bw = w * 0.38;
    g.strokeStyle = col; g.strokeRect(bx + 0.5, yy + 2.5, bw - 1, size - 3);
    if (!dead) {
      const f = 1 - Math.max(0, wp.cd) / wp.def.cd;
      g.fillStyle = col; g.fillRect(bx + 2, yy + 4, (bw - 4) * f, size - 6);
    } else txt(g, 'DESTR', bx + bw / 2, yy + size - 1, { size: size - 2, align: 'center', color: C.bad, glow: 0 });
  });
}

export function drawHeat(g, x, y, w, h, heat, vertical = true, t = 0) {
  g.strokeStyle = C.dim; g.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  const f = Math.min(1, heat / 100);
  const col = f > 0.8 ? C.bad : f > 0.55 ? C.warn : C.main;
  g.fillStyle = col;
  if (f > 0.8 && Math.sin(t * 14) > 0) g.globalAlpha = 0.5;
  if (vertical) g.fillRect(x + 2, y + 2 + (h - 4) * (1 - f), w - 4, (h - 4) * f);
  else g.fillRect(x + 2, y + 2, (w - 4) * f, h - 4);
  g.globalAlpha = 1;
  g.strokeStyle = C.bad;
  if (vertical) { const yy = y + h * 0.2; g.beginPath(); g.moveTo(x - 3, yy); g.lineTo(x + w + 3, yy); g.stroke(); }
  else { const xx = x + w * 0.8; g.beginPath(); g.moveTo(xx, y - 3); g.lineTo(xx, y + h + 3); g.stroke(); }
}

export function brackets(g, x, y, w, h, color, len = 6) {
  g.strokeStyle = color; g.lineWidth = 1.5;
  g.beginPath();
  g.moveTo(x, y + len); g.lineTo(x, y); g.lineTo(x + len, y);
  g.moveTo(x + w - len, y); g.lineTo(x + w, y); g.lineTo(x + w, y + len);
  g.moveTo(x, y + h - len); g.lineTo(x, y + h); g.lineTo(x + len, y + h);
  g.moveTo(x + w - len, y + h); g.lineTo(x + w, y + h); g.lineTo(x + w, y + h - len);
  g.stroke(); g.lineWidth = 1;
}
