/**
 * Natural Alarm Sound Synthesizer (Web Audio API + optional Indonesian speech alert).
 * Produces a resonant acoustic warning chime / school-bell-like dual-tone siren
 * so it sounds natural, clear, and works offline without external audio files.
 */
class NaturalAlarm {
  constructor() {
    this.ctx = null;
    this.loopTimer = null;
    this.isPlaying = false;
    this.lastSpeechAt = 0;
  }

  ensureContext() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === "suspended") {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  /**
   * Plays one natural harmonic dual-chime pulse (acoustic bell + warm warning tone).
   */
  playChimeCycle(urgent = false) {
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const notes = urgent
      ? [
          { freq: 880, offset: 0.0, dur: 0.34 },
          { freq: 659.25, offset: 0.28, dur: 0.36 },
          { freq: 880, offset: 0.58, dur: 0.34 },
        ]
      : [
          { freq: 783.99, offset: 0.0, dur: 0.42 },
          { freq: 587.33, offset: 0.34, dur: 0.55 },
        ];

    notes.forEach(({ freq, offset, dur }) => {
      const start = now + offset;
      // Fundamental + gentle 2nd & 3rd harmonics for a natural acoustic bell timbre
      const harmonics = [
        { mult: 1, gain: 0.34, type: "sine" },
        { mult: 2, gain: 0.11, type: "triangle" },
        { mult: 3, gain: 0.05, type: "sine" },
      ];

      harmonics.forEach((h) => {
        const osc = ctx.createOscillator();
        const gainNode = ctx.createGain();
        const filter = ctx.createBiquadFilter();

        osc.type = h.type;
        osc.frequency.setValueAtTime(freq * h.mult, start);

        filter.type = "lowpass";
        filter.frequency.setValueAtTime(2800, start);

        // Natural attack and exponential decay envelope
        gainNode.gain.setValueAtTime(0.0001, start);
        gainNode.gain.linearRampToValueAtTime(h.gain, start + 0.025);
        gainNode.gain.exponentialRampToValueAtTime(0.0008, start + dur);

        osc.connect(filter);
        filter.connect(gainNode);
        gainNode.connect(ctx.destination);

        osc.start(start);
        osc.stop(start + dur + 0.05);
      });
    });
  }

  speakWarning(violationNumber) {
    if (!("speechSynthesis" in window)) return;
    const now = Date.now();
    if (now - this.lastSpeechAt < 4000) return;
    this.lastSpeechAt = now;

    try {
      window.speechSynthesis.cancel();
      const text =
        violationNumber >= 3
          ? "Peringatan terakhir! Anda keluar aplikasi tiga kali. Jawaban otomatis dikirim."
          : `Peringatan pelanggaran ke ${violationNumber}! Anda terdeteksi keluar dari halaman ujian.`;
      const utter = new SpeechSynthesisUtterance(text);
      utter.lang = "id-ID";
      utter.rate = 1.02;
      utter.pitch = 1.0;
      utter.volume = 1.0;
      window.speechSynthesis.speak(utter);
    } catch {
      // Ignore if speech synthesis is unavailable
    }
  }

  /**
   * Plays a brief preview chime on the login screen.
   */
  playTest() {
    this.playChimeCycle(false);
  }

  /**
   * Starts continuous natural alarm until stop() is called.
   */
  startContinuous(violationNumber = 1) {
    this.stop();
    this.isPlaying = true;
    const urgent = violationNumber >= 2;
    this.playChimeCycle(urgent);
    this.speakWarning(violationNumber);

    this.loopTimer = setInterval(() => {
      if (!this.isPlaying) return;
      this.playChimeCycle(urgent);
    }, urgent ? 1150 : 1450);
  }

  /**
   * Plays a final alert tone when auto-submitting on the 3rd violation.
   */
  playFinalAutoSubmit() {
    this.stop();
    this.playChimeCycle(true);
    this.speakWarning(3);
  }

  stop() {
    this.isPlaying = false;
    if (this.loopTimer) {
      clearInterval(this.loopTimer);
      this.loopTimer = null;
    }
    if ("speechSynthesis" in window) {
      try {
        window.speechSynthesis.cancel();
      } catch {
        // Ignore
      }
    }
  }
}

export const naturalAlarm = new NaturalAlarm();
