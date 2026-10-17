"""Interfaz web (Streamlit) del Analista Hídrico.

Local:    streamlit run src/app_web.py
Railway:  ver Dockerfile y README (variables ANTHROPIC_API_KEY y APP_PASSWORD).

Cada sesión del navegador tiene su propia carpeta de salida y su propio
agente. En la web los scripts se ejecutan sin confirmación (el sandbox es la
barrera); el código de cada uno queda visible y descargable.
"""

from __future__ import annotations

import hmac
import os
import shutil
import sys
import time
import uuid
import zipfile
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import anthropic  # noqa: E402
import streamlit as st  # noqa: E402

from agent import MODELO_POR_DEFECTO, AgenteAnalista, Callbacks  # noqa: E402
from ingestion import PerfilDataset, cargar  # noqa: E402
from sandbox_runner import ResultadoEjecucion, SandboxRunner  # noqa: E402

RAIZ = Path(__file__).resolve().parent.parent
CARPETA_SESIONES = Path(os.environ.get("CARPETA_SESIONES", RAIZ / "output" / "sesiones"))
MAX_MENSAJES = int(os.environ.get("MAX_MENSAJES_POR_SESION", "40"))
MAX_MB_ARCHIVO = int(os.environ.get("MAX_MB_ARCHIVO", "50"))
HORAS_RETENCION = float(os.environ.get("HORAS_RETENCION_SESIONES", "24"))
MEMORIA_SANDBOX_MB = int(os.environ.get("SANDBOX_MEMORIA_MB", "3072"))
TIMEOUT_SANDBOX_S = int(os.environ.get("SANDBOX_TIMEOUT_S", "300"))
EJEMPLO = RAIZ / "data" / "sample_water_flow.csv"

st.set_page_config(page_title="Analista Hídrico", page_icon="💧", layout="wide")


# --------------------------------------------------------------------------- acceso

def verificar_acceso() -> bool:
    clave = os.environ.get("APP_PASSWORD")
    if not clave:
        if os.environ.get("PERMITIR_SIN_CLAVE") == "1":
            return True
        st.error("Falta la variable de entorno APP_PASSWORD. Defínala (o PERMITIR_SIN_CLAVE=1 solo para "
                 "uso local) y reinicie la app.")
        return False
    if st.session_state.get("autenticado"):
        return True
    st.title("💧 Analista Hídrico")
    with st.form("login"):
        intento = st.text_input("Contraseña", type="password")
        if st.form_submit_button("Entrar"):
            if hmac.compare_digest(intento.encode(), clave.encode()):
                st.session_state.autenticado = True
                st.rerun()
            time.sleep(1)  # frena intentos por fuerza bruta
            st.error("Contraseña incorrecta.")
    return False


def limpiar_sesiones_antiguas() -> None:
    if not CARPETA_SESIONES.exists():
        return
    limite = time.time() - HORAS_RETENCION * 3600
    for carpeta in CARPETA_SESIONES.iterdir():
        if carpeta.is_dir() and carpeta.stat().st_mtime < limite:
            shutil.rmtree(carpeta, ignore_errors=True)


# --------------------------------------------------------------------------- estado

def estado():
    ss = st.session_state
    if "id" not in ss:
        ss.id = f"{datetime.now():%Y%m%d_%H%M%S}_{uuid.uuid4().hex[:8]}"
        ss.carpeta = CARPETA_SESIONES / ss.id
        ss.carpeta.mkdir(parents=True, exist_ok=True)
        ss.agente = None
        ss.perfil = None
        ss.df = None
        ss.chat = []          # elementos {"rol": "user"|"assistant", "texto": str} o {"rol": "run", ...}
        ss.mensajes = 0
        ss.conclusion = None
    return ss


def cargar_dataset(fuente: str, contexto: str, hoja) -> None:
    ss = estado()
    df, perfil = cargar(fuente, hoja)
    runner = SandboxRunner(df, ss.carpeta / "salidas", timeout_s=TIMEOUT_SANDBOX_S, memoria_mb=MEMORIA_SANDBOX_MB)
    ss.df, ss.perfil = df, perfil
    ss.agente = AgenteAnalista(perfil, runner, modelo=os.environ.get("AGENTE_MODELO", MODELO_POR_DEFECTO),
                               esfuerzo=os.environ.get("AGENTE_ESFUERZO", "high"))
    ss.chat, ss.mensajes, ss.conclusion = [], 0, None
    ss.contexto = contexto
    ss.pendiente = ("proponer", contexto)


# --------------------------------------------------------------------------- vistas

def mostrar_ejecucion(item: dict) -> None:
    icono = "✅" if item["ok"] else "❌"
    with st.expander(f"{icono} {item['objetivo']} · {item['duracion']:.1f}s", expanded=not item["ok"]):
        st.code(item["codigo"], language="python")
        if item["stdout"].strip():
            st.text(item["stdout"][-4000:])
        if not item["ok"] and item["stderr"].strip():
            st.error(item["stderr"][-3000:])
    for png in item["graficos"]:
        if Path(png).exists():
            st.image(png, caption=Path(png).name)


def mostrar_chat() -> None:
    for item in estado().chat:
        if item["rol"] == "run":
            with st.chat_message("assistant", avatar="🧪"):
                mostrar_ejecucion(item)
        else:
            with st.chat_message(item["rol"], avatar="🧑‍🔧" if item["rol"] == "user" else "💧"):
                st.markdown(item["texto"])


def ejecutar_turno(accion: str, texto: str = "") -> bool:
    """Corre un turno del agente mostrando texto y ejecuciones en vivo. True si terminó sin error."""
    ss = estado()
    agente: AgenteAnalista = ss.agente
    bloque = {"texto": "", "caja": None}

    def nueva_caja():
        bloque["texto"] = ""
        bloque["caja"] = st.chat_message("assistant", avatar="💧").empty()

    def on_texto(t: str) -> None:
        if bloque["caja"] is None:
            nueva_caja()
        bloque["texto"] += t
        bloque["caja"].markdown(bloque["texto"] + "▌")

    def cerrar_texto() -> None:
        if bloque["caja"] is not None and bloque["texto"].strip():
            bloque["caja"].markdown(bloque["texto"])
            ss.chat.append({"rol": "assistant", "texto": bloque["texto"]})
        bloque["caja"] = None

    pendientes: dict = {}

    def on_aprobar(objetivo: str, codigo: str) -> bool:
        pendientes["codigo"] = codigo
        return True

    def on_inicio(objetivo: str) -> None:
        cerrar_texto()
        pendientes["status"] = st.status(f"Ejecutando: {objetivo}", expanded=False)
        pendientes["objetivo"] = objetivo

    def on_resultado(r: ResultadoEjecucion) -> None:
        if pendientes.get("status"):
            pendientes["status"].update(label=f"{'✅' if r.ok else '❌'} {pendientes['objetivo']}",
                                        state="complete" if r.ok else "error")
        item = {"rol": "run", "objetivo": pendientes.get("objetivo", "análisis"),
                "codigo": pendientes.get("codigo", ""), "ok": r.ok, "duracion": r.duracion_s,
                "stdout": r.stdout, "stderr": r.stderr, "graficos": [str(p) for p in r.graficos]}
        ss.chat.append(item)
        with st.chat_message("assistant", avatar="🧪"):
            mostrar_ejecucion(item)

    def on_aviso(m: str) -> None:
        cerrar_texto()
        st.warning(m)
        ss.chat.append({"rol": "assistant", "texto": f"⚠️ {m}"})

    agente.callbacks = Callbacks(texto=on_texto, aprobar_codigo=on_aprobar, inicio_ejecucion=on_inicio,
                                 resultado_ejecucion=on_resultado, aviso=on_aviso)
    try:
        if accion == "proponer":
            agente.proponer(texto)
        elif accion == "concluir":
            ss.conclusion = agente.concluir()
        else:
            agente.conversar(texto)
        ss.mensajes += 1
        return True
    except anthropic.AuthenticationError:
        st.error("La clave de Anthropic del servidor no es válida (variable ANTHROPIC_API_KEY).")
    except anthropic.RateLimitError:
        st.error("Límite de uso de la API alcanzado. Espere un momento y reintente.")
    except anthropic.APIStatusError as exc:
        st.error(f"Error de la API ({exc.status_code}): {exc.message}")
    except anthropic.APIConnectionError:
        st.error("No hay conexión con la API de Anthropic.")
    finally:
        cerrar_texto()
    return False


def tab_datos(perfil: PerfilDataset) -> None:
    c1, c2, c3 = st.columns(3)
    c1.metric("Filas", f"{perfil.filas:,}")
    c2.metric("Variables", perfil.columnas)
    c3.metric("Frecuencia", perfil.frecuencia or "sin tiempo")
    if perfil.indice_temporal:
        st.caption(f"Serie temporal '{perfil.indice_temporal}': {perfil.inicio} → {perfil.fin} · "
                   f"{perfil.huecos_temporales} huecos · {perfil.duplicados_temporales} duplicados")
    st.dataframe(
        [{"Variable": v.nombre, "Categoría": v.categoria, "Tipo": v.tipo, "Faltantes %": round(v.faltantes_pct, 1),
          "Mín": v.minimo, "Media": v.media, "Máx": v.maximo} for v in perfil.variables],
        use_container_width=True, hide_index=True)
    for aviso in perfil.avisos:
        st.warning(aviso)
    with st.expander("Vista previa de los datos"):
        st.dataframe(estado().df.head(200), use_container_width=True)


def tab_resultados() -> None:
    ss = estado()
    salidas = ss.carpeta / "salidas"
    graficos = sorted(p for p in salidas.rglob("*.png") if ".sandbox" not in p.parts)
    tablas = sorted(p for p in salidas.rglob("*.csv") if ".sandbox" not in p.parts)

    st.subheader("Conclusión operativa")
    if ss.conclusion:
        st.markdown(ss.conclusion)
        st.download_button("Descargar conclusión (.md)", ss.conclusion, file_name="conclusion_operativa.md")
    else:
        st.caption("Pídala con el botón «Generar conclusión operativa» del panel lateral.")

    if ss.agente is not None and ss.agente.ejecuciones:
        if st.button("Preparar ZIP con todos los resultados"):
            with zipfile.ZipFile(ss.carpeta / "resultados.zip", "w", zipfile.ZIP_DEFLATED) as zf:
                for f in salidas.rglob("*"):
                    if f.is_file() and ".sandbox" not in f.parts:
                        zf.write(f, f.relative_to(salidas))
                if ss.conclusion:
                    zf.writestr("conclusion_operativa.md", ss.conclusion)
        if (ss.carpeta / "resultados.zip").exists():
            st.download_button("Descargar ZIP", (ss.carpeta / "resultados.zip").read_bytes(),
                               file_name=f"analista_hidrico_{ss.id}.zip", mime="application/zip")

    st.subheader(f"Gráficos ({len(graficos)})")
    columnas = st.columns(2)
    for i, png in enumerate(graficos):
        with columnas[i % 2]:
            st.image(str(png), caption=f"{png.parent.name}/{png.name}")
            st.download_button("Descargar", png.read_bytes(), file_name=png.name, mime="image/png",
                               key=f"dl_{png}")
    st.subheader(f"Tablas ({len(tablas)})")
    for csv in tablas:
        st.download_button(f"📄 {csv.parent.name}/{csv.name}", csv.read_bytes(), file_name=csv.name,
                           mime="text/csv", key=f"dl_{csv}")


# --------------------------------------------------------------------------- página

def barra_lateral() -> None:
    ss = estado()
    with st.sidebar:
        st.header("💧 Analista Hídrico")
        st.caption("Análisis, pronóstico y simulación de datos de agua")
        origen = st.radio("Datos", ["Subir archivo", "URL", "Ejemplo (planta potabilizadora)"])
        archivo = url = None
        if origen == "Subir archivo":
            archivo = st.file_uploader("CSV o Excel", type=["csv", "txt", "xlsx", "xls"])
        elif origen == "URL":
            url = st.text_input("URL de CSV o Excel")
        hoja = st.text_input("Hoja de Excel (nombre o número)", value="0")
        contexto = st.text_area("Contexto del proceso", placeholder="Ej.: PTAP convencional, datos SCADA horarios, "
                                "límite interno 0,5 NTU")
        if st.button("Cargar y analizar", type="primary", use_container_width=True):
            hoja_val = int(hoja) if hoja.strip().isdigit() else hoja.strip()
            try:
                if origen == "Subir archivo":
                    if archivo is None:
                        st.warning("Suba un archivo primero.")
                        return
                    if archivo.size > MAX_MB_ARCHIVO * 1024 * 1024:
                        st.error(f"El archivo supera {MAX_MB_ARCHIVO} MB.")
                        return
                    destino = ss.carpeta / f"datos{Path(archivo.name).suffix.lower()}"
                    destino.write_bytes(archivo.getvalue())
                    fuente = str(destino)
                elif origen == "URL":
                    if not url or not url.startswith(("http://", "https://")):
                        st.warning("Escriba una URL http(s).")
                        return
                    fuente = url
                else:
                    fuente = str(EJEMPLO)
                with st.spinner("Cargando y perfilando…"):
                    cargar_dataset(fuente, contexto, hoja_val)
                st.rerun()
            except Exception as exc:  # noqa: BLE001 - se informa cualquier fallo de lectura
                st.error(f"No se pudo cargar: {exc}")

        if ss.agente is not None:
            st.divider()
            st.progress(min(ss.mensajes / MAX_MENSAJES, 1.0), text=f"Mensajes: {ss.mensajes}/{MAX_MENSAJES}")
            if st.button("Generar conclusión operativa", use_container_width=True,
                         disabled=ss.mensajes >= MAX_MENSAJES):
                ss.pendiente = ("concluir", "")
                st.rerun()
            if st.button("Nueva sesión", use_container_width=True):
                for k in list(st.session_state.keys()):
                    if k != "autenticado":
                        del st.session_state[k]
                st.rerun()


def main() -> None:
    if not verificar_acceso():
        return
    limpiar_sesiones_antiguas()
    ss = estado()
    barra_lateral()

    if ss.perfil is None:
        st.title("💧 Analista Hídrico")
        st.markdown(
            "Cargue datos de caudales, calidad físico-química u operación de plantas desde el panel lateral. "
            "El agente propondrá análisis exploratorios, modelos predictivos y simulaciones What-If o Monte "
            "Carlo; ejecutará el código en un entorno aislado y cerrará con recomendaciones operativas.\n\n"
            "¿Solo quiere probar? Elija **Ejemplo** y pulse **Cargar y analizar**.")
        return

    chat, datos, resultados = st.tabs(["💬 Análisis", "📋 Datos", "📈 Resultados"])
    with datos:
        tab_datos(ss.perfil)
    with resultados:
        tab_resultados()
    with chat:
        mostrar_chat()
        pendiente = ss.pop("pendiente", None)
        if pendiente and ejecutar_turno(*pendiente):
            st.rerun()  # refresca la pestaña Resultados con lo nuevo
        agotado = ss.mensajes >= MAX_MENSAJES
        pregunta = st.chat_input("Ej.: «haz 1 y 3» o «¿qué pasa si la turbidez cruda sube 30 %?»",
                                 disabled=agotado)
        if agotado:
            st.info("Se alcanzó el límite de mensajes de esta sesión. Descargue los resultados o inicie una nueva.")
        if pregunta:
            ss.chat.append({"rol": "user", "texto": pregunta})
            with st.chat_message("user", avatar="🧑‍🔧"):
                st.markdown(pregunta)
            if ejecutar_turno("conversar", pregunta):
                st.rerun()


main()
