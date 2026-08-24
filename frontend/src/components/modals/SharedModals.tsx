import React, { useState, useEffect } from 'react';
import { useMutation } from '@tanstack/react-query';
import {
  Camera,
  CheckCircle,
  Clock,
  Copy,
  Key,
  MessageCircle,
  PhoneCall,
  QrCode,
  RefreshCw,
  Send,
  Smartphone,
  Wallet,
} from 'lucide-react';
import { AuthAPI, UploadAPI, WalletAPI } from '../../api';
import { formatRupiah } from '@obama/shared-utils';

// PERBAIKAN PERFORMA: file ini sebelumnya adalah bagian dari app/App.tsx
// (satu file monolitik ~5100 baris) yang SELALU ikut ter-load di initial
// bundle terlepas dari role user (customer/driver/admin) atau bahkan
// sebelum user login sama sekali. Dipisah ke sini supaya CustomerApp &
// DriverApp (yang sama-sama memakai modal ini) bisa lazy-load tanpa
// duplikasi kode, dan supaya App.tsx (shell awal, dibuka SEMUA orang)
// jadi jauh lebih kecil/cepat di-parse browser.

export function QrisCameraScannerModal({ onClose, triggerToast }: { onClose: () => void; triggerToast: (m: string) => void }) {
  const videoRef = React.useRef<HTMLVideoElement>(null);
  const streamRef = React.useRef<MediaStream | null>(null);
  const scanFrameRef = React.useRef<number | null>(null);
  const [streamActive, setStreamActive] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [scanResult, setScanResult] = useState<string | null>(null);

  const onCloseRef = React.useRef(onClose);
  const triggerToastRef = React.useRef(triggerToast);
  useEffect(() => {
    onCloseRef.current = onClose;
    triggerToastRef.current = triggerToast;
  }, [onClose, triggerToast]);

  // Buka stream sekali. Stream disimpan di ref; pemasangan ke elemen <video>
  // dilakukan oleh effect terpisah SETELAH React benar-benar merender <video>.
  // Ini memperbaiki bug layar gelap: versi lama setStreamActive(true) lalu
  // langsung mencoba videoRef.current, padahal elemen video belum ada pada render itu.
  useEffect(() => {
    let cancelled = false;

    const isLocalhost = ['localhost', '127.0.0.1', '::1'].includes(window.location.hostname);
    if (!window.isSecureContext && !isLocalhost) {
      const message = 'Kamera hanya bisa diakses melalui koneksi HTTPS (atau localhost saat development).';
      setCameraError(message);
      triggerToastRef.current(message);
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      const message = 'Browser/perangkat ini tidak menyediakan akses kamera. Gunakan Chrome/Edge terbaru dan pastikan izin kamera aktif.';
      setCameraError(message);
      triggerToastRef.current(message);
      return;
    }

    navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
      audio: false,
    }).then((stream) => {
      if (cancelled) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = stream;
      setCameraError(null);
      setStreamActive(true);
    }).catch((err: unknown) => {
      if (cancelled) return;
      const name = err instanceof DOMException ? err.name : '';
      const message =
        name === 'NotAllowedError' || name === 'PermissionDeniedError'
          ? 'Izin kamera ditolak. Buka pengaturan browser/HP, izinkan akses kamera untuk DHUKNOO, lalu coba lagi.'
          : name === 'NotFoundError' || name === 'DevicesNotFoundError'
            ? 'Kamera tidak ditemukan di perangkat ini.'
            : name === 'NotReadableError' || name === 'TrackStartError'
              ? 'Kamera sedang dipakai aplikasi lain. Tutup aplikasi kamera lain lalu coba lagi.'
              : 'Gagal mengakses kamera. Pastikan aplikasi dibuka melalui HTTPS atau localhost.';
      setCameraError(message);
      triggerToastRef.current(message);
    });

    return () => {
      cancelled = true;
      if (scanFrameRef.current !== null) cancelAnimationFrame(scanFrameRef.current);
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    };
  }, []);

  // Pasang stream setelah elemen video sudah mounted, lalu scan frame QRIS.
  useEffect(() => {
    if (!streamActive || !videoRef.current || !streamRef.current) return;
    const video = videoRef.current;
    video.srcObject = streamRef.current;

    let stopped = false;
    const start = async () => {
      try {
        await video.play();
      } catch (err) {
        setCameraError('Kamera terbuka tetapi video gagal diputar. Coba tutup scanner lalu buka kembali.');
        return;
      }

      const Detector = (window as any).BarcodeDetector;
      if (!Detector) {
        // Kamera tetap berguna sebagai preview, tetapi browser lama belum punya decoder native.
        setCameraError('Kamera aktif, tetapi browser ini belum mendukung pembacaan QR otomatis. Gunakan Chrome/Edge Android terbaru atau upload screenshot bukti bayar.');
        return;
      }

      let detector: any;
      try {
        detector = new Detector({ formats: ['qr_code'] });
      } catch {
        setCameraError('Decoder QR tidak tersedia pada browser ini. Gunakan browser terbaru.');
        return;
      }

      const scan = async () => {
        if (stopped || video.readyState < 2) {
          if (!stopped) scanFrameRef.current = requestAnimationFrame(scan);
          return;
        }
        try {
          const results = await detector.detect(video);
          const rawValue = results?.[0]?.rawValue;
          if (rawValue) {
            setScanResult(rawValue);
            triggerToastRef.current('✅ QR Code berhasil terbaca. Silakan lanjutkan pembayaran dan simpan bukti bayar.');
            return;
          }
        } catch {
          // Frame belum dapat dibaca; lanjut scan berikutnya tanpa spam toast.
        }
        if (!stopped) scanFrameRef.current = requestAnimationFrame(scan);
      };
      scanFrameRef.current = requestAnimationFrame(scan);
    };

    start();
    return () => {
      stopped = true;
      if (scanFrameRef.current !== null) cancelAnimationFrame(scanFrameRef.current);
    };
  }, [streamActive]);

  return (
    <div className="fixed inset-0 z-[80] bg-black/90 backdrop-blur-md flex items-center justify-center p-4">
      <div className="bg-[#0D2E1F] border-2 border-[#00E575] rounded-3xl p-6 max-w-md w-full flex flex-col gap-4 text-center">
        <div className="flex justify-between items-center border-b border-[#23583E] pb-3">
          <span className="text-xs font-black text-[#00E575] uppercase tracking-wider flex items-center gap-1.5">
            <Camera className="w-4 h-4" /> Pemindai QRIS Kamera Live
          </span>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-white font-bold text-xs bg-[#06170E] px-3 py-1 rounded-xl border border-[#23583E]">
            ✕ Tutup
          </button>
        </div>

        <div className="relative aspect-square bg-black rounded-2xl overflow-hidden border-2 border-[#00E575]/50 flex items-center justify-center">
          {streamActive ? (
            <video ref={videoRef} className="w-full h-full object-cover" playsInline muted autoPlay />
          ) : cameraError ? (
            <div className="flex flex-col items-center p-4 gap-2 text-[#A5C9B8]">
              <Camera className="w-12 h-12 text-red-400" />
              <span className="text-xs font-bold text-red-400">Kamera Tidak Bisa Dibuka</span>
              <p className="text-[10px]">{cameraError}</p>
            </div>
          ) : (
            <div className="flex flex-col items-center p-4 gap-2 text-[#A5C9B8]">
              <QrCode className="w-16 h-16 text-[#00E575] animate-pulse" />
              <span className="text-xs font-bold text-white">Membuka kamera...</span>
            </div>
          )}

          <div className="absolute inset-0 border-2 border-dashed border-[#00E575] m-8 rounded-2xl pointer-events-none flex items-center justify-center">
            <div className="w-full h-0.5 bg-[#00E575] animate-pulse shadow-[0_0_15px_#00E575]"></div>
          </div>
        </div>

        {cameraError && streamActive && !scanResult && (
          <div className="bg-amber-500/10 border border-amber-500/40 text-amber-300 text-[10px] p-2.5 rounded-xl text-left">
            {cameraError}
          </div>
        )}

        {scanResult ? (
          <div className="bg-[#00E575]/10 border border-[#00E575]/40 p-3 rounded-xl text-left">
            <div className="text-[11px] font-black text-[#00E575]">✅ QR Code terbaca</div>
            <div className="text-[9px] text-[#A5C9B8] mt-1 break-all max-h-16 overflow-y-auto">{scanResult}</div>
          </div>
        ) : (
          <p className="text-[10px] text-[#A5C9B8]">Arahkan kamera belakang ke QRIS sampai kode terbaca otomatis.</p>
        )}

        <div className="bg-[#06170E] p-3 rounded-2xl border border-[#23583E] text-left text-xs space-y-1">
          <div className="flex justify-between font-bold text-white">
            <span>Merchant Resmi:</span>
            <span className="text-[#00E575]">PT DHUKNOO RIDE INDONESIA</span>
          </div>
          <div className="flex justify-between text-gray-400 text-[10px]">
            <span>NMID:</span>
            <span className="font-mono text-white">ID1029384756102</span>
          </div>
        </div>

        <button
          type="button"
          disabled={!scanResult}
          onClick={() => {
            triggerToast('QR berhasil dibaca. Setelah pembayaran, jangan lupa upload bukti bayar agar order dapat di-approve.');
            onCloseRef.current();
          }}
          className="bg-[#00E575] text-[#071F14] hover:bg-[#00ff80] disabled:opacity-40 disabled:cursor-not-allowed font-black py-3 rounded-xl text-xs transition-all shadow-md"
        >
          {scanResult ? '✅ QR Terbaca — Lanjutkan Pembayaran' : 'Arahkan Kamera ke QRIS'}
        </button>
      </div>
    </div>
  );
}

export function TopupModal({
  isOpen,
  onClose,
  user,
  initialAmount = '',
  triggerToast,
  onSuccess,
}: {
  isOpen: boolean;
  onClose: () => void;
  user: any;
  initialAmount?: string;
  triggerToast: (msg: string) => void;
  onSuccess: () => void;
}) {
  const [amount, setAmount] = useState(initialAmount);
  const [method, setMethod] = useState<'QRIS' | 'TRANSFER' | 'EWALLET' | 'PAYMENT_LINK' | 'CASH'>('QRIS');
  const [proofUrl, setProofUrl] = useState<string>('');
  const [isUploading, setIsUploading] = useState(false);
  const [showQrisCam, setShowQrisCam] = useState(false);
  const [submittedReq, setSubmittedReq] = useState<any | null>(null);

  useEffect(() => {
    if (initialAmount) {
      setAmount(initialAmount);
    }
  }, [initialAmount]);

  const topupMutation = useMutation({
    mutationFn: async (payload: { amount: number; method: string; proofImageUrl?: string }) => {
      return WalletAPI.topup(payload);
    },
    onSuccess: (res: any) => {
      triggerToast(res?.message || 'Permintaan top-up berhasil dikirim! Menunggu verifikasi Admin.');
      setSubmittedReq({
        amount: Number(amount),
        method,
        proofImageUrl: proofUrl,
      });
      onSuccess();
    },
    onError: (err: any) => {
      triggerToast(err.response?.data?.error || 'Gagal mengajukan top-up!');
    },
  });

  const handleFileUpload = async (file: File) => {
    try {
      setIsUploading(true);
      const res = await UploadAPI.uploadImage(file);
      setProofUrl(res.url);
      triggerToast('Foto bukti bayar berhasil diunggah!');
    } catch (err: any) {
      triggerToast(err.response?.data?.error || 'Gagal mengunggah foto bukti bayar!');
    } finally {
      setIsUploading(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const numAmt = Number(amount);
    if (isNaN(numAmt) || numAmt < 5000) {
      triggerToast('Nominal top-up minimal adalah Rp 5.000!');
      return;
    }
    topupMutation.mutate({
      amount: numAmt,
      method,
      proofImageUrl: method === 'CASH' ? undefined : (proofUrl || undefined),
    });
  };

  if (!isOpen) return null;

  const waMessage = `Mohon konfirmasi dan approve Top-Up wallet Nama: ${user?.fullName || 'Pengguna'} ,Jumlah: ${formatRupiah(Number(submittedReq?.amount || amount || 0))} via ${submittedReq?.method || method}`;
  const waUrl = `https://wa.me/6281252185515?text=${encodeURIComponent(waMessage)}`;

  return (
    <div className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-md flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-[#0D2E1F] border-2 border-[#00E575] rounded-3xl p-6 max-w-lg w-full flex flex-col gap-5 my-auto max-h-[90vh] overflow-y-auto shadow-2xl">
        <div className="flex justify-between items-center border-b border-[#23583E] pb-3">
          <div className="flex items-center gap-2 text-[#FFD700]">
            <Wallet className="w-5 h-5 text-[#00E575]" />
            <h3 className="font-black text-lg text-white">Top-Up Saldo Dompet DHUKNOO</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-400 hover:text-white font-bold text-sm bg-[#06170E] px-3 py-1.5 rounded-xl border border-[#23583E]"
          >
            ✕
          </button>
        </div>

        {submittedReq ? (
          <div className="bg-[#06170E] border border-[#00E575]/50 p-5 rounded-2xl flex flex-col gap-4 text-center">
            <div className="w-12 h-12 bg-[#00E575]/20 text-[#00E575] rounded-full flex items-center justify-center mx-auto">
              <CheckCircle className="w-8 h-8" />
            </div>
            <div>
              <h4 className="text-base font-black text-[#00E575]">Pengajuan Top-Up Berhasil Dikirim!</h4>
              <p className="text-xs text-[#A5C9B8] mt-1">
                Permintaan top-up sebesar <b className="text-[#FFD700]">{formatRupiah(submittedReq.amount)}</b> via <b>{submittedReq.method}</b> telah tercatat di sistem dan menunggu persetujuan Admin.
              </p>
            </div>

            {submittedReq.proofImageUrl && (
              <div className="bg-black/50 border border-[#23583E] p-2 rounded-xl">
                <span className="text-[10px] text-gray-400 block mb-1">Foto Bukti Bayar Terlampir:</span>
                <img src={submittedReq.proofImageUrl} alt="Bukti Transfer" className="max-h-28 object-contain mx-auto rounded-lg" />
              </div>
            )}

            <div className="bg-[#0D2E1F] border border-amber-500/40 p-3 rounded-xl text-left text-xs flex flex-col gap-2">
              <span className="text-amber-400 font-bold flex items-center gap-1 text-[11px]">
                <Clock className="w-4 h-4" /> Langkah Konfirmasi WhatsApp Web:
              </span>
              <p className="text-[10px] text-[#A5C9B8]">
                Klik tombol di bawah untuk membuka pesan WhatsApp terformat otomatis ke Admin (+6281252185515).
              </p>
            </div>

            <a
              href={waUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="bg-[#25D366] hover:bg-[#1ebf59] text-black font-black py-3 px-4 rounded-xl text-xs flex items-center justify-center gap-2 shadow-lg transition-all"
            >
              <PhoneCall className="w-4 h-4" />
              📱 Kirim Konfirmasi ke WhatsApp Admin (+6281252185515)
            </a>

            <button
              type="button"
              onClick={() => {
                setSubmittedReq(null);
                setAmount('');
                setProofUrl('');
                onClose();
              }}
              className="bg-[#23583E] hover:bg-[#23583E]/80 text-[#00E575] font-bold py-2 px-4 rounded-xl text-xs"
            >
              Tutup & Kembali
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-4 text-xs">
            <div className="flex flex-col gap-1.5">
              <label className="font-bold text-[#A5C9B8] text-[11px]">1. Pilih / Ketik Nominal Top-Up (Rp):</label>
              <input
                type="number"
                required
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="Masukkan nominal (contoh: 50000)"
                className="bg-[#06170E] border border-[#23583E] text-white font-bold text-sm px-3 py-2.5 rounded-xl focus:outline-none focus:border-[#00E575]"
              />
              <div className="grid grid-cols-4 gap-1.5 mt-1">
                {[10000, 20000, 50000, 100000].map((amt) => (
                  <button
                    key={amt}
                    type="button"
                    onClick={() => setAmount(String(amt))}
                    className="bg-[#06170E] hover:bg-[#23583E] border border-[#23583E] text-[#FFD700] text-[10px] py-1.5 rounded-lg font-bold transition-all"
                  >
                    +{formatRupiah(amt)}
                  </button>
                ))}
              </div>
              <span className="text-[9px] text-[#A5C9B8]/70">🔒 Batas minimal top-up adalah Rp 5.000</span>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="font-bold text-[#A5C9B8] text-[11px]">2. Pilih Metode Pembayaran:</label>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { id: 'QRIS', label: '📲 QRIS Instant', sub: 'Scan Barcode' },
                  { id: 'TRANSFER', label: '🏦 Transfer Bank', sub: 'BCA / Mandiri / BRI' },
                  { id: 'EWALLET', label: '📱 E-Wallet', sub: 'OVO / GoPay / DANA' },
                  { id: 'PAYMENT_LINK', label: '💳 Link Payment', sub: 'Gateway Checkout' },
                  { id: 'CASH', label: '💵 Setor Tunai / Cash', sub: 'Kasir / Agen Resmi' },
                ].map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setMethod(m.id as any)}
                    className={`p-2.5 rounded-xl border text-left flex flex-col transition-all ${
                      method === m.id
                        ? 'bg-[#00E575]/20 border-[#00E575] text-[#00E575] font-black'
                        : 'bg-[#06170E] border-[#23583E] text-gray-300 hover:border-[#00E575]/50'
                    }`}
                  >
                    <span className="text-xs font-bold">{m.label}</span>
                    <span className="text-[9px] opacity-75">{m.sub}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="bg-[#06170E] border border-[#23583E] p-3.5 rounded-xl flex flex-col gap-2">
              {method === 'CASH' && (
                <div className="flex flex-col gap-1.5 text-left">
                  <span className="text-[10px] text-gray-400">Setoran Tunai (Cash):</span>
                  <p className="text-xs text-[#00E575] font-bold">
                    💵 Lakukan setoran uang tunai/cash langsung di Kasir Kantor DHUKNOO RIDE atau Titik Agen Resmi terdekat.
                  </p>
                  <span className="text-[10px] text-[#A5C9B8]">Tunjukkan ID Akun / Email Anda ke Kasir: <b className="text-white">{user?.email}</b></span>
                </div>
              )}
              {method === 'QRIS' && (
                <div className="flex flex-col items-center gap-2 text-center">
                  <span className="text-[10px] text-[#00E575] font-bold">Pindai Kode QRIS Resmi DHUKNOO RIDE:</span>
                  <div className="bg-white p-2 rounded-xl border border-gray-300 shadow-md">
                    <img
                      src="https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=00020101021126580014ID.LINKAJA.WWW011893600911002202680215202607220123455204581253033605802ID5915DHUKNOO%20RIDE%20OFFICIAL6007JAKARTA61051234563040A5B"
                      alt="QRIS Barcode"
                      className="w-36 h-36 object-contain"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowQrisCam(true)}
                    className="bg-[#00E575] hover:bg-[#00ff80] text-[#071F14] font-bold py-1.5 px-3 rounded-lg text-[10px] flex items-center gap-1 mt-1"
                  >
                    <Camera className="w-3.5 h-3.5" /> Buka Kamera Scan QRIS
                  </button>
                </div>
              )}

              {method === 'TRANSFER' && (
                <div className="flex flex-col gap-1.5">
                  <div className="flex justify-between items-center">
                    <span className="text-[10px] text-gray-400">Rekening Transfer Bank:</span>
                    <span className="text-xs font-mono font-black text-[#FFD700]">0192837465</span>
                  </div>
                  <span className="text-[10px] text-[#A5C9B8]">Bank BCA / Mandiri a/n PT DHUKNOO RIDE INDONESIA</span>
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard.writeText('0192837465');
                      triggerToast('Nomor Rekening 0192837465 berhasil disalin!');
                    }}
                    className="bg-[#23583E] text-[#FFD700] font-bold py-1 px-2.5 rounded-lg text-[10px] flex items-center justify-center gap-1 mt-1"
                  >
                    <Copy className="w-3 h-3" /> Salin No. Rekening 0192837465
                  </button>
                </div>
              )}

              {method === 'EWALLET' && (
                <div className="flex flex-col gap-1.5">
                  <div className="flex justify-between items-center">
                    <span className="text-[10px] text-gray-400">Nomor OVO / GoPay / DANA:</span>
                    <span className="text-xs font-mono font-black text-[#FFD700]">081252185515</span>
                  </div>
                  <span className="text-[10px] text-[#A5C9B8]">Atas Nama: DHUKNOO Official Wallet</span>
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard.writeText('081252185515');
                      triggerToast('Nomor E-Wallet 081252185515 berhasil disalin!');
                    }}
                    className="bg-[#23583E] text-[#FFD700] font-bold py-1 px-2.5 rounded-lg text-[10px] flex items-center justify-center gap-1 mt-1"
                  >
                    <Copy className="w-3 h-3" /> Salin No. E-Wallet 081252185515
                  </button>
                </div>
              )}

              {method === 'PAYMENT_LINK' && (
                <div className="flex flex-col gap-1.5">
                  <span className="text-[10px] text-gray-400">Link Payment Gateway Pembayaran Instant:</span>
                  <span className="text-xs font-mono text-[#00E575] break-all bg-black/40 p-2 rounded-lg border border-[#23583E]">
                    https://checkout.dhuknooride.id/pay/topup
                  </span>
                  <div className="flex gap-2 mt-1">
                    <a
                      href="https://checkout.dhuknooride.id/pay/topup"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="bg-[#00E575] text-[#071F14] font-bold py-1.5 px-3 rounded-lg text-[10px] flex-1 text-center"
                    >
                      Buka Link Pembayaran
                    </a>
                    <button
                      type="button"
                      onClick={() => {
                        navigator.clipboard.writeText('https://checkout.dhuknooride.id/pay/topup');
                        triggerToast('Link pembayaran berhasil disalin!');
                      }}
                      className="bg-[#23583E] text-[#FFD700] font-bold py-1.5 px-3 rounded-lg text-[10px] flex items-center justify-center gap-1"
                    >
                      <Copy className="w-3 h-3" /> Salin Link
                    </button>
                  </div>
                </div>
              )}
            </div>

            {method === 'CASH' ? (
              <div className="flex flex-col gap-1.5 bg-[#06170E] p-3 rounded-xl border border-[#23583E]">
                <label className="font-bold text-[#A5C9B8] text-[11px]">3. Verifikasi Setoran Tunai</label>
                <p className="text-[10px] text-[#A5C9B8]">
                  Foto bukti tidak diperlukan. Setoran akan tetap berstatus menunggu verifikasi sampai kasir/agen resmi mengonfirmasi uang tunai telah diterima.
                </p>
              </div>
            ) : (
              <div className="flex flex-col gap-1.5 bg-[#06170E] p-3 rounded-xl border border-[#23583E]">
                <label className="font-bold text-[#A5C9B8] text-[11px]">3. Unggah Foto Bukti Bayar / Transfer (Wajib):</label>
                <div className="flex items-center gap-2">
                  <input
                    type="file"
                    accept="image/*"
                    required
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) handleFileUpload(f);
                    }}
                    className="text-[10px] text-[#A5C9B8] file:mr-2 file:py-1.5 file:px-3 file:rounded-xl file:border-0 file:text-[10px] file:font-bold file:bg-[#23583E] file:text-[#00E575] hover:file:bg-[#23583E]/80"
                  />
                  {isUploading && <span className="text-[10px] text-amber-400 animate-pulse">Mengunggah...</span>}
                </div>
                {proofUrl && (
                  <div className="flex items-center gap-2 mt-1 bg-black/40 p-1.5 rounded-lg border border-[#00E575]/40">
                    <img src={proofUrl} alt="Bukti" className="w-10 h-10 object-cover rounded-md" />
                    <span className="text-[9px] text-[#00E575] font-bold">Foto Bukti Terlampir!</span>
                  </div>
                )}
              </div>
            )}

            <button
              type="submit"
              disabled={topupMutation.isPending || isUploading}
              className="bg-[#00E575] hover:bg-[#00ff80] text-[#071F14] font-black py-3 rounded-xl text-xs transition-all shadow-md mt-2 flex items-center justify-center gap-2"
            >
              {topupMutation.isPending ? 'Mengirim Pengajuan...' : 'Kirim Pengajuan Top-Up Saldo'}
            </button>
          </form>
        )}
      </div>

      {showQrisCam && (
        <QrisCameraScannerModal
          onClose={() => setShowQrisCam(false)}
          triggerToast={triggerToast}
        />
      )}
    </div>
  );
}

export function PasswordResetModal({
  isOpen,
  onClose,
  user,
  triggerToast,
}: {
  isOpen: boolean;
  onClose: () => void;
  user?: any;
  triggerToast: (msg: string) => void;
}) {
  const [phone, setPhone] = useState(user?.phone || user?.email || '');
  const [otpCode, setOtpCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [step, setStep] = useState<'REQUEST' | 'VERIFY'>('REQUEST');
  const [isLoading, setIsLoading] = useState(false);
  const [resetWhatsAppUrl, setResetWhatsAppUrl] = useState<string | null>(null);

  useEffect(() => {
    if (user?.phone || user?.email) {
      setPhone(user.phone || user.email);
    }
  }, [user]);

  if (!isOpen) return null;

  const handleRequestOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!phone.trim()) {
      triggerToast('Mohon masukkan Nomor HP Pendaftar!');
      return;
    }

    setIsLoading(true);
    try {
      const res = await AuthAPI.requestPasswordReset({ phone: phone.trim(), emailOrPhone: phone.trim() });
      triggerToast(res.message || '✅ Kode otentikasi alternatif dikirim ke nomor HP pendaftar!');

      // 🔒 Kode OTP TIDAK PERNAH ditampilkan di dashboard/UI.
      // Kode hanya dikirim lewat pesan WhatsApp yang sudah disiapkan
      // backend (whatsappUrl). Buka otomatis begitu diterima:
      // - Dibuka di browser desktop -> redirect ke WhatsApp Web
      // - Dibuka di HP -> langsung membuka aplikasi WhatsApp
      if (res.whatsappUrl) {
        setResetWhatsAppUrl(res.whatsappUrl);
        window.open(res.whatsappUrl, '_blank', 'noopener,noreferrer');
      }

      setOtpCode('');
      setStep('VERIFY');
    } catch (err: any) {
      triggerToast(err.response?.data?.error || 'Gagal mengirim kode otentikasi ke nomor HP!');
    } finally {
      setIsLoading(false);
    }
  };

  const handleConfirmReset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!otpCode.trim()) {
      triggerToast('Mohon masukkan kode otentikasi alternatif 6-digit!');
      return;
    }
    if (!newPassword || newPassword.length < 4) {
      triggerToast('Kata sandi baru minimal 4 karakter!');
      return;
    }
    if (newPassword !== confirmPassword) {
      triggerToast('Konfirmasi kata sandi tidak cocok!');
      return;
    }

    setIsLoading(true);
    try {
      const res = await AuthAPI.confirmPasswordReset({
        token: otpCode.trim(),
        newPassword: newPassword.trim(),
      });
      triggerToast(res.message || '✅ Kata sandi akun berhasil diperbarui! Silakan login.');
      setOtpCode('');
      setNewPassword('');
      setConfirmPassword('');
      setStep('REQUEST');
      onClose();
    } catch (err: any) {
      triggerToast(err.response?.data?.error || 'Gagal memverifikasi kode otentikasi reset!');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
      <div className="bg-[#0D2E1F] border-2 border-[#FFD700] rounded-3xl p-6 max-w-md w-full flex flex-col gap-4 shadow-2xl">
        <div className="flex justify-between items-center border-b border-[#23583E] pb-3">
          <div className="flex items-center gap-2">
            <Smartphone className="w-5 h-5 text-[#FFD700]" />
            <span className="text-sm font-black text-white">Layanan Otentikasi DHUKNOO Ride</span>
          </div>
          <button
            onClick={onClose}
            type="button"
            className="text-gray-400 hover:text-white font-bold text-sm bg-[#06170E] px-3 py-1 rounded-xl border border-[#23583E]"
          >
            ✕
          </button>
        </div>

        {step === 'REQUEST' ? (
          <form onSubmit={handleRequestOtp} className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-[10px] text-[#A5C9B8] font-bold">
                Nomor HP Pendaftar (WhatsApp / SMS) *
              </label>
              <input
                type="text"
                required
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="Contoh: 081252185515 atau ID/Email"
                className="bg-[#06170E] border border-[#23583E] rounded-xl px-3.5 py-2.5 text-xs text-white focus:outline-none focus:border-[#FFD700]"
              />
            </div>

            <p className="text-[9px] text-[#A5C9B8] bg-[#06170E] p-3 rounded-xl border border-[#23583E] leading-relaxed">
              💡 Bantuan mandiri reset kata sandi langsung terhubung ke layanan otentikasi akun DHUKNOO Ride dengan otentifikasi yang lain yang diterima melalui no hp pendaftar.
            </p>

            <div className="flex gap-2 mt-2">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 bg-[#06170E] text-[#A5C9B8] font-bold py-2.5 rounded-xl text-xs hover:bg-[#23583E]"
              >
                Batal
              </button>
              <button
                type="submit"
                disabled={isLoading}
                className="flex-1 bg-[#FFD700] hover:bg-[#FFD700]/80 text-[#06170E] font-black py-2.5 rounded-xl text-xs transition-all disabled:opacity-50 flex items-center justify-center gap-1.5 cursor-pointer"
              >
                {isLoading ? (
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <>
                    <Send className="w-3.5 h-3.5" /> Kirim Kode Otentikasi HP
                  </>
                )}
              </button>
            </div>
          </form>
        ) : (
          <form onSubmit={handleConfirmReset} className="flex flex-col gap-3">
            <div className="bg-[#06170E] border border-[#00E575]/40 p-3 rounded-xl flex flex-col gap-1">
              <span className="text-[10px] text-[#00E575] font-bold flex items-center gap-1">
                <CheckCircle className="w-3.5 h-3.5" /> Kode Otentikasi Alternatif Terkirim!
              </span>
              <p className="text-[9px] text-[#A5C9B8]">
                Layanan otentikasi DHUKNOO Ride telah mengirimkan kode verifikasi 6-digit lewat WhatsApp ke No. HP Pendaftar: <strong className="text-white">{phone}</strong>. Buka WhatsApp Anda untuk melihat kodenya.
              </p>
              {resetWhatsAppUrl && (
                <div className="mt-1 bg-[#0D2E1F] p-2 rounded-lg border border-[#00E575]/30 flex justify-between items-center text-[10px]">
                  <span>Tidak menerima pesannya?</span>
                  <button
                    type="button"
                    onClick={() => window.open(resetWhatsAppUrl, '_blank', 'noopener,noreferrer')}
                    className="text-[#25D366] text-[9px] hover:underline font-bold flex items-center gap-1"
                  >
                    <MessageCircle className="w-3 h-3" /> Buka WhatsApp Lagi
                  </button>
                </div>
              )}
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-[10px] text-[#A5C9B8] font-bold">
                Kode Otentikasi Alternatif (6 Digit) *
              </label>
              <input
                type="text"
                required
                maxLength={6}
                value={otpCode}
                onChange={(e) => setOtpCode(e.target.value)}
                placeholder="Contoh: 123456"
                className="bg-[#06170E] border border-[#23583E] rounded-xl px-3.5 py-2.5 text-xs text-white font-mono tracking-widest text-center focus:outline-none focus:border-[#FFD700]"
              />
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-[10px] text-[#A5C9B8] font-bold">Kata Sandi Baru *</label>
              <input
                type="password"
                required
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Masukkan kata sandi baru"
                className="bg-[#06170E] border border-[#23583E] rounded-xl px-3.5 py-2.5 text-xs text-white focus:outline-none focus:border-[#FFD700]"
              />
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-[10px] text-[#A5C9B8] font-bold">Konfirmasi Kata Sandi Baru *</label>
              <input
                type="password"
                required
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Ulangi kata sandi baru"
                className="bg-[#06170E] border border-[#23583E] rounded-xl px-3.5 py-2.5 text-xs text-white focus:outline-none focus:border-[#FFD700]"
              />
            </div>

            <p className="text-[9px] text-[#A5C9B8] bg-[#06170E] p-3 rounded-xl border border-[#23583E] leading-relaxed">
              💡 Bantuan mandiri reset kata sandi langsung terhubung ke layanan otentikasi akun DHUKNOO Ride dengan otentifikasi yang lain yang diterima melalui no hp pendaftar.
            </p>

            <div className="flex gap-2 mt-2">
              <button
                type="button"
                onClick={() => {
                  setStep('REQUEST');
                  setResetWhatsAppUrl(null);
                  setOtpCode('');
                }}
                className="flex-1 bg-[#06170E] text-[#A5C9B8] font-bold py-2.5 rounded-xl text-xs hover:bg-[#23583E]"
              >
                Ganti No HP
              </button>
              <button
                type="submit"
                disabled={isLoading}
                className="flex-1 bg-[#00E575] hover:bg-[#00ff80] text-[#06170E] font-black py-2.5 rounded-xl text-xs transition-all disabled:opacity-50 flex items-center justify-center gap-1.5 cursor-pointer"
              >
                {isLoading ? (
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <>
                    <Key className="w-3.5 h-3.5" /> Verifikasi & Simpan Sandi
                  </>
                )}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
