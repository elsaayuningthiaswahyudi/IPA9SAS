import { FALLBACK_QUESTIONS } from "./questions-fallback.js";

const LOCAL_SUBMISSIONS_KEY = "sas_ipa9_local_submissions_v1";
const LOCAL_CONFIG_KEY = "sas_ipa9_config_v1";

const ANSWER_KEYS = Object.fromEntries(
  FALLBACK_QUESTIONS.map((q) => [String(q.number), q.answer])
);

let activePin = "";
let cachedSubmissions = [];
let isStaticMode = false;

const els = {
  pinGate: document.getElementById("pin-gate"),
  pinForm: document.getElementById("pin-form"),
  pinInput: document.getElementById("teacher-pin-input"),
  pinError: document.getElementById("pin-error"),
  dashboardContent: document.getElementById("dashboard-content"),

  cfgForm: document.getElementById("config-form"),
  cfgExamCode: document.getElementById("cfg-exam-code"),
  cfgDuration: document.getElementById("cfg-duration"),
  cfgShowScore: document.getElementById("cfg-show-score"),
  cfgSpreadsheetUrl: document.getElementById("cfg-spreadsheet-url"),
  cfgMsg: document.getElementById("cfg-msg"),

  btnOpenTutorial: document.getElementById("btn-open-tutorial"),
  btnCloseTutorial: document.getElementById("btn-close-tutorial"),
  tutorialModal: document.getElementById("tutorial-modal"),
  btnCopyGas: document.getElementById("btn-copy-gas"),
  gasCopyStatus: document.getElementById("gas-copy-status"),
  btnTestSheet: document.getElementById("btn-test-sheet"),
  btnCopyConfig: document.getElementById("btn-copy-config"),

  btnRefresh: document.getElementById("btn-refresh-data"),
  btnExportCsv: document.getElementById("btn-export-csv"),
  btnClearData: document.getElementById("btn-clear-data"),
  syncStatusBadge: document.getElementById("sync-status-badge"),

  statTotal: document.getElementById("stat-total"),
  statAvg: document.getElementById("stat-avg"),
  statWarned: document.getElementById("stat-warned"),
  statAutoSubmitted: document.getElementById("stat-autosubmitted"),
  tbody: document.getElementById("submissions-tbody"),

  detailModal: document.getElementById("detail-modal"),
  detailTitle: document.getElementById("detail-title"),
  detailBody: document.getElementById("detail-body"),
  btnCloseDetail: document.getElementById("btn-close-detail"),
};

els.pinForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  els.pinError.classList.add("hidden");
  activePin = els.pinInput.value.trim();
  await loadDashboard();
});

function getLocalConfig() {
  try {
    return JSON.parse(localStorage.getItem(LOCAL_CONFIG_KEY) || "{}") || {};
  } catch {
    return {};
  }
}

async function getRepoConfig() {
  try {
    const resp = await fetch("data/config.json");
    if (resp.ok) return await resp.json();
  } catch {
    // Ignore
  }
  return {};
}

function getLocalSubmissions() {
  try {
    return JSON.parse(localStorage.getItem(LOCAL_SUBMISSIONS_KEY) || "[]") || [];
  } catch {
    return [];
  }
}

function jsonpRequest(url, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const cbName = "__sasGasCb_" + Date.now() + "_" + Math.floor(Math.random() * 10000);
    const script = document.createElement("script");
    let finished = false;

    const cleanup = () => {
      if (script.parentNode) script.parentNode.removeChild(script);
      try {
        delete window[cbName];
      } catch {
        window[cbName] = undefined;
      }
    };

    const timer = setTimeout(() => {
      if (finished) return;
      finished = true;
      cleanup();
      reject(new Error("Timeout menghubungi Google Apps Script."));
    }, timeoutMs);

    window[cbName] = (data) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      cleanup();
      resolve(data);
    };

    script.onerror = () => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      cleanup();
      reject(new Error("Script gagal dimuat (cek URL /exec atau akses 'Anyone')."));
    };

    const sep = url.includes("?") ? "&" : "?";
    script.src = `${url}${sep}callback=${encodeURIComponent(cbName)}`;
    document.head.appendChild(script);
  });
}

async function callSheetGet(sheetUrl, action, pin = "", extraParams = {}) {
  const cleanUrl = (sheetUrl || "").trim();
  if (!cleanUrl) throw new Error("URL Spreadsheet kosong.");
  if (!cleanUrl.startsWith("https://script.google.com/")) {
    throw new Error("URL harus diawali https://script.google.com/ dan berakhiran /exec.");
  }

  const extraQuery = Object.entries(extraParams)
    .filter(([, v]) => v !== undefined && v !== null && String(v) !== "")
    .map(([k, v]) => `&${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join("");

  // 1. If local server.py is active, use server-side proxy (immune to browser CORS/multi-login)
  if (!isStaticMode) {
    try {
      const proxyUrl = `api/sheet-proxy?url=${encodeURIComponent(cleanUrl)}&action=${encodeURIComponent(action)}&pin=${encodeURIComponent(pin)}${extraQuery}`;
      const resp = await fetch(proxyUrl);
      const data = await resp.json();
      if (!resp.ok || !data.ok) {
        throw new Error(data.message || "Gagal terhubung via server proxy.");
      }
      return data;
    } catch (err) {
      throw err;
    }
  }

  // 2. Direct fetch (static hosting / GitHub Pages)
  const sep = cleanUrl.includes("?") ? "&" : "?";
  const baseTarget =
    action === "list" || action === "snapshots"
      ? `${cleanUrl}${sep}action=${encodeURIComponent(action)}&pin=${encodeURIComponent(pin)}`
      : `${cleanUrl}${sep}action=${encodeURIComponent(action)}`;
  const target = `${baseTarget}${extraQuery}`;

  try {
    const resp = await fetch(target);
    const data = await resp.json();
    if (!resp.ok || !data.ok) {
      throw new Error(data.message || "Respon error dari Google Apps Script.");
    }
    return data;
  } catch (fetchErr) {
    // 3. Fallback JSONP (bypasses browser CORS redirect blocks on script.googleusercontent.com)
    try {
      const jsonpData = await jsonpRequest(target);
      if (!jsonpData || !jsonpData.ok) {
        throw new Error((jsonpData && jsonpData.message) || "Respon JSONP gagal.");
      }
      return jsonpData;
    } catch (jsonpErr) {
      throw new Error(
        `Browser tidak dapat membaca respon dari Google Apps Script (${fetchErr.message}). Pastikan URL berakhiran /exec, deployment diatur "Anyone / Siapa saja", atau coba buka link uji langsung.`
      );
    }
  }
}

async function fetchSpreadsheetSubmissions(sheetUrl, pin) {
  if (!sheetUrl) return { ok: false, submissions: [] };
  const data = await callSheetGet(sheetUrl, "list", pin);
  return { ok: true, submissions: data.submissions || [] };
}

function mergeSubmissions(localSubs, sheetSubs) {
  const map = new Map();
  // Local records first (have local snapshot blobs if same machine)
  localSubs.forEach((s) => {
    if (s && s.id) map.set(s.id, { ...s, source: s.source || "lokal" });
  });
  sheetSubs.forEach((s) => {
    if (!s || !s.id) return;
    const prev = map.get(s.id);
    if (prev) {
      map.set(s.id, {
        ...s,
        snapshots: (prev.snapshots && prev.snapshots.length) ? prev.snapshots : [],
        violations: (prev.violations && prev.violations.length) ? prev.violations : s.violations,
        cameraWarnings: (prev.cameraWarnings && prev.cameraWarnings.length) ? prev.cameraWarnings : s.cameraWarnings,
        source: "spreadsheet+lokal",
      });
    } else {
      map.set(s.id, { ...s, source: "spreadsheet" });
    }
  });
  return Array.from(map.values()).sort((a, b) =>
    String(b.finishedAt || "").localeCompare(String(a.finishedAt || ""))
  );
}

async function loadDashboard() {
  let localSubs = [];
  let sheetUrl = "";
  let handledByServer = false;

  try {
    const resp = await fetch(`api/submissions?pin=${encodeURIComponent(activePin)}`);
    const ct = resp.headers.get("content-type") || "";
    if (ct.includes("application/json")) {
      handledByServer = true;
      const data = await resp.json();
      if (!resp.ok || !data.ok) {
        els.pinError.textContent = data.message || "PIN pengawas salah.";
        els.pinError.classList.remove("hidden");
        return;
      }

      isStaticMode = false;
      els.pinGate.classList.add("hidden");
      els.dashboardContent.classList.remove("hidden");

      const cfg = data.config || {};
      els.cfgExamCode.value = cfg.examCode || "IPA9SAS";
      els.cfgDuration.value = cfg.durationMinutes || 120;
      els.cfgShowScore.value = String(cfg.showScoreToStudent !== false);
      sheetUrl = cfg.spreadsheetUrl || "";
      els.cfgSpreadsheetUrl.value = sheetUrl;
      localSubs = data.submissions || [];
    }
  } catch {
    // Network error -> fallback to static mode
  }

  if (!handledByServer) {
    const repoCfg = await getRepoConfig();
    const localCfg = getLocalConfig();
    const expectedPin = localCfg.teacherPin || repoCfg.teacherPin || "GURU2026";
    if (activePin !== expectedPin) {
      els.pinError.textContent = "PIN pengawas salah.";
      els.pinError.classList.remove("hidden");
      return;
    }

    isStaticMode = true;
    els.pinGate.classList.add("hidden");
    els.dashboardContent.classList.remove("hidden");
    els.cfgExamCode.value = localCfg.examCode || repoCfg.examCode || "IPA9SAS";
    els.cfgDuration.value = localCfg.durationMinutes || repoCfg.durationMinutes || 120;
    els.cfgShowScore.value = String(
      (localCfg.showScoreToStudent !== undefined
        ? localCfg.showScoreToStudent
        : repoCfg.showScoreToStudent) !== false
    );
    sheetUrl = localCfg.spreadsheetUrl || repoCfg.spreadsheetUrl || "";
    els.cfgSpreadsheetUrl.value = sheetUrl;
    localSubs = getLocalSubmissions();
  }

  if (sheetUrl) {
    try {
      els.syncStatusBadge.className = "status-pill pending";
      els.syncStatusBadge.textContent = "Menyinkronkan Spreadsheet...";
      const sheetRes = await fetchSpreadsheetSubmissions(sheetUrl, activePin);
      cachedSubmissions = mergeSubmissions(localSubs, sheetRes.submissions);
      els.syncStatusBadge.className = "status-pill ready";
      els.syncStatusBadge.textContent = `Spreadsheet Terhubung (${sheetRes.submissions.length} dari Sheets)`;
    } catch (err) {
      cachedSubmissions = localSubs;
      els.syncStatusBadge.className = "status-pill error";
      els.syncStatusBadge.textContent = "Gagal Sinkron Spreadsheet";
      els.cfgMsg.innerHTML = `<div class="alert-error">${escapeHtml(err.message)}</div>`;
    }
  } else {
    cachedSubmissions = localSubs;
    els.syncStatusBadge.className = "status-pill pending";
    els.syncStatusBadge.textContent = isStaticMode
      ? "Mode Browser Lokal (Spreadsheet Belum Disambungkan)"
      : "Server Lokal (Spreadsheet Belum Disambungkan)";
  }

  renderStatsAndTable(cachedSubmissions);
}

function renderStatsAndTable(subs) {
  const total = subs.length;
  const avg = total
    ? (subs.reduce((acc, s) => acc + Number(s.score || 0), 0) / total).toFixed(1)
    : "0";
  const warned = subs.filter((s) => (s.violationCount || 0) > 0).length;
  const autoSub = subs.filter((s) => s.status === "AUTO_SUBMIT_VIOLATION").length;

  els.statTotal.textContent = String(total);
  els.statAvg.textContent = String(avg);
  els.statWarned.textContent = String(warned);
  els.statAutoSubmitted.textContent = String(autoSub);

  els.tbody.innerHTML = "";
  if (total === 0) {
    els.tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;color:#64748b;">Belum ada peserta yang mengumpulkan ujian.</td></tr>`;
    return;
  }

  subs.forEach((s, idx) => {
    const vCount = s.violationCount || 0;
    const camWarnCount =
      s.cameraWarningCount !== undefined
        ? s.cameraWarningCount
        : (s.cameraWarnings || []).length;
    const snapCount =
      s.snapshotCount !== undefined ? s.snapshotCount : (s.snapshots || []).length;
    const statusBadge =
      s.status === "AUTO_SUBMIT_VIOLATION"
        ? `<span class="badge-danger">Auto-Submit (3x Curang)</span>`
        : vCount > 0
        ? `<span class="badge-warn">Selesai (${vCount}x Pelanggaran)</span>`
        : `<span class="badge-ok">Tertib</span>`;

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${idx + 1}</td>
      <td><strong>${escapeHtml(s.name)}</strong></td>
      <td>${escapeHtml(s.className)}</td>
      <td><strong>${s.score ?? "-"}</strong> (${s.correctCount ?? 0}/40)</td>
      <td>${s.answeredCount ?? 0} / ${s.totalQuestions ?? 40}</td>
      <td>${vCount} / 3</td>
      <td>${camWarnCount} catatan</td>
      <td>${statusBadge}</td>
      <td><button type="button" class="btn-outline-sm btn-detail" data-id="${escapeHtml(s.id)}">Jawaban & Bukti (${snapCount})</button></td>
    `;
    els.tbody.appendChild(tr);
  });

  els.tbody.querySelectorAll(".btn-detail").forEach((btn) => {
    btn.addEventListener("click", () => {
      const sub = cachedSubmissions.find((x) => x.id === btn.dataset.id);
      if (sub) openDetailModal(sub);
    });
  });
}

function renderSnapshotsGrid(snapshots, subId) {
  return (
    `<div class="res-snapshots-grid">` +
    snapshots
      .map((sn) => {
        const imgSrc = sn.dataUrl
          ? sn.dataUrl
          : `api/snapshot?pin=${encodeURIComponent(activePin)}&id=${encodeURIComponent(subId)}&file=${encodeURIComponent(sn.file)}`;
        return `
          <div class="snap-thumb">
            <img src="${imgSrc}" alt="Bukti" />
            <div>${escapeHtml(sn.reason)}</div>
          </div>`;
      })
      .join("") +
    `</div>`
  );
}

async function openDetailModal(sub) {
  els.detailTitle.textContent = `Jawaban & Pengawasan — ${sub.name} (${sub.className})`;

  // 40 Answers grid
  const answers = sub.answers || {};
  const answersGridHtml = `<div class="answers-grid">` +
    Array.from({ length: 40 }, (_, i) => {
      const num = String(i + 1);
      const chosen = answers[num] || "-";
      const key = ANSWER_KEYS[num];
      let cls = "ans-empty";
      if (chosen !== "-") {
        cls = chosen === key ? "ans-correct" : "ans-wrong";
      }
      return `<div class="ans-cell ${cls}" title="Kunci: ${key}"><span>${num}</span><strong>${escapeHtml(chosen)}</strong></div>`;
    }).join("") +
    `</div>`;

  let violationsHtml = "";
  if (Array.isArray(sub.violations) && sub.violations.length > 0) {
    violationsHtml = sub.violations
      .map(
        (v) =>
          `<div class="log-item danger">[${new Date(v.timestamp).toLocaleTimeString("id-ID")}] Pelanggaran #${v.count}: ${escapeHtml(v.reason)}</div>`
      )
      .join("");
  } else if (sub.violationSummaryText) {
    violationsHtml = `<div class="log-item danger">${escapeHtml(sub.violationSummaryText)}</div>`;
  } else {
    violationsHtml = `<div class="log-item">Tidak ada pelanggaran keluar aplikasi.</div>`;
  }

  let camWarnHtml = "";
  if (Array.isArray(sub.cameraWarnings) && sub.cameraWarnings.length > 0) {
    camWarnHtml = sub.cameraWarnings
      .map(
        (w) =>
          `<div class="log-item warn">[${new Date(w.timestamp).toLocaleTimeString("id-ID")}] Kamera: ${escapeHtml(w.message)}</div>`
      )
      .join("");
  } else if (sub.cameraSummaryText) {
    camWarnHtml = `<div class="log-item warn">Kamera: ${escapeHtml(sub.cameraSummaryText)}</div>`;
  }

  const hasLocalSnaps = Array.isArray(sub.snapshots) && sub.snapshots.length > 0;
  const activeSheetUrl = (els.cfgSpreadsheetUrl.value || "").trim();
  const canFetchRemoteSnaps =
    !hasLocalSnaps && activeSheetUrl && ((sub.snapshotCount || 0) > 0 || String(sub.source || "").includes("spreadsheet"));

  const snapsHtml = hasLocalSnaps
    ? renderSnapshotsGrid(sub.snapshots, sub.id)
    : canFetchRemoteSnaps
    ? `<p class="hint">Memuat tangkapan kamera pengawas...</p>`
    : `<p style="color:#64748b;">Tidak ada foto kamera tersimpan.</p>`;

  els.detailBody.innerHTML = `
    <p><strong>Status:</strong> ${escapeHtml(sub.statusLabel || sub.status)} | <strong>Nilai:</strong> ${sub.score} (${sub.correctCount}/40 benar)</p>
    <h4>Rincian 40 Jawaban Peserta (Hijau = Benar, Merah = Salah)</h4>
    ${answersGridHtml}
    <h4 class="mt-8">Log Pelanggaran & Peringatan Kamera</h4>
    <div class="res-log-list">${violationsHtml}${camWarnHtml}</div>
    <h4>Tangkapan Kamera Pengawas</h4>
    <div id="detail-snapshots-container">${snapsHtml}</div>
  `;
  els.detailModal.classList.remove("hidden");

  if (canFetchRemoteSnaps) {
    const container = document.getElementById("detail-snapshots-container");
    try {
      const res = await callSheetGet(activeSheetUrl, "snapshots", activePin, { id: sub.id });
      const fetched = Array.isArray(res.snapshots) ? res.snapshots : [];
      sub.snapshots = fetched;
      if (container) {
        container.innerHTML = fetched.length > 0
          ? renderSnapshotsGrid(fetched, sub.id)
          : `<p style="color:#64748b;">Tidak ada foto kamera tersimpan untuk peserta ini.</p>`;
      }
    } catch {
      if (container) {
        container.innerHTML = `<p style="color:#64748b;">Gagal memuat tangkapan kamera dari server sinkronisasi.</p>`;
      }
    }
  }
}

els.btnCloseDetail.addEventListener("click", () => {
  els.detailModal.classList.add("hidden");
});

els.btnOpenTutorial.addEventListener("click", () => {
  els.tutorialModal.classList.remove("hidden");
});

els.btnCloseTutorial.addEventListener("click", () => {
  els.tutorialModal.classList.add("hidden");
});

els.btnCopyGas.addEventListener("click", async () => {
  els.gasCopyStatus.textContent = "Menyalin...";
  try {
    const resp = await fetch("google-apps-script/Code.gs");
    if (!resp.ok) throw new Error("Gagal membaca Code.gs");
    const text = await resp.text();
    await navigator.clipboard.writeText(text);
    els.gasCopyStatus.textContent = "✅ Kode Apps Script berhasil disalin!";
  } catch (err) {
    els.gasCopyStatus.textContent = "Buka file google-apps-script/Code.gs untuk menyalin manual.";
  }
});

els.btnTestSheet.addEventListener("click", async () => {
  const url = els.cfgSpreadsheetUrl.value.trim();
  if (!url) {
    els.cfgMsg.innerHTML = `<div class="alert-error">Masukkan URL Web App Google Spreadsheet terlebih dahulu.</div>`;
    return;
  }
  els.cfgMsg.innerHTML = `<div class="hint">Menguji koneksi ke Google Spreadsheet...</div>`;
  try {
    const data = await callSheetGet(url, "ping", activePin);
    els.cfgMsg.innerHTML = `<div class="alert-success">✅ ${escapeHtml(data.message || "Koneksi Spreadsheet Aktif!")}</div>`;
  } catch (err) {
    const sep = url.includes("?") ? "&" : "?";
    const testLink = `${url}${sep}action=ping`;
    els.cfgMsg.innerHTML = `<div class="alert-error">
      ${escapeHtml(err.message)}
      <div class="mt-8">
        <a href="${escapeHtml(testLink)}" target="_blank" rel="noopener" class="btn-outline-sm">🔍 Buka Tes Langsung di Tab Baru</a>
      </div>
    </div>`;
  }
});

els.btnCopyConfig.addEventListener("click", async () => {
  const snippet = JSON.stringify(
    {
      examTitle: "Sumatif Akhir Semester (SAS) Ganjil 2026/2027",
      subject: "Ilmu Pengetahuan Alam (IPA) – Kelas IX",
      curriculum: "Kurikulum Merdeka – Fase D",
      material: "Bab 1 – Bab 3",
      examCode: els.cfgExamCode.value.trim().toUpperCase() || "IPA9SAS",
      teacherPin: activePin || "GURU2026",
      durationMinutes: Number(els.cfgDuration.value) || 120,
      maxViolations: 3,
      showScoreToStudent: els.cfgShowScore.value === "true",
      spreadsheetUrl: els.cfgSpreadsheetUrl.value.trim(),
      classes: ["IX A", "IX B", "IX C", "IX D"],
    },
    null,
    2
  );
  try {
    await navigator.clipboard.writeText(snippet);
    els.cfgMsg.innerHTML = `<div class="alert-success">✅ Konfigurasi <code>data/config.json</code> disalin ke clipboard! Tempel ke file <code>data/config.json</code> di GitHub lalu push.</div>`;
  } catch {
    els.cfgMsg.innerHTML = `<pre style="white-space:pre-wrap;font-size:0.8rem;background:#f8fafc;padding:10px;border-radius:8px;">${escapeHtml(snippet)}</pre>`;
  }
});

els.cfgForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  els.cfgMsg.innerHTML = "";
  const newCfg = {
    examCode: els.cfgExamCode.value.trim().toUpperCase(),
    durationMinutes: Number(els.cfgDuration.value),
    showScoreToStudent: els.cfgShowScore.value === "true",
    spreadsheetUrl: els.cfgSpreadsheetUrl.value.trim(),
  };

  if (isStaticMode) {
    const merged = { ...getLocalConfig(), ...newCfg };
    localStorage.setItem(LOCAL_CONFIG_KEY, JSON.stringify(merged));
    els.cfgMsg.innerHTML = `<div class="alert-success">Pengaturan tersimpan di browser ini. Untuk GitHub Pages lintas perangkat, jangan lupa salin URL ke <code>data/config.json</code>.</div>`;
    await loadDashboard();
    return;
  }

  const resp = await fetch("api/config", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pin: activePin, ...newCfg }),
  });
  const data = await resp.json();
  if (resp.ok && data.ok) {
    els.cfgMsg.innerHTML = `<div class="alert-success">${escapeHtml(data.message)}</div>`;
    await loadDashboard();
  } else {
    els.cfgMsg.innerHTML = `<div class="alert-error">${escapeHtml(data.message || "Gagal menyimpan.")}</div>`;
  }
});

els.btnRefresh.addEventListener("click", loadDashboard);

els.btnExportCsv.addEventListener("click", () => {
  if (!isStaticMode && !els.cfgSpreadsheetUrl.value.trim()) {
    window.location.href = `api/export-csv?pin=${encodeURIComponent(activePin)}`;
    return;
  }

  const headers = [
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
    ...Array.from({ length: 40 }, (_, i) => `J${i + 1}`),
  ];
  const rows = cachedSubmissions.map((s, i) => [
    i + 1,
    s.name || "",
    s.className || "",
    s.code || "",
    s.score ?? 0,
    s.correctCount ?? 0,
    s.totalQuestions ?? 40,
    s.answeredCount ?? 0,
    s.violationCount ?? 0,
    s.cameraWarningCount !== undefined ? s.cameraWarningCount : (s.cameraWarnings || []).length,
    s.statusLabel || s.status || "",
    s.startedAt || "",
    s.finishedAt || "",
    ...Array.from({ length: 40 }, (_, qIdx) => (s.answers || {})[String(qIdx + 1)] || ""),
  ]);
  const csv = [headers, ...rows]
    .map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","))
    .join("\n");
  const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "rekap_sas_ipa_kelas9.csv";
  a.click();
  URL.revokeObjectURL(url);
});

els.btnClearData.addEventListener("click", async () => {
  if (!confirm("Yakin ingin menghapus data lokal di perangkat ini? (Data yang sudah masuk di Google Spreadsheet tidak terhapus.)")) return;
  if (isStaticMode) {
    localStorage.removeItem(LOCAL_SUBMISSIONS_KEY);
    await loadDashboard();
    return;
  }
  const resp = await fetch("api/clear-submissions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pin: activePin }),
  });
  if (resp.ok) {
    await loadDashboard();
  }
});

function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
