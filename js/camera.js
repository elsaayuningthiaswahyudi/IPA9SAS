/**
 * Camera Proctoring Module:
 * - Requests webcam permission and attaches stream to setup & exam videos.
 * - Captures periodic & violation-triggered JPEG snapshots.
 * - Analyzes frames for suspicious conditions (covered/dark camera, sudden scene changes,
 *   missing face when FaceDetector API is available, or stopped camera stream).
 */
export class CameraProctor {
  constructor() {
    this.stream = null;
    this.snapshots = [];
    this.warnings = [];
    this.monitorTimer = null;
    this.periodicSnapTimer = null;
    this.canvas = document.createElement("canvas");
    this.ctx = this.canvas.getContext("2d", { willReadFrequently: true });
    this.prevFrameData = null;
    this.onWarningCallback = null;
    this.onStreamLostCallback = null;
    this.onSnapshotCountCallback = null;
    this.faceDetector =
      "FaceDetector" in window
        ? new window.FaceDetector({ fastMode: true, maxDetectedFaces: 3 })
        : null;
    this.lastWarningAt = 0;
  }

  isActive() {
    if (!this.stream) return false;
    const tracks = this.stream.getVideoTracks();
    return tracks.length > 0 && tracks[0].readyState === "live";
  }

  async startCamera(videoElements = []) {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error("Browser ini tidak mendukung akses kamera.");
    }

    if (!this.isActive()) {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 640 },
          height: { ideal: 480 },
          facingMode: "user",
        },
        audio: false,
      });

      const [track] = this.stream.getVideoTracks();
      if (track) {
        track.onended = () => {
          if (this.onStreamLostCallback) {
            this.onStreamLostCallback("Kamera pengawas terputus atau dimatikan!");
          }
        };
      }
    }

    this.attachToVideos(videoElements);
    return this.stream;
  }

  attachToVideos(videoElements) {
    if (!this.stream) return;
    videoElements.forEach((vid) => {
      if (vid && vid.srcObject !== this.stream) {
        vid.srcObject = this.stream;
        vid.play().catch(() => {});
      }
    });
  }

  captureSnapshot(videoEl, reason = "Pemantauan Berkala") {
    if (!this.isActive() || !videoEl || videoEl.videoWidth === 0) return null;

    const w = 320;
    const h = Math.round((videoEl.videoHeight / videoEl.videoWidth) * w) || 240;
    this.canvas.width = w;
    this.canvas.height = h;
    this.ctx.drawImage(videoEl, 0, 0, w, h);

    // Stamp timestamp & reason in corner for evidence clarity
    const ts = new Date().toLocaleTimeString("id-ID");
    this.ctx.fillStyle = "rgba(15, 23, 42, 0.72)";
    this.ctx.fillRect(0, h - 24, w, 24);
    this.ctx.fillStyle = "#ffffff";
    this.ctx.font = "11px sans-serif";
    this.ctx.fillText(`${ts} • ${reason}`.slice(0, 48), 8, h - 8);

    const dataUrl = this.canvas.toDataURL("image/jpeg", 0.62);
    const snap = {
      dataUrl,
      reason,
      timestamp: new Date().toISOString(),
    };
    this.snapshots.push(snap);
    if (this.onSnapshotCountCallback) {
      this.onSnapshotCountCallback(this.snapshots.length);
    }
    return snap;
  }

  recordCameraWarning(videoEl, message) {
    const now = Date.now();
    if (now - this.lastWarningAt < 8000) return;
    this.lastWarningAt = now;

    const entry = {
      message,
      timestamp: new Date().toISOString(),
    };
    this.warnings.push(entry);
    this.captureSnapshot(videoEl, `Peringatan: ${message}`);
    if (this.onWarningCallback) {
      this.onWarningCallback(message, entry);
    }
  }

  startMonitoring(videoEl) {
    this.stopMonitoring();
    this.prevFrameData = null;

    // Initial baseline snapshot
    setTimeout(() => this.captureSnapshot(videoEl, "Mulai Ujian"), 1200);

    // Periodic snapshot every 3 minutes
    this.periodicSnapTimer = setInterval(() => {
      this.captureSnapshot(videoEl, "Pemantauan Berkala");
    }, 180000);

    // Real-time frame inspection every 3.5 seconds
    this.monitorTimer = setInterval(async () => {
      if (!this.isActive() || !videoEl || videoEl.videoWidth === 0) return;

      const w = 160;
      const h = 120;
      this.canvas.width = w;
      this.canvas.height = h;
      this.ctx.drawImage(videoEl, 0, 0, w, h);
      const img = this.ctx.getImageData(0, 0, w, h).data;

      let totalBrightness = 0;
      let diffSum = 0;
      const pixelCount = w * h;

      for (let i = 0; i < img.length; i += 4) {
        const lum = 0.299 * img[i] + 0.587 * img[i + 1] + 0.114 * img[i + 2];
        totalBrightness += lum;
        if (this.prevFrameData) {
          diffSum += Math.abs(lum - this.prevFrameData[i / 4]);
        }
      }

      const currentLum = new Float32Array(pixelCount);
      for (let i = 0, p = 0; i < img.length; i += 4, p++) {
        currentLum[p] = 0.299 * img[i] + 0.587 * img[i + 1] + 0.114 * img[i + 2];
      }

      const avgBrightness = totalBrightness / pixelCount;
      const avgDiff = this.prevFrameData ? diffSum / pixelCount : 0;
      this.prevFrameData = currentLum;

      if (avgBrightness < 18) {
        this.recordCameraWarning(videoEl, "Kamera tertutup atau terlalu gelap");
        return;
      }

      if (avgDiff > 42) {
        this.recordCameraWarning(videoEl, "Pergerakan ekstrem / berpindah posisi");
        return;
      }

      if (this.faceDetector) {
        try {
          const faces = await this.faceDetector.detect(this.canvas);
          if (faces.length === 0) {
            this.recordCameraWarning(videoEl, "Wajah peserta tidak terlihat di kamera");
          } else if (faces.length > 1) {
            this.recordCameraWarning(videoEl, `Terdeteksi ${faces.length} wajah di depan kamera`);
          }
        } catch {
          // Ignore FaceDetector errors on unsupported platforms
        }
      }
    }, 3500);
  }

  stopMonitoring() {
    if (this.monitorTimer) {
      clearInterval(this.monitorTimer);
      this.monitorTimer = null;
    }
    if (this.periodicSnapTimer) {
      clearInterval(this.periodicSnapTimer);
      this.periodicSnapTimer = null;
    }
  }

  stopAll() {
    this.stopMonitoring();
    if (this.stream) {
      this.stream.getTracks().forEach((t) => t.stop());
      this.stream = null;
    }
  }
}
