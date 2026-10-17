"""Caja de herramientas estadística que se importa dentro del sandbox.

Los scripts generados por el agente usan estas funciones para no reinventar
(y equivocar) el entrenamiento de modelos, el pronóstico y la simulación.
Cada función guarda sus gráficos en OUTPUT_DIR y registra resultados
estructurados con `registrar()` para que el agente los lea después.
"""

from __future__ import annotations

import json
import os
import warnings
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402

OUTPUT_DIR = Path(os.environ.get("AGENTE_OUTPUT_DIR", "output"))
RESULTS_FILE = "_resultados.json"

# Paleta categórica validada (slots 1-3) y tintas de texto.
COLOR_REAL = "#2a78d6"
COLOR_MODELO = "#eb6834"
COLOR_TERCERO = "#1baf7a"
TINTA = "#0b0b0b"
TINTA_SECUNDARIA = "#52514e"
SUPERFICIE = "#fcfcfb"
REJILLA = "#e4e3df"

plt.rcParams.update({
    "figure.facecolor": SUPERFICIE,
    "axes.facecolor": SUPERFICIE,
    "axes.edgecolor": REJILLA,
    "axes.labelcolor": TINTA_SECUNDARIA,
    "axes.titlecolor": TINTA,
    "axes.titlesize": 12,
    "axes.titleweight": "bold",
    "axes.grid": True,
    "axes.axisbelow": True,
    "date.converter": "concise",
    "axes.spines.top": False,
    "axes.spines.right": False,
    "grid.color": REJILLA,
    "grid.linewidth": 0.6,
    "xtick.color": TINTA_SECUNDARIA,
    "ytick.color": TINTA_SECUNDARIA,
    "legend.frameon": False,
    "lines.linewidth": 2,
    "figure.dpi": 110,
    "savefig.bbox": "tight",
})


# ---------------------------------------------------------------------------
# Registro de resultados y guardado de salidas
# ---------------------------------------------------------------------------

def _jsonable(valor: Any) -> Any:
    if isinstance(valor, dict):
        return {str(k): _jsonable(v) for k, v in valor.items()}
    if isinstance(valor, (list, tuple)):
        return [_jsonable(v) for v in valor]
    if isinstance(valor, pd.DataFrame):
        return valor.head(50).to_dict(orient="records")
    if isinstance(valor, pd.Series):
        return {str(k): _jsonable(v) for k, v in valor.head(50).items()}
    if isinstance(valor, (np.integer,)):
        return int(valor)
    if isinstance(valor, (np.floating, float)):
        return None if not np.isfinite(valor) else round(float(valor), 6)
    if isinstance(valor, (np.bool_,)):
        return bool(valor)
    if isinstance(valor, (pd.Timestamp, np.datetime64)):
        return str(valor)
    return valor


def registrar(nombre: str, valor: Any) -> None:
    """Guarda un resultado estructurado que el agente leerá tras la ejecución."""
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    ruta = OUTPUT_DIR / RESULTS_FILE
    datos = json.loads(ruta.read_text(encoding="utf-8")) if ruta.exists() else {}
    datos[nombre] = _jsonable(valor)
    ruta.write_text(json.dumps(datos, ensure_ascii=False, indent=2), encoding="utf-8")


def guardar_figura(nombre: str, fig: plt.Figure | None = None) -> Path:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    fig = fig or plt.gcf()
    ruta = OUTPUT_DIR / f"{nombre}.png"
    fig.savefig(ruta)
    plt.close(fig)
    return ruta


def guardar_tabla(df: pd.DataFrame, nombre: str) -> Path:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    ruta = OUTPUT_DIR / f"{nombre}.csv"
    df.to_csv(ruta, index=True)
    return ruta


# ---------------------------------------------------------------------------
# Exploración
# ---------------------------------------------------------------------------

def exploracion(df: pd.DataFrame, variables: list[str] | None = None, nombre: str = "eda") -> dict:
    """EDA estándar: resumen, faltantes, correlaciones, series y distribuciones."""
    num = df.select_dtypes("number")
    if variables:
        num = num[[v for v in variables if v in num.columns]]
    resumen = num.describe().T
    resumen["faltantes_%"] = num.isna().mean() * 100
    guardar_tabla(resumen, f"{nombre}_resumen")

    corr = num.corr()
    fig, ax = plt.subplots(figsize=(1.0 + 0.7 * len(corr), 0.8 + 0.6 * len(corr)))
    im = ax.imshow(corr.values, cmap="RdBu_r", vmin=-1, vmax=1)
    ax.set_xticks(range(len(corr)), corr.columns, rotation=45, ha="right")
    ax.set_yticks(range(len(corr)), corr.columns)
    ax.grid(False)
    for i in range(len(corr)):
        for j in range(len(corr)):
            v = corr.values[i, j]
            ax.text(j, i, f"{v:.2f}", ha="center", va="center", fontsize=8,
                    color="white" if abs(v) > 0.6 else TINTA)
    fig.colorbar(im, ax=ax, shrink=0.8, label="Correlación de Pearson")
    ax.set_title("Matriz de correlación")
    guardar_figura(f"{nombre}_correlacion", fig)

    if isinstance(df.index, pd.DatetimeIndex):
        cols = list(num.columns)
        fig, axes = plt.subplots(len(cols), 1, figsize=(11, 1.8 * len(cols)), sharex=True)
        axes = np.atleast_1d(axes)
        for ax, c in zip(axes, cols):
            ax.plot(num.index, num[c], color=COLOR_REAL, linewidth=1)
            ax.set_ylabel(c, rotation=0, ha="right", va="center", fontsize=8)
        axes[0].set_title("Series temporales")
        guardar_figura(f"{nombre}_series", fig)

    n = len(num.columns)
    ncols = min(4, n)
    nrows = int(np.ceil(n / ncols))
    fig, axes = plt.subplots(nrows, ncols, figsize=(3.2 * ncols, 2.4 * nrows))
    for ax, c in zip(np.atleast_1d(axes).ravel(), num.columns):
        ax.hist(num[c].dropna(), bins=40, color=COLOR_REAL, edgecolor=SUPERFICIE, linewidth=0.5)
        ax.set_title(c, fontsize=9)
    for ax in np.atleast_1d(axes).ravel()[n:]:
        ax.set_visible(False)
    fig.suptitle("Distribuciones", fontweight="bold")
    guardar_figura(f"{nombre}_distribuciones", fig)

    # Pares de variables más correlacionados: punto de partida para modelar.
    pares = (corr.where(np.triu(np.ones(corr.shape, dtype=bool), k=1))
             .stack().rename("r").reset_index())
    pares["abs_r"] = pares["r"].abs()
    top = pares.sort_values("abs_r", ascending=False).head(10)
    salida = {
        "resumen": resumen.round(4),
        "correlaciones_principales": top[["level_0", "level_1", "r"]].round(3).to_dict(orient="records"),
        "faltantes_%": (num.isna().mean() * 100).round(2).to_dict(),
    }
    registrar(nombre, salida)
    return salida


# ---------------------------------------------------------------------------
# Regresión / Machine Learning
# ---------------------------------------------------------------------------

@dataclass
class ResultadoModelo:
    modelo: Any
    objetivo: str
    variables: list[str]
    metricas: dict
    importancia: pd.DataFrame
    X_train: pd.DataFrame
    y_train: pd.Series
    X_test: pd.DataFrame
    y_test: pd.Series
    residuos: np.ndarray
    advertencias: list[str] = field(default_factory=list)

    def predecir(self, X: pd.DataFrame) -> np.ndarray:
        return self.modelo.predict(X[self.variables])


def _construir_modelo(tipo: str, semilla: int):
    from sklearn.ensemble import GradientBoostingRegressor, RandomForestRegressor
    from sklearn.impute import SimpleImputer
    from sklearn.linear_model import LinearRegression, Ridge
    from sklearn.pipeline import make_pipeline
    from sklearn.preprocessing import StandardScaler

    tipos = {
        "lineal": lambda: make_pipeline(SimpleImputer(strategy="median"), StandardScaler(), LinearRegression()),
        "ridge": lambda: make_pipeline(SimpleImputer(strategy="median"), StandardScaler(), Ridge(alpha=1.0)),
        "random_forest": lambda: make_pipeline(
            SimpleImputer(strategy="median"),
            RandomForestRegressor(n_estimators=300, min_samples_leaf=3, n_jobs=-1, random_state=semilla)),
        "gradient_boosting": lambda: make_pipeline(
            SimpleImputer(strategy="median"),
            GradientBoostingRegressor(n_estimators=300, max_depth=3, learning_rate=0.05, random_state=semilla)),
    }
    if tipo not in tipos:
        raise ValueError(f"Modelo '{tipo}' no soportado. Opciones: {list(tipos)}")
    return tipos[tipo]()


def _metricas(y, yhat) -> dict:
    from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score

    y = np.asarray(y, dtype=float)
    yhat = np.asarray(yhat, dtype=float)
    nz = np.abs(y) > 1e-9
    return {
        "RMSE": float(np.sqrt(mean_squared_error(y, yhat))),
        "MAE": float(mean_absolute_error(y, yhat)),
        "R2": float(r2_score(y, yhat)),
        "MAPE_%": float(np.mean(np.abs((y[nz] - yhat[nz]) / y[nz])) * 100) if nz.any() else None,
    }


def agregar_rezagos(df: pd.DataFrame, columnas: list[str], rezagos: list[int]) -> pd.DataFrame:
    """Añade columnas `<col>_lag<k>` (útil cuando el efecto no es instantáneo)."""
    out = df.copy()
    for c in columnas:
        for k in rezagos:
            out[f"{c}_lag{k}"] = out[c].shift(k)
    return out


def entrenar_regresion(
    df: pd.DataFrame,
    objetivo: str,
    variables: list[str] | None = None,
    modelo: str = "random_forest",
    proporcion_test: float = 0.2,
    division_temporal: bool | None = None,
    semilla: int = 42,
    nombre: str = "regresion",
) -> ResultadoModelo:
    """Entrena un regresor, evalúa en test y calcula importancia por permutación.

    Si el índice es datetime la división train/test es cronológica (el test es
    el tramo final) para no filtrar información del futuro.
    """
    from sklearn.inspection import permutation_importance
    from sklearn.model_selection import train_test_split

    if variables is None:
        variables = [c for c in df.select_dtypes("number").columns if c != objetivo]
    datos = df[variables + [objetivo]].dropna(subset=[objetivo])
    advertencias: list[str] = []
    if len(datos) < 30:
        advertencias.append(f"Solo {len(datos)} observaciones con objetivo válido: métricas poco fiables.")

    if division_temporal is None:
        division_temporal = isinstance(datos.index, pd.DatetimeIndex)
    X, y = datos[variables], datos[objetivo]
    if division_temporal:
        corte = int(len(datos) * (1 - proporcion_test))
        X_train, X_test, y_train, y_test = X.iloc[:corte], X.iloc[corte:], y.iloc[:corte], y.iloc[corte:]
    else:
        X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=proporcion_test, random_state=semilla)

    est = _construir_modelo(modelo, semilla)
    est.fit(X_train, y_train)
    pred_train = est.predict(X_train)
    pred_test = est.predict(X_test)

    m_train = _metricas(y_train, pred_train)
    m_test = _metricas(y_test, pred_test)
    base = _metricas(y_test, np.full(len(y_test), y_train.mean()))
    metricas = {"modelo": modelo, "n_train": len(X_train), "n_test": len(X_test),
                "division": "temporal" if division_temporal else "aleatoria",
                "train": m_train, "test": m_test, "linea_base_media": base}

    if m_train["R2"] - m_test["R2"] > 0.15:
        advertencias.append(
            f"Posible sobreajuste: R² train {m_train['R2']:.2f} vs test {m_test['R2']:.2f}.")
    if m_test["RMSE"] >= base["RMSE"] * 0.95:
        advertencias.append("El modelo apenas mejora a predecir la media: capacidad predictiva débil.")

    pi = permutation_importance(est, X_test, y_test, n_repeats=10, random_state=semilla)
    importancia = (pd.DataFrame({"variable": variables, "importancia": pi.importances_mean,
                                 "desv": pi.importances_std})
                   .sort_values("importancia", ascending=False).reset_index(drop=True))
    positiva = importancia["importancia"].clip(lower=0)
    importancia["relativa_%"] = (positiva / positiva.sum() * 100) if positiva.sum() > 0 else 0.0
    if modelo in ("lineal", "ridge"):
        coefs = est[-1].coef_
        escalas = est[1].scale_
        # Coeficiente en unidades originales: cambio en objetivo por unidad de la variable.
        importancia["coef_unidades_originales"] = importancia["variable"].map(
            dict(zip(variables, coefs / escalas)))

    residuos = np.asarray(y_test) - pred_test
    advertencias += _diagnostico_residuos(residuos, division_temporal)

    # Gráfico 1: real vs predicho en el tiempo (o dispersión si no hay tiempo).
    fig, ax = plt.subplots(figsize=(11, 4))
    if division_temporal and isinstance(X_test.index, pd.DatetimeIndex):
        ax.plot(y_test.index, y_test.values, color=COLOR_REAL, label="Real", linewidth=1.4)
        ax.plot(y_test.index, pred_test, color=COLOR_MODELO, label="Predicho", linewidth=1.4)
        ax.set_ylabel(objetivo)
        ax.legend(loc="upper left")
    else:
        ax.scatter(y_test, pred_test, s=14, color=COLOR_REAL, alpha=0.6)
        lim = [min(y_test.min(), pred_test.min()), max(y_test.max(), pred_test.max())]
        ax.plot(lim, lim, color=TINTA_SECUNDARIA, linewidth=1, linestyle="--")
        ax.set_xlabel(f"{objetivo} real")
        ax.set_ylabel(f"{objetivo} predicho")
    ax.set_title(f"{objetivo}: real vs predicho (test)  ·  RMSE {m_test['RMSE']:.3g}  ·  R² {m_test['R2']:.3f}")
    guardar_figura(f"{nombre}_prediccion", fig)

    # Gráfico 2: importancia de variables.
    imp = importancia.head(15).iloc[::-1]
    fig, ax = plt.subplots(figsize=(8, 0.35 * len(imp) + 1.2))
    ax.barh(imp["variable"], imp["importancia"], xerr=imp["desv"], color=COLOR_REAL,
            error_kw={"ecolor": TINTA_SECUNDARIA, "elinewidth": 1})
    ax.set_xlabel("Pérdida de R² al permutar la variable")
    ax.set_title(f"Importancia de variables para {objetivo}")
    ax.grid(axis="y", visible=False)
    guardar_figura(f"{nombre}_importancia", fig)

    resultado = ResultadoModelo(est, objetivo, variables, metricas, importancia,
                                X_train, y_train, X_test, y_test, residuos, advertencias)
    registrar(nombre, {"metricas": metricas, "importancia": importancia.round(5),
                       "advertencias": advertencias})
    return resultado


def comparar_modelos(df: pd.DataFrame, objetivo: str, variables: list[str] | None = None,
                     modelos: tuple[str, ...] = ("lineal", "random_forest", "gradient_boosting"),
                     nombre: str = "comparacion_modelos") -> tuple[pd.DataFrame, ResultadoModelo]:
    """Entrena varios modelos y devuelve la tabla comparativa y el mejor (menor RMSE test)."""
    filas, resultados = [], {}
    for m in modelos:
        r = entrenar_regresion(df, objetivo, variables, modelo=m, nombre=f"{nombre}_{m}")
        resultados[m] = r
        filas.append({"modelo": m, **{f"test_{k}": v for k, v in r.metricas["test"].items()},
                      "train_R2": r.metricas["train"]["R2"]})
    tabla = pd.DataFrame(filas).sort_values("test_RMSE").reset_index(drop=True)
    guardar_tabla(tabla, nombre)
    mejor = resultados[tabla.loc[0, "modelo"]]
    registrar(nombre, {"tabla": tabla.round(4), "mejor": tabla.loc[0, "modelo"]})
    return tabla, mejor


def _diagnostico_residuos(residuos: np.ndarray, temporal: bool) -> list[str]:
    from scipy import stats
    from statsmodels.stats.stattools import durbin_watson

    avisos = []
    r = residuos[np.isfinite(residuos)]
    if len(r) < 20:
        return avisos
    if temporal:
        dw = durbin_watson(r)
        if dw < 1.5 or dw > 2.5:
            avisos.append(f"Residuos autocorrelacionados (Durbin-Watson={dw:.2f}): el modelo no captura "
                          "toda la dinámica temporal; considere rezagos o un modelo de series de tiempo.")
    muestra = r if len(r) <= 5000 else np.random.default_rng(0).choice(r, 5000, replace=False)
    _, p = stats.normaltest(muestra)
    if p < 0.01:
        avisos.append("Residuos no normales (D'Agostino p<0.01): los intervalos basados en normalidad "
                      "pueden ser engañosos.")
    mitad = len(r) // 2
    if mitad > 10:
        ratio = np.var(r[mitad:]) / max(np.var(r[:mitad]), 1e-12)
        if ratio > 2 or ratio < 0.5:
            avisos.append(f"La varianza del error cambia en el periodo de test (ratio {ratio:.2f}): "
                          "posible heterocedasticidad o cambio de régimen.")
    return avisos


# ---------------------------------------------------------------------------
# Forecasting
# ---------------------------------------------------------------------------

@dataclass
class ResultadoPronostico:
    serie: pd.Series
    pronostico: pd.DataFrame  # columnas: media, inf, sup
    metodo: str
    metricas_backtest: dict
    advertencias: list[str] = field(default_factory=list)


_PERIODOS = {"h": 24, "D": 7, "B": 5, "W": 52, "M": 12, "MS": 12, "ME": 12, "Q": 4, "QS": 4, "QE": 4}


def _periodo_estacional(idx: pd.DatetimeIndex) -> int | None:
    freq = idx.freqstr or pd.infer_freq(idx)
    if not freq:
        return None
    base = "".join(ch for ch in freq if not ch.isdigit()).split("-")[0]
    base = {"H": "h", "T": "min", "min": "min"}.get(base, base)
    if base == "min":
        return None
    return _PERIODOS.get(base)


def _ajustar_y_pronosticar(y: pd.Series, horizonte: int, metodo: str, s: int | None, alpha: float):
    warnings.filterwarnings("ignore")
    if metodo == "ets":
        from statsmodels.tsa.exponential_smoothing.ets import ETSModel

        estacional = "add" if s and len(y) >= 2 * s else None
        mod = ETSModel(y, error="add", trend="add", damped_trend=True, seasonal=estacional,
                       seasonal_periods=s if estacional else None)
        fit = mod.fit(disp=False, maxiter=200)
        pred = fit.get_prediction(start=len(y), end=len(y) + horizonte - 1)
        sf = pred.summary_frame(alpha=alpha)
        return sf["mean"].values, sf["pi_lower"].values, sf["pi_upper"].values
    if metodo == "sarimax":
        from statsmodels.tsa.statespace.sarimax import SARIMAX

        estacional = (1, 1, 1, s) if s and len(y) >= 3 * s else (0, 0, 0, 0)
        mod = SARIMAX(y, order=(1, 0, 1), seasonal_order=estacional, trend="c",
                      enforce_stationarity=False, enforce_invertibility=False)
        fit = mod.fit(disp=False, maxiter=100)
        fc = fit.get_forecast(horizonte)
        ci = fc.conf_int(alpha=alpha)
        return fc.predicted_mean.values, ci.iloc[:, 0].values, ci.iloc[:, 1].values
    if metodo == "prophet":
        from prophet import Prophet  # dependencia opcional

        dfp = pd.DataFrame({"ds": y.index, "y": y.values})
        m = Prophet(interval_width=1 - alpha)
        m.fit(dfp)
        futuro = m.make_future_dataframe(periods=horizonte, freq=y.index.freqstr, include_history=False)
        fc = m.predict(futuro)
        return fc["yhat"].values, fc["yhat_lower"].values, fc["yhat_upper"].values
    raise ValueError(f"Método '{metodo}' no soportado (ets, sarimax, prophet, auto)")


def pronosticar(
    serie: pd.Series,
    horizonte: int,
    metodo: str = "auto",
    frecuencia: str | None = None,
    periodo_estacional: int | None = None,
    alpha: float = 0.05,
    max_puntos: int = 3000,
    nombre: str = "pronostico",
) -> ResultadoPronostico:
    """Pronóstico con bandas de confianza (1-alpha) y backtest sobre el tramo final.

    metodo='auto' compara ETS y SARIMAX en el backtest y se queda con el menor RMSE.
    """
    if not isinstance(serie.index, pd.DatetimeIndex):
        raise ValueError("La serie necesita índice datetime.")
    advertencias: list[str] = []
    y = serie.sort_index()
    if frecuencia:
        y = y.resample(frecuencia).mean()
    elif pd.infer_freq(y.index[: min(len(y), 500)]) is None:
        freq = pd.Series(y.index).diff().median()
        y = y.resample(freq).mean()
        advertencias.append(f"Serie irregular: se re-muestreó a paso {freq}.")
    else:
        y = y.asfreq(pd.infer_freq(y.index[: min(len(y), 500)]))
    huecos = int(y.isna().sum())
    if huecos:
        y = y.interpolate(limit_direction="both")
        advertencias.append(f"Se interpolaron {huecos} valores faltantes ({huecos / len(y):.1%}).")
    if len(y) > max_puntos:
        y = y.iloc[-max_puntos:]
        advertencias.append(f"Se usaron solo las últimas {max_puntos} observaciones para ajustar.")

    s = periodo_estacional or _periodo_estacional(y.index)
    candidatos = ["ets", "sarimax"] if metodo == "auto" else [metodo]

    h_bt = min(horizonte, max(len(y) // 5, 1))
    entrenamiento, prueba = y.iloc[:-h_bt], y.iloc[-h_bt:]
    backtest: dict[str, dict] = {}
    for m in candidatos:
        try:
            media, inf, sup = _ajustar_y_pronosticar(entrenamiento, h_bt, m, s, alpha)
            met = _metricas(prueba.values, media)
            met["cobertura_intervalo_%"] = float(np.mean((prueba.values >= inf) & (prueba.values <= sup)) * 100)
            backtest[m] = met
        except Exception as exc:  # noqa: BLE001 - se reporta y se prueba el siguiente
            advertencias.append(f"{m} falló en backtest: {exc}")
    if not backtest:
        raise RuntimeError("Ningún método de pronóstico pudo ajustarse: " + "; ".join(advertencias))
    elegido = min(backtest, key=lambda k: backtest[k]["RMSE"])

    media, inf, sup = _ajustar_y_pronosticar(y, horizonte, elegido, s, alpha)
    idx_fut = pd.date_range(y.index[-1], periods=horizonte + 1, freq=y.index.freq)[1:]
    fc = pd.DataFrame({"media": media, "inf": inf, "sup": sup}, index=idx_fut)

    cob = backtest[elegido]["cobertura_intervalo_%"]
    if cob < (1 - alpha) * 100 - 15:
        advertencias.append(f"Las bandas del {int((1 - alpha) * 100)}% solo cubrieron el {cob:.0f}% del "
                            "backtest: la incertidumbre real es mayor que la estimada.")
    if horizonte > 2 * h_bt:
        advertencias.append("El horizonte supera ampliamente el tramo validado: la precisión lejana es "
                            "desconocida.")
    try:
        from statsmodels.tsa.stattools import adfuller

        p_adf = adfuller(y.values[-min(len(y), 2000):], autolag="AIC")[1]
        if p_adf > 0.05:
            advertencias.append(f"Serie no estacionaria (ADF p={p_adf:.2f}): tendencia o cambios de nivel.")
    except Exception:  # noqa: BLE001
        pass

    historia = y.iloc[-min(len(y), max(4 * horizonte, 200)):]
    fig, ax = plt.subplots(figsize=(11, 4))
    ax.plot(historia.index, historia.values, color=COLOR_REAL, linewidth=1.2, label="Histórico")
    ax.plot(fc.index, fc["media"], color=COLOR_MODELO, linewidth=2, label=f"Pronóstico ({elegido})")
    ax.fill_between(fc.index, fc["inf"], fc["sup"], color=COLOR_MODELO, alpha=0.18, linewidth=0,
                    label=f"Banda {int((1 - alpha) * 100)}%")
    ax.set_ylabel(serie.name or "valor")
    ax.set_title(f"Pronóstico de {serie.name or 'la serie'} · {horizonte} pasos")
    ax.legend(loc="upper left")
    guardar_figura(f"{nombre}_prediccion", fig)
    guardar_tabla(fc, nombre)

    registrar(nombre, {"metodo": elegido, "periodo_estacional": s, "backtest": backtest,
                       "resumen_pronostico": fc.describe().round(4), "advertencias": advertencias})
    return ResultadoPronostico(y, fc, elegido, backtest, advertencias)


# ---------------------------------------------------------------------------
# Simulación: What-If, sensibilidad y Monte Carlo
# ---------------------------------------------------------------------------

def _fuera_de_rango(res: ResultadoModelo, X: pd.DataFrame) -> dict:
    fuera = {}
    for c in res.variables:
        lo, hi = res.X_train[c].min(), res.X_train[c].max()
        frac = float(((X[c] < lo) | (X[c] > hi)).mean())
        if frac > 0:
            fuera[c] = round(frac * 100, 1)
    return fuera


def que_pasa_si(
    res: ResultadoModelo,
    cambios: dict[str, float],
    modo: str = "multiplicativo",
    base: pd.DataFrame | None = None,
    umbral: float | None = None,
    nombre: str = "what_if",
) -> dict:
    """Escenario paramétrico: aplica `cambios` a las variables y compara predicciones.

    modo='multiplicativo': {"turbidez": 1.30} -> +30 %.
    modo='aditivo':        {"turbidez": 5}    -> +5 unidades.
    Las variables no listadas se mantienen (ceteris paribus), lo que ignora
    correlaciones reales entre ellas: se advierte en el resultado.
    """
    X0 = (base if base is not None else pd.concat([res.X_train, res.X_test]))[res.variables].copy()
    X1 = X0.copy()
    for var, v in cambios.items():
        if var not in X1.columns:
            raise KeyError(f"'{var}' no es una variable del modelo: {res.variables}")
        X1[var] = X1[var] * v if modo == "multiplicativo" else X1[var] + v
    y0, y1 = res.predecir(X0), res.predecir(X1)

    advertencias = [
        "Supuesto ceteris paribus: el resto de variables se mantiene fijo aunque en la planta suelan "
        "moverse juntas (p. ej., más turbidez suele venir con más caudal tras lluvias)."]
    fuera = _fuera_de_rango(res, X1)
    if fuera:
        advertencias.append("Extrapolación: % de filas del escenario fuera del rango de entrenamiento -> "
                            + ", ".join(f"{k}: {v}%" for k, v in fuera.items())
                            + ". Los modelos de árboles no extrapolan (se aplanan) y los lineales "
                              "extrapolan sin límite físico.")
    salida = {
        "cambios": cambios, "modo": modo, "objetivo": res.objetivo,
        "base_media": float(np.mean(y0)), "escenario_media": float(np.mean(y1)),
        "delta_media": float(np.mean(y1 - y0)),
        "delta_%": float((np.mean(y1) - np.mean(y0)) / abs(np.mean(y0)) * 100) if np.mean(y0) else None,
        "base_p95": float(np.percentile(y0, 95)), "escenario_p95": float(np.percentile(y1, 95)),
        "advertencias": advertencias,
    }
    if umbral is not None:
        salida["umbral"] = umbral
        salida["base_%_sobre_umbral"] = float(np.mean(y0 > umbral) * 100)
        salida["escenario_%_sobre_umbral"] = float(np.mean(y1 > umbral) * 100)

    fig, ax = plt.subplots(figsize=(9, 4))
    bins = np.histogram_bin_edges(np.concatenate([y0, y1]), bins=50)
    ax.hist(y0, bins=bins, color=COLOR_REAL, alpha=0.55, label="Base", edgecolor=SUPERFICIE, linewidth=0.4)
    ax.hist(y1, bins=bins, color=COLOR_MODELO, alpha=0.55, label="Escenario", edgecolor=SUPERFICIE,
            linewidth=0.4)
    if umbral is not None:
        ax.axvline(umbral, color=TINTA, linestyle="--", linewidth=1)
        ax.annotate(f"umbral {umbral:g}", (umbral, ax.get_ylim()[1] * 0.92), xytext=(4, 0),
                    textcoords="offset points", color=TINTA_SECUNDARIA, fontsize=9)
    desc = ", ".join(f"{k} {'×' if modo == 'multiplicativo' else '+'}{v:g}" for k, v in cambios.items())
    ax.set_title(f"What-If ({desc}) · {res.objetivo}: {salida['base_media']:.3g} → {salida['escenario_media']:.3g}")
    ax.set_xlabel(f"{res.objetivo} predicho")
    ax.set_ylabel("Frecuencia")
    ax.legend(loc="upper right")
    guardar_figura(f"{nombre}_distribucion", fig)
    registrar(nombre, salida)
    return salida


def sensibilidad(
    res: ResultadoModelo,
    variable: str,
    variaciones_pct: list[float] | None = None,
    base: pd.DataFrame | None = None,
    nombre: str = "sensibilidad",
) -> pd.DataFrame:
    """Barrido de una variable (p. ej. -50 % … +50 %) y respuesta media del objetivo."""
    variaciones_pct = variaciones_pct or list(range(-50, 55, 10))
    X0 = (base if base is not None else pd.concat([res.X_train, res.X_test]))[res.variables]
    filas = []
    for p in variaciones_pct:
        X1 = X0.copy()
        X1[variable] = X1[variable] * (1 + p / 100)
        yhat = res.predecir(X1)
        filas.append({"variacion_%": p, "media": np.mean(yhat), "p05": np.percentile(yhat, 5),
                      "p95": np.percentile(yhat, 95),
                      "fuera_rango_%": _fuera_de_rango(res, X1).get(variable, 0.0)})
    tabla = pd.DataFrame(filas)
    fig, ax = plt.subplots(figsize=(8, 4))
    ax.fill_between(tabla["variacion_%"], tabla["p05"], tabla["p95"], color=COLOR_REAL, alpha=0.15,
                    linewidth=0, label="P5–P95")
    ax.plot(tabla["variacion_%"], tabla["media"], color=COLOR_REAL, marker="o", markersize=5, label="Media")
    extrap = tabla[tabla["fuera_rango_%"] > 20]
    if len(extrap):
        ax.scatter(extrap["variacion_%"], extrap["media"], s=60, facecolors="none",
                   edgecolors=COLOR_MODELO, linewidths=2, label=">20 % filas extrapoladas", zorder=3)
    ax.set_xlabel(f"Variación de {variable} (%)")
    ax.set_ylabel(f"{res.objetivo} predicho")
    ax.set_title(f"Sensibilidad de {res.objetivo} a {variable}")
    ax.legend(loc="best")
    guardar_figura(f"{nombre}_{variable}", fig)
    guardar_tabla(tabla, f"{nombre}_{variable}")
    registrar(f"{nombre}_{variable}", tabla.round(4))
    return tabla


def _muestrear(dist: tuple, n: int, rng: np.random.Generator) -> np.ndarray:
    tipo, *p = dist
    if tipo == "normal":
        return rng.normal(p[0], p[1], n)
    if tipo == "lognormal":  # p = (media, desviación) en unidades reales
        media, desv = p
        sigma2 = np.log(1 + (desv / media) ** 2)
        return rng.lognormal(np.log(media) - sigma2 / 2, np.sqrt(sigma2), n)
    if tipo == "uniforme":
        return rng.uniform(p[0], p[1], n)
    if tipo == "triangular":
        return rng.triangular(p[0], p[1], p[2], n)
    raise ValueError(f"Distribución '{tipo}' no soportada (normal, lognormal, uniforme, triangular)")


def monte_carlo(
    res: ResultadoModelo,
    n: int = 5000,
    distribuciones: dict[str, tuple] | None = None,
    factores: dict[str, float] | None = None,
    umbral: float | None = None,
    incluir_error_modelo: bool = True,
    semilla: int = 42,
    nombre: str = "monte_carlo",
) -> dict:
    """Simulación Monte Carlo sobre el modelo entrenado.

    Parte de un bootstrap de filas históricas (conserva las correlaciones
    reales entre variables). Encima:
      - `factores`: multiplica variables (escenario, p. ej. {"turbidez": 1.3}).
      - `distribuciones`: reemplaza variables por una distribución
        ("normal", media, sd) | ("lognormal", media, sd) | ("uniforme", a, b) | ("triangular", a, moda, b).
      - `incluir_error_modelo`: suma residuos de test re-muestreados (incertidumbre predictiva).
    """
    rng = np.random.default_rng(semilla)
    historico = pd.concat([res.X_train, res.X_test])[res.variables]
    X = historico.sample(n=n, replace=True, random_state=semilla).reset_index(drop=True)
    for var, f in (factores or {}).items():
        X[var] = X[var] * f
    for var, dist in (distribuciones or {}).items():
        X[var] = _muestrear(dist, n, rng)
    y = res.predecir(X)
    if incluir_error_modelo and len(res.residuos):
        y = y + rng.choice(res.residuos[np.isfinite(res.residuos)], n, replace=True)

    pct = {f"P{q}": float(np.percentile(y, q)) for q in (5, 25, 50, 75, 95)}
    salida: dict[str, Any] = {"n": n, "objetivo": res.objetivo, "media": float(np.mean(y)),
                              "desv": float(np.std(y)), **pct,
                              "factores": factores or {}, "distribuciones": {k: list(v) for k, v in
                                                                             (distribuciones or {}).items()}}
    if umbral is not None:
        p = float(np.mean(y > umbral))
        ee = np.sqrt(p * (1 - p) / n)
        salida["umbral"] = umbral
        salida["prob_superar_umbral"] = p
        salida["IC95_prob"] = [float(max(0.0, p - 1.96 * ee)), float(min(1.0, p + 1.96 * ee))]
    fuera = _fuera_de_rango(res, X)
    salida["advertencias"] = ([f"Extrapolación en: {fuera} (% de simulaciones fuera del rango entrenado)."]
                              if fuera else [])
    if distribuciones:
        salida["advertencias"].append(
            "Las variables con distribución explícita se muestrean independientes del resto: se pierde su "
            "correlación con las demás variables.")

    fig, ax = plt.subplots(figsize=(9, 4))
    ax.hist(y, bins=60, color=COLOR_REAL, edgecolor=SUPERFICIE, linewidth=0.4)
    for q, v in (("P5", pct["P5"]), ("P50", pct["P50"]), ("P95", pct["P95"])):
        ax.axvline(v, color=TINTA_SECUNDARIA, linewidth=1, linestyle=":")
        ax.annotate(q, (v, ax.get_ylim()[1] * 0.95), xytext=(3, 0), textcoords="offset points",
                    fontsize=8, color=TINTA_SECUNDARIA)
    if umbral is not None:
        ax.axvline(umbral, color=COLOR_MODELO, linewidth=2)
        ax.annotate(f"umbral {umbral:g} · P(>umbral) = {salida['prob_superar_umbral']:.1%}",
                    (umbral, ax.get_ylim()[1] * 0.82), xytext=(5, 0), textcoords="offset points",
                    fontsize=9, color=TINTA)
    ax.set_title(f"Monte Carlo ({n:,} simulaciones) · {res.objetivo}")
    ax.set_xlabel(f"{res.objetivo} simulado")
    ax.set_ylabel("Frecuencia")
    guardar_figura(f"{nombre}_distribucion", fig)
    registrar(nombre, salida)
    return salida
