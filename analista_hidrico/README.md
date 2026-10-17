# Analista Hídrico — agente CLI de análisis, pronóstico y simulación

Agente interactivo de terminal para datos industriales y de servicios de agua (caudales, calidad
físico-química, plantas de tratamiento, bombeo). Carga un CSV, un Excel o una URL; perfila los datos;
propone análisis; escribe y ejecuta scripts de Python en un sandbox; y cierra con una conclusión
operativa que incluye recomendaciones, alertas y los supuestos del modelo.

```
analista_hidrico/
├── requirements.txt
├── data/
│   ├── sample_water_flow.csv      # 90 días horarios de una potabilizadora (simulados)
│   └── generar_datos.py           # generador reproducible, con las relaciones "verdaderas"
├── src/
│   ├── main.py                    # CLI interactiva (rich)
│   ├── app_web.py                 # interfaz web (Streamlit)
│   ├── agent.py                   # diálogo con la API de Anthropic y bucle de herramientas
│   ├── ingestion.py               # lectura CSV/Excel/URL, detección de fechas y de tipos de variable
│   ├── sandbox_runner.py          # ejecución controlada; recoge gráficos, tablas y resultados
│   ├── toolkit.py                 # regresión/ML, forecasting, What-If, sensibilidad, Monte Carlo
│   └── validacion.py              # mide la fiabilidad contra casos con resultado conocido
├── casos_validacion/
│   ├── caso_00_planta_sintetica.json
│   └── plantilla_caso.json
├── Dockerfile, railway.json       # despliegue en Railway
└── output/                        # gráficos (.png), tablas (.csv), conclusiones (.md)
```

## Instalación

```bash
cd analista_hidrico
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
export ANTHROPIC_API_KEY=sk-ant-...      # o `ant auth login`
```

## Uso

```bash
# Probar la instalación sin consumir API (EDA + modelos + What-If + Monte Carlo + pronóstico)
python src/main.py data/sample_water_flow.csv --demo

# Sesión con el agente
python src/main.py data/sample_water_flow.csv --contexto "PTAP convencional, datos SCADA horarios"

# Excel o URL
python src/main.py datos_planta.xlsx --hoja Operacion
python src/main.py https://servidor.org/calidad_rio.csv
```

Opciones: `--modelo` (por defecto `claude-opus-5-5`), `--esfuerzo low|medium|high|xhigh|max`,
`--auto` (ejecuta scripts sin confirmar), `--timeout` (segundos por script), `--salida`.

Dentro de la sesión: escriba en lenguaje natural (*"haz 1 y 4"*, *"¿qué pasa si la turbidez sube
30 %?"*, *"pronostica el caudal 3 días"*) o use `/conclusion`, `/hallazgos`, `/salidas`, `/perfil`,
`/auto`, `/ayuda`, `/salir`. Antes de cada ejecución se muestra el script y se pide confirmación.

## Cómo funciona

1. **Ingesta** (`ingestion.py`): detecta separador y coma decimal, convierte textos como `"<0,1"` a
   número, encuentra la columna de fecha, ordena, infiere frecuencia, cuenta huecos y duplicados y
   clasifica cada variable como hidráulica, físico-química u operativa por nombre y unidad.
2. **Diálogo** (`agent.py`): el agente recibe el perfil y propone un menú en tres bloques
   (exploratorio, predictivo, simulación). Cada análisis es una llamada a la herramienta
   `ejecutar_python`; el resultado vuelve al modelo como texto (métricas, advertencias) más los
   primeros gráficos como imagen, para que los interprete.
3. **Motor** (`toolkit.py`, importado en el sandbox):
   - `entrenar_regresion` / `comparar_modelos`: lineal, ridge, random forest, gradient boosting;
     RMSE, MAE, R², MAPE en train/test y contra la línea base; importancia por permutación;
     división cronológica si hay fechas; diagnóstico de residuos (Durbin-Watson, normalidad,
     cambio de varianza).
   - `pronosticar`: ETS y SARIMAX (Prophet opcional) con backtest, selección automática, bandas
     de confianza y cobertura real del intervalo.
   - `que_pasa_si`, `sensibilidad`, `monte_carlo`: escenarios paramétricos, barridos y simulación
     estocástica con probabilidad de superar umbrales; avisan de extrapolación y del supuesto
     *ceteris paribus*.
   - Todos guardan gráficos en `output/NN_<análisis>/` y registran resultados en `_resultados.json`.
4. **Conclusión operativa**: hallazgos, recomendaciones con umbrales, alertas, supuestos y
   limitaciones, próximos pasos y nivel de confianza; se guarda como Markdown.

### Sobre el sandbox

`sandbox_runner.py` aplica varias capas: análisis estático del código (bloquea imports de red,
procesos y sistema y builtins como `eval`/`exec`), subproceso `python -I` con un entorno mínimo **sin la
API key**, límites de CPU, memoria y tamaño de archivo, timeout, y un *audit hook* que bloquea sockets,
subprocesos y escrituras fuera de la carpeta de la ejecución. Es una protección razonable para código
generado por el modelo sobre datos propios, **no** un aislamiento a prueba de atacantes: para
datos o entornos no confiables, ejecute la herramienta dentro de un contenedor o una VM.

### API de Anthropic

Las llamadas usan streaming, razonamiento adaptativo (por defecto en este modelo), esfuerzo
configurable, caché de prompt automático y `fallbacks: "default"` (beta
`server-side-fallback-2026-07-01`): si el modelo declina una petición, la API la reintenta en un
modelo de respaldo dentro de la misma llamada. Si prefiere no usarlo, quite `betas` y `fallbacks`
en `agent.py`.

## Validación de fiabilidad con estudios de caso

El plan: tomar tesis, artículos o informes técnicos que publiquen **los datos crudos y la
conclusión**, dejar que el agente analice los datos sin ver la conclusión y medir cuánto se acerca.

1. Copie `casos_validacion/plantilla_caso.json`, ponga los datos del documento en un CSV/Excel y
   rellene `contexto`, `pregunta` y `esperado` (variable objetivo, variables clave, sentido de los
   efectos, métricas con tolerancia y la conclusión de referencia).
2. Ejecute:
   ```bash
   python src/validacion.py casos_validacion/caso_00_planta_sintetica.json   # control positivo
   python src/validacion.py casos_validacion/*.json --repeticiones 3
   ```
3. Cada caso recibe puntajes de 0 a 1 por criterio (objetivo 10 %, variables clave 25 %, efectos 25 %,
   métricas 15 %, conclusión 25 %, juzgada por un LLM con rúbrica) y un puntaje global. Con
   `--repeticiones` se mide también la estabilidad (desviación entre corridas), porque el agente no
   es determinista.

Recomendaciones para que la medición sea justa:
- Empiece por `caso_00` (datos sintéticos con verdad conocida): si falla ahí, el problema es del
  agente, no del caso.
- Prefiera documentos cuyas conclusiones se sostengan en los datos publicados; si el autor usó
  información que no está en la tabla (visitas de campo, ensayos de jarras), añádala en `contexto`
  o espere puntajes más bajos.
- Las métricas (R², RMSE) solo son comparables si el esquema de validación es parecido; si el
  documento usó, p. ej., validación cruzada aleatoria, pídalo en la `pregunta`.
- Guarde los resultados de cada versión del agente para comparar mejoras en el tiempo.

## Versión web (Streamlit)

```bash
pip install -r requirements.txt
export ANTHROPIC_API_KEY=sk-ant-...
export APP_PASSWORD=una-clave-larga      # o PERMITIR_SIN_CLAVE=1 solo en su PC
streamlit run src/app_web.py             # abre http://localhost:8501
```

La web tiene tres pestañas: **Análisis** (chat con el agente; cada script y sus gráficos aparecen en
la conversación), **Datos** (perfil del dataset) y **Resultados** (conclusión, galería de gráficos,
tablas y un ZIP con todo). A diferencia de la CLI, los scripts se ejecutan sin pedir confirmación; el
código de cada uno queda visible en un desplegable.

Cada pestaña del navegador es una sesión independiente con su carpeta en `output/sesiones/`, que se
borra pasadas 24 h.

## Desplegar en Railway

El proyecto incluye `Dockerfile`, `railway.json` y `.streamlit/config.toml`.

1. Suba el repositorio a GitHub (ya está en `enderguel1309/trabajos`).
2. En [railway.com](https://railway.com): **New Project → Deploy from GitHub repo** → elija el
   repositorio y la rama.
3. En el servicio, **Settings**:
   - **Source → Root Directory**: `/analista_hidrico`
   - **Config-as-code → Railway Config File**: `/analista_hidrico/railway.json`
     (Railway no busca este archivo dentro del Root Directory: hay que dar la ruta completa).
4. En **Variables** agregue:

   | Variable | Valor | Obligatoria |
   |---|---|---|
   | `ANTHROPIC_API_KEY` | su clave `sk-ant-...` | sí |
   | `APP_PASSWORD` | contraseña larga para entrar a la web | sí |
   | `MAX_MENSAJES_POR_SESION` | p. ej. `40` (limita el gasto por sesión) | no |
   | `AGENTE_ESFUERZO` | `medium` para abaratar, `high` por defecto | no |
   | `SANDBOX_MEMORIA_MB` | `3072` por defecto; súbalo si el plan tiene más RAM | no |

5. **Settings → Networking → Generate Domain** para obtener la URL pública
   (`https://<nombre>.up.railway.app`).
6. Cada `git push` a esa rama vuelve a desplegar.

Recomendaciones:
- Plan con al menos 2 GB de RAM: SARIMAX y random forest consumen memoria.
- Sin volumen, las sesiones se pierden al redeplegar: el usuario debe descargar el ZIP. Para
  conservarlas, añada un **Volume** montado en `/app/output`.
- En **Usage** de Railway y en la consola de Anthropic configure límites de gasto.
- Todos los usuarios comparten una contraseña y, en el servidor, un mismo contenedor. El sandbox
  impide que los scripts lean la clave de API, usen la red o escriban fuera de su carpeta, pero no
  impide que lean archivos subidos en otras sesiones. Comparta la contraseña solo con personas de
  confianza; para usuarios externos se necesitaría login individual y ejecución en contenedores separados.

## Regenerar los datos de ejemplo

```bash
python data/generar_datos.py
```
