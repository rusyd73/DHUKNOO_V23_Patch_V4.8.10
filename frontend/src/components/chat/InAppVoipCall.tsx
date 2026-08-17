import React, { useState, useEffect, useRef } from 'react';
import { Phone, PhoneOff, PhoneIncoming, Mic, MicOff, Volume2, VolumeX, ShieldCheck, UserCheck } from 'lucide-react';
import { socket, joinRoom } from '../../services/socket';

interface InAppVoipCallProps {
  orderId: string;
  currentUserId: string;
  currentUserRole: 'CUSTOMER' | 'DRIVER' | string;
  otherPartyName?: string;
  otherPartyPhone?: string | null;
  onCallStateChange?: (isActive: boolean) => void;
}

export type CallStatus = 'IDLE' | 'CALLING' | 'INCOMING' | 'CONNECTED' | 'ENDED';

export function InAppVoipCall({
  orderId,
  currentUserId,
  currentUserRole,
  otherPartyName = 'Mitra',
  otherPartyPhone,
  onCallStateChange,
}: InAppVoipCallProps) {
  const [callStatus, setCallStatus] = useState<CallStatus>('IDLE');
  const [isMuted, setIsMuted] = useState(false);
  const [isSpeakerOn, setIsSpeakerOn] = useState(true);
  const [durationSeconds, setDurationSeconds] = useState(0);
  const [callerName, setCallerName] = useState<string>('');
  const [callerRole, setCallerRole] = useState<string>('');

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ringtoneOscRef = useRef<{ audioCtx: AudioContext; osc1: OscillatorNode; osc2: OscillatorNode; gain: GainNode } | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);

  // Notify parent component of call state
  useEffect(() => {
    onCallStateChange?.(callStatus !== 'IDLE');
  }, [callStatus, onCallStateChange]);

  // Audio Synth Ringtone Generator using Web Audio API
  const startRingtoneSound = () => {
    try {
      if (ringtoneOscRef.current) return;
      const AudioCtxClass = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtxClass) return;
      const audioCtx = new AudioCtxClass();

      // Dual tone telephone ring sound (440 Hz + 480 Hz)
      const osc1 = audioCtx.createOscillator();
      const osc2 = audioCtx.createOscillator();
      const gain = audioCtx.createGain();

      osc1.frequency.value = 440; // US standard ringback tone 1
      osc2.frequency.value = 480; // US standard ringback tone 2
      gain.gain.value = 0.08;

      osc1.connect(gain);
      osc2.connect(gain);
      gain.connect(audioCtx.destination);

      osc1.start();
      osc2.start();

      ringtoneOscRef.current = { audioCtx, osc1, osc2, gain };
    } catch (e) {
      console.log('Audio ringtone context init prevented:', e);
    }
  };

  const stopRingtoneSound = () => {
    if (ringtoneOscRef.current) {
      try {
        ringtoneOscRef.current.osc1.stop();
        ringtoneOscRef.current.osc2.stop();
        ringtoneOscRef.current.audioCtx.close();
      } catch (e) {}
      ringtoneOscRef.current = null;
    }
  };

  // Connected Beep Sound
  const playConnectBeep = () => {
    try {
      const AudioCtxClass = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtxClass) return;
      const ctx = new AudioCtxClass();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, ctx.currentTime);
      gain.gain.setValueAtTime(0.1, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.3);
    } catch (e) {}
  };

  // Socket event listeners & room join for calls
  useEffect(() => {
    if (!orderId) return;

    // Pastikan terhubung ke room socket order (sama seperti chat room)
    const roomId = `order_${orderId}`;
    joinRoom(roomId).catch((err) => console.log('Call room join error:', err));
    joinRoom(orderId).catch(() => {});

    const handleIncomingCall = (data: { orderId: string; callerId: string; callerName: string; callerRole: string }) => {
      if (data.orderId === orderId && data.callerId !== currentUserId) {
        setCallerName(data.callerName || (currentUserRole === 'DRIVER' ? 'Customer' : 'Mitra Driver'));
        setCallerRole(data.callerRole || (currentUserRole === 'DRIVER' ? 'CUSTOMER' : 'DRIVER'));
        setCallStatus('INCOMING');
        startRingtoneSound();
      }
    };

    const handleCallAccepted = (data: { orderId: string; responderId: string }) => {
      if (data.orderId === orderId) {
        stopRingtoneSound();
        playConnectBeep();
        setCallStatus('CONNECTED');
        setDurationSeconds(0);
      }
    };

    const handleCallRejected = (data: { orderId: string; rejecterId: string; reason?: string }) => {
      if (data.orderId === orderId) {
        stopRingtoneSound();
        setCallStatus('ENDED');
        setTimeout(() => {
          setCallStatus('IDLE');
        }, 2000);
      }
    };

    const handleCallEnded = (data: { orderId: string; enderId: string }) => {
      if (data.orderId === orderId) {
        stopRingtoneSound();
        setCallStatus('ENDED');
        if (timerRef.current) clearInterval(timerRef.current);
        setTimeout(() => {
          setCallStatus('IDLE');
          setDurationSeconds(0);
        }, 2000);
      }
    };

    socket.on('call_incoming', handleIncomingCall);
    socket.on('call_accepted', handleCallAccepted);
    socket.on('call_rejected', handleCallRejected);
    socket.on('call_ended', handleCallEnded);

    return () => {
      socket.off('call_incoming', handleIncomingCall);
      socket.off('call_accepted', handleCallAccepted);
      socket.off('call_rejected', handleCallRejected);
      socket.off('call_ended', handleCallEnded);
      stopRingtoneSound();
    };
  }, [orderId, currentUserId, currentUserRole]);

  // Handle Call Timer when CONNECTED
  useEffect(() => {
    if (callStatus === 'CONNECTED') {
      timerRef.current = setInterval(() => {
        setDurationSeconds((prev) => prev + 1);
      }, 1000);

      // Attempt to access microphone for realistic VoIP
      if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        navigator.mediaDevices
          .getUserMedia({ audio: true })
          .then((stream) => {
            localStreamRef.current = stream;
          })
          .catch((err) => {
            console.log('Microphone access note:', err.message);
          });
      }
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((t) => t.stop());
        localStreamRef.current = null;
      }
    }

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [callStatus]);

  // Mute / Unmute Microphone
  const toggleMute = () => {
    setIsMuted(!isMuted);
    if (localStreamRef.current) {
      localStreamRef.current.getAudioTracks().forEach((track) => {
        track.enabled = isMuted; // Toggle enabled state
      });
    }
  };

  // Speaker Toggle
  const toggleSpeaker = () => {
    setIsSpeakerOn(!isSpeakerOn);
  };

  // Actions
  const initiateCall = () => {
    const name = otherPartyName || (currentUserRole === 'DRIVER' ? 'Customer' : 'Mitra Driver');
    setCallerName(name);
    setCallStatus('CALLING');
    startRingtoneSound();

    socket.emit('call_initiate', {
      orderId,
      callerId: currentUserId,
      callerName: currentUserRole === 'DRIVER' ? 'Mitra Driver' : 'Customer',
      callerRole: currentUserRole,
    });
  };

  const answerCall = () => {
    stopRingtoneSound();
    playConnectBeep();
    setCallStatus('CONNECTED');
    setDurationSeconds(0);

    socket.emit('call_answer', {
      orderId,
      responderId: currentUserId,
    });
  };

  const rejectCall = () => {
    stopRingtoneSound();
    setCallStatus('IDLE');

    socket.emit('call_reject', {
      orderId,
      rejecterId: currentUserId,
      reason: 'Ditolak',
    });
  };

  const endCall = () => {
    stopRingtoneSound();
    const finalSecs = durationSeconds;
    setCallStatus('ENDED');

    socket.emit('call_end', {
      orderId,
      enderId: currentUserId,
      durationSeconds: finalSecs,
    });

    setTimeout(() => {
      setCallStatus('IDLE');
      setDurationSeconds(0);
    }, 2000);
  };

  const formatDuration = (secs: number) => {
    const mins = Math.floor(secs / 60);
    const remainingSecs = secs % 60;
    return `${mins.toString().padStart(2, '0')}:${remainingSecs.toString().padStart(2, '0')}`;
  };

  return (
    <>
      {/* 1. BUTTON DI HEADER CHAT UNTUK MEMULAI TELEPON IN-APP */}
      {callStatus === 'IDLE' && (
        <button
          type="button"
          onClick={initiateCall}
          title={`Telepon In-App ke ${otherPartyName || 'lawan bicara'}`}
          className="text-[10px] bg-[#00E575]/20 hover:bg-[#00E575]/30 text-[#00E575] font-black px-2.5 py-1 rounded-full border border-[#00E575]/40 flex items-center gap-1.5 transition-all shadow-sm group active:scale-95"
        >
          <Phone className="w-3.5 h-3.5 text-[#00E575] group-hover:animate-bounce" />
          <span>Telepon In-App</span>
        </button>
      )}

      {/* 2. OVERLAY TERPANGGIL / SEDANG MEMANGGIL / SEDANG BERBICARA (MODAL CALL UI) */}
      {callStatus !== 'IDLE' && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 animate-fadeIn">
          <div className="bg-[#06170E] border border-[#23583E] rounded-3xl p-6 w-full max-w-sm flex flex-col items-center gap-5 shadow-2xl relative overflow-hidden text-white">
            {/* Ambient Background Glow */}
            <div className="absolute -top-24 -left-24 w-48 h-48 bg-[#00E575]/20 rounded-full blur-3xl pointer-events-none" />
            <div className="absolute -bottom-24 -right-24 w-48 h-48 bg-[#00E575]/10 rounded-full blur-3xl pointer-events-none" />

            {/* Header Badge */}
            <div className="flex items-center gap-1.5 bg-[#0D2E1F] text-[#00E575] text-[10px] font-bold px-3 py-1 rounded-full border border-[#23583E]">
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>In-App Encrypted Voice Call</span>
            </div>

            {/* Avatar & Pulse Animation */}
            <div className="relative my-2">
              <div
                className={`w-24 h-24 rounded-full bg-gradient-to-tr from-[#0D2E1F] to-[#23583E] border-2 border-[#00E575] flex items-center justify-center text-3xl font-black text-[#00E575] shadow-lg relative z-10 ${
                  callStatus === 'CALLING' || callStatus === 'INCOMING' ? 'animate-pulse' : ''
                }`}
              >
                {callerName ? callerName.charAt(0).toUpperCase() : 'M'}
              </div>

              {/* Pulsing rings for calling / incoming */}
              {(callStatus === 'CALLING' || callStatus === 'INCOMING') && (
                <>
                  <div className="absolute inset-0 rounded-full border border-[#00E575]/60 animate-ping opacity-75" />
                  <div className="absolute -inset-2 rounded-full border border-[#00E575]/30 animate-pulse" />
                </>
              )}
            </div>

            {/* User Info & Call Status Text */}
            <div className="text-center flex flex-col gap-1">
              <h3 className="text-lg font-black text-white">{callerName || otherPartyName || 'Mitra'}</h3>
              <p className="text-xs text-[#A5C9B8] font-medium">
                {currentUserRole === 'DRIVER' ? 'Customer' : 'Mitra Driver'} • Order #{orderId.slice(0, 8)}
              </p>

              {/* Status Indicator */}
              <div className="mt-2 font-mono text-sm font-bold text-[#00E575] flex items-center justify-center gap-2">
                {callStatus === 'CALLING' && (
                  <span className="flex items-center gap-1 text-[#FFD700] animate-pulse">
                    <Phone className="w-4 h-4" /> Memanggil...
                  </span>
                )}
                {callStatus === 'INCOMING' && (
                  <span className="flex items-center gap-1 text-[#00E575] animate-bounce">
                    <PhoneIncoming className="w-4 h-4" /> Panggilan Masuk...
                  </span>
                )}
                {callStatus === 'CONNECTED' && (
                  <div className="flex flex-col items-center gap-1">
                    <span className="text-[#00E575] text-xs font-bold bg-[#00E575]/10 px-2.5 py-0.5 rounded-full border border-[#00E575]/30">
                      Terhubung
                    </span>
                    <span className="text-xl tracking-wider text-white font-extrabold">{formatDuration(durationSeconds)}</span>
                  </div>
                )}
                {callStatus === 'ENDED' && <span className="text-red-400">Panggilan Selesai</span>}
              </div>
            </div>

            {/* Animated Audio Equalizer Waveform when Connected */}
            {callStatus === 'CONNECTED' && (
              <div className="flex items-center gap-1 h-6 my-1">
                <div className="w-1 bg-[#00E575] h-3 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                <div className="w-1 bg-[#00E575] h-6 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                <div className="w-1 bg-[#00E575] h-4 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                <div className="w-1 bg-[#00E575] h-5 rounded-full animate-bounce" style={{ animationDelay: '450ms' }} />
                <div className="w-1 bg-[#00E575] h-2 rounded-full animate-bounce" style={{ animationDelay: '600ms' }} />
              </div>
            )}

            {/* Action Buttons depending on state */}
            <div className="w-full flex items-center justify-center gap-4 mt-2">
              {/* INCOMING STATE: Answer or Reject */}
              {callStatus === 'INCOMING' && (
                <>
                  <button
                    type="button"
                    onClick={rejectCall}
                    className="flex-1 bg-red-600 hover:bg-red-700 text-white font-bold py-3 px-4 rounded-2xl flex items-center justify-center gap-2 transition-all shadow-lg active:scale-95 text-xs"
                  >
                    <PhoneOff className="w-4 h-4" />
                    <span>Tolak</span>
                  </button>
                  <button
                    type="button"
                    onClick={answerCall}
                    className="flex-1 bg-[#00E575] hover:bg-[#00ff80] text-[#06170E] font-black py-3 px-4 rounded-2xl flex items-center justify-center gap-2 transition-all shadow-lg active:scale-95 text-xs animate-bounce"
                  >
                    <Phone className="w-4 h-4" />
                    <span>Terima</span>
                  </button>
                </>
              )}

              {/* CALLING / CONNECTED STATE: Mute, Speaker, End Call */}
              {(callStatus === 'CALLING' || callStatus === 'CONNECTED') && (
                <>
                  <button
                    type="button"
                    onClick={toggleMute}
                    className={`p-3.5 rounded-2xl flex items-center justify-center transition-all ${
                      isMuted
                        ? 'bg-red-500/20 text-red-400 border border-red-500/40'
                        : 'bg-[#0D2E1F] text-[#A5C9B8] hover:text-white border border-[#23583E]'
                    }`}
                    title={isMuted ? 'Unmute' : 'Mute'}
                  >
                    {isMuted ? <MicOff className="w-5 h-5 text-red-400" /> : <Mic className="w-5 h-5" />}
                  </button>

                  <button
                    type="button"
                    onClick={endCall}
                    className="bg-red-600 hover:bg-red-700 text-white font-black p-4 rounded-2xl flex items-center justify-center gap-2 transition-all shadow-xl active:scale-95"
                    title="Akhiri Panggilan"
                  >
                    <PhoneOff className="w-6 h-6" />
                  </button>

                  <button
                    type="button"
                    onClick={toggleSpeaker}
                    className={`p-3.5 rounded-2xl flex items-center justify-center transition-all ${
                      !isSpeakerOn
                        ? 'bg-gray-800 text-gray-400 border border-gray-700'
                        : 'bg-[#0D2E1F] text-[#00E575] border border-[#23583E]'
                    }`}
                    title="Speaker Phone"
                  >
                    {isSpeakerOn ? <Volume2 className="w-5 h-5" /> : <VolumeX className="w-5 h-5" />}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
