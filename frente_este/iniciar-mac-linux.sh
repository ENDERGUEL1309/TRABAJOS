#!/usr/bin/env bash
# FRENTE ESTE: arranca el servidor y abre el juego en el navegador.
cd "$(dirname "$0")/servidor" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js no está instalado. Descárgalo (versión LTS) en https://nodejs.org y vuelve a ejecutar este archivo."
  exit 1
fi
exec node servidor.js 8080 --abrir
