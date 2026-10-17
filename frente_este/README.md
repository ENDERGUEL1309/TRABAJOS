# FRENTE ESTE · Beta 0.2

Shooter táctico realista para navegador y móvil (gama alta) con **three.js**, ambientado en la guerra ruso-ucraniana. Estética de **cámara corporal** (ojo de pez, aberración cromática, grano, balanceo al caminar), dos bandos y **4 jugadores** (2 contra 2) en la beta.

Todo es procedural: no hay modelos ni texturas externas. three.js r160 va incluido en `vendor/`, así que funciona sin conexión a internet (en LAN, por ejemplo).

## Cómo jugar

**En Windows (lo más fácil):**
1. Descarga el ZIP del repositorio desde GitHub (botón verde **Code → Download ZIP**, en la rama `claude/zen-ptolemy-hwero2`) y descomprímelo.
2. Entra en la carpeta `frente_este` y haz doble clic en **`INICIAR-WINDOWS.bat`**.
   - Si no tienes Node.js, el lanzador lo instala con `winget`. Si no puede, abre la página de descarga: instala la versión LTS y vuelve a hacer doble clic.
   - Si Windows pregunta por el firewall, pulsa **Permitir** (en redes privadas) para que otros de tu WiFi puedan unirse.
3. Se abre el navegador en `http://localhost:8080`. Deja abierta la ventana negra mientras jugáis.

**En macOS o Linux:** instala Node.js (LTS) y ejecuta `./iniciar-mac-linux.sh`, o bien `cd servidor && npm start`.

El servidor no necesita `npm install`: no tiene dependencias externas.

- **Partida local**: elige *Partida local (con IA)*: tú + 1 aliado IA contra 2 enemigos IA.
- **Multijugador beta**: cada jugador abre la dirección `http://IP:8080` que muestra la ventana del servidor y elige *Multijugador beta*. Máximo 4 por sala y el reparto de bandos se equilibra 2 contra 2.
- En el móvil, pon el teléfono en horizontal.

> Para jugar fuera de tu red local, el servidor tiene que estar publicado con HTTPS/WSS (por ejemplo detrás de un proxy inverso o en un hosting de Node).

## Controles

| Modo | Móvil | Teclado / ratón |
|---|---|---|
| **Infantería** | Joystick izq. moverse · arrastrar a la derecha mirar · **MIRA** (izq.) · **FUEGO** (der.; también se puede arrastrar para mirar) · RECARGA · SALTO · AGACHAR · ARMA · DRON FPV · SUBIR | WASD · ratón · clic der. apuntar · clic izq. disparar · Mayús correr · C agacharse · Espacio saltar · R recargar · Q/1/2 arma · F subir · G dron · Tab marcador |
| **Tanque / MT-LB** (orugas) | **Palanca izq. = oruga izq., palanca der. = oruga der.** · arrastrar torreta · FUEGO · AMETR. (coaxial) · ZOOM (visor → aumento → térmico) · 1ª/3ª · MUNICIÓN (APFSDS/HE) · BAJAR | Q/Z oruga izq. · E/C oruga der. (o W/S/A/D mezclado) · ratón torreta · clic cañón · Espacio coaxial · clic der./N zoom · V cámara · T munición · F bajar |
| **Pick-up ZU-23-2** (ruedas) | **Joystick izq. acelerar/frenar · joystick der. dirección** · arrastrar para apuntar · FUEGO | W/S · A/D · ratón · clic |
| **Dron FPV** (modo 2) | **Izq.: gas (no vuelve al centro) + guiñada · Der.: cabeceo + alabeo** · ANGLE/ACRO · DETONAR · VOLVER | W/S gas · A/D guiñada · flechas o IJKL · B modo · Retroceso detonar · Esc volver |

También funciona con mando (Gamepad API).

## Mapas

- **Villa Atómica** (por defecto, arena pequeña de ~100 × 74 m para infantería): pueblo de pruebas nucleares de los años 50 en el desierto, inspirado en los clásicos mapas de "pueblo de pruebas". Tiene dos casas de dos plantas enfrentadas, con escalera, habitaciones, garaje con techo transitable y ventanas para disparar; calle con rotonda y autobús escolar; coches y camiones como cobertura; vallas bajas que se pueden saltar; patios traseros con cobertizos; y maniquíes. Cada equipo aparece en un extremo de la calle.
- **Frente Este** (2,4 km, con vehículos y aeronaves).

El mapa se elige en el menú. En multijugador, cada mapa usa su propia sala.

## Novedades (beta 0.2)

- **Daño corregido en iPhone**: el lienzo 3D medía `100vh`, que en Safari es más alto que la zona visible, así que el punto de mira no coincidía con el centro real de la imagen y los disparos salían por encima. Ahora el lienzo se ajusta al área visible. Además se ha reducido la dispersión desde la cadera, la bala converge en lo que hay bajo la mira (incluidos los soldados), hay puesta a cero automática a la distancia del blanco, marca y sonido de impacto, y asistencia de apuntado suave en pantallas táctiles.
- **Clases (operadores)**: Asalto, Soporte (reabastece munición a los aliados), Francotirador, Antitanque y Operador de drones. Se eligen en la pantalla de **despliegue**, al empezar y en cada reaparición.
- **Armas**: AK-74M, AK-12, M4A1, CZ Bren 2, AKS-74U, PKM, RPK-74M, SVD, ORSIS T-5000, Barrett M82A1, Makarov PM, Glock 17, RPG-7, NLAW, RPG-26 y granadas F-1. Hay armas automáticas, semiautomáticas y de cerrojo.
- **Accesorios**: miras metálicas, colimador, holográfico, ópticas 4× (también PSO-1) y telescópica 8× con retícula y balanceo de respiración; silenciador, compensador y apagallamas; empuñadura vertical o angulada y bípode; cargador ampliado o de recarga rápida.
- **Mapa completo** (botón MAPA, tecla M o tocar el minimapa): relieve, cuadrícula de 200 m, bases, aliados, vehículos y enemigos avistados.
- **Dron más fácil**: nuevo modo **ESTABLE** por defecto. Mantiene la altura y el stick izquierdo sube y baja a unos 10 m/s. Siguen disponibles ANGLE y ACRO.
- **Aeronaves** (botones de armas a la izquierda; asistencia de puntería suave hacia enemigos cerca de la mira): helicóptero de ataque **Mi-24** (subir/bajar con mantenimiento de altura, ametralladora de morro YakB-12,7 que se apunta arrastrando por la pantalla, con dispersión real, y cohetes S-8) y avión **Su-25** (arranque en vuelo a 260 m y ~300 km/h, máximo ~575 km/h, cañón GSh-30-2 con munición explosiva, cohetes S-8 y 4 bombas FAB-250, con opción de eyectar). Se estrellan, se derriban (el ZU-23-2 tiene espoleta de proximidad) y reaparecen en su base.

## Qué incluye

- **Mapa** de 2,4 × 2,4 km: estepa con campos (arado, rastrojo, girasol), cinturones forestales, barranco, aldea destruida con casas en ruinas y escombros, bloque de viviendas de 5 plantas derrumbado, elevador de grano, tendido eléctrico caído, trincheras en zigzag con revestimiento de tablones y sacos terreros, dientes de dragón, erizos checos, coches calcinados, restos de blindados y columnas de humo. La zona de combate central (640 × 640 m) tiene terreno de alta resolución que **se deforma con las explosiones** (cráteres).
- **Infantería**: AK-74M con colimador (Ucrania), AK-12 (Rusia) y RPG-7 con PG-7VL. Balística con caída y arrastre, trazadoras 1 de cada 4, retroceso, dispersión desde la cadera o apuntando, cajas de impacto por zona (cabeza ×3,5), rebufo del RPG y chasquido supersónico cuando una bala pasa cerca.
- **Vehículos**, con cámara en 1ª persona (visor del tirador, aumento y **térmico**) o en 3ª persona:
  - Tanque T-64BV / T-72B3 (con jaula anti-dron): física de orugas diferencial, torreta estabilizada con velocidad de giro real, cañón de 125 mm (APFSDS / HE-FRAG) con recarga de 7 s y ametralladora coaxial PKT. Al ser destruido, la torreta sale despedida.
  - Tanqueta MT-LB con KPVT de 14,5 mm.
  - Pick-up con cañón antiaéreo ZU-23-2 (espoleta de proximidad contra drones) y modelo de dirección tipo bicicleta.
  - Suspensión que sigue el terreno, los blindados derriban árboles, se puede atropellar a la infantería, el blindaje se tiene en cuenta en el daño y los vehículos reaparecen en su base a los 90 s.
- **Dron FPV kamikaze**: física de cuadricóptero (empuje/peso 2,6 con carga), modos ACRO y ANGLE, cámara inclinada 24°, vídeo analógico con interferencias que empeoran con la distancia y los obstáculos, OSD tipo Betaflight y batería de unos 5 minutos. Detona al impactar y se le puede derribar. El operador se queda agachado y expuesto.
- **Audio procedural**: el sonido de los disparos llega con retardo según la distancia (343 m/s), hay reverberación, motores, zumbido de drones, combates lejanos y acúfeno tras una explosión cercana.
- **Red**: servidor Node con WebSocket (`servidor/servidor.js`), estado a 15 Hz con interpolación. Cada cliente es la autoridad de sus propios disparos. También se sincronizan el bloqueo de vehículos y los cráteres.
- **IA** en partida local: avanza, detecta con línea de visión, tiene tiempo de reacción y ráfagas cuyo error de puntería disminuye, usa el RPG contra blindados y dispara a los drones.

## Estructura

```
frente_este/
├── index.html            menú, HUD y overlays
├── css/estilo.css        HUD y disposición táctil por modo
├── js/
│   ├── main.js           menú y arranque
│   ├── juego.js          bucle, jugador local, combate, red
│   ├── mundo.js          terreno, vegetación, edificios, colisiones
│   ├── vehiculos.js      tanque, MT-LB, pick-up ZU-23-2
│   ├── dron.js           dron FPV
│   ├── armas.js          vista en 1ª persona, granadas, proyectiles
│   ├── arsenal.js        armas, accesorios, clases y modelos
│   ├── aeronaves.js      Mi-24 y Su-25
│   ├── despliegue.js     pantalla de clases y equipo
│   ├── soldado.js        modelo y animación del soldado
│   ├── bots.js           IA
│   ├── efectos.js        partículas, trazadoras, destellos
│   ├── audio.js          WebAudio procedural
│   ├── postfx.js         cámara corporal / visor / vídeo FPV
│   ├── entrada.js        teclado, ratón, táctil, mando
│   ├── hud.js            brújula, minimapa, OSD
│   ├── modelos.js        armas procedurales
│   ├── texturas.js       texturas procedurales
│   ├── red.js            cliente WebSocket
│   └── util.js           ruido, intersecciones
├── servidor/             servidor de retransmisión (Node + ws)
└── vendor/three/         three.js r160 (MIT)
```

## Próximos pasos sugeridos

Granadas de mano, puesto de tirador en vehículos para un segundo jugador, artillería y drones de reconocimiento (Mavic) para guiarla, guerra electrónica que corte el vídeo de los drones, más armas (PKM, SVD, AT4/NLAW, Javelin), modelos glTF de alta calidad sustituyendo a los procedurales, clima (lluvia, barro, niebla) y ciclo día/noche con visión nocturna/térmica.
