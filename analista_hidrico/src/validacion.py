"""Validación del agente contra casos con resultado conocido (tesis, artículos, informes).

Cada caso es un JSON en casos_validacion/ con los datos crudos del documento,
la pregunta que el documento responde y lo que concluyó. El agente analiza
los datos de forma autónoma, se extraen sus hallazgos estructurados y se
comparan con lo esperado:

  - variable objetivo identificada (sí/no)
  - variables clave: cuántas de las esperadas aparecen en el top-k del agente
  - dirección de los efectos (aumenta / disminuye)
  - métricas numéricas dentro de tolerancia
  - concordancia de la conclusión textual (juez LLM con rúbrica, 0–1)

Uso:
    python src/validacion.py casos_validacion/caso_00_planta_sintetica.json
    python src/validacion.py casos_validacion/*.json --repeticiones 3
"""

from __future__ import annotations

import argparse
import json
import statistics
import sys
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import anthropic  # noqa: E402
from pydantic import BaseModel, Field  # noqa: E402
from rich.console import Console  # noqa: E402
from rich.table import Table  # noqa: E402

from agent import BETA_FALLBACK, MODELO_POR_DEFECTO, AgenteAnalista, Callbacks, Hallazgos  # noqa: E402
from ingestion import cargar  # noqa: E402
from sandbox_runner import SandboxRunner  # noqa: E402

RAIZ = Path(__file__).resolve().parent.parent
console = Console()

PESOS = {"objetivo": 0.10, "variables_clave": 0.25, "efectos": 0.25, "metricas": 0.15, "conclusion": 0.25}


class Juicio(BaseModel):
    puntaje: float = Field(ge=0, le=1, description="0 = contradice, 0.5 = parcialmente, 1 = equivalente")
    coincidencias: list[str]
    discrepancias: list[str]
    justificacion: str


def _norm(nombre: str) -> str:
    return nombre.strip().lower()


def comparar(esperado: dict, h: Hallazgos) -> dict:
    """Puntajes parciales en [0, 1] (None si el caso no define ese criterio)."""
    puntajes: dict[str, float | None] = dict.fromkeys(PESOS)
    detalle: dict = {}

    if esperado.get("variable_objetivo"):
        puntajes["objetivo"] = float(_norm(esperado["variable_objetivo"]) == _norm(h.variable_objetivo or ""))

    if esperado.get("variables_clave"):
        esp = [_norm(v) for v in esperado["variables_clave"]]
        k = esperado.get("top_k", len(esp) + 1)
        top = [_norm(v) for v in h.variables_clave[:k]]
        encontradas = [v for v in esp if v in top]
        puntajes["variables_clave"] = len(encontradas) / len(esp)
        detalle["variables_clave"] = {"esperadas": esp, f"top_{k}_agente": top, "encontradas": encontradas}

    if esperado.get("efectos"):
        efectos_agente = {_norm(e.variable): e.direccion for e in h.efectos}
        filas = []
        for var, dir_esp in esperado["efectos"].items():
            dir_ag = efectos_agente.get(_norm(var))
            filas.append({"variable": var, "esperado": dir_esp, "agente": dir_ag, "ok": dir_ag == dir_esp})
        puntajes["efectos"] = sum(f["ok"] for f in filas) / len(filas)
        detalle["efectos"] = filas

    if esperado.get("metricas"):
        met_agente = {_norm(m.nombre): m.valor for m in h.metricas}
        filas = []
        for nombre, spec in esperado["metricas"].items():
            valor = met_agente.get(_norm(nombre))
            ok = valor is not None and abs(valor - spec["valor"]) <= spec["tolerancia"]
            filas.append({"metrica": nombre, "esperado": spec["valor"], "tolerancia": spec["tolerancia"],
                          "agente": valor, "ok": ok})
        puntajes["metricas"] = sum(f["ok"] for f in filas) / len(filas)
        detalle["metricas"] = filas

    return {"puntajes": puntajes, "detalle": detalle}


def juzgar_conclusion(cliente: anthropic.Anthropic, modelo: str, referencia: str, conclusion: str) -> Juicio | None:
    resp = cliente.beta.messages.parse(
        model=modelo,
        max_tokens=8000,
        system=("Eres un revisor técnico de ingeniería sanitaria e hidráulica. Comparas la conclusión de un "
                "análisis automático con la conclusión publicada de un estudio sobre los mismos datos. Evalúa "
                "concordancia de fondo (qué variables importan, sentido de los efectos, magnitudes, "
                "recomendaciones), no el estilo. Un análisis que añade advertencias razonables no se penaliza; "
                "uno que contradice el estudio o omite su hallazgo central sí."),
        messages=[{"role": "user", "content":
                   f"<conclusion_publicada>\n{referencia}\n</conclusion_publicada>\n\n"
                   f"<conclusion_agente>\n{conclusion}\n</conclusion_agente>"}],
        output_format=Juicio,
        output_config={"effort": "medium"},
        betas=[BETA_FALLBACK],
        fallbacks="default",
    )
    return None if resp.stop_reason == "refusal" else resp.parsed_output


def ejecutar_caso(ruta_caso: Path, modelo: str, esfuerzo: str, carpeta: Path) -> dict:
    caso = json.loads(ruta_caso.read_text(encoding="utf-8"))
    ruta_datos = caso["datos"]
    if not ruta_datos.startswith(("http://", "https://")) and not Path(ruta_datos).is_absolute():
        ruta_datos = str((ruta_caso.parent / ruta_datos).resolve())
    df, perfil = cargar(ruta_datos, caso.get("hoja", 0))

    salida = carpeta / ruta_caso.stem
    runner = SandboxRunner(df, salida)
    registro = []
    callbacks = Callbacks(
        texto=lambda t: None,
        aprobar_codigo=lambda objetivo, codigo: registro.append(objetivo) or True,
        aviso=lambda m: console.print(f"  [yellow]⚠ {m}[/yellow]"),
    )
    agente = AgenteAnalista(perfil, runner, modelo=modelo, esfuerzo=esfuerzo, callbacks=callbacks)

    console.print(f"[bold]{caso['nombre']}[/bold]: analizando…")
    agente.proponer(caso.get("contexto", ""))
    agente.conversar(
        f"{caso['pregunta']}\n\nRealiza de forma autónoma todos los análisis necesarios (no esperes mi "
        "confirmación entre pasos) y termina cuando tengas evidencia suficiente para responder.")
    conclusion = agente.concluir()
    hallazgos = agente.extraer_hallazgos()
    if hallazgos is None:
        return {"caso": caso["nombre"], "error": "sin hallazgos estructurados"}

    resultado = comparar(caso["esperado"], hallazgos)
    referencia = caso["esperado"].get("conclusion_referencia")
    if referencia:
        juicio = juzgar_conclusion(agente.cliente, modelo, referencia, conclusion)
        if juicio:
            resultado["puntajes"]["conclusion"] = juicio.puntaje
            resultado["detalle"]["conclusion"] = juicio.model_dump()

    validos = {k: v for k, v in resultado["puntajes"].items() if v is not None}
    peso_total = sum(PESOS[k] for k in validos)
    resultado["puntaje_global"] = (sum(PESOS[k] * v for k, v in validos.items()) / peso_total
                                   if peso_total else None)
    resultado.update({"caso": caso["nombre"], "scripts_ejecutados": registro,
                      "hallazgos": hallazgos.model_dump(), "conclusion_agente": conclusion})
    (salida / "validacion.json").write_text(json.dumps(resultado, ensure_ascii=False, indent=2), encoding="utf-8")
    return resultado


def main() -> None:
    ap = argparse.ArgumentParser(description="Valida el agente contra casos con resultado conocido")
    ap.add_argument("casos", nargs="+", type=Path)
    ap.add_argument("--modelo", default=MODELO_POR_DEFECTO)
    ap.add_argument("--esfuerzo", default="high")
    ap.add_argument("--repeticiones", type=int, default=1,
                    help="Ejecuciones por caso (el agente no es determinista; >1 mide estabilidad)")
    args = ap.parse_args()

    carpeta = RAIZ / "output" / f"validacion_{datetime.now():%Y%m%d_%H%M%S}"
    carpeta.mkdir(parents=True, exist_ok=True)
    resumen = []
    for ruta in args.casos:
        puntajes = []
        for rep in range(args.repeticiones):
            r = ejecutar_caso(ruta, args.modelo, args.esfuerzo, carpeta / f"rep{rep + 1}")
            puntajes.append(r)
        globales = [r["puntaje_global"] for r in puntajes if r.get("puntaje_global") is not None]
        resumen.append({
            "caso": puntajes[0].get("caso", ruta.stem),
            "media": statistics.mean(globales) if globales else None,
            "desv": statistics.stdev(globales) if len(globales) > 1 else 0.0,
            "parciales": [r.get("puntajes") for r in puntajes],
        })

    tabla = Table("Caso", "Global", "±", "Objetivo", "Var. clave", "Efectos", "Métricas", "Conclusión",
                  title="Fiabilidad del agente", header_style="bold")
    fmt = (lambda x: "—" if x is None else f"{x:.2f}")
    for r in resumen:
        prom = {k: (statistics.mean([q[k] for q in r["parciales"] if q and q.get(k) is not None])
                    if any(q and q.get(k) is not None for q in r["parciales"]) else None) for k in PESOS}
        tabla.add_row(r["caso"], fmt(r["media"]), fmt(r["desv"]), *(fmt(prom[k]) for k in PESOS))
    console.print(tabla)
    (carpeta / "resumen.json").write_text(json.dumps(resumen, ensure_ascii=False, indent=2), encoding="utf-8")
    console.print(f"[dim]Detalle en {carpeta}[/dim]")


if __name__ == "__main__":
    main()
