// src/components/admin/ReviewPanel.tsx
import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { formatRupiah } from '@obama/shared-utils';
import { openWhatsAppMessage, sendAdminThankYouChat } from '../../utils/whatsapp';
import { PaymentAPI, AdminAPI } from '../../api';
import { UserCheck, ExternalLink, MessageCircle, PhoneCall } from 'lucide-react';

// (Tempelkan semua kode fungsi ReviewPanel Anda yang asli di sini...)
function ReviewPanel({ triggerToast }: { triggerToast: (msg: string) => void }) {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<'proofs' | 'topups' | 'documents'>('proofs');
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null);

  const { data: proofsData } = useQuery({ queryKey: ['pendingProofs'], queryFn: PaymentAPI.getPendingProofs });
  const { data: documentsData } = useQuery({ queryKey: ['pendingDriverDocuments'], queryFn: AdminAPI.getPendingDriverDocuments });
  const { data: topupRequestsData } = useQuery({ queryKey: ['pendingTopups'], queryFn: AdminAPI.getPendingTopupRequests });

  const proofs = proofsData?.proofs || [];
  const documents = documentsData?.documents || [];
  const topups = topupRequestsData?.topupRequests || [];

  const reviewProofMutation = useMutation({
    mutationFn: ({ proofId, status }: { proofId: string; status: 'APPROVED' | 'REJECTED' }) =>
      PaymentAPI.reviewProof(proofId, status),
    onSuccess: (res: any) => {
      triggerToast(res.message);
      queryClient.invalidateQueries({ queryKey: ['pendingProofs'] });
    },
    onError: (err: any) => triggerToast(err.response?.data?.error || 'Gagal meninjau bukti bayar!'),
  });

  const reviewTopupMutation = useMutation({
    mutationFn: ({ id, status, reviewNote, userPhone, userName, userId, amount, method }: { id: string; status: 'APPROVED' | 'REJECTED'; reviewNote?: string; userPhone?: string; userName?: string; userId?: string; amount?: number; method?: string }) =>
      AdminAPI.reviewTopupRequest(id, status, reviewNote),
    onSuccess: (res: any, variables: any) => {
      triggerToast(res.message || 'Permintaan top-up berhasil ditinjau!');
      queryClient.invalidateQueries({ queryKey: ['pendingTopups'] });
      queryClient.invalidateQueries({ queryKey: ['adminDashboard'] });

      if (variables.userPhone) {
        const actionText = variables.status === 'APPROVED' ? 'DISETUJUI. Saldo dompet Anda telah bertambah.' : 'DITOLAK. Mohon periksa kembali bukti pembayaran Anda.';
        const replyMsg = `Halo ${variables.userName || 'Pengguna'}, konfirmasi balasan Admin DHUKNOO Ride: Top up wallet atas Nama: ${variables.userName} (${variables.userId}) / Jumlah: ${formatRupiah(variables.amount || 0)} via ${variables.method} -> STATUS: ${actionText}`;
        openWhatsAppMessage(variables.userPhone, replyMsg);
      }
    },
    onError: (err: any) => triggerToast(err.response?.data?.error || 'Gagal meninjau top-up!'),
  });

  const reviewDocumentMutation = useMutation({
    mutationFn: ({ documentId, status }: { documentId: string; status: 'APPROVED' | 'REJECTED' }) =>
      AdminAPI.reviewDriverDocument(documentId, status),
    onSuccess: (res: any) => {
      triggerToast(res.message);
      queryClient.invalidateQueries({ queryKey: ['pendingDriverDocuments'] });
      queryClient.invalidateQueries({ queryKey: ['adminDashboard'] });
    },
    onError: (err: any) => triggerToast(err.response?.data?.error || 'Gagal meninjau dokumen!'),
  });

  return (
    <div className="bg-[#0D2E1F] border border-[#00E575]/30 p-6 rounded-3xl flex flex-col gap-5">
      <div>
        <span className="text-xs font-black text-[#00E575] uppercase tracking-wider flex items-center gap-1.5">
          <UserCheck className="w-5 h-5" /> Peninjauan & Verifikasi Admin
        </span>
        <p className="text-[10px] text-[#A5C9B8] mt-1">Satu pintu persetujuan bukti bayar order, deposit top-up mitra/customer, dan dokumen driver.</p>
      </div>

      <div className="flex gap-2 border-b border-[#23583E] pb-3 overflow-x-auto">
        <button
          onClick={() => setTab('proofs')}
          className={`text-[10px] font-bold px-3 py-2 rounded-lg transition-all ${tab === 'proofs' ? 'bg-[#00E575] text-[#06170E]' : 'bg-[#06170E] text-[#A5C9B8]'}`}
        >
          Bukti Order ({proofs.length})
        </button>
        <button
          onClick={() => setTab('topups')}
          className={`text-[10px] font-bold px-3 py-2 rounded-lg transition-all ${tab === 'topups' ? 'bg-[#00E575] text-[#06170E]' : 'bg-[#06170E] text-[#A5C9B8]'}`}
        >
          Deposit Top Up ({topups.length})
        </button>
        <button
          onClick={() => setTab('documents')}
          className={`text-[10px] font-bold px-3 py-2 rounded-lg transition-all ${tab === 'documents' ? 'bg-[#00E575] text-[#06170E]' : 'bg-[#06170E] text-[#A5C9B8]'}`}
        >
          Dokumen Driver ({documents.length})
        </button>
      </div>

      {tab === 'proofs' && (
        <div className="flex flex-col gap-3">
          {proofs.length === 0 ? (
            <div className="text-center text-[10px] text-[#A5C9B8]/60 py-6 border border-dashed border-[#23583E] rounded-xl">Tidak ada bukti bayar order yang menunggu.</div>
          ) : proofs.map((p: any) => (
            <div key={p.id} className="bg-[#06170E] border border-[#23583E] p-3 rounded-xl flex flex-col gap-2 text-[10px]">
              <div className="flex justify-between">
                <span className="text-white font-bold">{p.order.customer?.user?.fullName} → {p.order.driver?.user?.fullName || '-'}</span>
                <span className="text-[#FFD700] font-bold">{p.method}</span>
              </div>
              <span className="text-[#A5C9B8]">Order #{p.orderId.slice(0, 8)} — {formatRupiah(Number(p.order.price) - Number(p.order.discount || 0))}</span>
              {p.note && <span className="text-gray-400 italic">"{p.note}"</span>}

              {/* PERBAIKAN: sebelumnya di sini cuma ada TEKS LINK POLOS ("Lihat Bukti
                  Bayar Foto →") tanpa thumbnail gambar sama sekali -- beda dengan tab
                  Dokumen Driver & Deposit Top Up yang sudah benar (thumbnail inline +
                  lightbox zoom + link buka dokumen asli). Disamakan polanya di sini. */}
              {p.proofImageUrl ? (
                <div className="flex flex-col gap-2 bg-[#0D2E1F] p-2.5 rounded-xl border border-[#23583E] my-1">
                  <div className="flex justify-between items-center text-[9px] text-[#A5C9B8]">
                    <span className="font-bold text-white flex items-center gap-1">
                      📄 Bukti Bayar Order ({p.method}):
                    </span>
                    <span className="text-[#00E575] font-semibold">Klik gambar untuk zoom</span>
                  </div>
                  <div
                    onClick={() => setPreviewImageUrl(p.proofImageUrl)}
                    className="relative group rounded-xl overflow-hidden border border-[#23583E] bg-black/50 cursor-pointer max-h-52 flex items-center justify-center p-1"
                  >
                    <img
                      src={p.proofImageUrl}
                      alt="Bukti Bayar Order"
                      className="w-full max-h-48 object-contain rounded-lg transition-transform duration-300 group-hover:scale-105"
                    />
                    <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white text-[10px] font-bold gap-1 rounded-lg">
                      🔍 Perbesar Bukti Bayar Lightbox
                    </div>
                  </div>
                  <div className="flex justify-between items-center text-[9px] pt-1.5 border-t border-[#23583E]">
                    <button
                      type="button"
                      onClick={() => setPreviewImageUrl(p.proofImageUrl)}
                      className="text-[#00E575] text-[10px] font-bold hover:underline flex items-center gap-1"
                    >
                      🔍 Lightbox Zoom Bukti Bayar High-Res
                    </button>
                    <a
                      href={p.proofImageUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[#FFD700] text-[10px] font-bold hover:underline flex items-center gap-1"
                    >
                      <ExternalLink className="w-3 h-3" /> Buka Link Dokumen Asli
                    </a>
                  </div>
                </div>
              ) : (
                <span className="text-red-400">URL foto bukti bayar tidak ditemukan</span>
              )}
              <div className="flex gap-2 mt-1">
                <button
                  onClick={() => reviewProofMutation.mutate({ proofId: p.id, status: 'APPROVED' })}
                  disabled={reviewProofMutation.isPending}
                  className="flex-1 bg-[#00E575] text-[#06170E] font-black py-1.5 rounded-lg"
                >
                  Setujui
                </button>
                <button
                  onClick={() => reviewProofMutation.mutate({ proofId: p.id, status: 'REJECTED' })}
                  disabled={reviewProofMutation.isPending}
                  className="flex-1 bg-red-500/20 text-red-400 font-black py-1.5 rounded-lg"
                >
                  Tolak
                </button>
                <button
                  onClick={() =>
                    sendAdminThankYouChat({
                      phoneNumber: p.order.customer?.phoneNumber,
                      recipientName: p.order.customer?.user?.fullName,
                      orderId: p.orderId,
                    })
                  }
                  title="Kirim ucapan terima kasih via WhatsApp ke customer"
                  className="flex items-center justify-center gap-1 bg-[#25D366]/15 text-[#25D366] font-black py-1.5 px-2.5 rounded-lg"
                >
                  <MessageCircle className="w-3 h-3" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === 'topups' && (
        <div className="flex flex-col gap-3">
          {topups.length === 0 ? (
            <div className="text-center text-[10px] text-[#A5C9B8]/60 py-6 border border-dashed border-[#23583E] rounded-xl">Tidak ada permintaan top-up deposit yang menunggu.</div>
          ) : topups.map((t: any) => (
            <div key={t.id} className="bg-[#06170E] border border-[#23583E] p-3 rounded-xl flex flex-col gap-2 text-[10px]">
              <div className="flex justify-between items-center">
                <span className="text-white font-bold">{t.user?.fullName || 'Pengguna'} ({t.user?.role || 'USER'})</span>
                <span className="text-[#FFD700] font-black text-xs">{formatRupiah(Number(t.amount))}</span>
              </div>
              <div className="flex justify-between text-[#A5C9B8] text-[9px]">
                <span>ID: <code className="text-white">{t.user?.id || t.userId}</code></span>
                <span>Metode: <strong className="text-white">{t.method}</strong></span>
              </div>
              <div className="flex justify-between text-[#A5C9B8] text-[9px]">
                <span>No WA: <strong className="text-[#00E575]">{t.user?.phone || 'Tidak Ada Nomor'}</strong></span>
                <span>{new Date(t.createdAt).toLocaleDateString('id-ID')}</span>
              </div>
              {t.note && <span className="text-gray-400 italic">Catatan: "{t.note}"</span>}
              
              {/* Box Balas WhatsApp Admin */}
              <div className="bg-[#0D2E1F] p-2 rounded-xl border border-[#23583E] flex flex-col gap-1.5 my-1">
                <span className="text-[9px] text-[#A5C9B8] font-bold">📲 Balasan Konfirmasi Admin ke User/Driver via WhatsApp:</span>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      const msg = `Halo ${t.user?.fullName || 'Pengguna'}, konfirmasi balasan Admin DHUKNOO Ride: Top up wallet atas Nama: ${t.user?.fullName || 'Pengguna'} (${t.user?.id || t.userId}) / Jumlah: ${formatRupiah(Number(t.amount))} via ${t.method} -> STATUS: DISETUJUI. Saldo Anda telah bertambah.`;
                      openWhatsAppMessage(t.user?.phone, msg);
                    }}
                    className="bg-[#25D366]/20 hover:bg-[#25D366] text-[#25D366] hover:text-black font-black text-[9px] py-1.5 px-2 rounded-lg transition-all flex items-center justify-center gap-1 border border-[#25D366]/40"
                  >
                    <PhoneCall className="w-3 h-3" /> WA Reply DISETUJUI
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const msg = `Halo ${t.user?.fullName || 'Pengguna'}, konfirmasi balasan Admin DHUKNOO Ride: Top up wallet atas Nama: ${t.user?.fullName || 'Pengguna'} (${t.user?.id || t.userId}) / Jumlah: ${formatRupiah(Number(t.amount))} via ${t.method} -> STATUS: DITOLAK. Mohon periksa kembali bukti pembayaran Anda.`;
                      openWhatsAppMessage(t.user?.phone, msg);
                    }}
                    className="bg-red-500/20 hover:bg-red-500 text-red-400 hover:text-white font-black text-[9px] py-1.5 px-2 rounded-lg transition-all flex items-center justify-center gap-1 border border-red-500/40"
                  >
                    <PhoneCall className="w-3 h-3" /> WA Reply DITOLAK
                  </button>
                </div>
              </div>

              {t.proofImageUrl ? (
                <div className="flex flex-col gap-2 bg-[#0D2E1F] p-2.5 rounded-xl border border-[#23583E]">
                  <div className="flex justify-between items-center text-[9px] text-[#A5C9B8]">
                    <span className="font-bold text-white flex items-center gap-1">
                      📄 Dokumen Lampiran Bukti Pembayaran Top-Up Deposit:
                    </span>
                    <span className="text-[#00E575] font-semibold">Klik gambar untuk zoom</span>
                  </div>
                  <div 
                    onClick={() => setPreviewImageUrl(t.proofImageUrl)}
                    className="relative group rounded-xl overflow-hidden border border-[#23583E] bg-black/50 cursor-pointer max-h-52 flex items-center justify-center p-1"
                  >
                    <img 
                      src={t.proofImageUrl} 
                      alt="Bukti Bayar Topup" 
                      className="w-full max-h-48 object-contain rounded-lg transition-transform duration-300 group-hover:scale-105" 
                    />
                    <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white text-[10px] font-bold gap-1 rounded-lg">
                      🔍 Perbesar Dokumen Lightbox
                    </div>
                  </div>
                  <div className="flex justify-between items-center text-[9px] pt-1.5 border-t border-[#23583E]">
                    <button
                      type="button"
                      onClick={() => setPreviewImageUrl(t.proofImageUrl)}
                      className="text-[#00E575] text-[10px] font-bold hover:underline flex items-center gap-1"
                    >
                      🔍 Lightbox Zoom Dokumen High-Res
                    </button>
                    <a
                      href={t.proofImageUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[#FFD700] text-[10px] font-bold hover:underline flex items-center gap-1"
                    >
                      <ExternalLink className="w-3 h-3" /> Buka Link Dokumen Asli
                    </a>
                  </div>
                </div>
              ) : (
                <div className="bg-[#0D2E1F]/60 p-2.5 rounded-xl border border-dashed border-[#23583E] text-gray-400 text-[9px]">
                  ⚠️ Konfirmasi langsung tanpa lampiran foto bukti bayar
                </div>
              )}
              <div className="flex gap-2 mt-1">
                <button
                  onClick={() => reviewTopupMutation.mutate({
                    id: t.id,
                    status: 'APPROVED',
                    userPhone: t.user?.phone,
                    userName: t.user?.fullName,
                    userId: t.user?.id || t.userId,
                    amount: Number(t.amount),
                    method: t.method,
                  })}
                  disabled={reviewTopupMutation.isPending}
                  className="flex-1 bg-[#00E575] text-[#06170E] font-black py-1.5 rounded-lg hover:bg-[#00ff80]"
                >
                  Approve & Tambah Saldo
                </button>
                <button
                  onClick={() => reviewTopupMutation.mutate({
                    id: t.id,
                    status: 'REJECTED',
                    userPhone: t.user?.phone,
                    userName: t.user?.fullName,
                    userId: t.user?.id || t.userId,
                    amount: Number(t.amount),
                    method: t.method,
                  })}
                  disabled={reviewTopupMutation.isPending}
                  className="flex-1 bg-red-500/20 text-red-400 font-black py-1.5 rounded-lg hover:bg-red-500/30"
                >
                  Tolak Top Up
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === 'documents' && (
        <div className="flex flex-col gap-3">
          {documents.length === 0 ? (
            <div className="text-center text-[10px] text-[#A5C9B8]/60 py-6 border border-dashed border-[#23583E] rounded-xl">Tidak ada dokumen driver yang menunggu verifikasi.</div>
          ) : documents.map((d: any) => (
            <div key={d.id} className="bg-[#06170E] border border-[#23583E] p-3 rounded-xl flex flex-col gap-2 text-[10px]">
              <div className="flex justify-between">
                <span className="text-white font-bold">{d.driver?.user?.fullName} ({d.driver?.user?.email})</span>
                <span className="text-[#FFD700] font-bold">{d.type === 'KTP_SELFIE' ? '🪪 Foto Diri + KTP' : d.type === 'STNK' ? '📄 STNK Kendaraan' : '💳 SIM Driver (*Wajib)'}</span>
              </div>
              {d.imageUrl ? (
                <div className="flex flex-col gap-2 bg-[#0D2E1F] p-2.5 rounded-xl border border-[#23583E] my-1">
                  <div className="flex justify-between items-center text-[9px] text-[#A5C9B8]">
                    <span className="font-bold text-white flex items-center gap-1">
                      📄 Dokumen Driver ({d.type}):
                    </span>
                    <span className="text-[#00E575] font-semibold">Klik gambar untuk zoom</span>
                  </div>
                  <div 
                    onClick={() => setPreviewImageUrl(d.imageUrl)}
                    className="relative group rounded-xl overflow-hidden border border-[#23583E] bg-black/50 cursor-pointer max-h-52 flex items-center justify-center p-1"
                  >
                    <img 
                      src={d.imageUrl} 
                      alt="Dokumen Driver" 
                      className="w-full max-h-48 object-contain rounded-lg transition-transform duration-300 group-hover:scale-105" 
                    />
                    <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white text-[10px] font-bold gap-1 rounded-lg">
                      🔍 Perbesar Dokumen Driver Lightbox
                    </div>
                  </div>
                  <div className="flex justify-between items-center text-[9px] pt-1.5 border-t border-[#23583E]">
                    <button
                      type="button"
                      onClick={() => setPreviewImageUrl(d.imageUrl)}
                      className="text-[#00E575] text-[10px] font-bold hover:underline flex items-center gap-1"
                    >
                      🔍 Lightbox Zoom Dokumen High-Res
                    </button>
                    <a
                      href={d.imageUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[#FFD700] text-[10px] font-bold hover:underline flex items-center gap-1"
                    >
                      <ExternalLink className="w-3 h-3" /> Buka Link Dokumen Asli
                    </a>
                  </div>
                </div>
              ) : (
                <span className="text-red-400">URL foto tidak ditemukan</span>
              )}
              <div className="flex gap-2 mt-1">
                <button
                  onClick={() => reviewDocumentMutation.mutate({ documentId: d.id, status: 'APPROVED' })}
                  disabled={reviewDocumentMutation.isPending}
                  className="flex-1 bg-[#00E575] text-[#06170E] font-black py-1.5 rounded-lg hover:bg-[#00ff80]"
                >
                  Setujui & Verifikasi Driver
                </button>
                <button
                  onClick={() => reviewDocumentMutation.mutate({ documentId: d.id, status: 'REJECTED' })}
                  disabled={reviewDocumentMutation.isPending}
                  className="flex-1 bg-red-500/20 text-red-400 font-black py-1.5 rounded-lg hover:bg-red-500/30"
                >
                  Tolak Dokumen
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Image Preview Modal inside Admin Panel */}
      {previewImageUrl && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-[#0D2E1F] border border-[#00E575] rounded-2xl p-4 max-w-lg w-full flex flex-col gap-3">
            <div className="flex justify-between items-center border-b border-[#23583E] pb-2">
              <span className="text-xs font-bold text-white">Pratinjau Dokumen / Bukti Bayar</span>
              <button
                onClick={() => setPreviewImageUrl(null)}
                className="text-gray-400 hover:text-white font-bold text-sm bg-[#06170E] px-2.5 py-1 rounded-lg"
              >
                ✕ Tutup
              </button>
            </div>
            <div className="max-h-[70vh] overflow-auto rounded-xl border border-[#23583E]">
              <img src={previewImageUrl} alt="Dokumen" className="w-full object-contain" />
            </div>
            <div className="flex gap-2">
              <a
                href={previewImageUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 bg-[#06170E] hover:bg-[#23583E] text-[#FFD700] border border-[#23583E] font-bold py-2 rounded-xl text-xs text-center flex items-center justify-center gap-1 transition-all"
              >
                <ExternalLink className="w-3.5 h-3.5" /> Buka Link Dokumen Asli
              </a>
              <button
                onClick={() => setPreviewImageUrl(null)}
                className="flex-1 bg-[#00E575] hover:bg-[#00ff80] text-[#06170E] font-black py-2 rounded-xl text-xs transition-all"
              >
                Kembali
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
// ✅ PERBAIKAN KRITIS: Tambahkan baris ini di bagian paling bawah!
export default React.memo(ReviewPanel);