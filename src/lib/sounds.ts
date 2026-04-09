class SoundManager {
  private ctx: AudioContext | null = null;
  private muted: boolean = false;

  private async init() {
    if (!this.ctx) {
      try {
        this.ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      } catch (e) {
        console.warn("Failed to create AudioContext:", e);
        return;
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      try {
        await this.ctx.resume();
      } catch (e) {
        // Ignore AbortError on resume
        if (e instanceof Error && e.name !== 'AbortError') {
          console.warn("AudioContext resume failed:", e);
        }
      }
    }
  }

  setMuted(muted: boolean) {
    this.muted = muted;
  }

  private async playTone(freq: number, type: OscillatorType, duration: number, volume: number, fade: boolean = true) {
    if (this.muted) return;
    await this.init();
    if (!this.ctx || this.ctx.state !== 'running') return;

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = type;
    osc.frequency.setValueAtTime(freq, this.ctx.currentTime);

    gain.gain.setValueAtTime(volume, this.ctx.currentTime);
    if (fade) {
      gain.gain.exponentialRampToValueAtTime(0.0001, this.ctx.currentTime + duration);
    }

    osc.connect(gain);
    gain.connect(this.ctx.destination);

    osc.start();
    osc.stop(this.ctx.currentTime + duration);
  }

  playEat() {
    this.playTone(600 + Math.random() * 200, 'sine', 0.1, 0.1);
  }

  async playPowerup() {
    if (this.muted) return;
    await this.init();
    if (!this.ctx || this.ctx.state !== 'running') return;

    const duration = 0.4;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(400, this.ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(1200, this.ctx.currentTime + duration);

    gain.gain.setValueAtTime(0.1, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, this.ctx.currentTime + duration);

    osc.connect(gain);
    gain.connect(this.ctx.destination);

    osc.start();
    osc.stop(this.ctx.currentTime + duration);
  }

  playDeath() {
    this.playTone(100, 'sawtooth', 0.5, 0.2);
    this.playTone(50, 'sine', 0.6, 0.3);
  }

  playClick() {
    this.playTone(1000, 'sine', 0.05, 0.05);
  }

  playBoost(active: boolean) {
    // This could be a looping sound, but for now let's just do a short burst
    if (active) {
      this.playTone(200, 'sine', 0.2, 0.05);
    }
  }
}

export const sounds = new SoundManager();
