/**
 * Google Apps Script — Penyimpanan Otomatis Jawaban & Bukti Kamera SAS IPA Kelas 9
 * Pasangkan pada Google Spreadsheet melalui menu: Ekstensi > Apps Script
 * (Tanpa Google Drive — bukti tangkapan kamera tampil langsung di Portal Pengawas)
 */

const SHEET_NAME = "Rekap_SAS_IPA9";
const SNAPSHOT_SHEET_NAME = "Bukti_Kamera_SAS_IPA9";
const TEACHER_PIN = "GURU2026"; // Samakan dengan PIN Portal Pengawas

function buildHeaders() {
  const base = [
    "Waktu Server",
    "ID Sesi",
    "Nama Siswa",
    "Kelas",
    "Kode Masuk",
    "Nilai",
    "Benar",
    "Total Soal",
    "Terjawab",
    "Pelanggaran Keluar",
    "Peringatan Kamera",
    "Status Pengumpulan",
    "Waktu Mulai",
    "Waktu Selesai",
    "Log Pelanggaran",
    "Log Kamera",
    "Jumlah Foto",
    "Status Bukti Kamera",
  ];
  for (let i = 1; i <= 40; i++) {
    base.push("J" + i);
  }
  return base;
}

function getOrCreateSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
  }
  if (sheet.getLastRow() === 0) {
    const headers = buildHeaders();
    sheet.appendRow(headers);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight("bold").setBackground("#dbeafe");
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function getOrCreateSnapshotSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SNAPSHOT_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SNAPSHOT_SHEET_NAME);
  }
  if (sheet.getLastRow() === 0) {
    const headers = ["ID Sesi", "Urutan", "Alasan", "Waktu", "DataFoto"];
    sheet.appendRow(headers);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight("bold").setBackground("#e2e8f0");
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function saveSnapshotsToSheet(sessionId, snapshots) {
  if (!snapshots || !snapshots.length) return 0;
  try {
    const snapSheet = getOrCreateSnapshotSheet();
    const lastRow = snapSheet.getLastRow();
    if (lastRow > 1) {
      const ids = snapSheet.getRange(2, 1, lastRow - 1, 1).getValues();
      for (let r = ids.length - 1; r >= 0; r--) {
        if (String(ids[r][0]) === sessionId) {
          snapSheet.deleteRow(r + 2);
        }
      }
    }

    const rows = [];
    const limited = snapshots.slice(0, 10);
    limited.forEach((snap, idx) => {
      const dataUrl = String(snap.dataUrl || "");
      // Batas sel Google Sheets adalah 50.000 karakter
      if (dataUrl.indexOf("data:image/") === 0 && dataUrl.length <= 49000) {
        rows.push([
          sessionId,
          idx + 1,
          String(snap.reason || "Pemantauan Berkala"),
          String(snap.timestamp || ""),
          dataUrl,
        ]);
      }
    });

    if (rows.length > 0) {
      const startRow = snapSheet.getLastRow() + 1;
      snapSheet.getRange(startRow, 1, rows.length, 5).setValues(rows);
    }
    return rows.length;
  } catch (err) {
    return 0;
  }
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const raw = (e && e.postData && e.postData.contents) ? e.postData.contents : "{}";
    const data = JSON.parse(raw);

    const sheet = getOrCreateSheet();
    const sessionId = String(data.id || data.sessionId || ("S_" + Date.now()));
    const answers = data.answers || {};
    const violations = data.violations || [];
    const camWarnings = data.cameraWarnings || [];
    const snapshots = data.snapshots || [];

    const savedSnapCount = saveSnapshotsToSheet(sessionId, snapshots);

    const violationSummary = violations
      .map((v) => "#" + v.count + " " + v.reason + " (" + v.timestamp + ")")
      .join(" | ");
    const camSummary = camWarnings
      .map((w) => w.message + " (" + w.timestamp + ")")
      .join(" | ");

    const snapStatus = savedSnapCount > 0
      ? "Tersimpan di Portal Pengawas (" + savedSnapCount + " foto)"
      : "Tidak ada foto";

    const row = [
      new Date().toLocaleString("id-ID", { timeZone: "Asia/Jakarta" }),
      sessionId,
      data.name || "",
      data.className || "",
      data.code || "",
      Number(data.score || 0),
      Number(data.correctCount || 0),
      Number(data.totalQuestions || 40),
      Number(data.answeredCount || 0),
      Number(data.violationCount || 0),
      camWarnings.length,
      data.statusLabel || data.status || "",
      data.startedAt || "",
      data.finishedAt || "",
      violationSummary,
      camSummary,
      savedSnapCount || snapshots.length,
      snapStatus,
    ];

    for (let i = 1; i <= 40; i++) {
      row.push(answers[String(i)] || "");
    }

    // Update baris jika ID Sesi sudah ada, atau tambah baris baru
    const lastRow = sheet.getLastRow();
    let existingRowIndex = -1;
    if (lastRow > 1) {
      const idValues = sheet.getRange(2, 2, lastRow - 1, 1).getValues();
      for (let r = 0; r < idValues.length; r++) {
        if (String(idValues[r][0]) === sessionId) {
          existingRowIndex = r + 2;
          break;
        }
      }
    }

    if (existingRowIndex > 0) {
      sheet.getRange(existingRowIndex, 1, 1, row.length).setValues([row]);
    } else {
      sheet.appendRow(row);
    }

    return jsonResponse({
      ok: true,
      id: sessionId,
      savedSnapshots: savedSnapCount,
      message: "Data jawaban & bukti kamera berhasil disimpan.",
    });
  } catch (err) {
    return jsonResponse({ ok: false, message: String(err) });
  } finally {
    lock.releaseLock();
  }
}

function doGet(e) {
  const params = (e && e.parameter) ? e.parameter : {};
  const action = params.action || "ping";
  const callback = params.callback || "";

  if (action === "ping") {
    return jsonResponse({ ok: true, message: "Koneksi Spreadsheet SAS IPA 9 Aktif!" }, callback);
  }

  if (action === "snapshots") {
    if (String(params.pin || "").trim() !== TEACHER_PIN) {
      return jsonResponse({ ok: false, message: "PIN pengawas salah." }, callback);
    }
    const targetId = String(params.id || "").trim();
    if (!targetId) {
      return jsonResponse({ ok: true, snapshots: [] }, callback);
    }

    const snapSheet = getOrCreateSnapshotSheet();
    const lastRow = snapSheet.getLastRow();
    if (lastRow <= 1) {
      return jsonResponse({ ok: true, id: targetId, snapshots: [] }, callback);
    }

    const rows = snapSheet.getRange(2, 1, lastRow - 1, 5).getValues();
    const snapshots = rows
      .filter((r) => String(r[0]).trim() === targetId && String(r[4]).indexOf("data:image/") === 0)
      .sort((a, b) => Number(a[1] || 0) - Number(b[1] || 0))
      .map((r) => ({
        reason: String(r[2] || "Pemantauan Berkala"),
        timestamp: String(r[3] || ""),
        dataUrl: String(r[4] || ""),
      }));

    return jsonResponse({ ok: true, id: targetId, snapshots: snapshots }, callback);
  }

  if (action === "list") {
    if (String(params.pin || "").trim() !== TEACHER_PIN) {
      return jsonResponse({ ok: false, message: "PIN pengawas salah." }, callback);
    }

    const sheet = getOrCreateSheet();
    const lastRow = sheet.getLastRow();
    if (lastRow <= 1) {
      return jsonResponse({ ok: true, submissions: [] }, callback);
    }

    const values = sheet.getRange(2, 1, lastRow - 1, 58).getValues();
    const submissions = values
      .filter((r) => String(r[1] || r[2]).trim() !== "")
      .map((r) => {
        const answers = {};
        for (let i = 1; i <= 40; i++) {
          const val = String(r[17 + i] || "").trim();
          if (val) answers[String(i)] = val;
        }
        const statusLabel = String(r[11] || "");
        const vCount = Number(r[9] || 0);
        const status = statusLabel.indexOf("3x") >= 0 || vCount >= 3
          ? "AUTO_SUBMIT_VIOLATION"
          : statusLabel.indexOf("Waktu") >= 0
          ? "AUTO_SUBMIT_TIME"
          : "SUBMITTED_MANUAL";

        return {
          id: String(r[1]),
          name: String(r[2]),
          className: String(r[3]),
          code: String(r[4]),
          score: Number(r[5] || 0),
          correctCount: Number(r[6] || 0),
          totalQuestions: Number(r[7] || 40),
          answeredCount: Number(r[8] || 0),
          violationCount: vCount,
          cameraWarningCount: Number(r[10] || 0),
          status: status,
          statusLabel: statusLabel,
          startedAt: String(r[12] || ""),
          finishedAt: String(r[13] || ""),
          violationSummaryText: String(r[14] || ""),
          cameraSummaryText: String(r[15] || ""),
          snapshotCount: Number(r[16] || 0),
          answers: answers,
          source: "spreadsheet",
        };
      })
      .reverse();

    return jsonResponse({ ok: true, submissions: submissions }, callback);
  }

  return jsonResponse({ ok: false, message: "Action tidak dikenali." }, callback);
}

function jsonResponse(obj, callback) {
  const jsonText = JSON.stringify(obj);
  if (callback && /^[a-zA-Z_$][0-9a-zA-Z_$.]*$/.test(callback)) {
    return ContentService.createTextOutput(callback + "(" + jsonText + ");").setMimeType(
      ContentService.MimeType.JAVASCRIPT
    );
  }
  return ContentService.createTextOutput(jsonText).setMimeType(
    ContentService.MimeType.JSON
  );
}
