# STEEL HORIZON — simulador de combate mech (estilo MechWarrior / BattleTech)

Juego en HTML + JavaScript con Three.js y post-proceso CRT (pantalla plana, sin esquinas redondeadas). Se juega **solo con teclado**; el ratón es opcional.

## Cómo jugar

No necesita build. Sirve la carpeta con cualquier servidor estático (los módulos ES no cargan desde `file://`):

```bash
python3 -m http.server 8000
# abre http://localhost:8000
```

También funciona tal cual en GitHub Pages.

### Flujo

**Menú → hangar → misión.** En el menú eliges modo (↑↓ + Enter o teclas 1 / 2); en el hangar configuras el mech y la misión (mapa, hora y, en batalla, el objetivo); con Enter despliegas. Al terminar, Enter te devuelve al hangar.

### Modos

| Modo | Descripción |
|------|-------------|
| **[1] ENTRENAMIENTO** | Práctica libre para aprender los controles: dianas, lecciones, sin muerte. |
| **[2] BATALLA 5 VS 5** | Tu escuadra contra otra con cuatro objetivos: asalto, defensa, conquista y escolta de convoy. |

### Vista

El juego se juega en **vista táctica** (cenital): cámara fija a máxima apertura que se adelanta hacia donde apunta el torso.

### Apuntado y disparo

- **Seguimiento automático (modo por defecto)**: el blanco es siempre el **enemigo visible más cercano** y el torso gira solo hacia él. Se mantiene mientras siga visible; si cae o se pierde de vista, se fija automáticamente el siguiente más cercano. **Q / Tab** o **→** pasan al siguiente blanco (por distancia) y **←** al anterior.
- **Sólo se dispara con el torso encarado a un blanco visible** (error menor de ~7°). Mientras el torso gira la retícula está en ámbar (*GIRANDO TORSO*) y las armas no disparan; en verde (*FUEGO*) sí. Si el blanco queda fuera del arco de giro del torso (±109° respecto a las piernas) aparece *FUERA DE ARCO · GIRA LAS PIERNAS*. Sin blanco no se dispara (*SIN BLANCO VISIBLE*); al intentarlo suena un clic seco.
- **Alcance**: las armas cuyo alcance no llega al blanco no disparan (no gastan calor) y aparecen como *LEJOS* en el panel de armas.
- Una línea discontinua desde tu mech indica hacia dónde apunta el torso, con el mismo color que la retícula.
- **R** cambia a **apuntado manual**: las flechas giran el torso (↑↓ ajustan el alcance de la mira) o, con ratón, el torso sigue al cursor; el blanco es el enemigo visible que quede en el cono del torso o bajo el cursor. Las mismas reglas de disparo siguen aplicando.

### Visibilidad: sólo se fija lo que se ve

En todos los modos, un enemigo sólo se puede **fijar como blanco** (Q/Tab, fijación automática, ratón, misiles guiados, orden "atacad mi blanco") si es **visible**:

1. está en pantalla,
2. está dentro del alcance visual: depende de la hora (≈ 680 m de día, ≈ 590 m al atardecer, ≈ 360 m de noche) y llega a 650 m con **visión térmica**,
3. hay **línea de visión** desde tu mech (edificios, colinas y otros mechs tapan),
4. no está oculto en un bosque a más de 150 m (la térmica sí ve a través del follaje).

Si el blanco deja de verse más de 0,6 s se pierde ("BLANCO PERDIDO"). Los enemigos en pantalla pero no visibles aparecen con un recuadro punteado y atenuado, y en el radar como un punto apagado: el radar sigue detectándolos, pero no puedes fijarlos.

### Entrenamiento

Modo libre para practicar sin presión:

- **Sin muerte**: el blindaje se repara poco a poco y, si el mech llegara a caer, se restaura entero.
- **Dianas que reaparecen**: 3 dianas fijas cerca, 2 dianas móviles y un tanque. Cada diana destruida vuelve a aparecer a los 4 s; **N** crea una diana fija más.
- **Blancos armados (O)**: por defecto las dianas no disparan; con O empiezan a devolver el fuego para practicar con presión real.
- **Lecciones** que se marcan solas al hacerlas (I oculta/muestra el panel):
  acelerar · girar piernas · girar torso · cambiar de blanco · disparar cada grupo · destruir una diana · superar el 70 % de calor · refrigerarse en el agua (si la zona tiene) · derribar un árbol (si hay bosque) · visión térmica.
- Usa el mismo hangar: puedes probar cualquier chasis, configuración, zona y hora.

### Batalla 5 vs 5

Tú (LANZA-1) y cuatro mechs aliados con IA (LANZA-2…5, en azul) contra cinco mechs enemigos (en rojo). En el hangar eliges **mapa**, **hora** y **objetivo**.

| Objetivo | Qué hay que hacer | Victoria | Derrota |
|----------|-------------------|----------|---------|
| **ASALTO** | Capturar el punto ALFA | la captura llega al 100 % | se acaba el tiempo (6 min) |
| **DEFENSA** | Impedir que el enemigo capture ALFA | aguantar hasta el final (6 min) | el enemigo llega al 100 % |
| **CONQUISTA** | Controlar los puntos ALFA, BRAVO y CHARLIE | llegar antes a 250 puntos (cada punto propio suma 1 por segundo) o tener más al acabar los 7 min | el enemigo llega antes a 250 |
| **ESCOLTA** | Llevar 3 camiones por la ruta hasta la EXTRACCIÓN | llegan 2 camiones | se pierden 2 camiones o se acaban los 8 min |

En todos los objetivos, además, gana quien deje al otro **sin refuerzos y sin mechs en pie**.

- **Puntos de captura**: zonas circulares con postes y un haz de luz visible desde lejos. Toman el color de quien los controla y parpadean en naranja cuando están **disputados** (mechs de los dos bandos dentro: la captura se congela).
  - *Asalto/Defensa*: la captura sólo avanza con atacantes dentro y ningún defensor (más rápido con más atacantes, hasta 3); si sólo hay defensores, retrocede.
  - *Conquista*: cada punto tiene una barra de −100 (rojo) a +100 (azul). Con un solo bando dentro se mueve hacia ese lado; al llegar al extremo el punto pasa a ser suyo, y lo sigue siendo hasta que la barra cruza el centro (queda neutral). La IA de ambos bandos se reparte entre los puntos que no controla y a veces vigila los propios.
- **Escolta**: los camiones (blindados, sin armas) arrancan a los 8 s, van en fila manteniendo la distancia y siguen la ruta (en la ciudad, por una calle recta; fuera, se abre un pasillo entre edificios). El enemigo embosca desde un lateral a mitad de ruta y prioriza los camiones. Tus aliados escoltan al camión de cabeza. El HUD muestra el avance de la ruta y el blindaje de cada camión; hay marcadores de **CONVOY** y **EXTRACCIÓN**.
- **Refuerzos**: cada equipo tiene 10. Cada mech destruido gasta uno y reaparece en su base (8 s el jugador, 10 s la IA).
- **Eyección**: cuando tu mech cae, el piloto **sale disparado en una cápsula con paracaídas**. La cámara la sigue hasta que reapareces en la base con un mech nuevo con tu misma configuración. **Z mantenido** (1,2 s) eyecta voluntariamente, aunque gasta un refuerzo. Los mechs de la IA también se eyectan.
- **HUD de batalla**: objetivo y progreso (barra de captura, tres casillas A/B/C con marcador en conquista, o avance del convoy), tiempo, refuerzos y mechs vivos por equipo, marcadores con distancia (se pegan al borde si quedan fuera de pantalla), aliados con chevrón azul y en el radar.
- **Puntuación**: los derribos que haces tú cuentan entero; los de la escuadra, una parte.

#### Órdenes a la escuadra

| Tecla | Orden | Qué hacen tus aliados |
|-------|-------|-----------------------|
| **1** | SEGUIDME | Forman en cuña detrás de ti, igualan tu velocidad y disparan a lo que tengan a tiro |
| **2** | ATACAD MI BLANCO | Todos se lanzan contra tu blanco fijado (fíjalo antes con Q). Al destruirlo vuelven a libre acción |
| **3** | OBJETIVO | Asalto/Defensa: van al punto ALFA y se quedan dentro · Conquista: toman el punto más cercano a ti que no sea vuestro · Escolta: se pegan al convoy |
| **4** | LIBRE ACCIÓN | Comportamiento por defecto según el objetivo de la misión |

Cada orden se confirma por radio (un aliado responde). El panel **ESCUADRA** (bajo el radar) muestra la orden activa y, por aliado, blindaje y estado (SIGUIENDO, ATACANDO, AL PUNTO, COMBATE, AVANZANDO, EYECTADO…). El blanco ordenado lleva una marca azul **ESCUADRA** en el HUD.

### Controles

| Tecla | Acción |
|-------|--------|
| ↑ / ↓ + Enter (o 1 / 2) | Elegir modo en el menú |
| W / S | Subir / bajar acelerador (marcha atrás limitada) |
| A / D | Girar piernas |
| Q / Tab · → | Siguiente blanco (por distancia) |
| ← | Blanco anterior |
| R | Seguimiento automático (por defecto) ↔ apuntado manual |
| ← / → · ↑ / ↓ | En apuntado manual: girar torso · alcance de la mira |
| Espacio / J | Grupo de disparo G1 |
| F / K | Grupo de disparo G2 |
| E / L | Grupo de disparo G3 |
| X | Parar · C centrar torso |
| V | Visión térmica on/off |
| T | Paleta CRT: color / ámbar / fósforo verde |
| Esc / P | Pausa (Enter continuar, H hangar, M menú) |
| 1 · 2 · 3 · 4 | Batalla: órdenes a la escuadra (seguidme · atacad mi blanco · al punto · libre) |
| Z (mantener) | Batalla: eyección voluntaria |
| O · N · I | Sólo entrenamiento: blancos armados · nueva diana · panel de lecciones |


**Con ratón (opcional):** clic izq. = G1, clic der. = G2. En apuntado manual (R) el torso sigue al cursor.

## Hangar

Antes de cada misión configuras el mech y, en el panel **MISIÓN**, el mapa, la hora y (en batalla) el objetivo. Se maneja con teclado (↑↓ elegir fila, ←→ cambiar, G grupo de disparo, R restablecer, Enter desplegar, Esc menú) o haciendo clic en las flechas. Todo se guarda en el navegador.

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

## Mapas, hora del día y visión térmica

Se eligen en el panel **MISIÓN** del hangar (filas MAPA y HORA); se pueden combinar libremente con cualquier objetivo.

| Mapa | Terreno |
|------|---------|
| DESIERTO ROJO | Dunas, ruinas industriales, árboles muertos dispersos |
| VALLE FLUVIAL | Dos ríos, lagos, arboledas de pinos y frondosos |
| BOSQUE BOREAL | Bosque muy denso de coníferas cruzado por un río |
| CIUDAD EN RUINAS | Cuadrícula de calles y manzanas con edificios de 8 a 38 m, plazas abiertas (donde se colocan los puntos de captura) y edificios en ruinas. Máxima cobertura: los edificios cortan la línea de visión y se pueden derribar |

| Hora | Efecto |
|------|--------|
| DÍA | Cielo azul, buena visibilidad |
| ATARDECER | Luz rasante naranja, ventanas encendidas |
| NOCHE | Luna y estrellas, niebla oscura, visibilidad corta; el mech enciende focos |

- **Agua**: vadear ríos y lagos reduce la velocidad un 40 % pero **refrigera un 70 % más rápido** (como en BattleTech). Salpicaduras al caminar y en los impactos. Nunca se despliega dentro del agua.
- **Bosques**: los árboles **caen** cuando un mech o tanque los atraviesa. Estar dentro de un bosque da **cobertura**: los enemigos fallan más y no te disparan a más de 150 m.
- **Visión térmica (V)**: renderiza cada objeto según su temperatura con paleta *ironbow* (negro → morado → rojo → naranja → blanco). Los mechs brillan más cuanto más calor acumulan, los restos humean calientes, el agua y el terreno quedan fríos. Imprescindible de noche.

## Sistemas implementados

- **Torso independiente de las piernas**, como en BattleTech.
- **Daño por secciones**: brazos, torsos laterales, torso central y piernas. Si pierdes un brazo o un torso lateral pierdes sus armas; con las piernas dañadas vas más lento; si caen el torso central o las piernas, el mech queda destruido.
- **Calor**: cada disparo calienta. Al llegar al 100 % el reactor se apaga 4 s (la pantalla se llena de estática). El agua y los disipadores extra ayudan.
- **Armas**: láseres (impacto instantáneo), PPC (proyectil rápido), cañones automáticos, SRM (salva directa) y LRM (salva guiada).
- **Enemigos** con IA (acercarse / mantener distancia / flanquear, línea de visión, cobertura del bosque): "Chacal" (ligero), "Merodeador" (medio) y "Coloso" (pesado). Usan los mismos chasis que el jugador. En entrenamiento también hay tanques.
- **Equipos**: IA genérica por bandos; los aliados y enemigos usan los mismos chasis, eligen blanco por cercanía y respetan la línea de visión (no disparan si un compañero se interpone).
- **Edificios destructibles** que bloquean disparos y movimiento.
- **CRT**: scanlines, máscara de apertura RGB, aberración cromática, bloom de fósforo, ruido, parpadeo, banda de refresco, sacudida al recibir impactos y paleta térmica integrada. El HUD también pasa por el filtro.
- **Sonido** sintetizado con WebAudio (sin archivos): armas, explosiones, pasos, árboles, agua, alarmas y zumbido del reactor.

## Estructura

```
index.html        importmap + arranque
lib/              three.js r187 (vendorizado, licencia MIT)
js/main.js        bucle, estado, entidades, armas, IA por equipos, HUD, hangar (UI), entrenamiento, batalla 5 vs 5 (asalto, defensa, conquista, escolta), órdenes de escuadra, eyección, visión térmica
js/data.js        catálogo de armas y chasis, cálculo de estadísticas
js/hangar.js      escena 3D del hangar
js/crt.js         shader CRT de post-proceso (incluye paleta térmica)
js/world.js       mapas y horas: terreno, ríos/agua, bosques instanciados, ciudad en cuadrícula, cielo, luces, edificios
js/models.js      modelos low-poly de mech (armas visibles según configuración), tanque y camión de convoy
js/hud.js         dibujo 2D del HUD: radar, esquema de daños, armas, calor
js/audio.js       efectos de sonido sintetizados
```

## Ideas para seguir

- Saltos (jump jets), pantalla de mapa, órdenes individuales por aliado
- Variante de escolta inversa (emboscar un convoy enemigo)
- Progresión: créditos por batalla para desbloquear chasis y armas
- Gamepad, ajustes de sensibilidad, intensidad del efecto CRT
