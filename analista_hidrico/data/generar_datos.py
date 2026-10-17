"""Genera data/sample_water_flow.csv: 90 días horarios de una planta potabilizadora.

Las relaciones están definidas a mano (ver RELACIONES), así que el conjunto
sirve también como primer caso de validación: el agente debería redescubrirlas.

Uso: python data/generar_datos.py
"""

from pathlib import Path

import numpy as np
import pandas as pd

RELACIONES = """
- turbidez_tratada_NTU depende de turbidez_cruda_NTU (+), dosis_coagulante_mgL (-, efecto exponencial)
  y caudal_entrada_m3h (+, menor tiempo de residencia).
- Los eventos de lluvia elevan turbidez_cruda_NTU y caudal_entrada_m3h a la vez y diluyen la conductividad.
- La dosis de coagulante sigue a la turbidez cruda con 2 h de retraso (control manual) y se queda corta
  en los picos: ahí la turbidez tratada supera 1 NTU.
- energia_bombeo_kWh ≈ 0.32 · caudal_entrada_m3h.
- cloro_residual_mgL baja con la temperatura del agua y con la turbidez tratada.
"""


def generar(dias: int = 90, semilla: int = 7) -> pd.DataFrame:
    rng = np.random.default_rng(semilla)
    idx = pd.date_range("2026-01-01", periods=dias * 24, freq="h")
    n = len(idx)
    hora = idx.hour.values
    t = np.arange(n)

    # Eventos de lluvia: impulso con decaimiento exponencial.
    lluvia = np.zeros(n)
    for inicio in rng.choice(np.arange(48, n - 72), size=9, replace=False):
        intensidad = rng.uniform(0.5, 1.0)
        dur = np.arange(n - inicio)
        lluvia[inicio:] += intensidad * np.exp(-dur / rng.uniform(10, 30))
    lluvia = np.clip(lluvia, 0, 1.5)

    diario = np.sin(2 * np.pi * (hora - 6) / 24)
    fin_semana = np.isin(idx.dayofweek, [5, 6]).astype(float)
    caudal = 850 + 110 * diario - 45 * fin_semana + 160 * lluvia + rng.normal(0, 18, n)

    turb_cruda = 11 * np.exp(rng.normal(0, 0.18, n)) + 140 * lluvia ** 1.3
    temperatura = 17.5 + 3.0 * np.sin(2 * np.pi * t / (24 * 120)) + 0.6 * diario + rng.normal(0, 0.15, n)
    ph = 7.45 - 0.0035 * turb_cruda + rng.normal(0, 0.05, n)
    conductividad = 430 - 0.9 * (turb_cruda - 11) + rng.normal(0, 8, n)

    turb_retrasada = pd.Series(turb_cruda).shift(2).bfill().values
    dosis = np.clip(9 + 0.22 * turb_retrasada - 0.0006 * turb_retrasada ** 2, 6, 40) + rng.normal(0, 0.6, n)

    turb_tratada = (0.10 + 0.045 * turb_cruda * np.exp(-0.085 * dosis)
                    + 0.00045 * (caudal - 800)) * np.exp(rng.normal(0, 0.08, n))
    turb_tratada = np.clip(turb_tratada, 0.05, None)

    cloro = 1.25 - 0.035 * (temperatura - 17.5) - 0.25 * turb_tratada + rng.normal(0, 0.05, n)
    energia = 0.32 * caudal + rng.normal(0, 6, n)

    df = pd.DataFrame({
        "fecha": idx,
        "caudal_entrada_m3h": caudal.round(1),
        "turbidez_cruda_NTU": turb_cruda.round(2),
        "ph_crudo": ph.round(2),
        "temperatura_agua_C": temperatura.round(2),
        "conductividad_uScm": conductividad.round(1),
        "dosis_coagulante_mgL": dosis.round(2),
        "turbidez_tratada_NTU": turb_tratada.round(3),
        "cloro_residual_mgL": cloro.round(3),
        "energia_bombeo_kWh": energia.round(1),
    })
    # ~1 % de faltantes en sensores de calidad, como en un SCADA real.
    for col in ["turbidez_cruda_NTU", "ph_crudo", "cloro_residual_mgL"]:
        df.loc[rng.random(n) < 0.01, col] = np.nan
    return df


if __name__ == "__main__":
    salida = Path(__file__).with_name("sample_water_flow.csv")
    generar().to_csv(salida, index=False)
    print(f"Escrito {salida}")
