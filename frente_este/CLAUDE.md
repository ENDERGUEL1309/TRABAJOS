# FRENTE ESTE — guía para Claude Code

Shooter táctico en navegador (PC y móvil de gama alta) hecho con **three.js r160**, ambientado en la guerra ruso-ucraniana. Estética de cámara corporal. Beta multijugador de 4 jugadores (2 contra 2) con servidor Node propio, y partida local contra IA.

**Idioma:** todo en español: código (nombres de variables y funciones), comentarios, textos de la interfaz, mensajes de commit y respuestas al usuario. Mantén ese estilo.

## Cómo ejecutar

```bash
cd servidor && node servidor.js 8080 --abrir   # o doble clic en INICIAR-WINDOWS.bat
```

- Sirve el juego en `http://localhost:8080` y el WebSocket en `/ws`. **No hay dependencias npm ni paso de compilación**: los módulos ES se cargan directamente con un `importmap` (en `index.html`) que apunta a `vendor/three/`.
- Tras editar `js/` o `css/` basta con recargar el navegador (Ctrl+F5).
- Para añadir un addon de three.js, cópialo de `three@0.160.0/examples/jsm/...` a `vendor/three/addons/...` con la misma ruta y revisa sus `import` relativos.

## Mapa del código

| Archivo | Responsabilidad |
|---|---|
| `index.html`, `css/estilo.css` | Menú, HUD, overlays (mapa, visor, despliegue) y disposición de los controles táctiles por modo (`#tactil[data-modo=...]`) |
| `js/main.js` | Menú, ajustes en `localStorage`, detección de controles (PC o táctil), creación de `Juego` |
| `js/juego.js` | **Núcleo**: bucle, jugador local (estados `infanteria`, `vehiculo`, `aeronave`, `dron`, `muerto`, `despliegue`), combate (`impactoSegmento`, `alImpactar`, `explosion`, `danoSoldado`, `danoVehiculo`), red y gestión de bots |
| `js/mundo.js` | Motor de mundo parametrizable: terreno de dos rejillas (interior de alta resolución y exterior), cráteres deformables, colisores AABB en hash espacial, `segmento()` (raycast contra terreno, colisores y árboles), hierba, cielo, sombras. Sin mapa explícito construye el **Frente Este** |
| `js/mapas/villa.js` | Mapa **Villa Atómica**, inspirado en Nuketown con nombre y recursos propios. Exporta `{ id, configurar(mundo), construir(mundo) }`. Es la plantilla para mapas nuevos |
| `js/soldado.js` + `js/soldadoModelo.js` | Entidad soldado (estado, animación procedural, 9 cajas de impacto) y su modelo detallado (casco, portaplacas MOLLE, mochila…). Brazos que agarran el arma actual |
| `js/arsenal.js` | Datos: armas, accesorios, clases, `estadisticas()`, `crearModeloArma(id, accesorios)` |
| `js/armasPerfil.js` + `js/perfiles.js` | Armas modeladas desde fotos: contornos por pieza extruidos con bisel. `perfiles.js` se genera con `herramientas/extraer_perfiles.py` (OpenCV) |
| `js/armas.js` | Vista en primera persona (`ArmaLocal`: ranuras, apuntado, retroceso, recarga) y `Proyectiles` (balas, cohetes, obuses, granadas y bombas con balística) |
| `js/vehiculos.js` | Tanque, MT-LB (orugas diferenciales) y camioneta ZU-23-2 (ruedas) |
| `js/aeronaves.js` | Mi-24 (torreta de morro apuntable) y Su-25 (arranque en vuelo) |
| `js/dron.js` | Dron FPV (modos ESTABLE, ANGLE y ACRO) |
| `js/entrada.js` | Teclado, ratón (pointer lock), joysticks y botones táctiles por modo, mando |
| `js/hud.js`, `js/despliegue.js` | HUD, minimapa, mapa completo, OSD del dron y pantalla de clases y equipo |
| `js/postfx.js` | Post-procesado: cámara corporal, visor de vehículo, térmico y vídeo FPV |
| `js/efectos.js`, `js/audio.js` | Partículas instanciadas y luces de destello; audio 100 % procedural con WebAudio |
| `js/texturas.js`, `js/modelos.js` | Texturas procedurales en canvas y modelos procedurales antiguos (RPG-7, brazos de primera persona) |
| `js/bots.js`, `js/red.js` | IA de la partida local y cliente WebSocket |
| `servidor/servidor.js`, `servidor/ws-mini.js` | Servidor HTTP estático y WebSocket propio (RFC 6455) sin dependencias. Hasta 4 jugadores por sala; la sala incluye el mapa |

### Convenciones importantes
- **Ejes:** −Z es «adelante», `yaw` positivo gira a la izquierda y la dirección es `(−sin yaw, 0, −cos yaw)`. Los modelos de armas tienen el origen en el pistolete y el cañón hacia −Z.
- **Red:** cada cliente es autoritativo de sus propios disparos. El impacto sobre un remoto envía `golpe` y el objetivo aplica el daño y anuncia `muerte`. El daño a vehículos va por `vdano` y lo aplican todos. Las explosiones son visuales en los demás clientes (`exp`). El estado se envía a 15 Hz.
- **Rendimiento móvil:** hay mallas fusionadas e instanciadas, un número fijo de luces puntuales (no cambiarlo: provoca recompilar los shaders) y calidades `baja`, `media` y `alta` en `CALIDADES` (`juego.js`).
- **Lienzo:** se dimensiona con `this.tamano()` (getBoundingClientRect), nunca con `innerHeight`. Esto evita el desfase de la mira en iPhone.
- **Recursos:** todo es procedural; no hay imágenes ni modelos externos. No metas en el repositorio imágenes con marca de agua o derechos de terceros.

## Cómo probar

- Prueba manual en el navegador, con la consola abierta (F12) para ver los errores.
- Prueba automatizada sin pantalla (ya se usaba): Playwright con Chromium y `--use-angle=swiftshader`. Para avanzar la simulación rápido sin renderizar: `juego.renderer.setAnimationLoop(null)`, sustituir `juego.postfx.dibujar` por una función vacía, fijar `juego.reloj.getDelta = () => 0.033` y llamar en bucle a `juego.scene.updateMatrixWorld(); juego.bucle();`. `window.juego` está expuesto.
- Para el multijugador, abre dos pestañas en el modo *Multijugador beta* con el mismo mapa.
- Antes de cada commit comprueba como mínimo que cargan los dos mapas, que un disparo daña a un bot y que no hay errores en la consola.

## Estado y pendientes (por prioridad)

1. **Recursos externos (siguiente paso acordado):**
   - Añadir `GLTFLoader` (y `DRACOLoader`/`KTX2Loader` si hace falta) al vendor.
   - Crear la carpeta `recursos/` (`modelos/`, `texturas/`, `sonidos/`, `animaciones/`).
   - Montar un sistema de «recurso con alternativa»: si existe el `.glb`, la textura o el sonido, se usa; si no, el procedural actual.
   - Precarga con barra de progreso.
2. **Personajes:** soldado `.glb` con esqueleto y animaciones (Mixamo) mediante `AnimationMixer`: andar, correr, agacharse, recargar, apuntar y morir, con mezcla según la velocidad. Las cajas de impacto deben seguir los huesos.
3. **Armas:** modelos `.glb` por arma con puntos de anclaje (boca, mira, mano izquierda, riel), animación de recarga y casquillos expulsados. Faltan fotos de perfil de PKM, SVD, T-5000, M82, RPG-7, NLAW, RPK y AKS-74U para el proceso de siluetas.
4. **Texturas PBR reales** (Poly Haven o ambientCG, CC0) para terreno, edificios y equipo, con mapas normal, rugosidad y AO.
5. **Sonido real:** muestras de disparo por arma (cerca, lejos, interior), cola de reverberación según el entorno, pasos por superficie, recargas y ambiente. Mantener el retardo por distancia (343 m/s).
6. **Movimiento:** inclinarse a los lados (Q/E), tumbarse, deslizarse, saltar obstáculos automáticamente, inercia del arma y balanceo de cámara más realista.
7. **Controles de vehículos:** el usuario los encuentra complejos. Propuesta: modo simple opcional en el que un joystick conduzca (adelante/giro) y el sistema reparta la potencia a las orugas; dejar las dos palancas como modo «realista».
8. **Jugabilidad:** modos de juego (dominación por zonas, buscar y destruir), puntuación por partida, sistema de progresión y desbloqueos, mejor IA (coberturas, flanqueo, rutas por puertas y escaleras).
9. **Escenarios:** más mapas usando `js/mapas/villa.js` como plantilla, e interiores destruibles.

## Preferencias del usuario
- Habla español; quiere realismo visual («hiperrealista», estilo cámara corporal) y que funcione bien en móvil de gama alta y en PC.
- Prefiere que se haga el trabajo de principio a fin y luego se le explique qué probar.
- Envía fotos de referencia para modelar; úsalas para formas, proporciones y colores, no pegándolas como textura.
