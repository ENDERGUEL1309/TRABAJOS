"""CLI interactiva del agente analista de datos hídricos.

Uso:
    python src/main.py data/sample_water_flow.csv
    python src/main.py https://ejemplo.org/datos.xlsx --hoja Datos
    python src/main.py data/sample_water_flow.csv --demo     # sin API: recorrido del toolkit
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import anthropic  # noqa: E402
from rich.console import Console  # noqa: E402
from rich.markdown import Markdown  # noqa: E402
from rich.panel import Panel  # noqa: E402
from rich.prompt import Prompt  # noqa: E402
from rich.syntax import Syntax  # noqa: E402
from rich.table import Table  # noqa: E402

from agent import MODELO_POR_DEFECTO, AgenteAnalista, Callbacks  # noqa: E402
from ingestion import PerfilDataset, cargar  # noqa: E402
from sandbox_runner import CodigoRechazado, ResultadoEjecucion, SandboxRunner  # noqa: E402

RAIZ = Path(__file__).resolve().parent.parent
console = Console()

COLORES_CATEGORIA = {"hidraulica": "blue", "fisicoquimica": "green", "operativa": "yellow", "otra": "white"}

AYUDA = """\
[bold]Comandos[/bold]
  [cyan]/proponer[/cyan]     pedir de nuevo el menú de análisis
  [cyan]/perfil[/cyan]       ver el perfil del dataset
  [cyan]/conclusion[/cyan]   conclusión operativa final (se guarda en output/)
  [cyan]/hallazgos[/cyan]    resumen estructurado JSON (para validación)
  [cyan]/salidas[/cyan]      listar gráficos y tablas generados
  [cyan]/auto[/cyan]         alternar aprobación automática de scripts
  [cyan]/ayuda[/cyan]        esta ayuda
  [cyan]/salir[/cyan]        terminar
Cualquier otro texto se envía al agente, p. ej. [italic]"2 y 5"[/italic] o
[italic]"¿qué pasa si la turbidez cruda sube 30 %?"[/italic]"""

SCRIPT_DEMO = '''
objetivo = "{objetivo}"
exploracion(df)
variables = [c for c in df.select_dtypes("number").columns if c != objetivo]
tabla, mejor = comparar_modelos(df, objetivo, variables, modelos=("lineal", "random_forest"))
print(tabla.to_string(index=False))
print("Importancia:\\n", mejor.importancia.head(6).to_string(index=False))
var = mejor.importancia.iloc[0]["variable"]
print(que_pasa_si(mejor, {{var: 1.30}}))
sensibilidad(mejor, var)
print(monte_carlo(mejor, factores={{var: 1.30}}, umbral=float(df[objetivo].quantile(0.95))))
fc = pronosticar(df[objetivo], horizonte=48)
print(fc.metodo, fc.metricas_backtest[fc.metodo])
'''


# --------------------------------------------------------------------------- vistas

def mostrar_perfil(perfil: PerfilDataset) -> None:
    info = f"[bold]{perfil.origen}[/bold]\n{perfil.filas:,} filas × {perfil.columnas} columnas"
    if perfil.indice_temporal:
        info += (f"\n[green]Serie temporal[/green] '{perfil.indice_temporal}': {perfil.inicio} → {perfil.fin}"
                 f"  ·  frecuencia {perfil.frecuencia or 'irregular'}  ·  huecos {perfil.huecos_temporales}")
    else:
        info += "\n[yellow]Sin índice temporal detectado[/yellow]"
    console.print(Panel(info, title="Dataset", border_style="cyan"))

    tabla = Table(show_lines=False, header_style="bold")
    for col, just in [("Variable", "left"), ("Categoría", "left"), ("Faltantes", "right"), ("Mín", "right"),
                      ("Media", "right"), ("Máx", "right")]:
        tabla.add_column(col, justify=just)
    for v in perfil.variables:
        color = COLORES_CATEGORIA.get(v.categoria, "white")
        fmt = (lambda x: f"{x:.4g}" if x is not None else "—")
        tabla.add_row(v.nombre, f"[{color}]{v.categoria}[/{color}]", f"{v.faltantes_pct:.1f}%",
                      fmt(v.minimo), fmt(v.media), fmt(v.maximo))
    console.print(tabla)
    if perfil.avisos:
        console.print(Panel("\n".join(f"• {a}" for a in perfil.avisos), title="Calidad de datos",
                            border_style="yellow"))


def mostrar_resultado(r: ResultadoEjecucion) -> None:
    estado = "[green]✔ OK[/green]" if r.ok else "[red]✘ ERROR[/red]"
    lineas = [f"{estado}  {r.duracion_s:.1f}s  ·  carpeta {r.carpeta}"]
    lineas += [f"  🖼  {p.name}" for p in r.graficos] + [f"  📄 {p.name}" for p in r.tablas]
    console.print(Panel("\n".join(lineas), title="Resultado de la ejecución", border_style="green" if r.ok else "red"))
    if r.stdout.strip():
        console.print(Panel(r.stdout.strip()[-3000:], title="stdout", border_style="dim"))
    if not r.ok and r.stderr.strip():
        console.print(Panel(r.stderr.strip()[-2000:], title="stderr", border_style="red"))


def listar_salidas(carpeta: Path) -> None:
    archivos = sorted(p for p in carpeta.rglob("*") if p.suffix in (".png", ".csv", ".md", ".json")
                      and ".sandbox" not in p.parts)
    if not archivos:
        console.print("[dim]Aún no hay salidas.[/dim]")
        return
    tabla = Table("Archivo", "Tamaño", header_style="bold")
    for p in archivos:
        tabla.add_row(str(p.relative_to(carpeta)), f"{p.stat().st_size / 1024:.0f} KB")
    console.print(tabla)


# --------------------------------------------------------------------------- modos

def modo_demo(df, perfil: PerfilDataset, runner: SandboxRunner, objetivo: str | None) -> None:
    """Recorrido completo del toolkit sin llamar a la API (para probar la instalación)."""
    numericas = [v.nombre for v in perfil.variables if v.tipo == "numérica"]
    if not objetivo:
        fisico = [v.nombre for v in perfil.variables if v.categoria == "fisicoquimica" and v.tipo == "numérica"]
        candidatos = [n for n in fisico if any(k in n.lower() for k in ("tratad", "efluente", "salida"))]
        objetivo = (candidatos or fisico or numericas)[0]
    console.print(f"[bold]Modo demo[/bold]: objetivo = [cyan]{objetivo}[/cyan] (use --objetivo para cambiarlo)")
    with console.status("Ejecutando EDA, modelos, What-If, Monte Carlo y pronóstico…"):
        r = runner.ejecutar(SCRIPT_DEMO.format(objetivo=objetivo), etiqueta="demo")
    mostrar_resultado(r)
    if not r.ok:
        console.print(r.stderr)


def crear_callbacks(estado: dict) -> Callbacks:
    def texto(t: str) -> None:
        console.print(t, end="", markup=False, highlight=False, soft_wrap=True)

    def aprobar(objetivo: str, codigo: str) -> bool:
        console.print()
        console.print(Panel(Syntax(codigo, "python", line_numbers=True, word_wrap=True),
                            title=f"Script propuesto: {objetivo}", border_style="magenta"))
        if estado["auto"]:
            return True
        resp = Prompt.ask("¿Ejecutar? ([bold]s[/bold]í / [bold]n[/bold]o / [bold]t[/bold]odos los siguientes)",
                          choices=["s", "n", "t"], default="s")
        if resp == "t":
            estado["auto"] = True
        return resp in ("s", "t")

    def inicio(objetivo: str) -> None:
        estado["spinner"] = console.status(f"Ejecutando en sandbox: {objetivo}")
        estado["spinner"].start()

    def resultado(r: ResultadoEjecucion) -> None:
        if estado.get("spinner"):
            estado["spinner"].stop()
        mostrar_resultado(r)

    def aviso(m: str) -> None:
        console.print(f"\n[yellow]⚠ {m}[/yellow]")

    return Callbacks(texto=texto, aprobar_codigo=aprobar, inicio_ejecucion=inicio,
                     resultado_ejecucion=resultado, aviso=aviso)


def turno(agente: AgenteAnalista, accion, *args) -> str | None:
    console.print(Panel.fit("[bold]Agente[/bold]", border_style="cyan"))
    try:
        salida = accion(*args)
        console.print()
        return salida
    except anthropic.AuthenticationError:
        console.print("[red]Credenciales de Anthropic no válidas o ausentes.[/red] Defina ANTHROPIC_API_KEY "
                      "o ejecute con --demo para probar sin API.")
    except anthropic.RateLimitError:
        console.print("[red]Límite de uso de la API alcanzado.[/red] Espere un momento y reintente.")
    except anthropic.APIStatusError as exc:
        console.print(f"[red]Error de la API ({exc.status_code}):[/red] {exc.message}")
    except anthropic.APIConnectionError:
        console.print("[red]No hay conexión con la API de Anthropic.[/red]")
    except CodigoRechazado as exc:
        console.print(f"[red]{exc}[/red]")
    return None


def bucle_interactivo(agente: AgenteAnalista, perfil: PerfilDataset, salida: Path, estado: dict,
                      contexto: str) -> None:
    console.print(Panel(AYUDA, border_style="dim"))
    turno(agente, agente.proponer, contexto)
    while True:
        try:
            entrada = Prompt.ask("\n[bold cyan]tú[/bold cyan]").strip()
        except (EOFError, KeyboardInterrupt):
            console.print("\nHasta luego.")
            return
        if not entrada:
            continue
        cmd = entrada.lower()
        if cmd in ("/salir", "/exit", "/q"):
            return
        if cmd == "/ayuda":
            console.print(Panel(AYUDA, border_style="dim"))
        elif cmd == "/perfil":
            mostrar_perfil(perfil)
        elif cmd == "/salidas":
            listar_salidas(salida)
        elif cmd == "/auto":
            estado["auto"] = not estado["auto"]
            console.print(f"Aprobación automática: {'activada' if estado['auto'] else 'desactivada'}")
        elif cmd == "/proponer":
            turno(agente, agente.conversar, "Vuelve a proponer el menú de análisis considerando lo hecho hasta ahora.")
        elif cmd == "/conclusion":
            texto = turno(agente, agente.concluir)
            if texto:
                ruta = salida / f"conclusion_operativa_{datetime.now():%Y%m%d_%H%M%S}.md"
                ruta.write_text(texto, encoding="utf-8")
                console.print(Panel(Markdown(texto), title="Conclusión operativa", border_style="green"))
                console.print(f"[dim]Guardada en {ruta}[/dim]")
        elif cmd == "/hallazgos":
            with console.status("Extrayendo hallazgos estructurados…"):
                h = agente.extraer_hallazgos()
            if h:
                ruta = salida / "hallazgos.json"
                ruta.write_text(h.model_dump_json(indent=2), encoding="utf-8")
                console.print_json(h.model_dump_json())
                console.print(f"[dim]Guardado en {ruta}[/dim]")
        elif cmd.startswith("/"):
            console.print("[yellow]Comando desconocido.[/yellow] Escriba /ayuda.")
        else:
            turno(agente, agente.conversar, entrada)


def main() -> None:
    ap = argparse.ArgumentParser(description="Agente CLI de análisis, pronóstico y simulación de datos hídricos")
    ap.add_argument("fuente", nargs="?", help="CSV, Excel o URL (por defecto: datos de ejemplo)")
    ap.add_argument("--hoja", default=0, help="Hoja de Excel (nombre o índice)")
    ap.add_argument("--salida", default=str(RAIZ / "output"), help="Carpeta de gráficos y tablas")
    ap.add_argument("--modelo", default=os.environ.get("AGENTE_MODELO", MODELO_POR_DEFECTO))
    ap.add_argument("--esfuerzo", default="high", choices=["low", "medium", "high", "xhigh", "max"])
    ap.add_argument("--auto", action="store_true", help="Ejecutar scripts sin pedir confirmación")
    ap.add_argument("--contexto", default="", help="Contexto del proceso (p. ej. 'PTAP de filtración rápida')")
    ap.add_argument("--demo", action="store_true", help="Recorrido del toolkit sin usar la API")
    ap.add_argument("--objetivo", help="Variable objetivo para --demo")
    ap.add_argument("--timeout", type=int, default=300, help="Segundos máximos por script")
    args = ap.parse_args()

    console.print(Panel.fit("[bold]Analista Hídrico[/bold] · análisis, pronóstico y simulación de datos de agua",
                            border_style="cyan"))
    fuente = args.fuente or Prompt.ask("Ruta o URL de datos", default=str(RAIZ / "data" / "sample_water_flow.csv"))
    hoja = int(args.hoja) if str(args.hoja).isdigit() else args.hoja
    try:
        with console.status("Cargando y perfilando datos…"):
            df, perfil = cargar(fuente, hoja)
    except Exception as exc:  # noqa: BLE001 - se informa al usuario cualquier fallo de lectura
        console.print(f"[red]No se pudo cargar '{fuente}':[/red] {exc}")
        sys.exit(1)
    mostrar_perfil(perfil)

    salida = Path(args.salida).resolve()
    runner = SandboxRunner(df, salida, timeout_s=args.timeout)

    if args.demo:
        modo_demo(df, perfil, runner, args.objetivo)
        return

    estado = {"auto": args.auto}
    agente = AgenteAnalista(perfil, runner, modelo=args.modelo, esfuerzo=args.esfuerzo,
                            callbacks=crear_callbacks(estado))
    bucle_interactivo(agente, perfil, salida, estado, args.contexto)

    historial = salida / f"sesion_{datetime.now():%Y%m%d_%H%M%S}.json"
    historial.write_text(json.dumps(
        [{"script": str(e.carpeta / "script.py"), "ok": e.ok, "resultados": e.resultados}
         for e in agente.ejecuciones], ensure_ascii=False, indent=2), encoding="utf-8")
    console.print(f"[dim]Registro de ejecuciones: {historial}[/dim]")


if __name__ == "__main__":
    main()
