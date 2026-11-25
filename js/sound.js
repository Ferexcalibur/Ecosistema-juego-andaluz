(function (global) {
  const EcoGame = (global.EcoGame = global.EcoGame || {});

  class SoundManager {
    constructor() {
      this.muted = false;
      this.ctx = null;
    }

    ensureCtx() {
      if (this.muted) return null;
      if (!this.ctx) {
        const AudioCtx = global.AudioContext || global.webkitAudioContext;
        if (AudioCtx) this.ctx = new AudioCtx();
      }
      if (this.ctx && this.ctx.state === "suspended") {
        this.ctx.resume().catch(() => {});
      }
      return this.ctx;
    }

    tone(freq, duration, type = "sine", gainVal = 0.08, delay = 0) {
      const ctx = this.ensureCtx();
      if (!ctx) return;
      const now = ctx.currentTime + delay;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, now);
      gain.gain.setValueAtTime(gainVal, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + duration);
    }

    playPop() {
      this.tone(520, 0.09, "triangle", 0.07);
      this.tone(680, 0.08, "triangle", 0.05, 0.04);
    }

    playGood() {
      this.tone(440, 0.1, "sine", 0.07, 0);
      this.tone(554, 0.1, "sine", 0.07, 0.07);
      this.tone(659, 0.15, "sine", 0.08, 0.14);
    }

    playWarn() {
      this.tone(300, 0.15, "sawtooth", 0.05, 0);
      this.tone(220, 0.22, "sawtooth", 0.05, 0.12);
    }

    playCard() {
      this.tone(330, 0.12, "triangle", 0.08, 0);
      this.tone(392, 0.12, "triangle", 0.08, 0.1);
      this.tone(494, 0.22, "triangle", 0.09, 0.2);
    }
  }

  EcoGame.sound = new SoundManager();
})(window);
