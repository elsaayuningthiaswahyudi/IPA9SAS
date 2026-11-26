let activePin = "";
let cachedSubmissions = [];

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
  cfgMsg: document.getElementById("cfg-msg"),

  btnRefresh: document.getElementById("btn-refresh-data"),
  btnExportCsv: document.getElementById("btn-export-csv"),
  btnClearData: document.getElementById("btn-clear-data"),

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

async function loadDashboard() {
  try {
    const resp = await fetch(`/api/submissions?pin=${encodeURIComponent(activePin)}`);
    const data = await resp.json();
    if (!resp.ok || !data.ok) {
      els.pinError.textContent = data.message || "PIN pengawas salah.";
      els.pinError.classList.remove("hidden");
      return;
    }

    els.pinGate.classList.add("hidden");
    els.dashboardContent.classList.remove("hidden");

    const cfg = data.config || {};
    els.cfgExamCode.value = cfg.examCode || "IPA9SAS";
    els.cfgDuration.value = cfg.durationMinutes || 90;
    els.cfgShowScore.value = String(cfg.showScoreToStudent !== false);

    cachedSubmissions = data.submissions || [];
    renderStatsAndTable(cachedSubmissions);
  } catch (err) {
    els.pinError.textContent = "Gagal terhubung ke server pengawas: " + err.message;
    els.pinError.classList.remove("hidden");
  }
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
    const camWarnCount = (s.cameraWarnings || []).length;
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
      <td><button type="button" class="btn-outline-sm btn-detail" data-id="${escapeHtml(s.id)}">Lihat Bukti (${(s.snapshots || []).length})</button></td>
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

function openDetailModal(sub) {
  els.detailTitle.textContent = `Bukti Pengawasan — ${sub.name} (${sub.className})`;
  const violationsHtml =
    (sub.violations || []).length === 0
      ? `<div class="log-item">Tidak ada pelanggaran keluar aplikasi.</div>`
      : sub.violations
          .map(
            (v) =>
              `<div class="log-item danger">[${new Date(v.timestamp).toLocaleTimeString("id-ID")}] Pelanggaran #${v.count}: ${escapeHtml(v.reason)}</div>`
          )
          .join("");

  const camWarnHtml = (sub.cameraWarnings || [])
    .map(
      (w) =>
        `<div class="log-item warn">[${new Date(w.timestamp).toLocaleTimeString("id-ID")}] Kamera: ${escapeHtml(w.message)}</div>`
    )
    .join("");

  const snapsHtml =
    (sub.snapshots || []).length === 0
      ? `<p style="color:#64748b;">Tidak ada foto kamera tersimpan.</p>`
      : `<div class="res-snapshots-grid">` +
        sub.snapshots
          .map(
            (sn) => `
          <div class="snap-thumb">
            <img src="/api/snapshot?pin=${encodeURIComponent(activePin)}&id=${encodeURIComponent(sub.id)}&file=${encodeURIComponent(sn.file)}" alt="Bukti" />
            <div>${escapeHtml(sn.reason)}</div>
          </div>`
          )
          .join("") +
        `</div>`;

  els.detailBody.innerHTML = `
    <p><strong>Status:</strong> ${escapeHtml(sub.statusLabel || sub.status)} | <strong>Nilai:</strong> ${sub.score} (${sub.correctCount}/40 benar)</p>
    <h4>Log Pelanggaran & Peringatan Kamera</h4>
    <div class="res-log-list">${violationsHtml}${camWarnHtml}</div>
    <h4>Tangkapan Kamera Pengawas</h4>
    ${snapsHtml}
  `;
  els.detailModal.classList.remove("hidden");
}

els.btnCloseDetail.addEventListener("click", () => {
  els.detailModal.classList.add("hidden");
});

els.cfgForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  els.cfgMsg.innerHTML = "";
  const resp = await fetch("/api/config", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      pin: activePin,
      examCode: els.cfgExamCode.value.trim().toUpperCase(),
      durationMinutes: Number(els.cfgDuration.value),
      showScoreToStudent: els.cfgShowScore.value === "true",
    }),
  });
  const data = await resp.json();
  if (resp.ok && data.ok) {
    els.cfgMsg.innerHTML = `<div class="alert-success">${escapeHtml(data.message)}</div>`;
  } else {
    els.cfgMsg.innerHTML = `<div class="alert-error">${escapeHtml(data.message || "Gagal menyimpan.")}</div>`;
  }
});

els.btnRefresh.addEventListener("click", loadDashboard);

els.btnExportCsv.addEventListener("click", () => {
  window.location.href = `/api/export-csv?pin=${encodeURIComponent(activePin)}`;
});

els.btnClearData.addEventListener("click", async () => {
  if (!confirm("Yakin ingin menghapus seluruh data pengumpulan dan foto kamera uji coba?")) return;
  const resp = await fetch("/api/clear-submissions", {
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
