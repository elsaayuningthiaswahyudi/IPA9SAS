#!/bin/bash
cd "$(dirname "$0")"
PORT=8091
URL="http://127.0.0.1:$PORT/pengawas.html"

if lsof -iTCP:$PORT -sTCP:LISTEN >/dev/null 2>&1; then
  echo "Membuka Portal Pengawas di $URL"
  open "$URL"
else
  echo "Menjalankan Server Ujian & Membuka Portal Pengawas di $URL ..."
  echo "PIN Pengawas default: GURU2026"
  echo "Biarkan jendela Terminal ini tetap terbuka selama ujian berlangsung."
  (sleep 1 && open "$URL") &
  /usr/bin/python3 server.py --port $PORT
fi
