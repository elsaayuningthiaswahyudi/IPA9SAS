#!/bin/bash
cd "$(dirname "$0")"
PORT=8091
URL="http://127.0.0.1:$PORT/"

if lsof -iTCP:$PORT -sTCP:LISTEN >/dev/null 2>&1; then
  echo "Server sudah berjalan di $URL"
  open "$URL"
else
  echo "Menjalankan Server Ujian SAS IPA Kelas 9 di $URL ..."
  echo "Biarkan jendela Terminal ini tetap terbuka selama ujian berlangsung."
  (sleep 1 && open "$URL") &
  /usr/bin/python3 server.py --port $PORT
fi
