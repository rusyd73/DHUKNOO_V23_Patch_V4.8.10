// Web Audio API Bell Ring Synthesizer
let audioContext: AudioContext | null = null;

// 🔥 Fungsi sederhana untuk mendapatkan AudioContext yang sudah running
function getAudioContext(): AudioContext | null {
  try {
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) return null;
    
    // Buat sekali saja, reuse
    if (!audioContext) {
      audioContext = new AudioCtx();
    }
    
    // Jika suspended, resume
    if (audioContext.state === 'suspended') {
      audioContext.resume().catch(() => {});
    }
    
    return audioContext;
  } catch (err) {
    console.warn("AudioContext error:", err);
    return null;
  }
}

export function playBellRingSound(peakGain: number = 1.0) {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    
    // Jika masih suspended, skip dulu (akan dicoba lagi di interval berikutnya)
    if (ctx.state !== 'running') {
      console.log('⏳ AudioContext not ready, skipping...');
      return;
    }

    const now = ctx.currentTime;

    // Helper to create a rich metallic bell chime tone
    const createBellTone = (freq: number, startTime: number, duration: number) => {
      const osc1 = ctx.createOscillator();
      osc1.type = 'sine';
      osc1.frequency.setValueAtTime(freq, now + startTime);

      const osc2 = ctx.createOscillator();
      osc2.type = 'triangle';
      osc2.frequency.setValueAtTime(freq * 2.404, now + startTime);

      const osc3 = ctx.createOscillator();
      osc3.type = 'sine';
      osc3.frequency.setValueAtTime(freq * 3.8, now + startTime);

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.001, now + startTime);
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

    createBellTone(1567.98, 0, 0.7);
    createBellTone(2093.00, 0.18, 1.2);
  } catch (err) {
    console.warn("Could not play bell sound:", err);
  }
}

let ringLoopIntervalId: ReturnType<typeof setInterval> | null = null;

export function startRingLoop() {
  if (ringLoopIntervalId !== null) return;
  
  // 🔥 Coba mainkan langsung
  playBellRingSound(1.0);
  
  // 🔥 Mulai interval
  ringLoopIntervalId = setInterval(() => playBellRingSound(1.0), 1600);
}

export function stopRingLoop() {
  if (ringLoopIntervalId !== null) {
    clearInterval(ringLoopIntervalId);
    ringLoopIntervalId = null;
  }
}

// 🔥 Fungsi tambahan: panggil dari tombol test atau mount komponen
// untuk "mengaktifkan" AudioContext dengan user gesture
export function warmupAudioContext() {
  const ctx = getAudioContext();
  if (ctx && ctx.state === 'suspended') {
    ctx.resume().catch(() => {});
  }
}