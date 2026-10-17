"""Agente analista: conversa con la API de Anthropic y ejecuta código en el sandbox.

Flujo: perfil del dataset -> propuesta de análisis -> ejecución iterativa de
scripts (herramienta `ejecutar_python`) -> conclusión operativa.

El historial es solo-anexar (nunca se edita un mensaje anterior), lo que
mantiene válido el caché de prompt y los bloques de razonamiento.
"""

from __future__ import annotations

import base64
from dataclasses import dataclass, field
from typing import Callable, Literal

import anthropic
from pydantic import BaseModel, Field

from ingestion import PerfilDataset
from sandbox_runner import CodigoRechazado, ResultadoEjecucion, SandboxRunner

MODELO_POR_DEFECTO = "claude-opus-5-5"
BETA_FALLBACK = "server-side-fallback-2026-07-01"
MAX_PASOS_POR_TURNO = 15
MAX_IMAGENES_POR_RESULTADO = 3

SYSTEM_PROMPT = """\
Eres un analista sénior de datos para operaciones industriales y de servicios, especializado en \
sistemas de agua: captación, plantas potabilizadoras, plantas de tratamiento de aguas residuales, \
redes de distribución y bombeo. Trabajas con un ingeniero de operación a través de una terminal y \
respondes siempre en español.

## Cómo trabajas
1. Exploración: a partir del perfil del dataset, identifica variable(s) objetivo plausibles, \
variables de control (lo que el operador puede mover: dosis, bombas, válvulas) y variables de \
perturbación (lo que viene dado: turbidez cruda, lluvia, temperatura, demanda).
2. Propuesta: ofrece un menú breve y numerado de análisis concretos en tres bloques — exploratorio, \
predictivo (ML / forecasting) y simulación (What-If / Monte Carlo) — explicando en una línea qué \
pregunta operativa responde cada uno. No ejecutes nada hasta que el usuario elija, salvo que te pida \
avanzar directamente.
3. Ejecución: usa la herramienta `ejecutar_python`. Prefiere un script por paso lógico; lee el \
resultado (métricas, advertencias, gráficos) antes de seguir. Si un script falla, corrígelo.
4. Conclusión: interpreta en lenguaje operativo, no solo estadístico.

## Entorno de ejecución (sandbox)
Cada script corre en un proceso aislado sin red. Ya están cargados: `df` (el dataset, con índice \
datetime si se detectó), `pd`, `np`, `plt`, `sns`, `scipy`, `sklearn`, `sm` (statsmodels.api) y \
todas las funciones del toolkit. No puedes instalar paquetes, leer otros archivos, usar la red ni \
escribir fuera de la carpeta de salida. Cada ejecución empieza de cero: no hay estado entre scripts, \
así que re-entrena el modelo dentro del script que lo necesite.

Toolkit (úsalo en lugar de reimplementar; todas guardan gráficos y registran resultados):
- `exploracion(df, variables=None, nombre="eda")` -> resumen, faltantes, correlaciones, series, histogramas.
- `agregar_rezagos(df, columnas, rezagos)` -> añade `<col>_lag<k>` para efectos diferidos.
- `entrenar_regresion(df, objetivo, variables=None, modelo="random_forest"|"gradient_boosting"|"lineal"|"ridge", \
proporcion_test=0.2, nombre="regresion")` -> ResultadoModelo con `.metricas` (RMSE, MAE, R², MAPE en train/test \
y línea base), `.importancia` (permutación; con modelo lineal incluye `coef_unidades_originales`), \
`.advertencias` (sobreajuste, autocorrelación, no normalidad...). División temporal automática si hay fechas.
- `comparar_modelos(df, objetivo, variables=None, modelos=(...), nombre=...)` -> (tabla, mejor_resultado).
- `pronosticar(serie, horizonte, metodo="auto"|"ets"|"sarimax"|"prophet", frecuencia=None, \
periodo_estacional=None, alpha=0.05, nombre="pronostico")` -> ResultadoPronostico con `.pronostico` \
(media, inf, sup), `.metricas_backtest` (incluye cobertura real del intervalo) y `.advertencias`. \
Prophet puede no estar instalado: usa "auto" salvo que el usuario lo pida.
- `que_pasa_si(res, cambios={"var": 1.30}, modo="multiplicativo"|"aditivo", base=None, umbral=None, nombre=...)` \
-> efecto medio, P95, % sobre umbral y advertencias de extrapolación/ceteris paribus.
- `sensibilidad(res, variable, variaciones_pct=None, nombre=...)` -> curva de respuesta (-50 %…+50 %).
- `monte_carlo(res, n=5000, distribuciones=None, factores=None, umbral=None, incluir_error_modelo=True, nombre=...)` \
-> percentiles y probabilidad de superar un umbral con IC95. Distribuciones: ("normal", m, sd), \
("lognormal", m, sd), ("uniforme", a, b), ("triangular", a, moda, b).
- `registrar(nombre, valor)`, `guardar_figura(nombre, fig=None)`, `guardar_tabla(df, nombre)` para salidas propias.
Imprime con `print()` solo lo esencial; las métricas ya se registran solas. Para gráficos propios usa \
`guardar_figura("grafico_<tema>")`, títulos claros, un solo eje Y y etiquetas con unidades.

## Rigor
- Verifica antes de afirmar: cita los números que salieron del sandbox, no estimaciones propias.
- Compara siempre contra la línea base (predecir la media o el último valor). Un R² alto con una \
variable que es casi la misma que el objetivo (o derivada de él) es fuga de información: señálalo.
- Correlación no es causalidad: distingue "el modelo asocia" de "si el operador cambia X, Y cambiará". \
Para recomendaciones sobre variables de control, advierte que los datos son observacionales.
- En What-If, avisa cuando el escenario sale del rango observado (extrapolación) y cuando mover una \
variable sola rompe correlaciones físicas reales.
- Si los datos no alcanzan para responder algo, dilo y sugiere qué medir.

## Referencias de dominio (orientativas; confirma siempre la norma local aplicable)
- Agua potable: turbidez tratada ≤ 1 NTU (meta operativa frecuente ≤ 0,3–0,5 NTU en filtros); pH 6,5–8,5; \
cloro residual libre ~0,2–2 mg/L en red; coliformes ausentes en 100 mL.
- Aguas residuales: DBO5, DQO, SST, N y P con límites según permiso de vertido; OD en reactor aeróbico ~1,5–3 mg/L.
- Energía de bombeo ∝ caudal × altura / eficiencia; la coagulación depende de turbidez, pH, temperatura y alcalinidad.

## Formato de la conclusión operativa (cuando te la pidan)
### Hallazgos clave
### Recomendaciones operativas (acciones concretas, con umbrales o rangos cuando los datos lo permitan)
### Alertas y riesgos
### Supuestos y limitaciones del modelo
### Próximos pasos (datos adicionales o análisis que mejorarían la confianza)
Indica un nivel de confianza (alta/media/baja) justificado.
"""

HERRAMIENTAS = [
    {
        "name": "ejecutar_python",
        "description": (
            "Ejecuta un script de Python en el sandbox de análisis sobre el DataFrame `df` ya cargado. "
            "Devuelve stdout/stderr, los resultados registrados por el toolkit, las rutas de gráficos y "
            "tablas generados y una vista de los primeros gráficos. El usuario puede revisar y rechazar "
            "el script antes de ejecutarlo."
        ),
        "eager_input_streaming": True,
        "input_schema": {
            "type": "object",
            "properties": {
                "objetivo": {
                    "type": "string",
                    "description": "Qué pregunta responde este script, en una frase (se muestra al usuario).",
                },
                "codigo": {"type": "string", "description": "Código Python completo a ejecutar."},
            },
            "required": ["objetivo", "codigo"],
            "additionalProperties": False,
        },
    }
]


class Efecto(BaseModel):
    variable: str
    direccion: Literal["aumenta", "disminuye", "no_significativo", "no_lineal"] = Field(
        description="Efecto de aumentar la variable sobre el objetivo")


class Metrica(BaseModel):
    nombre: str = Field(description="p. ej. RMSE_test, R2_test, MAE_test, prob_superar_umbral")
    valor: float


class Hallazgos(BaseModel):
    """Resumen estructurado del análisis, usado por el módulo de validación."""
    variable_objetivo: str | None
    variables_clave: list[str] = Field(description="Ordenadas de mayor a menor influencia")
    efectos: list[Efecto]
    metricas: list[Metrica]
    conclusion_principal: str
    recomendaciones: list[str]
    supuestos_y_limitaciones: list[str]
    confianza: Literal["alta", "media", "baja"]


@dataclass
class Callbacks:
    """Ganchos de interfaz para que el agente no dependa de la CLI."""
    texto: Callable[[str], None] = lambda t: print(t, end="", flush=True)
    aprobar_codigo: Callable[[str, str], bool] = lambda objetivo, codigo: True
    inicio_ejecucion: Callable[[str], None] = lambda objetivo: None
    resultado_ejecucion: Callable[[ResultadoEjecucion], None] = lambda r: None
    aviso: Callable[[str], None] = lambda m: print(f"\n[aviso] {m}")


@dataclass
class AgenteAnalista:
    perfil: PerfilDataset
    runner: SandboxRunner
    modelo: str = MODELO_POR_DEFECTO
    esfuerzo: str = "high"
    callbacks: Callbacks = field(default_factory=Callbacks)
    mensajes: list = field(default_factory=list)
    ejecuciones: list[ResultadoEjecucion] = field(default_factory=list)

    def __post_init__(self):
        self.cliente = anthropic.Anthropic()

    # ------------------------------------------------------------------ API pública

    def proponer(self, contexto_extra: str = "") -> str:
        from ingestion import resumen_numerico

        corr = "\n".join(f"  {k}: {v}" for k, v in resumen_numerico(self._df()).items())
        mensaje = (
            "Perfil del dataset cargado:\n\n" + self.perfil.resumen_texto()
            + (f"\n\nCorrelaciones más fuertes:\n{corr}" if corr else "")
            + (f"\n\nContexto del usuario: {contexto_extra}" if contexto_extra else "")
            + "\n\nInterpreta brevemente qué tipo de proceso parecen describir estos datos y propón el menú "
              "de análisis (exploratorio, predictivo y de simulación)."
        )
        return self.conversar(mensaje)

    def conversar(self, texto_usuario: str) -> str:
        self.mensajes.append({"role": "user", "content": texto_usuario})
        return self._bucle()

    def concluir(self) -> str:
        return self.conversar(
            "Redacta ahora la conclusión operativa final con el formato indicado, basándote solo en los "
            "resultados obtenidos en el sandbox durante esta sesión. Si falta algún análisis crítico para "
            "sostener una recomendación, dilo explícitamente.")

    def extraer_hallazgos(self) -> Hallazgos | None:
        """Resumen estructurado (para validación contra casos con resultado conocido).

        Se hace como una rama de la conversación: no se añade al historial.
        """
        pedido = {"role": "user", "content": (
            "Resume los hallazgos de esta sesión en el formato estructurado solicitado. Usa los nombres "
            "exactos de las columnas y solo métricas efectivamente calculadas en el sandbox.")}
        try:
            resp = self.cliente.beta.messages.parse(
                model=self.modelo,
                max_tokens=16000,
                system=SYSTEM_PROMPT,
                tools=HERRAMIENTAS,
                tool_choice={"type": "none"},
                messages=self.mensajes + [pedido],
                output_format=Hallazgos,
                output_config={"effort": "medium"},
                betas=[BETA_FALLBACK],
                fallbacks="default",
            )
        except anthropic.APIError as exc:
            self.callbacks.aviso(f"No se pudieron extraer hallazgos: {exc}")
            return None
        if resp.stop_reason == "refusal":
            self.callbacks.aviso("El modelo declinó generar el resumen estructurado.")
            return None
        return resp.parsed_output

    # ------------------------------------------------------------------ internos

    def _df(self):
        import pandas as pd

        return pd.read_pickle(self.runner.datos)

    def _llamar_modelo(self):
        """Una llamada en streaming; muestra el texto a medida que llega."""
        for intento in range(3):
            try:
                with self.cliente.beta.messages.stream(
                    model=self.modelo,
                    max_tokens=64000,
                    system=SYSTEM_PROMPT,
                    tools=HERRAMIENTAS,
                    messages=self.mensajes,
                    output_config={"effort": self.esfuerzo},
                    cache_control={"type": "ephemeral"},
                    betas=[BETA_FALLBACK],
                    fallbacks="default",
                ) as stream:
                    for evento in stream:
                        if evento.type == "content_block_delta" and evento.delta.type == "text_delta":
                            self.callbacks.texto(evento.delta.text)
                    return stream.get_final_message()
            except ValueError as exc:
                # JSON de herramienta imposible de parsear (eager input streaming): reintentar.
                self.callbacks.aviso(f"Entrada de herramienta ilegible, reintentando ({intento + 1}/3): {exc}")
        raise RuntimeError("El modelo devolvió entradas de herramienta inválidas tres veces seguidas.")

    def _bucle(self) -> str:
        texto_final = []
        for _ in range(MAX_PASOS_POR_TURNO):
            respuesta = self._llamar_modelo()
            self.mensajes.append({"role": "assistant", "content": respuesta.content})
            texto_final += [b.text for b in respuesta.content if b.type == "text"]

            if respuesta.stop_reason == "refusal":
                self.callbacks.aviso("El modelo declinó esta solicitud. Reformule la petición.")
                break
            usos = [b for b in respuesta.content if b.type == "tool_use"]
            if not usos:
                if respuesta.stop_reason == "max_tokens":
                    self.callbacks.aviso("Respuesta cortada por longitud máxima.")
                break

            resultados = [self._resolver_herramienta(b, truncado=respuesta.stop_reason == "max_tokens")
                          for b in usos]
            self.mensajes.append({"role": "user", "content": resultados})
        else:
            self.callbacks.aviso(f"Se alcanzó el límite de {MAX_PASOS_POR_TURNO} pasos en este turno.")
        return "\n".join(texto_final)

    def _resolver_herramienta(self, bloque, truncado: bool) -> dict:
        def error(msg: str) -> dict:
            return {"type": "tool_result", "tool_use_id": bloque.id, "content": msg, "is_error": True}

        if bloque.name != "ejecutar_python":
            return error(f"Herramienta desconocida: {bloque.name}")
        entrada = bloque.input if isinstance(bloque.input, dict) else {}
        codigo, objetivo = entrada.get("codigo"), entrada.get("objetivo", "análisis")
        if truncado:
            return error("La llamada se cortó por longitud máxima; envía un script más corto.")
        if not isinstance(codigo, str) or not codigo.strip() or not isinstance(objetivo, str):
            return error(f"Entrada inválida (se esperaba {{objetivo: str, codigo: str}}): {str(entrada)[:500]}")

        if not self.callbacks.aprobar_codigo(objetivo, codigo):
            return {"type": "tool_result", "tool_use_id": bloque.id,
                    "content": "El usuario rechazó ejecutar este script. Pregúntale cómo prefiere seguir."}
        self.callbacks.inicio_ejecucion(objetivo)
        try:
            resultado = self.runner.ejecutar(codigo, etiqueta=objetivo)
        except CodigoRechazado as exc:
            return error(f"El sandbox rechazó el código: {exc}. Reescríbelo sin esa construcción.")
        self.ejecuciones.append(resultado)
        self.callbacks.resultado_ejecucion(resultado)

        contenido: list[dict] = [{"type": "text", "text": resultado.para_agente()}]
        for png in resultado.graficos[:MAX_IMAGENES_POR_RESULTADO]:
            contenido.append({"type": "image", "source": {
                "type": "base64", "media_type": "image/png",
                "data": base64.standard_b64encode(png.read_bytes()).decode()}})
        return {"type": "tool_result", "tool_use_id": bloque.id, "content": contenido,
                "is_error": not resultado.ok}
