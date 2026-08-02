// Web Audio API Bell Ring Synthesizer
export function playBellRingSound(peakGain: number = 1.0) {
  try {
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();

    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }

    const now = ctx.currentTime;

    // Helper to create a rich metallic bell chime tone
    const createBellTone = (freq: number, startTime: number, duration: number) => {
      // Primary sine oscillator
      const osc1 = ctx.createOscillator();
      osc1.type = 'sine';
      osc1.frequency.setValueAtTime(freq, now + startTime);

      // Harmonics for metallic resonance
      const osc2 = ctx.createOscillator();
      osc2.type = 'triangle';
      osc2.frequency.setValueAtTime(freq * 2.404, now + startTime);

      const osc3 = ctx.createOscillator();
      osc3.type = 'sine';
      osc3.frequency.setValueAtTime(freq * 3.8, now + startTime);

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.001, now + startTime);
      // PERBARUAN: volume puncak sekarang bisa diatur (default 1.0 — paling
      // keras yang aman tanpa distorsi/clipping Web Audio API), dipakai oleh
      // startRingLoop() di bawah supaya publikasi order benar-benar terdengar
      // maksimal sampai driver merespons.
      gain.gain.exponentialRampToValueAtTime(peakGain, now + startTime + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + startTime + duration);

      osc1.connect(gain);
      osc2.connect(gain);
      osc3.connect(gain);
      gain.connect(ctx.destination);

      osc1.start(now + startTime);
      osc2.start(now + startTime);
      osc3.start(now + startTime);

      osc1.stop(now + startTime + duration);
      osc2.stop(now + startTime + duration);
      osc3.stop(now + startTime + duration);
    };

    // Play crisp double bell ring chime (1567Hz - G6, 2093Hz - C7)
    createBellTone(1567.98, 0, 0.7);
    createBellTone(2093.00, 0.18, 1.2);
  } catch (err) {
    console.warn("Could not play bell sound:", err);
  }
}

// PERBARUAN: publikasi order sebelumnya cuma berbunyi SEKALI (sekilas, gampang
// terlewat kalau driver sedang tidak melihat layar). Sekarang tersedia
// loop yang membunyikan bel berulang-ulang di volume paling keras sampai
// order diterima otomatis (auto-accept) ATAU driver tap "Terima Order" --
// dipanggil stopRingLoop() di kedua kondisi tsb dari App.tsx.
let ringLoopIntervalId: ReturnType<typeof setInterval> | null = null;

export function startRingLoop() {
  if (ringLoopIntervalId !== null) return; // Sudah berbunyi -- jangan tumpuk interval.
  playBellRingSound(1.0);
  ringLoopIntervalId = setInterval(() => playBellRingSound(1.0), 1600);
}

export function stopRingLoop() {
  if (ringLoopIntervalId !== null) {
    clearInterval(ringLoopIntervalId);
    ringLoopIntervalId = null;
  }
}
