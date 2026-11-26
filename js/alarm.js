/**
 * Cross-Device Combined Siren + Indonesian Human Voice Warning System
 * Works reliably on Android Chrome/WebView, iOS Safari, and Desktop browsers.
 *
 * Each audio track (alarm-test.wav, alarm-1.wav, alarm-2.wav, alarm-3.wav)
 * combines the emergency siren and the Indonesian human voice warning in a single
 * seamless track (loud siren -> ducked siren + clear human voice -> loud siren).
 * That guarantees:
 * 1. Whenever the siren plays, the human voice warning ALWAYS plays too.
 * 2. Zero setTimeout/multi-audio focus race conditions on Android in background tabs.
 * 3. Native <audio loop> keeps ringing until the student returns to the exam and clicks
 *    "Matikan Alarm & Kembali ke Ujian".
 */

const ALARM_FILES = {
  test: "assets/audio/alarm-test.wav?v=20261126e",
  1: "assets/audio/alarm-1.wav?v=20261126e",
  2: "assets/audio/alarm-2.wav?v=20261126e",
  3: "assets/audio/alarm-3.wav?v=20261126e",
};

const VOICE_TEXTS = {
  test: "Tes sirine dan suara peringatan pelanggaran. Pastikan volume speaker Anda terdengar jelas.",
  1: "Perhatian! Peringatan ke satu. Anda terdeteksi melakukan pelanggaran keluar dari halaman ujian. Harap segera kembali ke halaman ujian.",
  2: "Perhatian! Peringatan ke dua, ini adalah peringatan terakhir. Anda kembali melakukan pelanggaran. Jika melanggar satu kali lagi, ujian otomatis dihentikan dan jawaban dikirim.",
  3: "Perhatian! Peringatan ke tiga. Anda telah melakukan pelanggaran sebanyak tiga kali. Ujian dihentikan dan jawaban Anda otomatis dikirim ke pengawas.",
};

// Tiny 44-byte silent WAV data URI for instant offline user-gesture unlock
const SILENT_WAV_DATA_URI =
  "data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA";

class NaturalAlarm {
  constructor() {
    this.ctx = null;
    this.sirenMasterGain = null;
    this.sirenLoopTimer = null;
    this.timers = new Set();
    this.activeAudioNodes = new Set();
    this.currentUtterance = null;

    this.player = null;
    if (typeof Audio !== "undefined") {
      this.player = new Audio();
      this.player.preload = "auto";
      this.player.playsInline = true;
      this.player.setAttribute("playsinline", "");
      this.player.setAttribute("webkit-playsinline", "");
    }
    this.playerUnlocked = false;
    this.playerUnlocking = false;

    this.rawArrayBuffers = {};
    this.blobUrls = {};
    this.decodedBuffers = {};
    this.fetchingKeys = new Set();
    this.decodingKeys = new Set();

    this.isPlaying = false;
    this.isTestPlaying = false;
    this.activeKey = null;
    this.activeLoop = false;
    this.onTestStateChange = null;
    this.runId = 0;

    // Start preloading combined alarm files immediately on page load
    this.preloadAssets();

    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      try {
        window.speechSynthesis.getVoices();
      } catch {
        // Ignore
      }
    }
  }

  preloadAssets() {
    if (typeof fetch !== "function") return;
    Object.entries(ALARM_FILES).forEach(([key, url]) => {
      if (this.rawArrayBuffers[key] || this.fetchingKeys.has(key)) return;
      this.fetchingKeys.add(key);
      fetch(url)
        .then((resp) => (resp.ok ? resp.arrayBuffer() : null))
        .then((arr) => {
          if (!arr) return;
          this.rawArrayBuffers[key] = arr;
          if (!this.blobUrls[key] && typeof Blob !== "undefined" && typeof URL !== "undefined") {
            const blob = new Blob([arr], { type: "audio/wav" });
            this.blobUrls[key] = URL.createObjectURL(blob);
          }
          this._decodeKeyIfReady(key);
        })
        .catch(() => {
          // Will fallback to direct URL / SpeechSynthesis
        })
        .finally(() => {
          this.fetchingKeys.delete(key);
        });
    });
  }

  _decodeKeyIfReady(key) {
    if (!this.ctx || this.decodedBuffers[key] || this.decodingKeys.has(key)) return;
    const raw = this.rawArrayBuffers[key];
    if (!raw) return;

    this.decodingKeys.add(key);
    // Copy slice because decodeAudioData detaches the ArrayBuffer
    const copy = raw.slice(0);
    this.ctx
      .decodeAudioData(copy)
      .then((decoded) => {
        if (decoded) this.decodedBuffers[key] = decoded;
      })
      .catch(() => {
        // Ignore; <audio> element handles playback directly
      })
      .finally(() => {
        this.decodingKeys.delete(key);
      });
  }

  ensureContext() {
    if (!this.ctx && typeof window !== "undefined") {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === "suspended") {
      this.ctx.resume().catch(() => {});
    }
    if (this.ctx && !this.sirenMasterGain) {
      this.sirenMasterGain = this.ctx.createGain();
      this.sirenMasterGain.gain.setValueAtTime(0.65, this.ctx.currentTime);
      this.sirenMasterGain.connect(this.ctx.destination);
    }

    this.preloadAssets();
    if (this.ctx) {
      Object.keys(ALARM_FILES).forEach((key) => this._decodeKeyIfReady(key));
    }
    return this.ctx;
  }

  /**
   * Unlocks AudioContext and the single persistent <audio> player synchronously
   * inside a user gesture so delayed/background alarm playback is allowed on Android & iOS.
   */
  unlockFromGesture() {
    this.ensureContext();

    if (this.ctx) {
      try {
        const silentBuf = this.ctx.createBuffer(1, 1, 22050);
        const src = this.ctx.createBufferSource();
        src.buffer = silentBuf;
        src.connect(this.ctx.destination);
        src.start(0);
      } catch {
        // Ignore
      }
    }

    if (this.player && !this.playerUnlocked && !this.playerUnlocking && !this.isPlaying) {
      this.playerUnlocking = true;
      try {
        this.player.muted = true;
        this.player.volume = 0.01;
        this.player.loop = false;
        this.player.src = SILENT_WAV_DATA_URI;
        const p = this.player.play();
        if (p && typeof p.then === "function") {
          p.then(() => {
            this.playerUnlocked = true;
            this.playerUnlocking = false;
            if (!this.isPlaying && this.player.src.startsWith("data:audio/wav")) {
              this.player.pause();
              try {
                this.player.currentTime = 0;
              } catch {
                // Ignore
              }
              this.player.muted = false;
              this.player.volume = 1.0;
            }
          }).catch(() => {
            this.playerUnlocking = false;
            if (!this.isPlaying && this.player.src.startsWith("data:audio/wav")) {
              this.player.muted = false;
              this.player.volume = 1.0;
            }
          });
        } else {
          this.playerUnlocked = true;
          this.playerUnlocking = false;
          this.player.pause();
          this.player.muted = false;
          this.player.volume = 1.0;
        }
      } catch {
        this.playerUnlocking = false;
      }
    }

    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      try {
        window.speechSynthesis.getVoices();
      } catch {
        // Ignore
      }
    }
  }

  scheduleTimeout(fn, delayMs) {
    const id = setTimeout(() => {
      this.timers.delete(id);
      fn();
    }, delayMs);
    this.timers.add(id);
    return id;
  }

  trackNode(node) {
    this.activeAudioNodes.add(node);
    if ("onended" in node) {
      const prev = node.onended;
      node.onended = (...args) => {
        this.activeAudioNodes.delete(node);
        if (typeof prev === "function") prev(...args);
      };
    }
  }

  /**
   * Plays a combined siren+voice track via:
   * 1. Pre-unlocked persistent <audio> player (Blob URL or direct WAV URL)
   * 2. Pre-decoded Web Audio AudioBufferSourceNode
   * 3. Synthesized Web Audio siren + SpeechSynthesis fallback
   */
  _playTrack(key, loop, runId, onEnded) {
    this.activeKey = key;
    this.activeLoop = loop;

    if (this.player) {
      try {
        const srcUrl = this.blobUrls[key] || ALARM_FILES[key];
        this.player.onended = null;
        this.player.onerror = null;
        this.player.pause();
        this.player.loop = loop;
        this.player.muted = false;
        this.player.volume = 1.0;
        this.player.src = srcUrl;
        try {
          this.player.currentTime = 0;
        } catch {
          // Ignore seek before metadata
        }

        if (!loop && typeof onEnded === "function") {
          this.player.onended = () => {
            if (runId === this.runId && this.isPlaying) onEnded();
          };
        }

        this.player.onerror = () => {
          if (runId === this.runId && this.isPlaying) {
            this._playViaWebAudioFallback(key, loop, runId, onEnded);
          }
        };

        const p = this.player.play();
        if (p && typeof p.then === "function") {
          p.then(() => {
            this.playerUnlocked = true;
          }).catch(() => {
            if (runId === this.runId && this.isPlaying) {
              this._playViaWebAudioFallback(key, loop, runId, onEnded);
            }
          });
        }
        return;
      } catch {
        // Fall through to Web Audio fallback
      }
    }

    this._playViaWebAudioFallback(key, loop, runId, onEnded);
  }

  _playViaWebAudioFallback(key, loop, runId, onEnded) {
    if (!this.isPlaying || runId !== this.runId) return;
    const ctx = this.ensureContext();
    const buf = this.decodedBuffers[key];

    if (ctx && buf) {
      try {
        const src = ctx.createBufferSource();
        const gain = ctx.createGain();
        src.buffer = buf;
        src.loop = loop;
        gain.gain.setValueAtTime(1.0, ctx.currentTime);
        src.connect(gain);
        gain.connect(ctx.destination);
        this.trackNode(src);
        if (!loop && typeof onEnded === "function") {
          src.onended = () => {
            this.activeAudioNodes.delete(src);
            if (runId === this.runId && this.isPlaying) onEnded();
          };
        }
        src.start(ctx.currentTime);
        return;
      } catch {
        // Fall through to synthesized siren + SpeechSynthesis
      }
    }

    // Last-resort fallback: synthesized siren + SpeechSynthesis
    const urgent = key === 2 || key === 3;
    this._startSynthesizedSiren(urgent, loop, runId);
    this._speakFallbackText(key, runId, !loop ? onEnded : null);
  }

  _playSynthesizedSweep(urgent = false) {
    const ctx = this.ensureContext();
    if (!ctx || !this.sirenMasterGain) return 1.5;

    const now = ctx.currentTime;
    const dur = urgent ? 0.65 : 1.5;
    const lowFreq = urgent ? 520 : 460;
    const highFreq = urgent ? 1340 : 1180;
    const peakOffset = dur * 0.44;

    const oscMain = ctx.createOscillator();
    const oscSub = ctx.createOscillator();
    const filter = ctx.createBiquadFilter();
    const env = ctx.createGain();

    oscMain.type = "sawtooth";
    oscSub.type = "triangle";

    oscMain.frequency.setValueAtTime(lowFreq, now);
    oscMain.frequency.exponentialRampToValueAtTime(highFreq, now + peakOffset);
    oscMain.frequency.exponentialRampToValueAtTime(lowFreq, now + dur);

    oscSub.frequency.setValueAtTime(lowFreq * 1.0042, now);
    oscSub.frequency.exponentialRampToValueAtTime(highFreq * 1.0042, now + peakOffset);
    oscSub.frequency.exponentialRampToValueAtTime(lowFreq * 1.0042, now + dur);

    filter.type = "lowpass";
    filter.Q.setValueAtTime(1.6, now);
    filter.frequency.setValueAtTime(1500, now);
    filter.frequency.exponentialRampToValueAtTime(2850, now + peakOffset);
    filter.frequency.exponentialRampToValueAtTime(1500, now + dur);

    const subGain = ctx.createGain();
    subGain.gain.setValueAtTime(0.5, now);

    env.gain.setValueAtTime(0.001, now);
    env.gain.linearRampToValueAtTime(0.65, now + 0.04);
    env.gain.setValueAtTime(0.65, now + dur - 0.05);
    env.gain.linearRampToValueAtTime(0.001, now + dur);

    oscMain.connect(filter);
    oscSub.connect(subGain);
    subGain.connect(filter);
    filter.connect(env);
    env.connect(this.sirenMasterGain);

    this.trackNode(oscMain);
    this.trackNode(oscSub);

    oscMain.start(now);
    oscSub.start(now);
    oscMain.stop(now + dur + 0.02);
    oscSub.stop(now + dur + 0.02);

    return dur;
  }

  _startSynthesizedSiren(urgent, loop, runId) {
    if (this.sirenLoopTimer) {
      clearInterval(this.sirenLoopTimer);
      this.sirenLoopTimer = null;
    }
    const dur = this._playSynthesizedSweep(urgent);
    if (!loop) return;
    this.sirenLoopTimer = setInterval(() => {
      if (!this.isPlaying || runId !== this.runId) return;
      this._playSynthesizedSweep(urgent);
    }, Math.round(dur * 1000) - 30);
  }

  _speakFallbackText(key, runId, onDone) {
    if (!this.isPlaying || runId !== this.runId) return;
    if (typeof window === "undefined" || !("speechSynthesis" in window)) {
      if (typeof onDone === "function") this.scheduleTimeout(onDone, 3000);
      return;
    }

    try {
      const synth = window.speechSynthesis;
      if (synth.speaking || synth.pending) synth.cancel();

      this.scheduleTimeout(() => {
        if (!this.isPlaying || runId !== this.runId) return;
        const utter = new SpeechSynthesisUtterance(VOICE_TEXTS[key] || VOICE_TEXTS[1]);
        utter.lang = "id-ID";
        utter.rate = 0.98;
        utter.volume = 1.0;
        const voices = synth.getVoices ? synth.getVoices() : [];
        const idVoice =
          voices.find((v) => /id[-_]id/i.test(v.lang)) ||
          voices.find((v) => /indonesia|damayanti|gadis|ardi/i.test(v.name));
        if (idVoice) utter.voice = idVoice;

        utter.onend = () => {
          if (this.currentUtterance === utter) this.currentUtterance = null;
          if (typeof onDone === "function" && runId === this.runId && this.isPlaying) onDone();
        };
        utter.onerror = () => {
          if (this.currentUtterance === utter) this.currentUtterance = null;
          if (typeof onDone === "function" && runId === this.runId && this.isPlaying) onDone();
        };
        this.currentUtterance = utter;
        synth.speak(utter);
      }, 70);
    } catch {
      if (typeof onDone === "function") this.scheduleTimeout(onDone, 3000);
    }
  }

  /**
   * Resumes active alarm if mobile OS suspended playback while tab was hidden.
   */
  resumeIfPlaying() {
    if (!this.isPlaying) return;
    if (this.ctx && this.ctx.state === "suspended") {
      this.ctx.resume().catch(() => {});
    }
    if (this.player && this.player.paused) {
      this.player.muted = false;
      this.player.volume = 1.0;
      this.player.play().catch(() => {});
    }
  }

  /**
   * Plays combined siren + human voice preview on the login screen.
   */
  playTest(onStateChange) {
    if (this.isTestPlaying) {
      this.stop();
      return;
    }

    this.stop();
    this.ensureContext();
    this.isPlaying = true;
    this.isTestPlaying = true;
    this.onTestStateChange = typeof onStateChange === "function" ? onStateChange : null;
    const runId = this.runId;

    if (this.onTestStateChange) this.onTestStateChange(true);

    this._playTrack("test", false, runId, () => {
      if (runId === this.runId) this.stop();
    });
  }

  /**
   * Plays combined siren + human voice warning in a continuous loop for Violation 1 or 2
   * until stop() is called when the student returns to the exam and dismisses the overlay.
   */
  startContinuous(violationNumber = 1) {
    this.stop();
    this.ensureContext();
    this.isPlaying = true;
    this.isTestPlaying = false;
    const runId = this.runId;
    const vKey = violationNumber >= 2 ? 2 : 1;

    this._playTrack(vKey, true, runId, null);
  }

  /**
   * Plays urgent siren + 3rd violation human voice warning when auto-submitting.
   */
  playFinalAutoSubmit() {
    this.stop();
    this.ensureContext();
    this.isPlaying = true;
    this.isTestPlaying = false;
    const runId = this.runId;

    this._playTrack(3, false, runId, () => {
      if (runId === this.runId) this.stop();
    });
  }

  stop() {
    const notifyTestDone = this.onTestStateChange;
    this.onTestStateChange = null;

    this.runId += 1;
    this.isPlaying = false;
    this.isTestPlaying = false;
    this.activeKey = null;
    this.activeLoop = false;

    if (this.sirenLoopTimer) {
      clearInterval(this.sirenLoopTimer);
      this.sirenLoopTimer = null;
    }

    for (const id of this.timers) {
      clearTimeout(id);
    }
    this.timers.clear();

    if (this.player) {
      try {
        this.player.onended = null;
        this.player.onerror = null;
        this.player.pause();
        this.player.currentTime = 0;
        this.player.loop = false;
      } catch {
        // Ignore
      }
    }

    for (const node of this.activeAudioNodes) {
      try {
        node.onended = null;
        node.stop(0);
        node.disconnect();
      } catch {
        // Ignore
      }
    }
    this.activeAudioNodes.clear();

    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      try {
        window.speechSynthesis.cancel();
      } catch {
        // Ignore
      }
    }
    this.currentUtterance = null;

    if (typeof notifyTestDone === "function") {
      notifyTestDone(false);
    }
  }
}

export const naturalAlarm = new NaturalAlarm();
