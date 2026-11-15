# STEEL HORIZON — simulador de combate mech (estilo MechWarrior / BattleTech)

Juego en HTML + JavaScript con Three.js y post-proceso CRT (pantalla plana, sin esquinas redondeadas).

## Cómo jugar

No necesita build. Sirve la carpeta con cualquier servidor estático (los módulos ES no cargan desde `file://`):

```bash
python3 -m http.server 8000
# abre http://localhost:8000
```

También funciona tal cual en GitHub Pages.

### Modos (independientes, se eligen en el menú)

| Modo | Vista | Apuntado |
|------|-------|----------|
| **[1] TÁCTICO** | Cenital, cámara sobre el mech | El torso gira hacia el cursor; los enemigos cercanos al cursor se fijan solos |
| **[2] CABINA** | Primera persona, interior de cabina 3D | Ratón capturado: mueve torso (giro) y brazos (pitch) |

### Controles

| Tecla | Acción |
|-------|--------|
| W / S | Subir / bajar acelerador (marcha atrás limitada) |
| A / D | Girar piernas |
| X | Parar · C centrar torso |
| Clic izq. | G1 — Láseres medios |
| Clic der. | G2 — PPC |
| Espacio / E | G3 — Misiles LRM (guiados si hay blanco fijado) |
| Rueda | Zoom (modo táctico) |
| T | Paleta CRT: color / ámbar / fósforo verde |
| Esc / P | Pausa (M para volver al menú) |

## Sistemas implementados

- **Torso independiente de las piernas**, como en BattleTech.
- **Daño por secciones**: brazos, torsos laterales, torso central y piernas. Si pierdes un brazo pierdes sus armas; con las piernas dañadas vas más lento; si caen el torso central o las piernas, el mech queda destruido.
- **Calor**: cada disparo calienta. Al llegar al 100 % el reactor se apaga 4 s (la pantalla se llena de estática).
- **Armas**: láser (impacto instantáneo), PPC (proyectil rápido), LRM (salva guiada), AC/5 (tanques).
- **Enemigos** con IA (acercarse / mantener distancia / flanquear, línea de visión): mechs ligeros "Chacal", pesados "Merodeador" y tanques.
- **Oleadas** crecientes con reparación parcial entre ellas.
- **Edificios destructibles** que bloquean disparos y movimiento.
- **Cabina 3D**: marco de parabrisas, salpicadero con 3 pantallas vivas (daños, radar, armas/calor), palanca de aceleración y joystick que se mueven con tus acciones, botonera parpadeante y luces de aviso.
- **CRT**: scanlines, máscara de apertura RGB, aberración cromática, bloom de fósforo, ruido, parpadeo, banda de refresco, sacudida al recibir impactos. El HUD también pasa por el filtro.
- **Sonido** sintetizado con WebAudio (sin archivos).

## Estructura

```
index.html        importmap + arranque
lib/              three.js r187 (vendorizado, licencia MIT)
js/main.js        bucle, estado, entidades, armas, IA, HUD
js/crt.js         shader CRT de post-proceso
js/world.js       terreno, cielo, luces, edificios
js/models.js      modelos low-poly de mech y tanque + animación de paso
js/cockpit.js     interior de cabina (hijo de la cámara)
js/hud.js         dibujo 2D: radar, esquema de daños, armas, calor
js/audio.js       efectos de sonido sintetizados
```

## Ideas para seguir

- Hangar / selección de chasis y configuración de armas
- Saltos (jump jets), pantalla de mapa, waypoints y misiones con objetivos
- Más variedad de terreno (ríos, bosques, noche con visión térmica)
- Gamepad, ajustes de sensibilidad, intensidad del efecto CRT
