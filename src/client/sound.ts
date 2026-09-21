/**
 * Web Audio API で合成する効果音。外部アセット不要。
 * AudioContext は初回のユーザー操作(盤面クリック)で生成される。
 */

export type SoundName = 'place' | 'flip' | 'bomb' | 'win' | 'pass';

export class SoundPlayer {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private enabled = true;

  constructor() {
    try {
      this.enabled = localStorage.getItem('hex-reversi-sound') !== 'off';
    } catch {
      // localStorage が使えない環境では常にON
    }
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  toggle(): boolean {
    this.enabled = !this.enabled;
    try {
      localStorage.setItem('hex-reversi-sound', this.enabled ? 'on' : 'off');
    } catch {
      // 永続化できなくても動作は続ける
    }
    return this.enabled;
  }

  private ensureCtx(): AudioContext | null {
    if (!this.ctx) {
      try {
        this.ctx = new AudioContext();
        this.master = this.ctx.createGain();
        this.master.gain.value = 0.5;
        this.master.connect(this.ctx.destination);
      } catch {
        return null;
      }
    }
    if (this.ctx.state === 'suspended') {
      void this.ctx.resume();
    }
    return this.ctx;
  }

  private tone(
    freq: number,
    start: number,
    dur: number,
    type: OscillatorType = 'sine',
    vol = 0.3,
    sweepTo?: number,
  ): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, start);
    if (sweepTo) {
      osc.frequency.exponentialRampToValueAtTime(sweepTo, start + dur);
    }
    gain.gain.setValueAtTime(vol, start);
    gain.gain.exponentialRampToValueAtTime(0.001, start + dur);
    osc.connect(gain);
    gain.connect(this.master);
    osc.start(start);
    osc.stop(start + dur + 0.02);
  }

  private noise(start: number, dur: number, vol = 0.4, lowpass = 800): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < len; i++) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    }
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = lowpass;
    const gain = ctx.createGain();
    gain.gain.value = vol;
    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.master);
    src.start(start);
  }

  play(name: SoundName, count = 1): void {
    if (!this.enabled) return;
    const ctx = this.ensureCtx();
    if (!ctx) return;
    const t = ctx.currentTime;
    switch (name) {
      case 'place':
        this.tone(520, t, 0.09, 'triangle', 0.35, 300);
        break;
      case 'flip': {
        const n = Math.min(count, 6);
        for (let i = 0; i < n; i++) {
          this.tone(700 + i * 90, t + i * 0.045, 0.07, 'square', 0.1);
        }
        break;
      }
      case 'bomb':
        this.noise(t, 0.5, 0.5, 600);
        this.tone(140, t, 0.45, 'sine', 0.5, 40);
        break;
      case 'win':
        [523, 659, 784].forEach((f, i) => this.tone(f, t + i * 0.12, 0.22, 'triangle', 0.3));
        break;
      case 'pass':
        this.tone(240, t, 0.12, 'sine', 0.18, 160);
        break;
    }
  }
}

export const soundPlayer = new SoundPlayer();
