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
| **[1] TÁCTICO** | Cenital, cámara sobre el mech | Flechas giran el torso (o el torso sigue al cursor si usas ratón) |
| **[2] CABINA** | Primera persona, interior de cabina 3D | Flechas (o ratón capturado) mueven torso y mira |

### Controles

Se puede jugar **solo con teclado** (el ratón es opcional).

| Tecla | Acción |
|-------|--------|
| ↑ / ↓ + Enter (o 1 / 2) | Elegir modo en el menú |
| W / S | Subir / bajar acelerador (marcha atrás limitada) |
| A / D | Girar piernas |
| ← / → | Girar torso |
| ↑ / ↓ | Cabina: subir/bajar la mira · Táctico: alcance de la mira |
| Q / Tab | Siguiente blanco (más cercano primero) y activa el seguimiento automático del torso |
| R | Activar / desactivar el seguimiento del blanco |
| Espacio / J | Grupo de disparo G1 |
| F / K | Grupo de disparo G2 |
| E / L | Grupo de disparo G3 |
| X | Parar · C centrar torso |
| T | Paleta CRT: color / ámbar / fósforo verde |
| Esc / P | Pausa (Enter continuar, H hangar, M menú) |

Sin seguimiento activo, cualquier enemigo que quede dentro del cono de tiro del torso se fija solo.

**Con ratón (opcional):** en modo táctico el torso sigue al cursor; en cabina, clic para capturar el ratón y mirar. Clic izq. = G1, clic der. = G2, rueda = zoom (táctico). El juego cambia solo entre ratón y teclado según el último que uses para apuntar.

## Hangar

Después de elegir modo entras al **hangar**, donde configuras el mech antes de desplegar. Se maneja con teclado (↑↓ elegir fila, ←→ cambiar, G grupo de disparo, R restablecer, Enter desplegar, Esc menú) o haciendo clic en las flechas. La configuración se guarda en el navegador.

| Chasis | Clase | Tonelaje | Velocidad | Carga de armas | Monturas (LA / LT / RT / RA) |
|--------|-------|----------|-----------|----------------|------------------------------|
| HALCÓN | Ligero | 35 t | 94 kph | 9 t | E / M / E / E |
| CENTINELA | Medio | 55 t | 72 kph | 15 t | E / M / E / EB |
| TITÁN | Pesado | 75 t | 56 kph | 24 t | EB / M / ME / EB |
| GOLIAT | Asalto | 95 t | 43 kph | 34 t | EB / M / M / EB |

Tipos de montura: **E** energía, **B** balística, **M** misiles. Cada montura solo acepta armas de los tipos indicados. Las toneladas que no gastas en armas se convierten en **disipadores extra** (+0.8 de disipación por tonelada), así que puedes elegir entre más potencia de fuego o más aguante térmico.

| Arma | Tipo | Peso | Daño | Calor | Recarga | Alcance |
|------|------|------|------|-------|---------|---------|
| Láser L | E | 1 t | 3 | 2 | 0.45 s | 160 m |
| Láser M | E | 2 t | 5 | 3.5 | 0.55 s | 240 m |
| Láser G | E | 5 t | 10 | 8 | 1.1 s | 320 m |
| PPC | E | 7 t | 14 | 10 | 2.4 s | 320 m |
| AC/5 | B | 6 t | 5 | 1 | 1.3 s | 280 m |
| AC/10 | B | 10 t | 10 | 3 | 2.0 s | 250 m |
| SRM-4 | M | 2 t | 2.5×4 | 4 | 2.8 s | 180 m (sin guiar) |
| LRM-6 | M | 3 t | 2.6×6 | 5 | 4.0 s | 450 m (guiado) |
| LRM-10 | M | 5 t | 2.6×10 | 7 | 4.5 s | 450 m (guiado) |

Las armas se ven en el modelo 3D (cañones, bobinas de PPC, lanzamisiles en el hombro…) y cambian al instante en el hangar. El panel muestra velocidad, blindaje, disipación, daño alfa, daño por segundo y cuánto tardas en disipar una andanada completa.

## Sistemas implementados

- **Torso independiente de las piernas**, como en BattleTech.
- **Daño por secciones**: brazos, torsos laterales, torso central y piernas. Si pierdes un brazo pierdes sus armas; con las piernas dañadas vas más lento; si caen el torso central o las piernas, el mech queda destruido.
- **Calor**: cada disparo calienta. Al llegar al 100 % el reactor se apaga 4 s (la pantalla se llena de estática).
- **Armas**: láseres (impacto instantáneo), PPC (proyectil rápido), cañones automáticos, SRM (salva directa) y LRM (salva guiada).
- **Enemigos** con IA (acercarse / mantener distancia / flanquear, línea de visión): "Chacal" (ligero), "Merodeador" (medio), "Coloso" (pesado, desde la oleada 5) y tanques. Usan los mismos chasis que el jugador.
- **Oleadas** crecientes con reparación parcial entre ellas.
- **Edificios destructibles** que bloquean disparos y movimiento.
- **Cabina 3D**: marco de parabrisas, salpicadero con 3 pantallas vivas (daños, radar, armas/calor), palanca de aceleración y joystick que se mueven con tus acciones, botonera parpadeante y luces de aviso.
- **CRT**: scanlines, máscara de apertura RGB, aberración cromática, bloom de fósforo, ruido, parpadeo, banda de refresco, sacudida al recibir impactos. El HUD también pasa por el filtro.
- **Sonido** sintetizado con WebAudio (sin archivos).

## Estructura

```
index.html        importmap + arranque
lib/              three.js r187 (vendorizado, licencia MIT)
js/main.js        bucle, estado, entidades, armas, IA, HUD, hangar (UI)
js/data.js        catálogo de armas y chasis, cálculo de estadísticas
js/hangar.js      escena 3D del hangar
js/crt.js         shader CRT de post-proceso
js/world.js       terreno, cielo, luces, edificios
js/models.js      modelos low-poly de mech (armas visibles según configuración) y tanque
js/cockpit.js     interior de cabina (hijo de la cámara)
js/hud.js         dibujo 2D: radar, esquema de daños, armas, calor
js/audio.js       efectos de sonido sintetizados
```

## Ideas para seguir

- Saltos (jump jets), pantalla de mapa, waypoints y misiones con objetivos
- Más variedad de terreno (ríos, bosques, noche con visión térmica)
- Gamepad, ajustes de sensibilidad, intensidad del efecto CRT
