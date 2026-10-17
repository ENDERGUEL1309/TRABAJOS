"""Ingesta de datos (CSV, Excel o URL) y perfilado automático.

Detecta el índice temporal, re-ordena, infiere la frecuencia y clasifica
cada variable en hidráulica / físico-química / operativa / otra a partir del
nombre de la columna y de su unidad.
"""

from __future__ import annotations

import io
import re
import unicodedata
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import urlparse
from urllib.request import Request, urlopen

import numpy as np
import pandas as pd

# Palabras clave (sin tildes, en minúscula) por categoría.
CATEGORIAS: dict[str, dict[str, list[str]]] = {
    "hidraulica": {
        "nombres": ["caudal", "flujo", "flow", "nivel", "level", "presion", "pressure", "velocidad",
                    "velocity", "volumen", "volume", "carga", "head", "precipitacion", "lluvia", "rain"],
        "unidades": ["m3h", "m3/h", "m3s", "m3/s", "ls", "l/s", "lps", "gpm", "mgd", "bar", "psi", "mca",
                     "kpa", "mm"],
    },
    "fisicoquimica": {
        "nombres": ["turbidez", "turbidity", "ph", "conductividad", "conductivity", "oxigeno", "oxygen",
                    "od", "do", "dbo", "bod", "dqo", "cod", "sst", "tss", "sdt", "tds", "cloro", "chlorine",
                    "temperatura", "temp", "nitrato", "nitrate", "nitrito", "amonio", "ammonia", "nh4",
                    "fosforo", "phosphorus", "fosfato", "coliformes", "coliform", "ecoli", "color",
                    "alcalinidad", "alkalinity", "dureza", "hardness", "hierro", "iron", "manganeso",
                    "orp", "redox", "salinidad", "sulfato", "cot", "toc", "solidos"],
        "unidades": ["ntu", "mgl", "mg/l", "uscm", "us/cm", "ms/cm", "ppm", "ufc", "nmp", "upt", "c", "mv"],
    },
    "operativa": {
        "nombres": ["dosis", "dose", "coagulante", "coagulant", "floculante", "polimero", "energia",
                    "energy", "potencia", "power", "bomba", "pump", "kwh", "kw", "frecuencia", "rpm",
                    "apertura", "valvula", "valve", "consumo", "costo", "cost", "lodo", "sludge",
                    "retrolavado", "backwash", "aireacion", "blower"],
        "unidades": ["kwh", "kw", "hz", "rpm", "%"],
    },
}

NOMBRES_FECHA = ["fecha", "date", "time", "hora", "timestamp", "datetime", "periodo", "period", "dia", "day",
                 "mes", "month", "ano", "year"]


def _normalizar(texto: str) -> str:
    sin_tildes = unicodedata.normalize("NFKD", str(texto)).encode("ascii", "ignore").decode()
    return sin_tildes.lower().strip()


def _tokens(nombre: str) -> list[str]:
    return [t for t in re.split(r"[^a-z0-9/%]+", _normalizar(nombre)) if t]


@dataclass
class PerfilVariable:
    nombre: str
    tipo: str
    categoria: str
    faltantes_pct: float
    unicos: int
    minimo: float | None = None
    maximo: float | None = None
    media: float | None = None
    desv: float | None = None


@dataclass
class PerfilDataset:
    origen: str
    filas: int
    columnas: int
    variables: list[PerfilVariable]
    indice_temporal: str | None = None
    inicio: str | None = None
    fin: str | None = None
    frecuencia: str | None = None
    huecos_temporales: int = 0
    duplicados_temporales: int = 0
    avisos: list[str] = field(default_factory=list)

    def por_categoria(self) -> dict[str, list[str]]:
        grupos: dict[str, list[str]] = {}
        for v in self.variables:
            grupos.setdefault(v.categoria, []).append(v.nombre)
        return grupos

    def resumen_texto(self) -> str:
        """Descripción compacta para el modelo de lenguaje."""
        lineas = [f"Origen: {self.origen}", f"Dimensiones: {self.filas} filas x {self.columnas} columnas"]
        if self.indice_temporal:
            lineas.append(
                f"Índice temporal: '{self.indice_temporal}' de {self.inicio} a {self.fin}, frecuencia "
                f"{self.frecuencia or 'irregular'}, {self.huecos_temporales} huecos, "
                f"{self.duplicados_temporales} marcas duplicadas")
        else:
            lineas.append("Sin índice temporal detectado (datos transversales).")
        lineas.append("Variables:")
        for v in self.variables:
            rango = (f" rango [{v.minimo:.4g}, {v.maximo:.4g}] media {v.media:.4g} sd {v.desv:.4g}"
                     if v.minimo is not None else f" {v.unicos} valores únicos")
            lineas.append(f"  - {v.nombre} ({v.tipo}, {v.categoria}) faltantes {v.faltantes_pct:.1f}%{rango}")
        if self.avisos:
            lineas.append("Avisos de calidad de datos:")
            lineas += [f"  - {a}" for a in self.avisos]
        return "\n".join(lineas)


def clasificar_variable(nombre: str) -> str:
    toks = _tokens(nombre)
    compacto = _normalizar(nombre).replace(" ", "_")
    puntajes = {}
    for cat, claves in CATEGORIAS.items():
        p = 0
        for clave in claves["nombres"]:
            # Claves cortas (ph, od, do) solo como token exacto para evitar falsos positivos.
            if (len(clave) <= 3 and clave in toks) or (len(clave) > 3 and clave in compacto):
                p += 2
        p += sum(1 for u in claves["unidades"] if u in toks)
        puntajes[cat] = p
    mejor = max(puntajes, key=puntajes.get)
    return mejor if puntajes[mejor] > 0 else "otra"


def _leer_bytes_url(url: str) -> tuple[bytes, str]:
    req = Request(url, headers={"User-Agent": "analista-hidrico/1.0"})
    with urlopen(req, timeout=60) as resp:  # noqa: S310 - el usuario aporta la URL explícitamente
        return resp.read(), Path(urlparse(url).path).suffix.lower()


def _leer_csv(fuente) -> pd.DataFrame:
    """Lee CSV detectando separador y separador decimal (formato latino `;` + `,`)."""
    if isinstance(fuente, bytes):
        texto = fuente.decode("utf-8-sig", errors="replace")
    else:
        texto = Path(fuente).read_text(encoding="utf-8-sig", errors="replace")
    muestra = "\n".join(texto.splitlines()[:50])
    sep = max([",", ";", "\t", "|"], key=muestra.count)
    decimal = "," if sep != "," and re.search(r"\d,\d", muestra) else "."
    return pd.read_csv(io.StringIO(texto), sep=sep, decimal=decimal)


def leer_fuente(fuente: str, hoja: str | int | None = 0) -> pd.DataFrame:
    es_url = urlparse(fuente).scheme in ("http", "https")
    if es_url:
        contenido, ext = _leer_bytes_url(fuente)
        if ext in (".xlsx", ".xls", ".xlsm"):
            return pd.read_excel(io.BytesIO(contenido), sheet_name=hoja)
        return _leer_csv(contenido)
    ruta = Path(fuente).expanduser()
    if not ruta.exists():
        raise FileNotFoundError(f"No existe el archivo: {ruta}")
    if ruta.suffix.lower() in (".xlsx", ".xls", ".xlsm"):
        return pd.read_excel(ruta, sheet_name=hoja)
    return _leer_csv(ruta)


def _es_texto(serie: pd.Series) -> bool:
    return serie.dtype == object or pd.api.types.is_string_dtype(serie)


def _convertir_numericos(df: pd.DataFrame) -> pd.DataFrame:
    """Convierte columnas texto con números (p. ej. '1,25' o '<0.1') a float."""
    for c in df.columns:
        if _es_texto(df[c]):
            limpio = (df[c].astype(str).str.strip()
                      .str.replace(r"^[<>≤≥]\s*", "", regex=True)
                      .str.replace(",", ".", regex=False))
            num = pd.to_numeric(limpio, errors="coerce")
            if num.notna().mean() > 0.9 and df[c].notna().sum() > 0:
                censurados = int(df[c].astype(str).str.strip().str.match(r"^[<>≤≥]").sum())
                if censurados:
                    df.attrs.setdefault("censurados", {})[c] = censurados
                df[c] = num
    return df


def detectar_indice_temporal(df: pd.DataFrame) -> tuple[pd.DataFrame, str | None]:
    if isinstance(df.index, pd.DatetimeIndex):
        return df, df.index.name or "indice"
    candidatos = sorted(df.columns, key=lambda c: 0 if any(k in _normalizar(c) for k in NOMBRES_FECHA) else 1)
    for c in candidatos:
        serie = df[c]
        if pd.api.types.is_datetime64_any_dtype(serie):
            convertida = serie
        elif _es_texto(serie) or any(k in _normalizar(c) for k in NOMBRES_FECHA):
            if pd.api.types.is_numeric_dtype(serie):
                continue  # p. ej. una columna "año" numérica no se toma como timestamp
            convertida = _parsear_fechas(serie)
        else:
            continue
        if convertida.notna().mean() > 0.9 and convertida.nunique() > 2:
            out = df.drop(columns=[c]).copy()
            out.index = pd.DatetimeIndex(convertida, name=c)
            out = out[out.index.notna()].sort_index()
            return out, c
    return df, None


def _parsear_fechas(serie: pd.Series) -> pd.Series:
    """Convierte a datetime resolviendo la ambigüedad día/mes.

    Si hay un primer campo > 12 el formato es inequívoco. Si no, se prueban
    ambas lecturas y se elige la que da una serie más ordenada y regular; en
    empate se asume día/mes (convención hispana).
    """
    texto = serie.astype(str)
    if not texto.str.match(r"^\d{1,2}[/\-.]\d{1,2}[/\-.]\d{2,4}").any():
        return pd.to_datetime(serie, errors="coerce")
    primeros = pd.to_numeric(texto.str.extract(r"^(\d{1,2})[/\-.]")[0], errors="coerce")
    segundos = pd.to_numeric(texto.str.extract(r"^\d{1,2}[/\-.](\d{1,2})")[0], errors="coerce")
    if (primeros > 12).any():
        return pd.to_datetime(serie, errors="coerce", dayfirst=True)
    if (segundos > 12).any():
        return pd.to_datetime(serie, errors="coerce", dayfirst=False)

    def calidad(fechas: pd.Series) -> tuple:
        difs = fechas.dropna().diff().dropna()
        if difs.empty:
            return (fechas.notna().mean(), 0.0, 0.0)
        ordenada = (difs > pd.Timedelta(0)).mean()
        regular = (difs == difs.median()).mean()
        return (round(fechas.notna().mean(), 3), round(ordenada, 3), round(regular, 3))

    dia_mes = pd.to_datetime(serie, errors="coerce", dayfirst=True)
    mes_dia = pd.to_datetime(serie, errors="coerce", dayfirst=False)
    return mes_dia if calidad(mes_dia) > calidad(dia_mes) else dia_mes


def perfilar(df: pd.DataFrame, origen: str, columna_tiempo: str | None) -> PerfilDataset:
    variables = []
    avisos = []
    for c in df.columns:
        s = df[c]
        falt = float(s.isna().mean() * 100)
        if pd.api.types.is_numeric_dtype(s):
            desc = s.describe()
            pv = PerfilVariable(c, "numérica", clasificar_variable(c), falt, int(s.nunique()),
                                float(desc["min"]), float(desc["max"]), float(desc["mean"]), float(desc["std"]))
            if s.nunique() <= 1:
                avisos.append(f"'{c}' es constante: no aporta información.")
            elif desc["std"] > 0:
                z = (s - desc["mean"]).abs() / desc["std"]
                atipicos = int((z > 4).sum())
                if atipicos:
                    avisos.append(f"'{c}' tiene {atipicos} valores a más de 4 desviaciones (posibles picos "
                                  "reales o errores de sensor).")
            if (s < 0).any() and pv.categoria in ("hidraulica", "fisicoquimica") \
                    and not any(k in _normalizar(c) for k in ("temp", "orp", "redox", "nivel")):
                avisos.append(f"'{c}' tiene valores negativos: físicamente sospechoso.")
        else:
            pv = PerfilVariable(c, "categórica", "otra", falt, int(s.nunique()))
        if falt > 20:
            avisos.append(f"'{c}' tiene {falt:.0f}% de faltantes.")
        variables.append(pv)

    for c, n in df.attrs.get("censurados", {}).items():
        avisos.append(f"'{c}' tiene {n} valores censurados ('<LD' o '>LC') que se tomaron como el límite: "
                      "sesgan medias y modelos; considere métodos para datos censurados.")
    perfil = PerfilDataset(origen, len(df), df.shape[1], variables, avisos=avisos)
    if columna_tiempo:
        idx = df.index
        perfil.indice_temporal = columna_tiempo
        perfil.inicio, perfil.fin = str(idx.min()), str(idx.max())
        perfil.duplicados_temporales = int(idx.duplicated().sum())
        unicos = idx[~idx.duplicated()]
        freq = pd.infer_freq(unicos[: min(len(unicos), 1000)]) if len(unicos) >= 3 else None
        if freq is None and len(unicos) >= 3:
            paso = pd.Series(unicos).diff().median()
            perfil.frecuencia = f"~{paso} (mediana, irregular)"
            esperado = pd.date_range(unicos.min(), unicos.max(), freq=paso)
        elif freq:
            perfil.frecuencia = freq
            esperado = pd.date_range(unicos.min(), unicos.max(), freq=freq)
        else:
            esperado = unicos
        perfil.huecos_temporales = max(0, len(esperado) - len(unicos))
        if perfil.duplicados_temporales:
            avisos.append(f"{perfil.duplicados_temporales} marcas de tiempo duplicadas.")
        if perfil.huecos_temporales:
            avisos.append(f"{perfil.huecos_temporales} instantes faltantes en la serie regular.")
    return perfil


def cargar(fuente: str, hoja: str | int | None = 0) -> tuple[pd.DataFrame, PerfilDataset]:
    """Punto de entrada: lee, limpia tipos, detecta tiempo y perfila."""
    df = leer_fuente(fuente, hoja)
    df.columns = [str(c).strip() for c in df.columns]
    df = df.dropna(axis=1, how="all").dropna(axis=0, how="all")
    df = _convertir_numericos(df)
    df, col_tiempo = detectar_indice_temporal(df)
    return df, perfilar(df, fuente, col_tiempo)


def resumen_numerico(df: pd.DataFrame) -> dict:
    """Correlaciones más fuertes, útil para que el agente proponga análisis."""
    num = df.select_dtypes("number")
    if num.shape[1] < 2:
        return {}
    corr = num.corr()
    mask = np.triu(np.ones(corr.shape, dtype=bool), k=1)
    pares = corr.where(mask).stack().sort_values(key=np.abs, ascending=False).head(8)
    return {f"{a} ~ {b}": round(float(r), 3) for (a, b), r in pares.items()}
