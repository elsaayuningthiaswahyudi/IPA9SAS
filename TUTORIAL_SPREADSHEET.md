# Tutorial Menyambungkan Aplikasi Ujian ke Google Spreadsheet

Dengan menyambungkan aplikasi ke **Google Spreadsheet**, seluruh jawaban siswa (nomor **1–40**), **nilai**, **status pelanggaran**, dan **log kamera** dari HP maupun laptop masing-masing siswa akan **otomatis tersimpan terpusat** di satu file Google Sheets dan tampil di **Portal Pengawas**.

---

## Langkah 1: Buat Google Spreadsheet Baru
1. Buka [Google Sheets](https://sheets.google.com) menggunakan akun Google Anda.
2. Klik **Blank / Kosong** untuk membuat Spreadsheet baru.
3. Beri nama Spreadsheet, misalnya: **`Rekap SAS IPA Kelas 9`**.

---

## Langkah 2: Pasang Kode Apps Script
1. Di halaman Spreadsheet tersebut, klik menu **Ekstensi (Extensions) → Apps Script**.
2. Hapus seluruh isi kode bawaan (`function myFunction() {}`) di editor Apps Script.
3. Buka file **`google-apps-script/Code.gs`** dari folder aplikasi ini (atau klik tombol **"Salin Kode Apps Script"** di Portal Pengawas), lalu **tempel (paste)** seluruh isinya ke editor Apps Script.
4. *(Opsional)* Jika Anda mengubah PIN pengawas, samakan nilai `TEACHER_PIN` pada baris ke-8 (`const TEACHER_PIN = "GURU2026";`).
5. Klik ikon **Simpan (Save)** atau tekan `Ctrl+S` / `Cmd+S`.

---

## Langkah 3: Deploy sebagai Web App
1. Di kanan atas Apps Script, klik tombol **Terapkan (Deploy) → Deployment baru (New deployment)**.
2. Pada ikon roda gigi di sebelah *Pilih jenis (Select type)*, pilih **Aplikasi Web (Web app)**.
3. Isi pengaturan berikut dengan tepat:
   - **Deskripsi**: `API Rekap SAS IPA 9`
   - **Jalankan sebagai (Execute as)**: **Saya (Me)**
   - **Yang memiliki akses (Who has access)**: **Siapa saja (Anyone)** *(wajib pilih "Siapa saja" agar perangkat siswa bisa mengirim jawaban tanpa login Google)*
4. Klik **Terapkan (Deploy)**.
5. Jika muncul jendela **Otorisasi akses (Authorize access)**:
   - Klik **Tinjau izin (Review permissions)** → pilih akun Google Anda.
   - Jika muncul peringatan *"Google hasn't verified this app"*, klik **Lanjutan (Advanced)** → klik **Buka ... (tidak aman) / Go to ... (unsafe)** → klik **Izinkan (Allow)**.
6. Setelah selesai, **salin URL Aplikasi Web (Web app URL)** yang berakhiran `/exec` (contoh: `https://script.google.com/macros/s/AKfycb.../exec`).

---

## Langkah 4: Pasang URL ke Aplikasi (Agar Semua Siswa Otomatis Tersimpan)

### Jika Anda Menggunakan GitHub Pages (Siswa Membuka Link Online)
Agar **semua perangkat siswa (HP/laptop berbeda)** otomatis tahu alamat Spreadsheet Anda:
1. Buka file **`data/config.json`** di folder proyek Anda (atau edit langsung di GitHub: `elsaayuningthiaswahyudi/IPA9SAS` → `data/config.json` → ikon pensil *Edit*).
2. Isi bagian `"spreadsheetUrl"` dengan URL `/exec` tadi:
   ```json
   "spreadsheetUrl": "https://script.google.com/macros/s/AKfycb.../exec"
   ```
3. Simpan / commit perubahan dan **push ke GitHub** (`git add data/config.json && git commit -m "Set Spreadsheet URL" && git push`).
4. Tunggu ~1 menit sampai GitHub Pages selesai memperbarui halaman.

### Jika Anda Menjalankan Secara Lokal (`Buka Aplikasi Ujian.command`)
1. Buka **Portal Pengawas** (`pengawas.html`), masuk dengan PIN `GURU2026`.
2. Tempel URL `/exec` ke kolom **URL Web App Google Spreadsheet**.
3. Klik **Tes Koneksi** untuk memastikan muncul pesan hijau *"Koneksi Spreadsheet SAS IPA 9 Aktif!"*, lalu klik **Simpan Pengaturan**.

---

## Langkah 5: Cek Hasil di Spreadsheet & Portal Pengawas
- Setiap kali siswa mengklik **Kumpulkan Jawaban**, waktu habis, atau **terkena 3x pelanggaran (auto-submit)**:
  - Satu baris data siswa langsung masuk ke sheet **`Rekap_SAS_IPA9`** lengkap dengan **Nilai**, **Log Pelanggaran**, **Link Folder Foto Kamera di Google Drive** (`Bukti_Kamera_SAS_IPA9`), dan seluruh **40 jawaban (`J1` s.d. `J40`)**.
- Ketika Anda membuka **Portal Pengawas (`pengawas.html`)** dan klik **Muat Ulang**, seluruh data peserta dari Google Spreadsheet otomatis ditarik dan ditampilkan dalam satu tabel terpusat!

> **Penting saat memperbarui kode Apps Script di kemudian hari:** Jika Anda mengubah isi `Code.gs`, pilih **Terapkan → Kelola deployment → Edit (ikon pensil) → Versi baru (New version)** agar URL `/exec` tidak berubah.
