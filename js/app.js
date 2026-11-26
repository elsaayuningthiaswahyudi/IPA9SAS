import { naturalAlarm } from "./alarm.js?v=20261126d";
import { CameraProctor } from "./camera.js";

const STORAGE_KEY = "sas_ipa9_active_session_v1";
const LOCAL_SUBMISSIONS_KEY = "sas_ipa9_local_submissions_v1";
const LOCAL_CONFIG_KEY = "sas_ipa9_config_v1";

const proctor = new CameraProctor();

const state = {
  sessionId: null,
  studentName: "",
  className: "",
  examCode: "",
  startedAt: null,
  durationSeconds: 120 * 60,
  remainingSeconds: 120 * 60,
  maxViolations: 3,
  spreadsheetUrl: "",
  questions: [],
  staticKeyQuestions: null,
  currentIndex: 0,
  answers: {},
  flagged: {},
  violationCount: 0,
  violations: [],
  examActive: false,
  isOutside: false,
  isSubmitting: false,
  lastViolationTs: 0,
  timerInterval: null,
};

// DOM Elements
const els = {
  loginView: document.getElementById("login-view"),
  examView: document.getElementById("exam-view"),
  resultView: document.getElementById("result-view"),

  loginForm: document.getElementById("login-form"),
  studentName: document.getElementById("student-name"),
  studentClass: document.getElementById("student-class"),
  examCode: document.getElementById("exam-code"),
  agreeRules: document.getElementById("agree-rules"),
  loginError: document.getElementById("login-error"),
  btnStartExam: document.getElementById("btn-start-exam"),

  setupVideo: document.getElementById("setup-video"),
  setupPlaceholder: document.getElementById("setup-camera-placeholder"),
  setupCamBadge: document.getElementById("setup-cam-badge"),
  btnEnableCamera: document.getElementById("btn-enable-camera"),
  pillCamera: document.getElementById("pill-camera"),
  cameraStatusText: document.getElementById("camera-status-text"),
  btnTestAlarm: document.getElementById("btn-test-alarm"),
  heroDurationChip: document.getElementById("hero-duration-chip"),

  displayName: document.getElementById("display-name"),
  displayClass: document.getElementById("display-class"),
  violationCounterPill: document.getElementById("violation-counter-pill"),
  violationCountText: document.getElementById("violation-count-text"),
  timerPill: document.getElementById("timer-pill"),
  timerDisplay: document.getElementById("timer-display"),
  btnFullscreenToggle: document.getElementById("btn-fullscreen-toggle"),
  btnFinishExam: document.getElementById("btn-finish-exam"),

  qNumberBadge: document.getElementById("q-number-badge"),
  qChapterBadge: document.getElementById("q-chapter-badge"),
  btnFlagQuestion: document.getElementById("btn-flag-question"),
  qText: document.getElementById("q-text"),
  qImageContainer: document.getElementById("q-image-container"),
  qImageNote: document.getElementById("q-image-note"),
  qImage: document.getElementById("q-image"),
  btnZoomImage: document.getElementById("btn-zoom-image"),
  qOptions: document.getElementById("q-options"),
  btnPrevQ: document.getElementById("btn-prev-q"),
  btnNextQ: document.getElementById("btn-next-q"),
  answeredProgressText: document.getElementById("answered-progress-text"),
  questionNavGrid: document.getElementById("question-nav-grid"),

  examVideo: document.getElementById("exam-video"),
  cameraAlertBanner: document.getElementById("camera-alert-banner"),
  proctorStatusLabel: document.getElementById("proctor-status-label"),
  snapshotCounter: document.getElementById("snapshot-counter"),

  violationOverlay: document.getElementById("violation-overlay"),
  violationTitle: document.getElementById("violation-title"),
  violationMessage: document.getElementById("violation-message"),
  overlayVCount: document.getElementById("overlay-v-count"),
  violationWarningNote: document.getElementById("violation-warning-note"),
  btnAckViolation: document.getElementById("btn-ack-violation"),

  confirmSubmitModal: document.getElementById("confirm-submit-modal"),
  confirmSubmitSummary: document.getElementById("confirm-submit-summary"),
  btnCancelSubmit: document.getElementById("btn-cancel-submit"),
  btnConfirmSubmit: document.getElementById("btn-confirm-submit"),

  imageZoomModal: document.getElementById("image-zoom-modal"),
  zoomCaption: document.getElementById("zoom-caption"),
  zoomedImg: document.getElementById("zoomed-img"),
  btnCloseZoom: document.getElementById("btn-close-zoom"),

  resultStatusBanner: document.getElementById("result-status-banner"),
  resultIcon: document.getElementById("result-icon"),
  resultTitle: document.getElementById("result-title"),
  resultSubtitle: document.getElementById("result-subtitle"),
  resName: document.getElementById("res-name"),
  resClass: document.getElementById("res-class"),
  resStatus: document.getElementById("res-status"),
  resAnswered: document.getElementById("res-answered"),
  resScoreBox: document.getElementById("res-score-box"),
  resScore: document.getElementById("res-score"),
  resViolations: document.getElementById("res-violations"),
  btnBackHome: document.getElementById("btn-back-home"),
};

// =========================================================
// INITIALIZATION & CAMERA SETUP
// =========================================================
function getLocalConfig() {
  try {
    return JSON.parse(localStorage.getItem(LOCAL_CONFIG_KEY) || "{}") || {};
  } catch {
    return {};
  }
}

async function loadEffectiveConfig() {
  const localCfg = getLocalConfig();
  try {
    const res = await fetch("api/exam-info");
    if (res.ok) {
      const info = await res.json();
      return {
        durationMinutes: info.durationMinutes || 120,
        maxViolations: info.maxViolations || 3,
        spreadsheetUrl: info.spreadsheetUrl || localCfg.spreadsheetUrl || "",
        examCode: localCfg.examCode || "",
        showScoreToStudent: info.showScoreToStudent !== false,
      };
    }
  } catch {
    // Fallback to static data/config.json
  }

  let fileCfg = {};
  try {
    const cfgResp = await fetch("data/config.json");
    if (cfgResp.ok) {
      fileCfg = await cfgResp.json();
    }
  } catch {
    // Ignore
  }

  return {
    durationMinutes: localCfg.durationMinutes || fileCfg.durationMinutes || 120,
    maxViolations: localCfg.maxViolations || fileCfg.maxViolations || 3,
    spreadsheetUrl: localCfg.spreadsheetUrl || fileCfg.spreadsheetUrl || "",
    examCode: localCfg.examCode || fileCfg.examCode || "IPA9SAS",
    showScoreToStudent:
      localCfg.showScoreToStudent !== undefined
        ? localCfg.showScoreToStudent
        : fileCfg.showScoreToStudent !== false,
  };
}

async function init() {
  bindEvents();
  const cfg = await loadEffectiveConfig();
  state.durationSeconds = cfg.durationMinutes * 60;
  state.remainingSeconds = state.durationSeconds;
  state.maxViolations = cfg.maxViolations;
  state.spreadsheetUrl = cfg.spreadsheetUrl;
  if (els.heroDurationChip) {
    els.heroDurationChip.textContent = `⏱️ Waktu ${cfg.durationMinutes} Menit`;
  }
}

async function activateSetupCamera() {
  els.loginError.classList.add("hidden");
  try {
    await proctor.startCamera([els.setupVideo, els.examVideo]);
    els.setupPlaceholder.classList.add("hidden");
    els.setupCamBadge.classList.remove("hidden");
    els.pillCamera.className = "status-pill ready";
    els.pillCamera.textContent = "Aktif";
    els.cameraStatusText.textContent = "Kamera pengawas aktif dan siap merekam bukti.";
    return true;
  } catch (err) {
    els.pillCamera.className = "status-pill error";
    els.pillCamera.textContent = "Ditolak";
    els.cameraStatusText.textContent =
      "Izin kamera diperlukan untuk mengikuti ujian. Silakan izinkan akses kamera di browser.";
    showLoginError(
      "Akses kamera gagal/ditolak: " + (err.message || "Izinkan kamera pada pengaturan browser Anda.")
    );
    return false;
  }
}

function showLoginError(msg) {
  els.loginError.textContent = msg;
  els.loginError.classList.remove("hidden");
}

function getSelectedClass() {
  return els.studentClass.value.trim();
}

async function requestFullscreenSafe() {
  const docEl = document.documentElement;
  if (!document.fullscreenElement && docEl.requestFullscreen) {
    try {
      await docEl.requestFullscreen();
    } catch {
      // Some embedded or automated browsers restrict programmatic fullscreen
    }
  }
}

function exitFullscreenSafe() {
  if (document.fullscreenElement && document.exitFullscreen) {
    document.exitFullscreen().catch(() => {});
  }
}

// =========================================================
// LOGIN & EXAM START
// =========================================================
async function loadExamQuestions() {
  // 1. Try local backend API first (keeps answer key on server)
  try {
    const qResp = await fetch("api/questions");
    if (qResp.ok) {
      const qJson = await qResp.json();
      if (Array.isArray(qJson.questions) && qJson.questions.length > 0) {
        state.staticKeyQuestions = null;
        return qJson.questions;
      }
    }
  } catch {
    // Ignore and fallback to static JSON / JS module
  }

  // 2. Fallback for static hosting (e.g., GitHub Pages)
  let rawList = null;
  try {
    const jsonResp = await fetch("data/questions.json");
    if (jsonResp.ok) {
      const parsed = await jsonResp.json();
      if (Array.isArray(parsed) && parsed.length > 0) {
        rawList = parsed;
      }
    }
  } catch {
    // Ignore and fallback to bundled JS module
  }

  // 3. Fallback for file:// or restricted environments
  if (!rawList) {
    const mod = await import("./questions-fallback.js");
    rawList = mod.FALLBACK_QUESTIONS || [];
  }

  state.staticKeyQuestions = rawList;
  return rawList.map((q) => ({
    number: q.number,
    chapter: q.chapter || "",
    question: q.question,
    image: q.image || null,
    imageNote: q.imageNote || null,
    options: q.options,
  }));
}

async function handleLoginSubmit(e) {
  e.preventDefault();
  els.loginError.classList.add("hidden");

  const name = els.studentName.value.trim();
  const className = getSelectedClass();
  const code = els.examCode.value.trim().toUpperCase();

  if (!name || !className || !code) {
    showLoginError("Mohon lengkapi Nama Lengkap, Kelas, dan Kode Masuk.");
    return;
  }
  if (!els.agreeRules.checked) {
    showLoginError("Centang persetujuan tata tertib ujian terlebih dahulu.");
    return;
  }

  // Stop any test preview and unlock audio + <audio> pool right inside user gesture
  naturalAlarm.stop();
  els.btnTestAlarm.textContent = "🔊 Uji Alarm";
  naturalAlarm.unlockFromGesture();

  // Ensure camera is active before entering exam
  if (!proctor.isActive()) {
    const okCam = await activateSetupCamera();
    if (!okCam) return;
  }

  els.btnStartExam.disabled = true;
  els.btnStartExam.textContent = "Memverifikasi...";

  try {
    let verified = false;
    let backendAvailable = false;
    try {
      const resp = await fetch("api/verify-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, className, code }),
      });
      const ct = resp.headers.get("content-type") || "";
      if (ct.includes("application/json")) {
        backendAvailable = true;
        const data = await resp.json();
        if (!resp.ok || !data.ok) {
          showLoginError(data.message || "Kode masuk tidak valid.");
          return;
        }
        state.sessionId = data.sessionId;
        state.durationSeconds = (data.durationMinutes || 120) * 60;
        state.remainingSeconds = state.durationSeconds;
        state.maxViolations = data.maxViolations || 3;
        verified = true;
      }
    } catch {
      // Network error -> use static fallback below
    }

    if (!backendAvailable) {
      const cfg = await loadEffectiveConfig();
      const expectedCode = (cfg.examCode || "IPA9SAS").trim().toUpperCase();
      if (code === expectedCode || (expectedCode === "IPA9SAS" && code === "SASIPA9")) {
        state.sessionId = "local_" + Date.now();
        state.durationSeconds = cfg.durationMinutes * 60;
        state.remainingSeconds = state.durationSeconds;
        state.maxViolations = cfg.maxViolations;
        state.spreadsheetUrl = cfg.spreadsheetUrl;
        verified = true;
      } else {
        showLoginError("Kode masuk salah! Hubungi guru/pengawas ujian.");
        return;
      }
    }

    if (!verified) return;

    // Load 40 questions (from backend API or static fallback)
    state.questions = await loadExamQuestions();
    if (state.questions.length === 0) throw new Error("Daftar soal kosong.");

    state.studentName = name;
    state.className = className;
    state.examCode = code;
    state.startedAt = new Date().toISOString();
    state.answers = {};
    state.flagged = {};
    state.currentIndex = 0;
    state.violationCount = 0;
    state.violations = [];
    state.isOutside = false;
    state.isSubmitting = false;

    await enterExamRoom();
  } catch (err) {
    showLoginError(err.message || "Terjadi kesalahan saat memulai ujian.");
  } finally {
    els.btnStartExam.disabled = false;
    els.btnStartExam.textContent = "🚀 Mulai Ujian Sekarang";
  }
}

async function enterExamRoom() {
  els.displayName.textContent = state.studentName;
  els.displayClass.textContent = `Kelas ${state.className} • Kode: ${state.examCode}`;
  updateViolationUI();

  els.loginView.classList.add("hidden");
  els.resultView.classList.add("hidden");
  els.examView.classList.remove("hidden");

  proctor.attachToVideos([els.examVideo]);
  proctor.onSnapshotCountCallback = (count) => {
    els.snapshotCounter.textContent = `${count} Bukti`;
  };
  proctor.onWarningCallback = (msg) => {
    els.proctorStatusLabel.textContent = `⚠ ${msg}`;
    els.proctorStatusLabel.className = "proctor-warn";
    els.cameraAlertBanner.textContent = msg;
    els.cameraAlertBanner.classList.remove("hidden");
    setTimeout(() => {
      if (state.examActive) {
        els.cameraAlertBanner.classList.add("hidden");
        els.proctorStatusLabel.textContent = "● Pemantauan Normal";
        els.proctorStatusLabel.className = "proctor-ok";
      }
    }, 5500);
  };
  proctor.onStreamLostCallback = (msg) => {
    if (!state.examActive) return;
    handleExitViolation(`Kamera dimatikan/terputus (${msg})`);
  };

  proctor.startMonitoring(els.examVideo);

  renderNavGrid();
  renderQuestion(0);
  startExamTimer();

  await requestFullscreenSafe();

  // Enable anti-cheat listeners slightly after fullscreen transition settles
  setTimeout(() => {
    state.examActive = true;
  }, 800);
}

// =========================================================
// QUESTIONS & NAVIGATION
// =========================================================
function renderQuestion(index) {
  state.currentIndex = index;
  const q = state.questions[index];
  if (!q) return;

  els.qNumberBadge.textContent = `Soal No. ${q.number} / ${state.questions.length}`;
  els.qChapterBadge.textContent = q.chapter || "IPA Kelas IX";
  els.qText.textContent = q.question;

  if (q.image) {
    els.qImage.src = q.image;
    els.qImage.alt = `Gambar Soal Nomor ${q.number}`;
    els.qImageContainer.classList.remove("hidden");
    if (q.imageNote) {
      els.qImageNote.textContent = q.imageNote;
      els.qImageNote.classList.remove("hidden");
    } else {
      els.qImageNote.classList.add("hidden");
    }
  } else {
    els.qImageContainer.classList.add("hidden");
    els.qImage.src = "";
  }

  // Flag button
  const isFlagged = Boolean(state.flagged[q.number]);
  els.btnFlagQuestion.classList.toggle("flagged", isFlagged);
  els.btnFlagQuestion.textContent = isFlagged ? "⚑ Ditandai Ragu-ragu" : "⚑ Tandai Ragu-ragu";

  // Options A-D
  const chosen = state.answers[String(q.number)] || null;
  els.qOptions.innerHTML = "";
  ["A", "B", "C", "D"].forEach((letter) => {
    const optText = q.options[letter];
    if (!optText) return;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "option-btn" + (chosen === letter ? " selected" : "");
    btn.innerHTML = `<span class="opt-letter">${letter}</span><span>${escapeHtml(optText)}</span>`;
    btn.addEventListener("click", () => selectAnswer(q.number, letter));
    els.qOptions.appendChild(btn);
  });

  els.btnPrevQ.disabled = index === 0;
  els.btnNextQ.textContent =
    index === state.questions.length - 1 ? "Selesai & Kumpulkan ✔" : "Selanjutnya →";

  updateProgressAndNav();
}

function selectAnswer(qNumber, letter) {
  state.answers[String(qNumber)] = letter;
  saveProgressSnapshot();
  renderQuestion(state.currentIndex);
}

function toggleFlag() {
  const q = state.questions[state.currentIndex];
  if (!q) return;
  state.flagged[q.number] = !state.flagged[q.number];
  renderQuestion(state.currentIndex);
}

function renderNavGrid() {
  els.questionNavGrid.innerHTML = "";
  state.questions.forEach((q, idx) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "nav-num-btn";
    btn.textContent = q.number;
    btn.dataset.index = String(idx);
    btn.addEventListener("click", () => renderQuestion(idx));
    els.questionNavGrid.appendChild(btn);
  });
}

function updateProgressAndNav() {
  const answeredCount = Object.keys(state.answers).length;
  els.answeredProgressText.textContent = `Terjawab: ${answeredCount} / ${state.questions.length}`;

  const buttons = els.questionNavGrid.querySelectorAll(".nav-num-btn");
  buttons.forEach((btn, idx) => {
    const q = state.questions[idx];
    btn.classList.remove("answered", "flagged", "current");
    if (state.flagged[q.number]) {
      btn.classList.add("flagged");
    } else if (state.answers[String(q.number)]) {
      btn.classList.add("answered");
    }
    if (idx === state.currentIndex) {
      btn.classList.add("current");
    }
  });
}

function saveProgressSnapshot() {
  try {
    sessionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        sessionId: state.sessionId,
        answers: state.answers,
        violationCount: state.violationCount,
      })
    );
  } catch {
    // Ignore storage quota issues
  }
}

// =========================================================
// TIMER
// =========================================================
function startExamTimer() {
  clearInterval(state.timerInterval);
  renderTimer();
  state.timerInterval = setInterval(() => {
    state.remainingSeconds -= 1;
    renderTimer();
    if (state.remainingSeconds <= 0) {
      clearInterval(state.timerInterval);
      submitExam("AUTO_SUBMIT_TIME");
    }
  }, 1000);
}

function renderTimer() {
  const s = Math.max(0, state.remainingSeconds);
  const mins = Math.floor(s / 60);
  const secs = s % 60;
  els.timerDisplay.textContent = `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  els.timerPill.classList.toggle("urgent", s <= 300);
}

// =========================================================
// ANTI-CHEAT: EXIT DETECTION, NATURAL ALARM & 3X AUTO-SUBMIT
// =========================================================
function handleExitViolation(reason) {
  if (!state.examActive || state.isSubmitting) return;

  const now = Date.now();
  // Debounce simultaneous blur + visibilitychange + fullscreenchange from the same exit event
  if (state.isOutside || now - state.lastViolationTs < 900) {
    return;
  }

  state.isOutside = true;
  state.lastViolationTs = now;
  state.violationCount += 1;

  const vNum = state.violationCount;
  const entry = {
    count: vNum,
    reason,
    timestamp: new Date().toISOString(),
  };
  state.violations.push(entry);

  // Capture webcam photo immediately on violation
  proctor.captureSnapshot(els.examVideo, `Pelanggaran #${vNum}: ${reason}`);
  updateViolationUI();
  saveProgressSnapshot();

  if (vNum >= state.maxViolations) {
    // 3rd violation -> Sound final alert and auto-submit immediately
    naturalAlarm.playFinalAutoSubmit();
    els.violationOverlay.classList.add("hidden");
    submitExam("AUTO_SUBMIT_VIOLATION");
    return;
  }

  // 1st or 2nd violation -> Continuous siren + human voice warning + blocking overlay
  naturalAlarm.startContinuous(vNum);
  els.overlayVCount.textContent = String(vNum);
  els.violationTitle.textContent =
    vNum === 2 ? "PERINGATAN KE-2 (TERAKHIR)!" : "PERINGATAN PELANGGARAN KE-1!";
  els.violationMessage.textContent = `Terdeteksi: ${reason}. Sirine dan suara peringatan ke-${vNum} berbunyi otomatis.`;
  els.violationWarningNote.textContent =
    vNum === 2
      ? "PERHATIAN: Ini adalah peringatan ke-2. Jika keluar 1 kali lagi (ke-3), jawaban Anda OTOMATIS TERKIRIM dan ujian berakhir!"
      : "Ini adalah peringatan ke-1. Jika melakukan pelanggaran hingga 3 kali, jawaban otomatis terkirim dan ujian berakhir.";
  els.violationOverlay.classList.remove("hidden");
}

function updateViolationUI() {
  els.violationCountText.textContent = `${state.violationCount} / ${state.maxViolations}`;
  els.violationCounterPill.classList.remove("level-0", "level-1", "level-2");
  if (state.violationCount === 0) {
    els.violationCounterPill.classList.add("level-0");
  } else if (state.violationCount === 1) {
    els.violationCounterPill.classList.add("level-1");
  } else {
    els.violationCounterPill.classList.add("level-2");
  }
}

async function acknowledgeViolation() {
  naturalAlarm.stop();
  els.violationOverlay.classList.add("hidden");
  await requestFullscreenSafe();
  // Short grace delay before re-arming exit detection
  setTimeout(() => {
    state.isOutside = false;
  }, 500);
}

// =========================================================
// SUBMIT & RESULT
// =========================================================
function openConfirmSubmitModal() {
  const answered = Object.keys(state.answers).length;
  const unanswered = state.questions.length - answered;
  els.confirmSubmitSummary.textContent =
    unanswered > 0
      ? `Anda baru menjawab ${answered} dari ${state.questions.length} soal (${unanswered} soal belum dijawab). Yakin ingin mengumpulkan sekarang?`
      : `Seluruh ${state.questions.length} soal sudah terjawab. Yakin ingin mengumpulkan jawaban sekarang?`;
  els.confirmSubmitModal.classList.remove("hidden");
}

async function submitExam(status) {
  if (state.isSubmitting) return;
  state.isSubmitting = true;
  state.examActive = false;

  clearInterval(state.timerInterval);
  els.confirmSubmitModal.classList.add("hidden");
  els.imageZoomModal.classList.add("hidden");
  els.violationOverlay.classList.add("hidden");

  if (status !== "AUTO_SUBMIT_VIOLATION") {
    naturalAlarm.stop();
  }

  proctor.captureSnapshot(els.examVideo, "Selesai Ujian");
  proctor.stopMonitoring();
  exitFullscreenSafe();

  const finishedAt = new Date().toISOString();
  const payload = {
    sessionId: state.sessionId,
    name: state.studentName,
    className: state.className,
    code: state.examCode,
    startedAt: state.startedAt,
    finishedAt,
    durationSeconds: state.durationSeconds - Math.max(0, state.remainingSeconds),
    status,
    answers: state.answers,
    violationCount: state.violationCount,
    violations: state.violations,
    cameraWarnings: proctor.warnings,
    snapshots: proctor.snapshots,
  };

  let serverRes = null;
  try {
    const resp = await fetch("api/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const ct = resp.headers.get("content-type") || "";
    if (resp.ok && ct.includes("application/json")) {
      serverRes = await resp.json();
    }
  } catch {
    // Handled by static fallback below
  }

  if (!serverRes) {
    const statusMap = {
      SUBMITTED_MANUAL: "Selesai (Dikumpulkan Siswa)",
      AUTO_SUBMIT_TIME: "Selesai Otomatis (Waktu Habis)",
      AUTO_SUBMIT_VIOLATION: "Dihentikan Otomatis (3x Keluar Aplikasi)",
    };
    const keyList = state.staticKeyQuestions || [];
    const totalQuestions = keyList.length || state.questions.length || 40;
    let correctCount = 0;
    let answeredCount = 0;
    keyList.forEach((q) => {
      const chosen = payload.answers[String(q.number)];
      if (chosen) {
        answeredCount += 1;
        if (chosen === q.answer) correctCount += 1;
      }
    });
    const score = totalQuestions ? Math.round((correctCount / totalQuestions) * 1000) / 10 : 0;
    const cfg = await loadEffectiveConfig();
    const showScore = cfg.showScoreToStudent !== false;

    const localRecord = {
      id: payload.sessionId,
      name: payload.name,
      className: payload.className,
      code: payload.code,
      startedAt: payload.startedAt,
      finishedAt: payload.finishedAt,
      durationSeconds: payload.durationSeconds,
      totalQuestions,
      answeredCount,
      correctCount,
      score,
      status: payload.status,
      statusLabel: statusMap[payload.status] || payload.status,
      violationCount: payload.violationCount,
      violations: payload.violations,
      cameraWarnings: payload.cameraWarnings,
      snapshots: (payload.snapshots || []).slice(0, 10),
      answers: payload.answers,
    };

    try {
      const existing = JSON.parse(localStorage.getItem(LOCAL_SUBMISSIONS_KEY) || "[]");
      const filtered = existing.filter((x) => x.id !== localRecord.id);
      filtered.unshift(localRecord);
      localStorage.setItem(LOCAL_SUBMISSIONS_KEY, JSON.stringify(filtered.slice(0, 25)));
    } catch {
      // Ignore storage quota issues
    }

    // Forward to Google Spreadsheet Web App if configured
    const sheetUrl = (state.spreadsheetUrl || cfg.spreadsheetUrl || "").trim();
    if (sheetUrl) {
      const sheetPayload = {
        ...localRecord,
        snapshots: (payload.snapshots || []).slice(0, 5),
      };
      try {
        await fetch(sheetUrl, {
          method: "POST",
          headers: { "Content-Type": "text/plain;charset=utf-8" },
          body: JSON.stringify(sheetPayload),
        });
      } catch {
        try {
          await fetch(sheetUrl, {
            method: "POST",
            mode: "no-cors",
            body: JSON.stringify(sheetPayload),
          });
        } catch {
          // Ignore network error during fallback
        }
      }
    }

    serverRes = {
      ok: true,
      id: localRecord.id,
      statusLabel: localRecord.statusLabel,
      answeredCount,
      totalQuestions,
      showScoreToStudent: showScore,
      score: showScore ? score : null,
      correctCount: showScore ? correctCount : null,
    };
  }

  proctor.stopAll();
  sessionStorage.removeItem(STORAGE_KEY);
  renderResultScreen(payload, serverRes);
}

function renderResultScreen(payload, serverRes) {
  els.examView.classList.add("hidden");
  els.resultView.classList.remove("hidden");

  const isAutoViolation = payload.status === "AUTO_SUBMIT_VIOLATION";
  els.resultStatusBanner.className = "result-banner " + (isAutoViolation ? "violation" : "success");
  els.resultIcon.textContent = isAutoViolation ? "🚨" : "✅";
  els.resultTitle.textContent = isAutoViolation
    ? "Ujian Dihentikan Otomatis (3x Keluar Aplikasi)"
    : payload.status === "AUTO_SUBMIT_TIME"
    ? "Waktu Habis — Jawaban Terkirim Otomatis"
    : "Jawaban Ujian Berhasil Dikirim";

  els.resultSubtitle.textContent = isAutoViolation
    ? "Sistem mendeteksi 3 kali pelanggaran keluar dari aplikasi ujian. Jawaban yang sudah terisi langsung dikirim ke pengawas."
    : "Terima kasih telah mengikuti Sumatif Akhir Semester (SAS) Ganjil IPA Kelas IX.";

  els.resName.textContent = payload.name;
  els.resClass.textContent = payload.className;
  els.resStatus.textContent =
    (serverRes && serverRes.statusLabel) ||
    (isAutoViolation ? "Dihentikan Otomatis (3x Pelanggaran)" : "Selesai Dikumpulkan");

  const answered = Object.keys(payload.answers).length;
  els.resAnswered.textContent = `${answered} / ${state.questions.length} soal`;
  els.resViolations.textContent = `${payload.violationCount} / ${state.maxViolations} kali`;

  if (serverRes && serverRes.showScoreToStudent && serverRes.score !== null) {
    els.resScoreBox.classList.remove("hidden");
    els.resScore.textContent = `${serverRes.score} (${serverRes.correctCount}/${serverRes.totalQuestions} benar)`;
  } else {
    els.resScoreBox.classList.add("hidden");
  }
}

// =========================================================
// EVENT LISTENERS & ANTI-CHEAT LOCKS
// =========================================================
function bindEvents() {
  // Unlock mobile/desktop audio elements as early as possible on any user interaction
  const unlockAndResume = () => {
    naturalAlarm.unlockFromGesture();
    naturalAlarm.resumeIfPlaying();
  };
  ["pointerdown", "touchstart", "click", "keydown"].forEach((evt) => {
    document.addEventListener(evt, unlockAndResume, { passive: true });
  });

  els.btnEnableCamera.addEventListener("click", () => {
    naturalAlarm.unlockFromGesture();
    activateSetupCamera();
  });
  els.btnTestAlarm.addEventListener("click", () => {
    naturalAlarm.playTest((playing) => {
      els.btnTestAlarm.textContent = playing ? "🔇 Hentikan Uji" : "🔊 Uji Alarm";
    });
  });

  els.loginForm.addEventListener("submit", handleLoginSubmit);

  els.btnPrevQ.addEventListener("click", () => {
    if (state.currentIndex > 0) renderQuestion(state.currentIndex - 1);
  });

  els.btnNextQ.addEventListener("click", () => {
    if (state.currentIndex < state.questions.length - 1) {
      renderQuestion(state.currentIndex + 1);
    } else {
      openConfirmSubmitModal();
    }
  });

  els.btnFlagQuestion.addEventListener("click", toggleFlag);
  els.btnFullscreenToggle.addEventListener("click", requestFullscreenSafe);
  els.btnFinishExam.addEventListener("click", openConfirmSubmitModal);
  els.btnCancelSubmit.addEventListener("click", () => els.confirmSubmitModal.classList.add("hidden"));
  els.btnConfirmSubmit.addEventListener("click", () => submitExam("SUBMITTED_MANUAL"));

  els.btnZoomImage.addEventListener("click", () => {
    const q = state.questions[state.currentIndex];
    if (!q || !q.image) return;
    els.zoomCaption.textContent = `Gambar Soal Nomor ${q.number}`;
    els.zoomedImg.src = q.image;
    els.imageZoomModal.classList.remove("hidden");
  });

  els.btnCloseZoom.addEventListener("click", () => {
    els.imageZoomModal.classList.add("hidden");
  });

  els.btnAckViolation.addEventListener("click", acknowledgeViolation);

  els.btnBackHome.addEventListener("click", () => {
    window.location.reload();
  });

  // 1. Detect tab switch / minimize app, and resume alarm if student returns before acknowledging
  document.addEventListener("visibilitychange", () => {
    if (document.hidden && state.examActive) {
      handleExitViolation("Berpindah tab atau meminimalkan aplikasi");
    } else if (!document.hidden) {
      naturalAlarm.resumeIfPlaying();
    }
  });

  // 2. Detect switching to another window / app, and resume alarm on focus return
  window.addEventListener("blur", () => {
    if (state.examActive) {
      handleExitViolation("Keluar dari jendela aplikasi ujian");
    }
  });
  window.addEventListener("focus", () => {
    naturalAlarm.resumeIfPlaying();
  });
  window.addEventListener("pageshow", () => {
    naturalAlarm.resumeIfPlaying();
  });

  // 3. Detect exiting fullscreen mode
  document.addEventListener("fullscreenchange", () => {
    if (!document.fullscreenElement && state.examActive) {
      handleExitViolation("Keluar dari mode layar penuh (Fullscreen)");
    }
  });

  // Block context menu & copy/paste during active exam
  document.addEventListener("contextmenu", (e) => {
    if (state.examActive) e.preventDefault();
  });

  ["copy", "cut", "paste"].forEach((evt) => {
    document.addEventListener(evt, (e) => {
      if (state.examActive) e.preventDefault();
    });
  });

  // Block common DevTools / cheat shortcuts
  document.addEventListener("keydown", (e) => {
    if (!state.examActive) return;
    const key = e.key.toLowerCase();
    const ctrlOrMeta = e.ctrlKey || e.metaKey;
    if (
      e.key === "F12" ||
      (ctrlOrMeta && e.shiftKey && ["i", "j", "c"].includes(key)) ||
      (ctrlOrMeta && ["u", "c", "x", "p", "s"].includes(key))
    ) {
      e.preventDefault();
    }
  });
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

init();
