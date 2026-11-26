#!/usr/bin/env python3
"""Local HTTP server for the SAS IPA Kelas 9 anti-cheating exam application."""

import argparse
import base64
import csv
import io
import json
import mimetypes
import os
import re
import shutil
import threading
import urllib.request
import uuid
from datetime import datetime
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlencode, urlparse

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, "data")
CONFIG_PATH = os.path.join(DATA_DIR, "config.json")
QUESTIONS_PATH = os.path.join(DATA_DIR, "questions.json")
SUBMISSIONS_PATH = os.path.join(DATA_DIR, "submissions.json")
SNAPSHOTS_DIR = os.path.join(DATA_DIR, "snapshots")

DATA_LOCK = threading.Lock()


def ensure_data_files():
    os.makedirs(DATA_DIR, exist_ok=True)
    os.makedirs(SNAPSHOTS_DIR, exist_ok=True)
    if not os.path.exists(SUBMISSIONS_PATH):
        with open(SUBMISSIONS_PATH, "w", encoding="utf-8") as f:
            json.dump([], f, ensure_ascii=False, indent=2)


def load_json(path, default):
    if not os.path.exists(path):
        return default
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def save_json(path, payload):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)


def forward_to_spreadsheet(url, payload):
    try:
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        req = urllib.request.Request(
            url,
            data=data,
            headers={"Content-Type": "text/plain;charset=utf-8"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=15) as resp:
            resp.read()
    except Exception as exc:
        print(f"[Spreadsheet Sync Warning] {exc}")


def sanitize_id(value):
    return re.sub(r"[^a-zA-Z0-9_-]", "", value or "")[:64]


class ExamHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=BASE_DIR, **kwargs)

    def end_headers(self):
        # Ensure mobile & desktop browsers always receive latest JS/HTML/audio updates
        path = urlparse(self.path).path
        if path == "/" or path.endswith((".html", ".js", ".css")):
            self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
            self.send_header("Pragma", "no-cache")
            self.send_header("Expires", "0")
        super().end_headers()

    def log_message(self, fmt, *args):
        # Keep console output clean and readable
        print(f"[{datetime.now().strftime('%H:%M:%S')}] {self.address_string()} - {fmt % args}")

    def send_json(self, status, payload):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def read_json_body(self):
        length = int(self.headers.get("Content-Length", "0"))
        if length <= 0 or length > 25 * 1024 * 1024:
            return None
        raw = self.rfile.read(length)
        return json.loads(raw.decode("utf-8"))

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path
        qs = parse_qs(parsed.query)

        # Protect sensitive raw data files from direct static access
        protected = {"/data/config.json", "/data/submissions.json", "/data/questions.json"}
        if path in protected or path.startswith("/data/snapshots/"):
            self.send_error(HTTPStatus.FORBIDDEN, "Access denied")
            return

        if path == "/api/exam-info":
            with DATA_LOCK:
                cfg = load_json(CONFIG_PATH, {})
            self.send_json(
                HTTPStatus.OK,
                {
                    "examTitle": cfg.get("examTitle", "Sumatif Akhir Semester (SAS) Ganjil"),
                    "subject": cfg.get("subject", "Ilmu Pengetahuan Alam (IPA) – Kelas IX"),
                    "curriculum": cfg.get("curriculum", "Kurikulum Merdeka – Fase D"),
                    "material": cfg.get("material", "Bab 1 – Bab 3"),
                    "durationMinutes": cfg.get("durationMinutes", 120),
                    "maxViolations": cfg.get("maxViolations", 3),
                    "showScoreToStudent": cfg.get("showScoreToStudent", True),
                    "spreadsheetUrl": cfg.get("spreadsheetUrl", ""),
                    "classes": cfg.get("classes", ["IX A", "IX B", "IX C", "IX D"]),
                },
            )
            return

        if path == "/api/questions":
            with DATA_LOCK:
                questions = load_json(QUESTIONS_PATH, [])
            sanitized = [
                {
                    "number": q["number"],
                    "chapter": q.get("chapter", ""),
                    "question": q["question"],
                    "image": q.get("image"),
                    "imageNote": q.get("imageNote"),
                    "options": q["options"],
                }
                for q in questions
            ]
            self.send_json(HTTPStatus.OK, {"questions": sanitized})
            return

        if path == "/api/sheet-proxy":
            pin = (qs.get("pin", [""])[0]).strip()
            sheet_url = (qs.get("url", [""])[0]).strip()
            action = (qs.get("action", ["ping"])[0]).strip()
            with DATA_LOCK:
                cfg = load_json(CONFIG_PATH, {})
                if pin != cfg.get("teacherPin", "GURU2026"):
                    self.send_json(HTTPStatus.UNAUTHORIZED, {"ok": False, "message": "PIN pengawas salah."})
                    return
                if not sheet_url:
                    sheet_url = (cfg.get("spreadsheetUrl") or "").strip()
            if not sheet_url.startswith("https://script.google.com/"):
                self.send_json(HTTPStatus.BAD_REQUEST, {"ok": False, "message": "URL Web App harus diawali https://script.google.com/ dan berakhiran /exec"})
                return
            try:
                sep = "&" if "?" in sheet_url else "?"
                query_params = {"action": action}
                if action == "list":
                    query_params["pin"] = pin
                target_url = f"{sheet_url}{sep}{urlencode(query_params)}"
                req = urllib.request.Request(target_url, headers={"User-Agent": "SAS-IPA-Proxy/1.0"})
                with urllib.request.urlopen(req, timeout=15) as resp:
                    raw = resp.read().decode("utf-8", errors="replace")
                try:
                    parsed_json = json.loads(raw)
                    self.send_json(HTTPStatus.OK, parsed_json)
                except Exception:
                    if "<html" in raw.lower() or "accounts.google.com" in raw.lower():
                        self.send_json(
                            HTTPStatus.BAD_GATEWAY,
                            {
                                "ok": False,
                                "message": "Google mengembalikan halaman login HTML (bukan JSON). Pastikan di Apps Script 'Yang memiliki akses / Who has access' dipilih 'Siapa saja / Anyone' dan deployment sudah versi terbaru.",
                            },
                        )
                    else:
                        self.send_json(
                            HTTPStatus.BAD_GATEWAY,
                            {"ok": False, "message": f"Respon Google bukan JSON valid: {raw[:140]}"},
                        )
            except Exception as exc:
                self.send_json(HTTPStatus.BAD_GATEWAY, {"ok": False, "message": f"Gagal menghubungi Google Apps Script: {exc}"})
            return

        if path == "/api/submissions":
            pin = (qs.get("pin", [""])[0]).strip()
            with DATA_LOCK:
                cfg = load_json(CONFIG_PATH, {})
                if pin != cfg.get("teacherPin", "GURU2026"):
                    self.send_json(HTTPStatus.UNAUTHORIZED, {"ok": False, "message": "PIN pengawas salah."})
                    return
                subs = load_json(SUBMISSIONS_PATH, [])
            self.send_json(
                HTTPStatus.OK,
                {
                    "ok": True,
                    "submissions": subs,
                    "config": {
                        "examCode": cfg.get("examCode", "IPA9SAS"),
                        "durationMinutes": cfg.get("durationMinutes", 120),
                        "maxViolations": cfg.get("maxViolations", 3),
                        "showScoreToStudent": cfg.get("showScoreToStudent", True),
                        "spreadsheetUrl": cfg.get("spreadsheetUrl", ""),
                    },
                },
            )
            return

        if path == "/api/snapshot":
            pin = (qs.get("pin", [""])[0]).strip()
            sub_id = sanitize_id(qs.get("id", [""])[0])
            filename = os.path.basename(qs.get("file", [""])[0])
            with DATA_LOCK:
                cfg = load_json(CONFIG_PATH, {})
                if pin != cfg.get("teacherPin", "GURU2026"):
                    self.send_error(HTTPStatus.UNAUTHORIZED, "Invalid PIN")
                    return
            target = os.path.abspath(os.path.join(SNAPSHOTS_DIR, sub_id, filename))
            if not target.startswith(os.path.abspath(SNAPSHOTS_DIR) + os.sep) or not os.path.isfile(target):
                self.send_error(HTTPStatus.NOT_FOUND, "Snapshot not found")
                return
            mime, _ = mimetypes.guess_type(target)
            with open(target, "rb") as f:
                data = f.read()
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", mime or "image/jpeg")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return

        if path == "/api/export-csv":
            pin = (qs.get("pin", [""])[0]).strip()
            with DATA_LOCK:
                cfg = load_json(CONFIG_PATH, {})
                if pin != cfg.get("teacherPin", "GURU2026"):
                    self.send_error(HTTPStatus.UNAUTHORIZED, "Invalid PIN")
                    return
                subs = load_json(SUBMISSIONS_PATH, [])

            buf = io.StringIO()
            writer = csv.writer(buf)
            writer.writerow([
                "No",
                "Nama Siswa",
                "Kelas",
                "Kode Masuk",
                "Nilai",
                "Benar",
                "Total Soal",
                "Terjawab",
                "Jumlah Pelanggaran",
                "Peringatan Kamera",
                "Status Pengumpulan",
                "Waktu Mulai",
                "Waktu Selesai",
            ])
            for idx, s in enumerate(subs, start=1):
                writer.writerow([
                    idx,
                    s.get("name", ""),
                    s.get("className", ""),
                    s.get("code", ""),
                    s.get("score", 0),
                    s.get("correctCount", 0),
                    s.get("totalQuestions", 40),
                    s.get("answeredCount", 0),
                    s.get("violationCount", 0),
                    len(s.get("cameraWarnings", [])),
                    s.get("statusLabel", s.get("status", "")),
                    s.get("startedAt", ""),
                    s.get("finishedAt", ""),
                ])
            csv_bytes = ("\ufeff" + buf.getvalue()).encode("utf-8")
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", "text/csv; charset=utf-8")
            self.send_header("Content-Disposition", 'attachment; filename="rekap_sas_ipa_kelas9.csv"')
            self.send_header("Content-Length", str(len(csv_bytes)))
            self.end_headers()
            self.wfile.write(csv_bytes)
            return

        super().do_GET()

    def do_POST(self):
        parsed = urlparse(self.path)
        path = parsed.path

        try:
            body = self.read_json_body()
        except Exception:
            self.send_json(HTTPStatus.BAD_REQUEST, {"ok": False, "message": "Payload JSON tidak valid."})
            return

        if body is None:
            self.send_json(HTTPStatus.BAD_REQUEST, {"ok": False, "message": "Payload kosong atau terlalu besar."})
            return

        if path == "/api/verify-code":
            name = (body.get("name") or "").strip()
            class_name = (body.get("className") or "").strip()
            code = (body.get("code") or "").strip().upper()
            with DATA_LOCK:
                cfg = load_json(CONFIG_PATH, {})
            expected = (cfg.get("examCode") or "IPA9SAS").strip().upper()
            if not name or not class_name or not code:
                self.send_json(HTTPStatus.BAD_REQUEST, {"ok": False, "message": "Nama, kelas, dan kode masuk wajib diisi."})
                return
            if code != expected:
                self.send_json(HTTPStatus.UNAUTHORIZED, {"ok": False, "message": "Kode masuk salah! Hubungi guru/pengawas ujian."})
                return
            self.send_json(
                HTTPStatus.OK,
                {
                    "ok": True,
                    "sessionId": uuid.uuid4().hex[:16],
                    "durationMinutes": cfg.get("durationMinutes", 120),
                    "maxViolations": cfg.get("maxViolations", 3),
                    "showScoreToStudent": cfg.get("showScoreToStudent", True),
                },
            )
            return

        if path == "/api/submit":
            sub_id = sanitize_id(body.get("sessionId")) or uuid.uuid4().hex[:16]
            answers = body.get("answers") or {}
            snapshots = body.get("snapshots") or []

            with DATA_LOCK:
                cfg = load_json(CONFIG_PATH, {})
                questions = load_json(QUESTIONS_PATH, [])
                subs = load_json(SUBMISSIONS_PATH, [])

            total_q = len(questions)
            correct_count = 0
            answered_count = 0
            for q in questions:
                num_str = str(q["number"])
                chosen = answers.get(num_str) or answers.get(q["number"])
                if chosen:
                    answered_count += 1
                    if chosen == q["answer"]:
                        correct_count += 1

            score = round((correct_count / total_q) * 100, 1) if total_q else 0

            # Save camera snapshots as JPEG files
            saved_snapshots = []
            sub_snap_dir = os.path.join(SNAPSHOTS_DIR, sub_id)
            os.makedirs(sub_snap_dir, exist_ok=True)
            for idx, snap in enumerate(snapshots[:40]):
                data_url = snap.get("dataUrl", "")
                if "," in data_url and data_url.startswith("data:image/"):
                    try:
                        b64_part = data_url.split(",", 1)[1]
                        raw_img = base64.b64decode(b64_part)
                        fname = f"snap_{idx + 1:02d}.jpg"
                        with open(os.path.join(sub_snap_dir, fname), "wb") as f:
                            f.write(raw_img)
                        saved_snapshots.append({
                            "file": fname,
                            "reason": snap.get("reason", "Pemantauan Berkala"),
                            "timestamp": snap.get("timestamp", ""),
                        })
                    except Exception:
                        pass

            status = body.get("status", "SUBMITTED_MANUAL")
            status_map = {
                "SUBMITTED_MANUAL": "Selesai (Dikumpulkan Siswa)",
                "AUTO_SUBMIT_TIME": "Selesai Otomatis (Waktu Habis)",
                "AUTO_SUBMIT_VIOLATION": "Dihentikan Otomatis (3x Keluar Aplikasi)",
            }

            record = {
                "id": sub_id,
                "name": (body.get("name") or "").strip(),
                "className": (body.get("className") or "").strip(),
                "code": (body.get("code") or "").strip().upper(),
                "startedAt": body.get("startedAt", ""),
                "finishedAt": body.get("finishedAt", datetime.now().isoformat()),
                "durationSeconds": body.get("durationSeconds", 0),
                "totalQuestions": total_q,
                "answeredCount": answered_count,
                "correctCount": correct_count,
                "score": score,
                "status": status,
                "statusLabel": status_map.get(status, status),
                "violationCount": int(body.get("violationCount", 0)),
                "violations": body.get("violations") or [],
                "cameraWarnings": body.get("cameraWarnings") or [],
                "snapshots": saved_snapshots,
                "answers": answers,
            }

            with DATA_LOCK:
                subs = [s for s in subs if s.get("id") != sub_id]
                subs.insert(0, record)
                save_json(SUBMISSIONS_PATH, subs)

            spreadsheet_url = (cfg.get("spreadsheetUrl") or "").strip()
            if spreadsheet_url:
                sheet_payload = dict(record)
                sheet_payload["snapshots"] = snapshots[:5]
                threading.Thread(
                    target=forward_to_spreadsheet,
                    args=(spreadsheet_url, sheet_payload),
                    daemon=True,
                ).start()

            show_score = cfg.get("showScoreToStudent", True)
            self.send_json(
                HTTPStatus.OK,
                {
                    "ok": True,
                    "id": sub_id,
                    "statusLabel": record["statusLabel"],
                    "answeredCount": answered_count,
                    "totalQuestions": total_q,
                    "showScoreToStudent": show_score,
                    "score": score if show_score else None,
                    "correctCount": correct_count if show_score else None,
                },
            )
            return

        if path == "/api/config":
            pin = (body.get("pin") or "").strip()
            with DATA_LOCK:
                cfg = load_json(CONFIG_PATH, {})
                if pin != cfg.get("teacherPin", "GURU2026"):
                    self.send_json(HTTPStatus.UNAUTHORIZED, {"ok": False, "message": "PIN pengawas salah."})
                    return
                if body.get("examCode"):
                    cfg["examCode"] = body["examCode"].strip().upper()
                if body.get("newTeacherPin"):
                    cfg["teacherPin"] = body["newTeacherPin"].strip()
                if body.get("durationMinutes"):
                    cfg["durationMinutes"] = max(5, min(240, int(body["durationMinutes"])))
                if "showScoreToStudent" in body:
                    cfg["showScoreToStudent"] = bool(body["showScoreToStudent"])
                if "spreadsheetUrl" in body:
                    cfg["spreadsheetUrl"] = (body.get("spreadsheetUrl") or "").strip()
                save_json(CONFIG_PATH, cfg)
            self.send_json(HTTPStatus.OK, {"ok": True, "message": "Pengaturan berhasil disimpan."})
            return

        if path == "/api/clear-submissions":
            pin = (body.get("pin") or "").strip()
            with DATA_LOCK:
                cfg = load_json(CONFIG_PATH, {})
                if pin != cfg.get("teacherPin", "GURU2026"):
                    self.send_json(HTTPStatus.UNAUTHORIZED, {"ok": False, "message": "PIN pengawas salah."})
                    return
                save_json(SUBMISSIONS_PATH, [])
                if os.path.exists(SNAPSHOTS_DIR):
                    shutil.rmtree(SNAPSHOTS_DIR)
                os.makedirs(SNAPSHOTS_DIR, exist_ok=True)
            self.send_json(HTTPStatus.OK, {"ok": True, "message": "Seluruh data pengumpulan dibersihkan."})
            return

        self.send_json(HTTPStatus.NOT_FOUND, {"ok": False, "message": "Endpoint tidak ditemukan."})


def main():
    parser = argparse.ArgumentParser(description="Server Ujian Anti-Curang SAS IPA Kelas 9")
    parser.add_argument("--port", type=int, default=8080, help="Port server HTTP (default: 8080)")
    parser.add_argument("--host", default="127.0.0.1", help="Host bind (default: 127.0.0.1)")
    args = parser.parse_args()

    ensure_data_files()
    server = ThreadingHTTPServer((args.host, args.port), ExamHandler)
    print(f"Server SAS IPA Kelas 9 berjalan di http://{args.host}:{args.port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nServer dihentikan.")
        server.server_close()


if __name__ == "__main__":
    main()
