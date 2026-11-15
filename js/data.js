// Catálogo de armas y chasis.
// slot: E energía · B balística · M misiles
export const WEAPONS = {
  laserS: { name: 'LÁSER L',  slot: 'E', tons: 1,  heat: 2,   cd: 0.45, dmg: 3,   range: 160, type: 'beam', color: 0x30ff60, width: 0.22 },
  laser:  { name: 'LÁSER M',  slot: 'E', tons: 2,  heat: 3.5, cd: 0.55, dmg: 5,   range: 240, type: 'beam', color: 0xff3020, width: 0.32 },
  laserL: { name: 'LÁSER G',  slot: 'E', tons: 5,  heat: 8,   cd: 1.1,  dmg: 10,  range: 320, type: 'beam', color: 0xff40d0, width: 0.5 },
  ppc:    { name: 'PPC',      slot: 'E', tons: 7,  heat: 10,  cd: 2.4,  dmg: 14,  range: 320, type: 'bolt', speed: 280, color: 0x70d0ff },
  ac5:    { name: 'AC/5',     slot: 'B', tons: 6,  heat: 1,   cd: 1.3,  dmg: 5,   range: 280, type: 'shell', speed: 230, color: 0xffcc66, size: 0.4 },
  ac10:   { name: 'AC/10',    slot: 'B', tons: 10, heat: 3,   cd: 2.0,  dmg: 10,  range: 250, type: 'shell', speed: 210, color: 0xffaa40, size: 0.6 },
  srm4:   { name: 'SRM-4',    slot: 'M', tons: 2,  heat: 4,   cd: 2.8,  dmg: 2.5, range: 180, type: 'missile', count: 4, speed: 140, guided: false },
  lrm6:   { name: 'LRM-6',    slot: 'M', tons: 3,  heat: 5,   cd: 4.0,  dmg: 2.6, range: 450, type: 'missile', count: 6, speed: 95, guided: true },
  lrm10:  { name: 'LRM-10',   slot: 'M', tons: 5,  heat: 7,   cd: 4.5,  dmg: 2.6, range: 450, type: 'missile', count: 10, speed: 95, guided: true },
  // sólo vehículos
  cannon: { name: 'AC/5',     slot: null, tons: 0, heat: 1,   cd: 1.8,  dmg: 5,   range: 260, type: 'shell', speed: 210, color: 0xffcc66, size: 0.4 },
};

export const SLOT_NAME = { E: 'ENERGÍA', B: 'BALÍSTICA', M: 'MISILES' };
export const MOUNTS = ['LA', 'LT', 'RT', 'RA'];
export const MOUNT_NAME = { LA: 'BRAZO IZQ', LT: 'TORSO IZQ', RT: 'TORSO DER', RA: 'BRAZO DER' };
export const HEATSINK_PER_TON = 0.8; // disipación extra por tonelada libre

export const CHASSIS = [
  {
    id: 'halcon', name: 'HALCÓN', cls: 'LIGERO', tons: 35, scale: 0.82,
    maxSpeed: 21, turnRate: 1.5, dissip: 6, weaponTons: 9,
    armor: { CT: 48, LT: 32, RT: 32, LA: 22, RA: 22, LEGS: 40 },
    hard: { LA: 'E', LT: 'M', RT: 'E', RA: 'E' },
    loadout: { LA: 'laser', LT: 'srm4', RT: 'laserS', RA: 'laser' },
    colors: { base: 0x8a8a70, dark: 0x30332c, accent: 0x3a90c0, glass: 0x50ffd8 },
  },
  {
    id: 'centinela', name: 'CENTINELA', cls: 'MEDIO', tons: 55, scale: 1,
    maxSpeed: 16, turnRate: 1.15, dissip: 7, weaponTons: 15,
    armor: { CT: 70, LT: 45, RT: 45, LA: 32, RA: 32, LEGS: 55 },
    hard: { LA: 'E', LT: 'M', RT: 'E', RA: 'EB' },
    loadout: { LA: 'laser', LT: 'lrm6', RT: 'laser', RA: 'ppc' },
    colors: { base: 0x7d8068, dark: 0x30332c, accent: 0xc4561e, glass: 0x50ffd8 },
  },
  {
    id: 'titan', name: 'TITÁN', cls: 'PESADO', tons: 75, scale: 1.15,
    maxSpeed: 12.5, turnRate: 0.9, dissip: 8, weaponTons: 24,
    armor: { CT: 95, LT: 62, RT: 62, LA: 45, RA: 45, LEGS: 75 },
    hard: { LA: 'EB', LT: 'M', RT: 'ME', RA: 'EB' },
    loadout: { LA: 'laserL', LT: 'lrm10', RT: 'srm4', RA: 'ac10' },
    colors: { base: 0x6a7060, dark: 0x262822, accent: 0xb0a030, glass: 0x50ffd8 },
  },
  {
    id: 'goliat', name: 'GOLIAT', cls: 'ASALTO', tons: 95, scale: 1.3,
    maxSpeed: 9.5, turnRate: 0.7, dissip: 9, weaponTons: 34,
    armor: { CT: 125, LT: 85, RT: 85, LA: 60, RA: 60, LEGS: 100 },
    hard: { LA: 'EB', LT: 'M', RT: 'M', RA: 'EB' },
    loadout: { LA: 'ppc', LT: 'lrm10', RT: 'lrm10', RA: 'ac10' },
    colors: { base: 0x5c5a58, dark: 0x222020, accent: 0xa02820, glass: 0x50ffd8 },
  },
];

export const chassisById = (id) => CHASSIS.find(c => c.id === id) ?? CHASSIS[1];

export function defaultGroup(key) {
  const w = WEAPONS[key];
  if (!w) return 0;
  if (w.slot === 'M') return 2;
  if (w.slot === 'B' || key === 'ppc' || key === 'laserL') return 1;
  return 0;
}

// Opciones válidas para una montura (null = vacío)
export function optionsFor(ch, mount) {
  const allowed = ch.hard[mount];
  return [null, ...Object.keys(WEAPONS).filter(k => WEAPONS[k].slot && allowed.includes(WEAPONS[k].slot))];
}

// cfg: { [mount]: { w: clave|null, g: grupo } }
export function usedTons(cfg) {
  return Object.values(cfg).reduce((t, s) => t + (s.w ? WEAPONS[s.w].tons : 0), 0);
}

export function stats(ch, cfg) {
  const tons = usedTons(cfg);
  const free = Math.max(0, ch.weaponTons - tons);
  const dissip = ch.dissip + free * HEATSINK_PER_TON;
  let alpha = 0, heat = 0, dps = 0, maxRange = 0;
  for (const s of Object.values(cfg)) {
    if (!s.w) continue;
    const w = WEAPONS[s.w];
    const dmg = w.dmg * (w.count ?? 1);
    alpha += dmg; heat += w.heat; dps += dmg / w.cd; maxRange = Math.max(maxRange, w.range);
  }
  const armor = Object.values(ch.armor).reduce((a, b) => a + b, 0);
  return { tons, free, dissip, alpha, heat, dps, armor, maxRange, kph: Math.round(ch.maxSpeed * 4.5) };
}

export function defaultConfig(ch) {
  const cfg = {};
  for (const m of MOUNTS) cfg[m] = { w: ch.loadout[m] ?? null, g: defaultGroup(ch.loadout[m]) };
  return cfg;
}
