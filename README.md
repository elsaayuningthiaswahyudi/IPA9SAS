# Aplikasi Ujian Anti-Curang — Sumatif Akhir Semester (SAS) IPA Kelas IX

Aplikasi ujian berbasis web untuk pelaksanaan **Sumatif Akhir Semester (SAS) Ganjil Tahun Pelajaran 2026/2027** mata pelajaran **Ilmu Pengetahuan Alam (IPA) Kelas IX** (Kurikulum Merdeka – Fase D, Bab 1–Bab 3) dengan **40 soal pilihan ganda** lengkap beserta **gambar sesuai nomor soal**.

## Fitur Utama

1. **Halaman Login Peserta** (`index.html`):
   - Input **Nama Lengkap**, **Kelas** (`IX-A` s.d. `IX-H` atau ketik manual), dan **Kode Masuk** (default: `IPA9SAS`).
   - Verifikasi **Kamera Pengawas** (`getUserMedia`) dan **Uji Suara Alarm Alami** sebelum ujian dimulai.
2. **Pengawasan Kamera Real-Time** (`js/camera.js`):
   - Kamera aktif selama ujian berlangsung dan ditampilkan di panel samping (`REC`).
   - Memantau kondisi kamera (kamera tertutup/gelap, pergerakan ekstrem, wajah tidak terlihat jika `FaceDetector` browser didukung, atau kamera dimatikan).
   - Mengambil foto bukti (`snapshot`) saat mulai ujian, berkala, setiap peringatan kamera, dan seketika saat pelanggaran terjadi.
3. **Alarm Alami Otomatis & Batas 3x Keluar Aplikasi** (`js/alarm.js` & `js/app.js`):
   - Mendeteksi perpindahan tab (`visibilitychange`), perpindahan jendela/aplikasi (`blur`), atau keluar dari mode layar penuh (`fullscreenchange`).
   - **Suara alarm peringatan alami** (sintesis nada lonceng harmonik Web Audio API + suara peringatan bahasa Indonesia jika tersedia) otomatis berbunyi terus-menerus hingga peserta kembali ke layar ujian.
   - **Batas maksimal 3 kali pelanggaran**: pada pelanggaran ke-3, **jawaban otomatis terkirim** dan ujian berakhir seketika.
   - Nonaktifkan klik kanan, copy-paste, seleksi teks soal, dan pintasan DevTools umum.
4. **40 Soal & Gambar Sesuai Nomor** (`data/questions.json` & `assets/images/`):
   - Gambar/grafik ditampilkan pada nomor `3, 4, 6, 9, 13, 14, 17, 21, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40` beserta fitur **Perbesar Gambar** di dalam layar ujian.
   - Timer hitung mundur 120 menit, penanda Ragu-ragu, dan navigasi 40 nomor soal.
5. **Portal Pengawas / Guru** (`pengawas.html`):
   - Dilindungi PIN pengawas (default: `GURU2026`).
   - Melihat rekap nilai, status pelanggaran, log kejadian, galeri foto kamera peserta, ubah **Kode Masuk**, serta **Unduh Rekap CSV**.

## Cara Menjalankan

```bash
cd /Users/elsaayuningthiaswahyudi/.gemini/antigravity/scratch/sas-ipa-kelas9
python3 server.py --port 8090
```

Buka di browser (Chrome/Edge/Safari):
- **Halaman Siswa:** `http://127.0.0.1:8090/` (Kode Masuk default: `IPA9SAS`)
- **Portal Pengawas / Guru:** `http://127.0.0.1:8090/pengawas.html` (PIN default: `GURU2026`)
