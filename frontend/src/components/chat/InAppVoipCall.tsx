import React, { useEffect, useRef, useState } from 'react';
import { Phone, PhoneOff, PhoneIncoming, Mic, MicOff, Volume2, VolumeX, ShieldCheck } from 'lucide-react';
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

type SignalPayload = {
  orderId: string;
  senderId: string;
  targetUserId: string;
  sdp?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit;
};

const getIceServers = (): RTCIceServer[] => {
  const servers: RTCIceServer[] = [
    { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
  ];
  const turnUrl = (import.meta as any).env?.VITE_WEBRTC_TURN_URL as string | undefined;
  const username = (import.meta as any).env?.VITE_WEBRTC_TURN_USERNAME as string | undefined;
  const credential = (import.meta as any).env?.VITE_WEBRTC_TURN_CREDENTIAL as string | undefined;
  if (turnUrl) servers.push({ urls: turnUrl, username, credential });
  return servers;
};

export function InAppVoipCall({
  orderId,
  currentUserId,
  currentUserRole,
  otherPartyName = 'Mitra',
  onCallStateChange,
}: InAppVoipCallProps) {
  const [callStatus, setCallStatus] = useState<CallStatus>('IDLE');
  const [isMuted, setIsMuted] = useState(false);
  const [isSpeakerOn, setIsSpeakerOn] = useState(true);
  const [durationSeconds, setDurationSeconds] = useState(0);
  const [callerName, setCallerName] = useState('');
  const [callError, setCallError] = useState('');

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const ringtoneOscRef = useRef<{ audioCtx: AudioContext; osc1: OscillatorNode; osc2: OscillatorNode; gain: GainNode } | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const peerRef = useRef<RTCPeerConnection | null>(null);
  const remoteUserIdRef = useRef<string | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const pendingIceRef = useRef<RTCIceCandidateInit[]>([]);

  useEffect(() => onCallStateChange?.(callStatus !== 'IDLE'), [callStatus, onCallStateChange]);

  const startRingtoneSound = () => {
    try {
      if (ringtoneOscRef.current) return;
      const AudioCtxClass = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtxClass) return;
      const audioCtx = new AudioCtxClass();
      const osc1 = audioCtx.createOscillator();
      const osc2 = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc1.frequency.value = 440;
      osc2.frequency.value = 480;
      gain.gain.value = 0.08;
      osc1.connect(gain); osc2.connect(gain); gain.connect(audioCtx.destination);
      osc1.start(); osc2.start();
      ringtoneOscRef.current = { audioCtx, osc1, osc2, gain };
    } catch {}
  };

  const stopRingtoneSound = () => {
    const r = ringtoneOscRef.current;
    if (!r) return;
    try { r.osc1.stop(); r.osc2.stop(); void r.audioCtx.close(); } catch {}
    ringtoneOscRef.current = null;
  };

  const playConnectBeep = () => {
    try {
      const AudioCtxClass = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtxClass) return;
      const ctx = new AudioCtxClass();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = 880;
      gain.gain.value = 0.1;
      osc.connect(gain); gain.connect(ctx.destination);
      osc.start(); osc.stop(ctx.currentTime + 0.25);
    } catch {}
  };

  const ensureLocalStream = async (): Promise<MediaStream> => {
    if (localStreamRef.current?.active) return localStreamRef.current;
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('Mikrofon tidak tersedia. Gunakan HTTPS/localhost atau aplikasi Android DHUKNOO.');
    }
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: false,
    });
    localStreamRef.current = stream;
    stream.getAudioTracks().forEach((track) => { track.enabled = !isMuted; });
    return stream;
  };

  const cleanupMedia = () => {
    peerRef.current?.close();
    peerRef.current = null;
    remoteUserIdRef.current = null;
    pendingIceRef.current = [];
    if (remoteAudioRef.current) remoteAudioRef.current.srcObject = null;
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    localStreamRef.current = null;
  };

  const createPeer = async (remoteUserId: string): Promise<RTCPeerConnection> => {
    if (peerRef.current && remoteUserIdRef.current === remoteUserId) return peerRef.current;
    peerRef.current?.close();
    const pc = new RTCPeerConnection({ iceServers: getIceServers() });
    peerRef.current = pc;
    remoteUserIdRef.current = remoteUserId;

    const local = await ensureLocalStream();
    local.getTracks().forEach((track) => pc.addTrack(track, local));

    pc.onicecandidate = (event) => {
      if (!event.candidate) return;
      socket.emit('call_webrtc_ice', {
        orderId,
        targetUserId: remoteUserId,
        candidate: event.candidate.toJSON(),
      });
    };

    pc.ontrack = (event) => {
      const remoteStream = event.streams[0] || new MediaStream([event.track]);
      const audio = remoteAudioRef.current;
      if (!audio) return;
      audio.srcObject = remoteStream;
      audio.muted = !isSpeakerOn;
      audio.volume = 1;
      void audio.play().catch((err) => {
        console.warn('[CALL] Remote audio autoplay tertahan:', err);
        setCallError('Audio lawan bicara siap. Tekan tombol speaker bila suara belum terdengar.');
      });
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'connected') {
        setCallError('');
        setCallStatus('CONNECTED');
      } else if (pc.connectionState === 'failed') {
        setCallError('Koneksi suara gagal. Jaringan mungkin memerlukan TURN server.');
      }
    };
    return pc;
  };

  const flushPendingIce = async () => {
    const pc = peerRef.current;
    if (!pc?.remoteDescription) return;
    const candidates = pendingIceRef.current.splice(0);
    for (const candidate of candidates) {
      try { await pc.addIceCandidate(candidate); } catch (err) { console.warn('[CALL] ICE pending gagal:', err); }
    }
  };

  useEffect(() => {
    if (!orderId) return;
    joinRoom(`order_${orderId}`).catch((err) => console.log('Call room join error:', err));

    const handleIncomingCall = (data: { orderId: string; callerId: string; callerName?: string }) => {
      if (data.orderId !== orderId || data.callerId === currentUserId) return;
      setCallError('');
      setCallerName(data.callerName || (currentUserRole === 'DRIVER' ? 'Customer' : 'Mitra Driver'));
      remoteUserIdRef.current = data.callerId;
      setCallStatus('INCOMING');
      startRingtoneSound();
    };

    const handleCallAccepted = async (data: { orderId: string; responderId: string }) => {
      if (data.orderId !== orderId) return;
      stopRingtoneSound();
      playConnectBeep();
      setDurationSeconds(0);
      if (data.responderId === currentUserId) return; // receiver waits for SDP offer
      try {
        const pc = await createPeer(data.responderId);
        const offer = await pc.createOffer({ offerToReceiveAudio: true });
        await pc.setLocalDescription(offer);
        socket.emit('call_webrtc_offer', { orderId, targetUserId: data.responderId, sdp: pc.localDescription });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Gagal memulai audio';
        setCallError(message);
        setCallStatus('ENDED');
      }
    };

    const handleOffer = async (data: SignalPayload) => {
      if (data.orderId !== orderId || data.targetUserId !== currentUserId || !data.sdp) return;
      try {
        const pc = await createPeer(data.senderId);
        await pc.setRemoteDescription(data.sdp);
        await flushPendingIce();
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        socket.emit('call_webrtc_answer', { orderId, targetUserId: data.senderId, sdp: pc.localDescription });
        setCallStatus('CONNECTED');
      } catch (err) {
        setCallError(err instanceof Error ? err.message : 'Gagal menjawab audio');
      }
    };

    const handleAnswer = async (data: SignalPayload) => {
      if (data.orderId !== orderId || data.targetUserId !== currentUserId || !data.sdp || !peerRef.current) return;
      try {
        await peerRef.current.setRemoteDescription(data.sdp);
        await flushPendingIce();
        setCallStatus('CONNECTED');
      } catch (err) {
        setCallError(err instanceof Error ? err.message : 'Gagal menyambungkan audio');
      }
    };

    const handleIce = async (data: SignalPayload) => {
      if (data.orderId !== orderId || data.targetUserId !== currentUserId || !data.candidate) return;
      const pc = peerRef.current;
      if (!pc?.remoteDescription) {
        pendingIceRef.current.push(data.candidate);
        return;
      }
      try { await pc.addIceCandidate(data.candidate); } catch (err) { console.warn('[CALL] ICE gagal:', err); }
    };

    const handleRejected = (data: { orderId: string }) => {
      if (data.orderId !== orderId) return;
      stopRingtoneSound(); cleanupMedia(); setCallStatus('ENDED');
      setTimeout(() => setCallStatus('IDLE'), 1500);
    };
    const handleEnded = (data: { orderId: string }) => {
      if (data.orderId !== orderId) return;
      stopRingtoneSound(); cleanupMedia(); setCallStatus('ENDED');
      setTimeout(() => { setCallStatus('IDLE'); setDurationSeconds(0); }, 1500);
    };

    socket.on('call_incoming', handleIncomingCall);
    socket.on('call_accepted', handleCallAccepted);
    socket.on('call_rejected', handleRejected);
    socket.on('call_ended', handleEnded);
    socket.on('call_webrtc_offer', handleOffer);
    socket.on('call_webrtc_answer', handleAnswer);
    socket.on('call_webrtc_ice', handleIce);
    return () => {
      socket.off('call_incoming', handleIncomingCall);
      socket.off('call_accepted', handleCallAccepted);
      socket.off('call_rejected', handleRejected);
      socket.off('call_ended', handleEnded);
      socket.off('call_webrtc_offer', handleOffer);
      socket.off('call_webrtc_answer', handleAnswer);
      socket.off('call_webrtc_ice', handleIce);
      stopRingtoneSound(); cleanupMedia();
    };
  }, [orderId, currentUserId, currentUserRole]);

  useEffect(() => {
    if (callStatus === 'CONNECTED') {
      timerRef.current = setInterval(() => setDurationSeconds((prev) => prev + 1), 1000);
    } else if (timerRef.current) {
      clearInterval(timerRef.current); timerRef.current = null;
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [callStatus]);

  const initiateCall = async () => {
    setCallError('');
    try {
      await ensureLocalStream(); // user gesture: request mic before signaling
      setCallerName(otherPartyName || (currentUserRole === 'DRIVER' ? 'Customer' : 'Mitra Driver'));
      setCallStatus('CALLING');
      startRingtoneSound();
      socket.emit('call_initiate', {
        orderId,
        callerId: currentUserId,
        callerName: currentUserRole === 'DRIVER' ? 'Mitra Driver' : 'Customer',
        callerRole: currentUserRole,
      });
    } catch (err) {
      setCallError(err instanceof Error ? err.message : 'Izin mikrofon ditolak');
    }
  };

  const answerCall = async () => {
    setCallError('');
    try {
      await ensureLocalStream(); // user gesture on receiver
      stopRingtoneSound(); playConnectBeep(); setDurationSeconds(0);
      socket.emit('call_answer', { orderId, responderId: currentUserId });
    } catch (err) {
      setCallError(err instanceof Error ? err.message : 'Izin mikrofon ditolak');
    }
  };

  const rejectCall = () => {
    stopRingtoneSound(); cleanupMedia(); setCallStatus('IDLE');
    socket.emit('call_reject', { orderId, rejecterId: currentUserId, reason: 'Ditolak' });
  };

  const endCall = () => {
    stopRingtoneSound();
    socket.emit('call_end', { orderId, enderId: currentUserId, durationSeconds });
    cleanupMedia(); setCallStatus('ENDED');
    setTimeout(() => { setCallStatus('IDLE'); setDurationSeconds(0); }, 1500);
  };

  const toggleMute = () => {
    const next = !isMuted;
    setIsMuted(next);
    localStreamRef.current?.getAudioTracks().forEach((track) => { track.enabled = !next; });
  };

  const toggleSpeaker = () => {
    const next = !isSpeakerOn;
    setIsSpeakerOn(next);
    if (remoteAudioRef.current) remoteAudioRef.current.muted = !next;
  };

  const formatDuration = (secs: number) => `${Math.floor(secs / 60).toString().padStart(2, '0')}:${(secs % 60).toString().padStart(2, '0')}`;

  return (
    <>
      <audio ref={remoteAudioRef} autoPlay playsInline className="hidden" />
      {callStatus === 'IDLE' && (
        <div className="flex flex-col items-end gap-1">
          <button type="button" onClick={initiateCall} title={`Telepon In-App ke ${otherPartyName || 'lawan bicara'}`} className="text-[10px] bg-[#00E575]/20 hover:bg-[#00E575]/30 text-[#00E575] font-black px-2.5 py-1 rounded-full border border-[#00E575]/40 flex items-center gap-1.5 transition-all shadow-sm active:scale-95">
            <Phone className="w-3.5 h-3.5" /><span>Telepon In-App</span>
          </button>
          {callError && <span className="text-[9px] text-red-400 max-w-48 text-right">{callError}</span>}
        </div>
      )}

      {callStatus !== 'IDLE' && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-[#06170E] border border-[#23583E] rounded-3xl p-6 w-full max-w-sm flex flex-col items-center gap-5 shadow-2xl text-white">
            <div className="flex items-center gap-1.5 bg-[#0D2E1F] text-[#00E575] text-[10px] font-bold px-3 py-1 rounded-full border border-[#23583E]"><ShieldCheck className="w-3.5 h-3.5" /> Panggilan terenkripsi WebRTC</div>
            <div className="w-20 h-20 rounded-full bg-[#0D2E1F] border-2 border-[#00E575]/50 flex items-center justify-center"><Phone className="w-9 h-9 text-[#00E575]" /></div>
            <div className="text-center">
              <h3 className="text-xl font-black">{callerName || otherPartyName}</h3>
              <p className="text-xs text-[#A5C9B8]">{currentUserRole === 'DRIVER' ? 'Customer' : 'Mitra Driver'} • Order #{orderId.slice(0, 8)}</p>
              <div className="mt-2 font-mono text-sm font-bold text-[#00E575]">
                {callStatus === 'CALLING' && <span className="text-[#FFD700]">Memanggil...</span>}
                {callStatus === 'INCOMING' && <span className="flex items-center justify-center gap-1"><PhoneIncoming className="w-4 h-4" /> Panggilan Masuk...</span>}
                {callStatus === 'CONNECTED' && <span className="text-xl tracking-wider text-white">{formatDuration(durationSeconds)}</span>}
                {callStatus === 'ENDED' && <span className="text-red-400">Panggilan Selesai</span>}
              </div>
              {callError && <p className="mt-2 text-[10px] text-red-300 bg-red-950/30 border border-red-800/40 rounded-lg px-3 py-2">{callError}</p>}
            </div>

            <div className="w-full flex items-center justify-center gap-4 mt-2">
              {callStatus === 'INCOMING' && <>
                <button type="button" onClick={rejectCall} className="flex-1 bg-red-600 text-white font-bold py-3 px-4 rounded-2xl flex items-center justify-center gap-2"><PhoneOff className="w-4 h-4" /> Tolak</button>
                <button type="button" onClick={answerCall} className="flex-1 bg-[#00E575] text-[#06170E] font-black py-3 px-4 rounded-2xl flex items-center justify-center gap-2"><Phone className="w-4 h-4" /> Terima</button>
              </>}
              {(callStatus === 'CALLING' || callStatus === 'CONNECTED') && <>
                <button type="button" onClick={toggleMute} className={`p-3.5 rounded-2xl border ${isMuted ? 'bg-red-500/20 text-red-400 border-red-500/40' : 'bg-[#0D2E1F] text-[#A5C9B8] border-[#23583E]'}`}>{isMuted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}</button>
                <button type="button" onClick={endCall} className="bg-red-600 text-white p-4 rounded-2xl"><PhoneOff className="w-6 h-6" /></button>
                <button type="button" onClick={toggleSpeaker} className={`p-3.5 rounded-2xl border ${isSpeakerOn ? 'bg-[#0D2E1F] text-[#00E575] border-[#23583E]' : 'bg-gray-800 text-gray-400 border-gray-700'}`}>{isSpeakerOn ? <Volume2 className="w-5 h-5" /> : <VolumeX className="w-5 h-5" />}</button>
              </>}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
