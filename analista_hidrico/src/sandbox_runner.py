"""Ejecución controlada de los scripts que genera el agente.

Capas de protección (defensa en profundidad, NO es un aislamiento perfecto):
  1. Análisis estático (AST): bloquea imports de red/sistema/procesos y
     builtins peligrosos (exec, eval, __import__, open en modo escritura
     fuera de OUTPUT_DIR se detecta en tiempo de ejecución).
  2. Subproceso aparte con `python -I` (ignora PYTHONPATH y site del usuario),
     entorno mínimo SIN credenciales (la API key nunca llega al script),
     directorio de trabajo = carpeta de la ejecución.
  3. Límites de CPU, memoria y tamaño de archivo (POSIX) y timeout de reloj.
  4. Un hook de auditoría (sys.addaudithook) que bloquea sockets, subprocesos
     y escritura de archivos fuera de la carpeta de salida.
Para datos o código no confiables use además un contenedor/VM.
"""

from __future__ import annotations

import ast
import json
import os
import subprocess
import sys
import textwrap
import time
from dataclasses import dataclass, field
from pathlib import Path

import pandas as pd

SRC_DIR = Path(__file__).resolve().parent

MODULOS_BLOQUEADOS = {
    "subprocess", "socket", "ssl", "http", "urllib", "requests", "httpx", "httpx2", "aiohttp", "ftplib",
    "smtplib", "telnetlib", "paramiko", "ctypes", "cffi", "multiprocessing", "threading", "asyncio",
    "signal", "pty", "shutil", "importlib", "pickle", "marshal", "shelve", "webbrowser", "anthropic",
    "builtins", "code", "codeop", "runpy", "sysconfig", "winreg", "_winapi", "posix", "nt", "resource",
}
FUNCIONES_BLOQUEADAS = {"exec", "eval", "compile", "__import__", "breakpoint", "input", "globals",
                        "vars", "setattr", "delattr", "getattr"}
ATRIBUTOS_BLOQUEADOS = {"system", "popen", "spawnl", "spawnv", "execv", "execve", "execl", "fork", "kill",
                        "unlink", "rmdir", "removedirs", "chmod", "chown",
                        "putenv", "environ", "__subclasses__", "__globals__", "__builtins__", "__code__",
                        "read_pickle", "to_pickle", "rmtree"}

MAX_SALIDA = 12_000  # caracteres de stdout/stderr devueltos al agente

PRELUDIO = textwrap.dedent('''
    import sys, os, warnings
    sys.path.insert(0, {src!r})
    _SALIDA = os.path.realpath({salida!r})
    _PERMITIDAS_LECTURA = (os.path.realpath(sys.prefix), os.path.realpath(sys.base_prefix))

    def _auditor(evento, args):
        if evento.startswith(("socket.", "subprocess.", "os.system", "os.exec", "os.spawn", "os.fork",
                              "os.posix_spawn", "ctypes.", "os.kill", "shutil.rmtree", "os.remove",
                              "os.rename", "os.rmdir", "os.chmod", "webbrowser.")):
            raise PermissionError(f"Operación bloqueada por el sandbox: {{evento}}")
        if evento == "open" and args and isinstance(args[0], (str, bytes, os.PathLike)):
            modo = args[1] if len(args) > 1 and isinstance(args[1], str) else "r"
            if any(m in modo for m in "wax+"):
                ruta = os.path.realpath(os.fsdecode(args[0]))
                if not (ruta.startswith(_SALIDA) or ruta.startswith("/tmp") or "matplotlib" in ruta
                        or "fontlist" in ruta):
                    raise PermissionError(f"Escritura fuera de la carpeta de salida bloqueada: {{ruta}}")

    import numpy as np
    import pandas as pd
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    import seaborn as sns
    import scipy, sklearn, statsmodels.api as sm
    from toolkit import *  # noqa: F401,F403
    import toolkit as tk

    df = pd.read_pickle({datos!r})
    OUTPUT_DIR = tk.OUTPUT_DIR
    warnings.filterwarnings("ignore", category=FutureWarning)
    sys.addaudithook(_auditor)
    del _auditor
    # ----------------- código del agente -----------------
''')


class CodigoRechazado(Exception):
    pass


@dataclass
class ResultadoEjecucion:
    ok: bool
    stdout: str
    stderr: str
    duracion_s: float
    graficos: list[Path] = field(default_factory=list)
    tablas: list[Path] = field(default_factory=list)
    resultados: dict = field(default_factory=dict)
    carpeta: Path | None = None

    def para_agente(self) -> str:
        """Texto que se devuelve al modelo como resultado de la herramienta."""
        partes = [f"estado: {'OK' if self.ok else 'ERROR'} ({self.duracion_s:.1f}s)"]
        if self.stdout.strip():
            partes.append("STDOUT:\n" + self.stdout)
        if self.stderr.strip():
            partes.append("STDERR:\n" + self.stderr)
        if self.resultados:
            partes.append("RESULTADOS REGISTRADOS (registrar()):\n" +
                          json.dumps(self.resultados, ensure_ascii=False, indent=1)[:MAX_SALIDA])
        if self.graficos:
            partes.append("GRÁFICOS GUARDADOS:\n" + "\n".join(f"- {p}" for p in self.graficos))
        if self.tablas:
            partes.append("TABLAS GUARDADAS:\n" + "\n".join(f"- {p}" for p in self.tablas))
        return "\n\n".join(partes)


def validar_codigo(codigo: str) -> None:
    """Rechaza el script antes de ejecutarlo si usa construcciones peligrosas."""
    try:
        arbol = ast.parse(codigo)
    except SyntaxError as exc:
        raise CodigoRechazado(f"Error de sintaxis en línea {exc.lineno}: {exc.msg}") from exc
    for nodo in ast.walk(arbol):
        if isinstance(nodo, ast.Import):
            for alias in nodo.names:
                if alias.name.split(".")[0] in MODULOS_BLOQUEADOS:
                    raise CodigoRechazado(f"Import no permitido: {alias.name}")
        elif isinstance(nodo, ast.ImportFrom):
            if nodo.module and nodo.module.split(".")[0] in MODULOS_BLOQUEADOS:
                raise CodigoRechazado(f"Import no permitido: {nodo.module}")
        elif isinstance(nodo, ast.Call) and isinstance(nodo.func, ast.Name):
            if nodo.func.id in FUNCIONES_BLOQUEADAS:
                raise CodigoRechazado(f"Función no permitida: {nodo.func.id}()")
        elif isinstance(nodo, ast.Attribute) and nodo.attr in ATRIBUTOS_BLOQUEADOS:
            raise CodigoRechazado(f"Atributo no permitido: .{nodo.attr}")
        elif isinstance(nodo, ast.Name) and nodo.id.startswith("__") and nodo.id not in ("__name__",):
            raise CodigoRechazado(f"Nombre reservado no permitido: {nodo.id}")


def _limites_posix(memoria_mb: int, cpu_s: int):
    def aplicar():
        import resource

        mem = memoria_mb * 1024 * 1024
        resource.setrlimit(resource.RLIMIT_AS, (mem, mem))
        resource.setrlimit(resource.RLIMIT_CPU, (cpu_s, cpu_s + 5))
        resource.setrlimit(resource.RLIMIT_FSIZE, (200 * 1024 * 1024, 200 * 1024 * 1024))
        os.setsid()
    return aplicar


class SandboxRunner:
    """Ejecuta scripts sobre un DataFrame fijo y recoge gráficos, tablas y resultados."""

    def __init__(self, df: pd.DataFrame, carpeta_salida: str | Path = "output",
                 timeout_s: int = 300, memoria_mb: int = 4096):
        self.salida = Path(carpeta_salida).resolve()
        self.salida.mkdir(parents=True, exist_ok=True)
        self.trabajo = self.salida / ".sandbox"
        self.trabajo.mkdir(exist_ok=True)
        self.datos = self.trabajo / "dataset.pkl"
        df.to_pickle(self.datos)
        self.timeout_s = timeout_s
        self.memoria_mb = memoria_mb
        self.contador = 0

    def ejecutar(self, codigo: str, etiqueta: str = "analisis") -> ResultadoEjecucion:
        validar_codigo(codigo)
        self.contador += 1
        nombre = f"{self.contador:02d}_{''.join(c if c.isalnum() else '_' for c in etiqueta)[:40]}"
        carpeta = self.salida / nombre
        carpeta.mkdir(parents=True, exist_ok=True)

        script = PRELUDIO.format(src=str(SRC_DIR), salida=str(carpeta), datos=str(self.datos)) + codigo
        ruta_script = carpeta / "script.py"
        ruta_script.write_text(codigo, encoding="utf-8")  # copia legible para auditoría
        ejecutable = self.trabajo / f"{nombre}.py"
        ejecutable.write_text(script, encoding="utf-8")

        entorno = {
            "PATH": "/usr/bin:/bin",
            "HOME": str(self.trabajo),
            "MPLCONFIGDIR": str(self.trabajo / "mpl"),
            "AGENTE_OUTPUT_DIR": str(carpeta),
            "PYTHONHASHSEED": "0",
            "OMP_NUM_THREADS": "4",
            "LANG": "C.UTF-8",
            "PYTHONIOENCODING": "utf-8",
        }
        kwargs = {}
        if os.name == "posix":
            kwargs["preexec_fn"] = _limites_posix(self.memoria_mb, self.timeout_s)

        inicio = time.time()
        try:
            proc = subprocess.run(
                [sys.executable, "-I", str(ejecutable)], cwd=carpeta, env=entorno,
                capture_output=True, text=True, timeout=self.timeout_s, **kwargs)
            ok, stdout, stderr = proc.returncode == 0, proc.stdout, proc.stderr
        except subprocess.TimeoutExpired as exc:
            ok = False
            stdout = exc.stdout.decode() if isinstance(exc.stdout, bytes) else (exc.stdout or "")
            stderr = f"Tiempo límite excedido ({self.timeout_s}s). Simplifique o reduzca los datos."
        duracion = time.time() - inicio

        stderr = self._limpiar_traza(stderr, ejecutable)
        resultados = {}
        archivo_res = carpeta / "_resultados.json"
        if archivo_res.exists():
            try:
                resultados = json.loads(archivo_res.read_text(encoding="utf-8"))
            except json.JSONDecodeError:
                pass
        return ResultadoEjecucion(
            ok=ok, stdout=_recortar(stdout), stderr=_recortar(stderr), duracion_s=duracion,
            graficos=sorted(carpeta.glob("*.png")), tablas=sorted(carpeta.glob("*.csv")),
            resultados=resultados, carpeta=carpeta)

    @staticmethod
    def _limpiar_traza(stderr: str, ejecutable: Path) -> str:
        # Ajusta los números de línea al código del agente (sin el preludio).
        offset = PRELUDIO.count("\n")
        lineas = []
        for linea in stderr.splitlines():
            if str(ejecutable) in linea and ", line " in linea:
                try:
                    _, resto = linea.split(", line ", 1)
                    num, post = (resto.split(",", 1) + [""])[:2]
                    n = int(num) - offset
                    sitio = f"script.py, línea {n}" if n > 0 else "preludio del sandbox"
                    linea = f"  {sitio}{',' + post if post else ''}"
                except ValueError:
                    pass
            lineas.append(linea)
        return "\n".join(lineas)


def _recortar(texto: str) -> str:
    if len(texto) <= MAX_SALIDA:
        return texto
    mitad = MAX_SALIDA // 2
    return texto[:mitad] + f"\n... [{len(texto) - MAX_SALIDA} caracteres omitidos] ...\n" + texto[-mitad:]
