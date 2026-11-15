// Sonido sintetizado con WebAudio (sin archivos externos).
let ctx = null, master = null, noiseBuf = null, hum = null;

export function initAudio() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
  ctx = new (window.AudioContext || window.webkitAudioContext)();
  master = ctx.createGain();
  master.gain.value = 0.45;
  master.connect(ctx.destination);
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
}

function out(vol) {
  const g = ctx.createGain();
  g.gain.value = vol;
  g.connect(master);
  return g;
}
function env(param, t, peak, attack, decay) {
  param.setValueAtTime(0.0001, t);
  param.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t + attack);
  param.exponentialRampToValueAtTime(0.0001, t + attack + decay);
}
function osc(type, f0, f1, dur, vol, dest) {
  const t = ctx.currentTime;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(Math.max(f1, 1), t + dur);
  env(g.gain, t, vol, 0.005, dur);
  o.connect(g); g.connect(dest);
  o.start(t); o.stop(t + dur + 0.05);
}
function noise(filterType, f0, f1, q, dur, vol, dest) {
  const t = ctx.currentTime;
  const s = ctx.createBufferSource();
  s.buffer = noiseBuf; s.loop = true;
  const f = ctx.createBiquadFilter();
  f.type = filterType; f.Q.value = q;
  f.frequency.setValueAtTime(f0, t);
  f.frequency.exponentialRampToValueAtTime(Math.max(f1, 10), t + dur);
  const g = ctx.createGain();
  env(g.gain, t, vol, 0.01, dur);
  s.connect(f); f.connect(g); g.connect(dest);
  s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.05);
}

const ok = (v) => ctx && v > 0.01;

export const sfx = {
  laser(v = 1) { if (!ok(v)) return; const o = out(v); osc('square', 1500, 220, 0.22, 0.12, o); osc('sawtooth', 900, 140, 0.25, 0.05, o); },
  ppc(v = 1) { if (!ok(v)) return; const o = out(v); osc('sawtooth', 260, 40, 0.7, 0.18, o); noise('bandpass', 3000, 300, 2, 0.6, 0.35, o); },
  missile(v = 1) { if (!ok(v)) return; const o = out(v); noise('bandpass', 600, 2500, 1.5, 0.5, 0.35, o); },
  cannon(v = 1) { if (!ok(v)) return; const o = out(v); noise('lowpass', 2500, 200, 0.7, 0.35, 0.6, o); osc('sine', 120, 40, 0.3, 0.4, o); },
  explosion(v = 1, big = false) {
    if (!ok(v)) return; const o = out(v);
    noise('lowpass', big ? 1600 : 2200, 60, 0.8, big ? 2.0 : 0.9, big ? 0.9 : 0.6, o);
    osc('sine', big ? 90 : 140, 25, big ? 1.4 : 0.6, 0.6, o);
  },
  hit(v = 1) { if (!ok(v)) return; const o = out(v); noise('highpass', 1800, 600, 1, 0.18, 0.4, o); osc('square', 180, 60, 0.12, 0.15, o); },
  step(v = 1) { if (!ok(v)) return; const o = out(v); osc('sine', 70, 28, 0.25, 0.55, o); noise('lowpass', 300, 60, 1, 0.2, 0.25, o); },
  beep(v = 1, f = 880) { if (!ok(v)) return; const o = out(v); osc('square', f, f, 0.09, 0.08, o); },
  shutdown() { if (!ctx) return; const o = out(1); osc('sawtooth', 400, 30, 1.6, 0.2, o); },
  powerup() { if (!ctx) return; const o = out(1); osc('sawtooth', 40, 500, 1.2, 0.12, o); },
  ui() { if (!ctx) return; const o = out(1); osc('square', 660, 990, 0.06, 0.06, o); },
};

// Zumbido de fondo del reactor (más presente en cabina)
export function setHum(level) {
  if (!ctx) return;
  if (!hum) {
    const o1 = ctx.createOscillator(), o2 = ctx.createOscillator();
    o1.type = 'sawtooth'; o1.frequency.value = 50;
    o2.type = 'sine'; o2.frequency.value = 101;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 220;
    const g = ctx.createGain(); g.gain.value = 0;
    o1.connect(f); o2.connect(f); f.connect(g); g.connect(master);
    o1.start(); o2.start();
    hum = g;
  }
  hum.gain.setTargetAtTime(level, ctx.currentTime, 0.3);
}
