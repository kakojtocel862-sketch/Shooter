import { WeaponId } from './types';

export class SoundEngine {
  private ctx: AudioContext | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private muted = false;

  public isMuted(): boolean {
    return this.muted;
  }

  public setMuted(mute: boolean): void {
    this.muted = mute;
  }

  public toggleMute(): boolean {
    this.muted = !this.muted;
    return this.muted;
  }

  private ensureContext(): AudioContext | null {
    if (this.muted) return null;
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return null;
      this.ctx = new AudioCtx();
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    if (!this.noiseBuffer && this.ctx) {
      const sampleRate = this.ctx.sampleRate;
      const length = Math.floor(sampleRate * 0.6);
      const buffer = this.ctx.createBuffer(1, length, sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < length; i++) {
        data[i] = Math.random() * 2 - 1;
      }
      this.noiseBuffer = buffer;
    }
    return this.ctx;
  }

  public unlock(): void {
    this.ensureContext();
  }

  public playShoot(weapon: WeaponId): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.noiseBuffer) return;
    const now = ctx.currentTime;

    if (weapon === 'rifle') {
      // Crisp punchy rifle transient + filtered noise burst
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(210, now);
      osc.frequency.exponentialRampToValueAtTime(62, now + 0.065);
      gain.gain.setValueAtTime(0.16, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.07);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.075);

      const noise = ctx.createBufferSource();
      noise.buffer = this.noiseBuffer;
      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(1750, now);
      filter.Q.setValueAtTime(1.1, now);
      const nGain = ctx.createGain();
      nGain.gain.setValueAtTime(0.14, now);
      nGain.gain.exponentialRampToValueAtTime(0.001, now + 0.055);
      noise.connect(filter).connect(nGain).connect(ctx.destination);
      noise.start(now);
      noise.stop(now + 0.06);
    } else if (weapon === 'shotgun') {
      // Heavy low boom + wide crisp scatter crack
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(145, now);
      osc.frequency.exponentialRampToValueAtTime(34, now + 0.19);
      gain.gain.setValueAtTime(0.28, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.21);

      const noise = ctx.createBufferSource();
      noise.buffer = this.noiseBuffer;
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(2600, now);
      filter.frequency.exponentialRampToValueAtTime(420, now + 0.16);
      const nGain = ctx.createGain();
      nGain.gain.setValueAtTime(0.24, now);
      nGain.gain.exponentialRampToValueAtTime(0.001, now + 0.17);
      noise.connect(filter).connect(nGain).connect(ctx.destination);
      noise.start(now);
      noise.stop(now + 0.18);
    } else {
      // Railgun: sharp electromagnetic crack + harmonic sweep
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(880, now);
      osc.frequency.exponentialRampToValueAtTime(110, now + 0.22);
      gain.gain.setValueAtTime(0.18, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.23);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.24);

      const sub = ctx.createOscillator();
      const sGain = ctx.createGain();
      sub.type = 'sine';
      sub.frequency.setValueAtTime(160, now);
      sub.frequency.exponentialRampToValueAtTime(38, now + 0.26);
      sGain.gain.setValueAtTime(0.26, now);
      sGain.gain.exponentialRampToValueAtTime(0.001, now + 0.27);
      sub.connect(sGain).connect(ctx.destination);
      sub.start(now);
      sub.stop(now + 0.28);
    }
  }

  public playEnemyShoot(heavy = false): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = heavy ? 'sawtooth' : 'square';
    osc.frequency.setValueAtTime(heavy ? 190 : 320, now);
    osc.frequency.exponentialRampToValueAtTime(heavy ? 58 : 110, now + 0.08);
    gain.gain.setValueAtTime(heavy ? 0.09 : 0.055, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.09);
    osc.connect(gain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.095);
  }

  public playHitmarker(crit = false): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(crit ? 1480 : 1080, now);
    osc.frequency.exponentialRampToValueAtTime(crit ? 720 : 540, now + 0.032);
    gain.gain.setValueAtTime(0.085, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.036);
    osc.connect(gain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.04);
  }

  public playKill(heavy = false): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.noiseBuffer) return;
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(heavy ? 120 : 175, now);
    osc.frequency.exponentialRampToValueAtTime(34, now + (heavy ? 0.26 : 0.14));
    gain.gain.setValueAtTime(heavy ? 0.26 : 0.16, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + (heavy ? 0.28 : 0.15));
    osc.connect(gain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + (heavy ? 0.29 : 0.16));

    const noise = ctx.createBufferSource();
    noise.buffer = this.noiseBuffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(heavy ? 1100 : 1500, now);
    const nGain = ctx.createGain();
    nGain.gain.setValueAtTime(heavy ? 0.18 : 0.1, now);
    nGain.gain.exponentialRampToValueAtTime(0.001, now + (heavy ? 0.22 : 0.1));
    noise.connect(filter).connect(nGain).connect(ctx.destination);
    noise.start(now);
    noise.stop(now + (heavy ? 0.23 : 0.11));
  }

  public playDash(): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.noiseBuffer) return;
    const now = ctx.currentTime;
    const noise = ctx.createBufferSource();
    noise.buffer = this.noiseBuffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(480, now);
    filter.frequency.exponentialRampToValueAtTime(1600, now + 0.12);
    filter.Q.setValueAtTime(2.0, now);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.14, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.14);
    noise.connect(filter).connect(gain).connect(ctx.destination);
    noise.start(now);
    noise.stop(now + 0.15);
  }

  public playReload(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(420, now);
    osc.frequency.setValueAtTime(640, now + 0.05);
    gain.gain.setValueAtTime(0.06, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.11);
    osc.connect(gain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.12);
  }

  public playPlayerHit(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(140, now);
    osc.frequency.exponentialRampToValueAtTime(48, now + 0.15);
    gain.gain.setValueAtTime(0.22, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.16);
    osc.connect(gain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.17);
  }

  public playPickup(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const notes = [523.25, 659.25, 783.99];
    notes.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, now + idx * 0.045);
      gain.gain.setValueAtTime(0.08, now + idx * 0.045);
      gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.045 + 0.12);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now + idx * 0.045);
      osc.stop(now + idx * 0.045 + 0.13);
    });
  }

  public playWaveClear(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const chord = [392.0, 493.88, 587.33, 783.99];
    chord.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, now + idx * 0.06);
      gain.gain.setValueAtTime(0.09, now + idx * 0.06);
      gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.06 + 0.35);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now + idx * 0.06);
      osc.stop(now + idx * 0.06 + 0.36);
    });
  }
}
