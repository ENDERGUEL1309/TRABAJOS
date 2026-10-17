FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    MPLBACKEND=Agg

WORKDIR /app
COPY requirements.txt .
RUN pip install -r requirements.txt

COPY . .

# Usuario sin privilegios: los scripts del sandbox no corren como root.
RUN useradd --create-home --uid 1000 analista \
    && mkdir -p /app/output/sesiones \
    && chown -R analista:analista /app/output
USER analista

ENV CARPETA_SESIONES=/app/output/sesiones
EXPOSE 8501
# Railway define $PORT; en local se usa 8501.
CMD ["sh", "-c", "streamlit run src/app_web.py --server.port ${PORT:-8501} --server.address 0.0.0.0"]
