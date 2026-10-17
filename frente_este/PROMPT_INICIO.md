# Prompt para continuar el desarrollo en Claude Code (local)

Abre Claude Code en la carpeta `trabajos/frente_este` y pega lo siguiente:

---

Hola. Continúo en mi PC el desarrollo de FRENTE ESTE, un shooter táctico en three.js que empezamos en la nube. Lee primero `CLAUDE.md` (arquitectura, convenciones, cómo probar y la lista de pendientes) y `README.md`.

Objetivo de esta etapa: subir la calidad de texturas, movilidad, interacción, modelos, escenarios, sonidos y jugabilidad.

Empieza por el pendiente nº 1 de `CLAUDE.md`, preparar el proyecto para recursos externos:
1. Añade `GLTFLoader` al vendor de three.js r160 (respetando el `importmap`, sin introducir un paso de compilación).
2. Crea `recursos/` con las subcarpetas `modelos/`, `texturas/`, `sonidos/` y `animaciones/`, con un `LEEME.md` que explique qué nombre y formato espera el juego para cada archivo (por ejemplo `modelos/soldado_ua.glb`, `modelos/armas/ak74.glb`, `sonidos/ak74_disparo.ogg`).
3. Implementa un gestor de recursos con alternativa: si el archivo existe se usa, y si no, el modelo, textura o sonido procedural actual. Precarga con progreso en la pantalla de carga.
4. Deja preparado el soldado para usar un `.glb` con esqueleto y animaciones (`AnimationMixer`): andar, correr, agacharse, apuntar, recargar y morir. Las cajas de impacto deben seguir los huesos.

Cuando termines:
- Arranca el servidor (`servidor/servidor.js`) y comprueba en el navegador que los dos mapas cargan, que el combate funciona y que no hay errores en la consola.
- Dime qué recursos concretos debo conseguir (y en qué webs con licencia libre) para el siguiente paso.

Trabaja en español: código, comentarios, interfaz y commits.

---

## Siguientes prompts sugeridos (uno por sesión)

- «Integra estos modelos .glb que he puesto en `recursos/modelos/` y ajusta los puntos de anclaje de cada arma.»
- «Sustituye el sonido procedural de los disparos por las muestras de `recursos/sonidos/`, con versión cercana y lejana y reverberación según interior o exterior.»
- «Añade inclinarse (Q/E), tumbarse y saltar obstáculos automáticamente, con sus botones táctiles.»
- «Haz un modo de conducción simple para los vehículos de orugas: un joystick para avanzar y girar, y deja las dos palancas como modo realista.»
- «Crea un modo de juego de dominación con tres zonas en Villa Atómica.»
- «Aplica texturas PBR de `recursos/texturas/` al terreno, las casas y el equipo del soldado.»
