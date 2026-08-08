import React, { useState, Suspense } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { formatRupiah } from '@obama/shared-utils';
import { sendAdminThankYouChat, openWhatsAppMessage } from '../utils/whatsapp';
import { useAuthStore } from '../store/useAuthStore';
import { AdminAPI, PaymentAPI, TariffAPI } from '../api';
import AuthFlow from '../components/auth/AuthFlow';
import {
  BarChart2,
  ClipboardList,
  DollarSign,
  ExternalLink,
  FileSpreadsheet,
  FileText,
  MapIcon,
  MessageCircle,
  Percent,
  PhoneCall,
  PlusCircle,
  Power,
  RefreshCw,
  Search,
  Settings,
  TrendingUp,
  User,
  UserCheck,
  UserX,
} from 'lucide-react';

// PERBAIKAN PERFORMA: sebelumnya AdminApp (+ ReviewPanel/TariffPanel/
// AdminRecapSection) adalah bagian dari app/App.tsx monolitik (~5100 baris)
// yang ikut ter-parse & ter-load browser SETIAP kali aplikasi dibuka, walau
// yang login adalah CUSTOMER atau DRIVER sekalipun -- termasuk library
// charting "recharts" yang cukup berat dan HANYA dipakai di sini. Dipisah
// ke file sendiri supaya bisa di-lazy-load lewat React.lazy(): kode admin
// (dan recharts) sekarang hanya diunduh browser saat role admin dipilih.
//
// 🆕 OPTIMASI LEBIH LANJUT: `recharts` sendiri (~366KB) DIKELUARKAN dari
// import statis di sini, dipindah ke CommissionAuditBarChart.tsx yang di
// bawah ini di-load lewat React.lazy() -- supaya admin yang hanya membuka
// tab Rules/Zones/Policies/Config (tidak butuh grafik) tidak ikut mengunduh
// recharts sama sekali. recharts baru diunduh saat tab "commissionAudit"
// (Audit Komisi) dibuka.
const CommissionAuditBarChart = React.lazy(() => import('../components/admin/CommissionAuditBarChart'));

interface PortalProps {
  onBack: () => void;
  triggerToast: (m: string) => void;
}

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


function TariffPanel({ triggerToast }: { triggerToast: (msg: string) => void }) {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<'rules' | 'zones' | 'policies' | 'versions' | 'commissionAudit' | 'config'>('rules');

  const { data: zonesData } = useQuery({ queryKey: ['tariffZones'], queryFn: TariffAPI.listZones });
  const { data: rulesData } = useQuery({ queryKey: ['tariffRules'], queryFn: () => TariffAPI.listRules() });
  const { data: policiesData } = useQuery({ queryKey: ['tariffPolicies'], queryFn: TariffAPI.listRegionalPolicies });
  const { data: versionsData } = useQuery({ queryKey: ['tariffVersions'], queryFn: TariffAPI.listVersions });
  const { data: configData } = useQuery({ queryKey: ['tariffConfig'], queryFn: TariffAPI.listConfig });
  const { data: auditData, isLoading: isLoadingAudit, refetch: refetchAudit } = useQuery({
    queryKey: ['commissionAudit'],
    queryFn: AdminAPI.getCommissionAudit,
    enabled: activeTab === 'commissionAudit',
  });

  const zones = zonesData?.zones || [];
  const rules = rulesData?.rules || [];
  const policies = policiesData?.policies || [];
  const versions = versionsData?.versions || [];
  const config = configData?.config || [];

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ['tariffZones'] });
    queryClient.invalidateQueries({ queryKey: ['tariffRules'] });
    queryClient.invalidateQueries({ queryKey: ['tariffPolicies'] });
    queryClient.invalidateQueries({ queryKey: ['tariffVersions'] });
    queryClient.invalidateQueries({ queryKey: ['tariffConfig'] });
    queryClient.invalidateQueries({ queryKey: ['commissionAudit'] });
  };

  const onErr = (fallback: string) => (err: any) => triggerToast(err.response?.data?.error || fallback);
  const onOk = (fallback: string) => (res: any) => {
    triggerToast(res.message || fallback);
    invalidateAll();
  };

  const createZoneMutation = useMutation({
    mutationFn: (name: string) => TariffAPI.createZone(name),
    onSuccess: onOk('Zona dibuat!'),
    onError: onErr('Gagal membuat zona!'),
  });
  const createRuleMutation = useMutation({
    mutationFn: (payload: any) => TariffAPI.createRule(payload),
    onSuccess: onOk('Aturan tarif dibuat!'),
    onError: onErr('Gagal membuat aturan tarif!'),
  });
  const toggleRuleMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) => TariffAPI.updateRule(id, { isActive }),
    onSuccess: onOk('Status aturan tarif diperbarui!'),
    onError: onErr('Gagal mengubah status aturan!'),
  });
  const createPolicyMutation = useMutation({
    mutationFn: (payload: any) => TariffAPI.createRegionalPolicy(payload),
    onSuccess: onOk('Kebijakan regional dibuat!'),
    onError: onErr('Gagal membuat kebijakan regional!'),
  });
  const createVersionMutation = useMutation({
    mutationFn: (payload: any) => TariffAPI.createVersion(payload),
    onSuccess: onOk('Versi tarif dibuat! Aktifkan supaya berlaku.'),
    onError: onErr('Gagal membuat versi tarif!'),
  });
  const activateVersionMutation = useMutation({
    mutationFn: (id: string) => TariffAPI.activateVersion(id),
    onSuccess: onOk('Versi tarif diaktifkan! Berlaku langsung, tanpa rilis aplikasi baru.'),
    onError: onErr('Gagal mengaktifkan versi tarif!'),
  });
  const updateConfigMutation = useMutation({
    mutationFn: ({ key, value }: { key: string; value: string }) => TariffAPI.updateConfig(key, value),
    onSuccess: onOk('Konfigurasi disimpan!'),
    onError: onErr('Gagal menyimpan konfigurasi!'),
  });

  // ── Form state (sederhana, disimpan sebagai objek per-form) ──
  const [zoneName, setZoneName] = useState('');
  const [ruleForm, setRuleForm] = useState({ zoneId: '', serviceType: 'BIKE', baseFare: '', pickupFee: '0', perKmFee: '', perMinuteWaitFee: '0' });
  const [policyForm, setPolicyForm] = useState({ zoneId: '', tollFee: '0', parkingFee: '0', weatherSurcharge: '0', holidaySurcharge: '0' });
  const [versionForm, setVersionForm] = useState({ versionName: '', description: '', tiers: [{ maxOrderValue: '20000', rate: '0.08' }, { maxOrderValue: '50000', rate: '0.07' }, { maxOrderValue: '100000', rate: '0.06' }, { maxOrderValue: '', rate: '0.05' }] });
  const [depositValue, setDepositValue] = useState('');

  const tabs: { key: typeof activeTab; label: string }[] = [
    { key: 'rules', label: 'Aturan Tarif' },
    { key: 'zones', label: 'Zona' },
    { key: 'policies', label: 'Kebijakan Regional' },
    { key: 'versions', label: 'Versi Komisi' },
    { key: 'commissionAudit', label: 'Commission Audit 📊' },
    { key: 'config', label: 'Konfigurasi' },
  ];

  const inputCls = "w-full bg-[#06170E] border border-[#23583E] rounded-lg px-3 py-2 text-xs text-white placeholder:text-gray-500 focus:outline-none focus:border-[#00E575]";
  const labelCls = "text-[10px] font-bold text-[#A5C9B8] uppercase tracking-wide";

  return (
    <div className="bg-[#0D2E1F] border border-[#FFD700]/30 p-6 rounded-3xl flex flex-col gap-5">
      <div>
        <span className="text-xs font-black text-[#FFD700] uppercase tracking-wider flex items-center gap-1.5">
          <Settings className="w-5 h-5" /> Tariff Engine — Kelola Tarif
        </span>
        <p className="text-[10px] text-[#A5C9B8] mt-1 leading-relaxed">
          Semua komponen tarif (Tarif Dasar + Pickup + Perjalanan + Tunggu + Tol + Parkir + Cuaca + Hari Libur − Promo) dan komisi platform tiered dikendalikan dari sini — berlaku langsung tanpa rilis aplikasi baru.
        </p>
      </div>

      <div className="flex gap-2 flex-wrap border-b border-[#23583E] pb-3">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            className={`text-[10px] font-bold px-3 py-2 rounded-lg transition-all ${activeTab === t.key ? 'bg-[#FFD700] text-[#06170E]' : 'bg-[#06170E] text-[#A5C9B8] hover:text-white'}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ── ATURAN TARIF ── */}
      {activeTab === 'rules' && (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 md:grid-cols-6 gap-2 items-end bg-[#06170E]/50 p-4 rounded-xl">
            <div className="flex flex-col gap-1">
              <label className={labelCls}>Zona (opsional)</label>
              <select className={inputCls} value={ruleForm.zoneId} onChange={(e) => setRuleForm({ ...ruleForm, zoneId: e.target.value })}>
                <option value="">Semua Zona (fallback)</option>
                {zones.map((z: any) => <option key={z.id} value={z.id}>{z.name}</option>)}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className={labelCls}>Layanan</label>
              <select className={inputCls} value={ruleForm.serviceType} onChange={(e) => setRuleForm({ ...ruleForm, serviceType: e.target.value })}>
                <option value="BIKE">BIKE</option>
                <option value="CAR">CAR</option>
                <option value="SEND">SEND</option>
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className={labelCls}>Tarif Dasar</label>
              <input className={inputCls} type="number" placeholder="5000" value={ruleForm.baseFare} onChange={(e) => setRuleForm({ ...ruleForm, baseFare: e.target.value })} />
            </div>
            <div className="flex flex-col gap-1">
              <label className={labelCls}>Biaya Pickup</label>
              <input className={inputCls} type="number" value={ruleForm.pickupFee} onChange={(e) => setRuleForm({ ...ruleForm, pickupFee: e.target.value })} />
            </div>
            <div className="flex flex-col gap-1">
              <label className={labelCls}>Rp/Km</label>
              <input className={inputCls} type="number" placeholder="2000" value={ruleForm.perKmFee} onChange={(e) => setRuleForm({ ...ruleForm, perKmFee: e.target.value })} />
            </div>
            <div className="flex flex-col gap-1">
              <label className={labelCls}>Rp/Menit Tunggu</label>
              <input className={inputCls} type="number" value={ruleForm.perMinuteWaitFee} onChange={(e) => setRuleForm({ ...ruleForm, perMinuteWaitFee: e.target.value })} />
            </div>
            <button
              onClick={() => {
                if (!ruleForm.baseFare || !ruleForm.perKmFee) { triggerToast('Tarif Dasar dan Rp/Km wajib diisi!'); return; }
                createRuleMutation.mutate({
                  zoneId: ruleForm.zoneId || undefined,
                  serviceType: ruleForm.serviceType,
                  baseFare: Number(ruleForm.baseFare),
                  pickupFee: Number(ruleForm.pickupFee || 0),
                  perKmFee: Number(ruleForm.perKmFee),
                  perMinuteWaitFee: Number(ruleForm.perMinuteWaitFee || 0),
                });
              }}
              disabled={createRuleMutation.isPending}
              className="col-span-2 md:col-span-6 flex items-center justify-center gap-1.5 bg-[#00E575] hover:bg-[#00E575]/80 disabled:opacity-50 text-[#06170E] text-xs font-black py-2.5 rounded-lg transition-all"
            >
              <PlusCircle className="w-4 h-4" /> {createRuleMutation.isPending ? 'Menyimpan...' : 'Tambah Aturan Tarif'}
            </button>
          </div>

          <div className="flex flex-col gap-2">
            {rules.length === 0 ? (
              <div className="text-center text-[10px] text-[#A5C9B8]/60 py-6 border border-dashed border-[#23583E] rounded-xl">Belum ada aturan tarif.</div>
            ) : rules.map((r: any) => (
              <div key={r.id} className={`flex flex-wrap justify-between items-center gap-2 bg-[#06170E] border ${r.isActive ? 'border-[#23583E]' : 'border-red-500/30 opacity-50'} p-3 rounded-xl text-[10px]`}>
                <div className="flex flex-col">
                  <span className="font-bold text-white">{r.serviceType} — {r.zone?.name || 'Semua Zona'}</span>
                  <span className="text-[#A5C9B8]">
                    Dasar {formatRupiah(Number(r.baseFare))} + Pickup {formatRupiah(Number(r.pickupFee))} + {formatRupiah(Number(r.perKmFee))}/km + {formatRupiah(Number(r.perMinuteWaitFee))}/menit tunggu
                  </span>
                </div>
                <button
                  onClick={() => toggleRuleMutation.mutate({ id: r.id, isActive: !r.isActive })}
                  className={`flex items-center gap-1 text-[10px] font-black py-1.5 px-3 rounded-lg transition-all ${r.isActive ? 'bg-red-500/20 text-red-400' : 'bg-[#00E575]/20 text-[#00E575]'}`}
                >
                  <Power className="w-3 h-3" /> {r.isActive ? 'Nonaktifkan' : 'Aktifkan'}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── ZONA ── */}
      {activeTab === 'zones' && (
        <div className="flex flex-col gap-4">
          <div className="flex gap-2 bg-[#06170E]/50 p-4 rounded-xl">
            <input className={inputCls} placeholder="Nama zona, mis. Kota Batu" value={zoneName} onChange={(e) => setZoneName(e.target.value)} />
            <button
              onClick={() => { if (!zoneName.trim()) return; createZoneMutation.mutate(zoneName.trim()); setZoneName(''); }}
              disabled={createZoneMutation.isPending}
              className="flex items-center gap-1.5 bg-[#00E575] hover:bg-[#00E575]/80 disabled:opacity-50 text-[#06170E] text-xs font-black py-2.5 px-4 rounded-lg whitespace-nowrap"
            >
              <PlusCircle className="w-4 h-4" /> Tambah Zona
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            {zones.length === 0 ? (
              <div className="text-center w-full text-[10px] text-[#A5C9B8]/60 py-6 border border-dashed border-[#23583E] rounded-xl">Belum ada zona.</div>
            ) : zones.map((z: any) => (
              <div key={z.id} className="flex items-center gap-1.5 bg-[#06170E] border border-[#23583E] px-3 py-2 rounded-full text-[10px] font-bold text-white">
                <MapIcon className="w-3 h-3 text-[#FFD700]" /> {z.name}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── KEBIJAKAN REGIONAL ── */}
      {activeTab === 'policies' && (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2 items-end bg-[#06170E]/50 p-4 rounded-xl">
            <div className="flex flex-col gap-1">
              <label className={labelCls}>Zona</label>
              <select className={inputCls} value={policyForm.zoneId} onChange={(e) => setPolicyForm({ ...policyForm, zoneId: e.target.value })}>
                <option value="">Pilih zona...</option>
                {zones.map((z: any) => <option key={z.id} value={z.id}>{z.name}</option>)}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className={labelCls}>Tol</label>
              <input className={inputCls} type="number" value={policyForm.tollFee} onChange={(e) => setPolicyForm({ ...policyForm, tollFee: e.target.value })} />
            </div>
            <div className="flex flex-col gap-1">
              <label className={labelCls}>Parkir</label>
              <input className={inputCls} type="number" value={policyForm.parkingFee} onChange={(e) => setPolicyForm({ ...policyForm, parkingFee: e.target.value })} />
            </div>
            <div className="flex flex-col gap-1">
              <label className={labelCls}>Cuaca Buruk</label>
              <input className={inputCls} type="number" value={policyForm.weatherSurcharge} onChange={(e) => setPolicyForm({ ...policyForm, weatherSurcharge: e.target.value })} />
            </div>
            <div className="flex flex-col gap-1">
              <label className={labelCls}>Hari Libur</label>
              <input className={inputCls} type="number" value={policyForm.holidaySurcharge} onChange={(e) => setPolicyForm({ ...policyForm, holidaySurcharge: e.target.value })} />
            </div>
            <button
              onClick={() => {
                if (!policyForm.zoneId) { triggerToast('Pilih zona dulu!'); return; }
                createPolicyMutation.mutate({
                  zoneId: policyForm.zoneId,
                  tollFee: Number(policyForm.tollFee || 0),
                  parkingFee: Number(policyForm.parkingFee || 0),
                  weatherSurcharge: Number(policyForm.weatherSurcharge || 0),
                  holidaySurcharge: Number(policyForm.holidaySurcharge || 0),
                });
              }}
              disabled={createPolicyMutation.isPending}
              className="col-span-2 md:col-span-5 flex items-center justify-center gap-1.5 bg-[#00E575] hover:bg-[#00E575]/80 disabled:opacity-50 text-[#06170E] text-xs font-black py-2.5 rounded-lg"
            >
              <PlusCircle className="w-4 h-4" /> {createPolicyMutation.isPending ? 'Menyimpan...' : 'Tambah Kebijakan Regional'}
            </button>
          </div>
          <div className="flex flex-col gap-2">
            {policies.length === 0 ? (
              <div className="text-center text-[10px] text-[#A5C9B8]/60 py-6 border border-dashed border-[#23583E] rounded-xl">Belum ada kebijakan regional.</div>
            ) : policies.map((p: any) => (
              <div key={p.id} className="bg-[#06170E] border border-[#23583E] p-3 rounded-xl text-[10px]">
                <span className="font-bold text-white">{p.zone?.name}</span>
                <span className="text-[#A5C9B8]"> — Tol {formatRupiah(Number(p.tollFee))}, Parkir {formatRupiah(Number(p.parkingFee))}, Cuaca +{formatRupiah(Number(p.weatherSurcharge))}, Libur +{formatRupiah(Number(p.holidaySurcharge))}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── VERSI KOMISI (TIERED) ── */}
      {activeTab === 'versions' && (
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-3 bg-[#06170E]/50 p-4 rounded-xl">
            <div className="grid grid-cols-2 gap-2">
              <input className={inputCls} placeholder="Nama versi, mis. v2026-07-tiered" value={versionForm.versionName} onChange={(e) => setVersionForm({ ...versionForm, versionName: e.target.value })} />
              <input className={inputCls} placeholder="Deskripsi (opsional)" value={versionForm.description} onChange={(e) => setVersionForm({ ...versionForm, description: e.target.value })} />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className={labelCls}>Tier Komisi (nilai order maksimal → tarif komisi)</label>
              {versionForm.tiers.map((tier, idx) => (
                <div key={idx} className="flex gap-2 items-center">
                  <input
                    className={inputCls}
                    placeholder="Nilai order maksimal (kosongkan = tanpa batas)"
                    type="number"
                    value={tier.maxOrderValue}
                    onChange={(e) => {
                      const next = [...versionForm.tiers]; next[idx] = { ...next[idx], maxOrderValue: e.target.value };
                      setVersionForm({ ...versionForm, tiers: next });
                    }}
                  />
                  <input
                    className={inputCls}
                    placeholder="Rate (0.08 = 8%)"
                    type="number" step="0.01"
                    value={tier.rate}
                    onChange={(e) => {
                      const next = [...versionForm.tiers]; next[idx] = { ...next[idx], rate: e.target.value };
                      setVersionForm({ ...versionForm, tiers: next });
                    }}
                  />
                  <button onClick={() => setVersionForm({ ...versionForm, tiers: versionForm.tiers.filter((_, i) => i !== idx) })} className="text-red-400 text-xs px-2">✕</button>
                </div>
              ))}
              <button
                onClick={() => setVersionForm({ ...versionForm, tiers: [...versionForm.tiers, { maxOrderValue: '', rate: '' }] })}
                className="text-[10px] text-[#00E575] font-bold self-start"
              >
                + Tambah tier
              </button>
            </div>
            <button
              onClick={() => {
                if (!versionForm.versionName.trim()) { triggerToast('Nama versi wajib diisi!'); return; }
                const tiers = versionForm.tiers.map((t) => ({
                  maxOrderValue: t.maxOrderValue === '' ? null : Number(t.maxOrderValue),
                  rate: Number(t.rate),
                }));
                createVersionMutation.mutate({ versionName: versionForm.versionName.trim(), description: versionForm.description || undefined, commissionTiers: tiers });
              }}
              disabled={createVersionMutation.isPending}
              className="flex items-center justify-center gap-1.5 bg-[#00E575] hover:bg-[#00E575]/80 disabled:opacity-50 text-[#06170E] text-xs font-black py-2.5 rounded-lg"
            >
              <PlusCircle className="w-4 h-4" /> {createVersionMutation.isPending ? 'Menyimpan...' : 'Buat Versi Tarif Baru'}
            </button>
          </div>

          <div className="flex flex-col gap-2">
            {versions.length === 0 ? (
              <div className="text-center text-[10px] text-[#A5C9B8]/60 py-6 border border-dashed border-[#23583E] rounded-xl">Belum ada versi tarif.</div>
            ) : versions.map((v: any) => (
              <div key={v.id} className={`flex justify-between items-center gap-2 bg-[#06170E] border ${v.isActive ? 'border-[#FFD700]' : 'border-[#23583E]'} p-3 rounded-xl text-[10px]`}>
                <div className="flex flex-col gap-0.5">
                  <span className="font-bold text-white flex items-center gap-1.5">
                    <Percent className="w-3 h-3 text-[#FFD700]" /> {v.versionName} {v.isActive && <span className="text-[9px] bg-[#FFD700] text-[#06170E] px-1.5 py-0.5 rounded-full font-black">AKTIF</span>}
                  </span>
                  <span className="text-[#A5C9B8]">{v.description || 'Tanpa deskripsi'}</span>
                </div>
                {!v.isActive && (
                  <button
                    onClick={() => activateVersionMutation.mutate(v.id)}
                    disabled={activateVersionMutation.isPending}
                    className="bg-[#FFD700] hover:bg-[#FFD700]/80 text-[#06170E] text-[10px] font-black py-1.5 px-3 rounded-lg whitespace-nowrap"
                  >
                    Aktifkan
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── COMMISSION AUDIT (BAR CHART & METRICS) ── */}
      {activeTab === 'commissionAudit' && (
        <div className="flex flex-col gap-5">
          {/* Summary KPI Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="bg-[#06170E] border border-[#00E575]/30 p-3.5 rounded-xl flex flex-col justify-between">
              <span className="text-[10px] text-[#A5C9B8] uppercase font-bold flex items-center gap-1">
                <DollarSign className="w-3.5 h-3.5 text-[#00E575]" /> Total Komisi (7 Hari)
              </span>
              <span className="text-lg font-black text-[#00E575] mt-1">
                {formatRupiah(auditData?.summary?.totalCommissionEarned || 0)}
              </span>
            </div>

            <div className="bg-[#06170E] border border-[#FFD700]/30 p-3.5 rounded-xl flex flex-col justify-between">
              <span className="text-[10px] text-[#A5C9B8] uppercase font-bold flex items-center gap-1">
                <TrendingUp className="w-3.5 h-3.5 text-[#FFD700]" /> Komisi Hari Ini
              </span>
              <span className="text-lg font-black text-[#FFD700] mt-1">
                {formatRupiah(auditData?.summary?.todayCommission || 0)}
              </span>
            </div>

            <div className="bg-[#06170E] border border-[#23583E] p-3.5 rounded-xl flex flex-col justify-between">
              <span className="text-[10px] text-[#A5C9B8] uppercase font-bold flex items-center gap-1">
                <Percent className="w-3.5 h-3.5 text-emerald-400" /> Rata-Rata Harian
              </span>
              <span className="text-lg font-black text-white mt-1">
                {formatRupiah(auditData?.summary?.averageDailyCommission || 0)}
              </span>
            </div>

            <div className="bg-[#06170E] border border-[#23583E] p-3.5 rounded-xl flex flex-col justify-between">
              <span className="text-[10px] text-[#A5C9B8] uppercase font-bold flex items-center gap-1">
                <ClipboardList className="w-3.5 h-3.5 text-blue-400" /> Total Order Selesai
              </span>
              <span className="text-lg font-black text-white mt-1">
                {auditData?.summary?.totalOrdersProcessed || 0} Order
              </span>
            </div>
          </div>

          {/* Bar Chart Section */}
          <div className="bg-[#06170E] border border-[#23583E] p-4 rounded-2xl flex flex-col gap-3">
            <div className="flex justify-between items-center border-b border-[#23583E] pb-3">
              <div>
                <h4 className="text-xs font-black text-white uppercase tracking-wider flex items-center gap-2">
                  <TrendingUp className="w-4 h-4 text-[#00E575]" /> Grafik Komisi Platform Harian
                </h4>
                <p className="text-[10px] text-[#A5C9B8] mt-0.5">
                  Visualisasi total pendapatan komisi bersih yang diperoleh sistem DHUKNOO per hari
                </p>
              </div>
              <button
                onClick={() => refetchAudit()}
                className="flex items-center gap-1 bg-[#0D2E1F] border border-[#23583E] hover:border-[#00E575] text-[#A5C9B8] hover:text-white text-[10px] font-bold px-2.5 py-1.5 rounded-lg transition-all"
              >
                <RefreshCw className={`w-3 h-3 ${isLoadingAudit ? 'animate-spin' : ''}`} /> Refresh Data
              </button>
            </div>

            {isLoadingAudit ? (
              <div className="h-60 flex items-center justify-center text-xs text-[#A5C9B8] animate-pulse">
                Memuat grafik audit komisi...
              </div>
            ) : (
              <div className="w-full h-64 pt-2">
                <Suspense
                  fallback={
                    <div className="h-full flex items-center justify-center text-xs text-[#A5C9B8] animate-pulse">
                      Memuat komponen grafik...
                    </div>
                  }
                >
                  <CommissionAuditBarChart dailyData={auditData?.dailyData || []} />
                </Suspense>
              </div>
            )}
          </div>

          {/* Daily Table Breakdown */}
          <div className="bg-[#06170E] border border-[#23583E] rounded-2xl overflow-hidden">
            <div className="p-3 bg-[#0D2E1F]/60 border-b border-[#23583E]">
              <span className="text-xs font-black text-white uppercase tracking-wider">
                Rincian Audit Komisi Per Hari
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[11px]">
                <thead className="bg-[#06170E] text-[#A5C9B8] uppercase text-[9px] border-b border-[#23583E]">
                  <tr>
                    <th className="py-2.5 px-4 font-bold">Tanggal</th>
                    <th className="py-2.5 px-4 font-bold">Hari / Bulan</th>
                    <th className="py-2.5 px-4 font-bold text-center">Order Completed</th>
                    <th className="py-2.5 px-4 font-bold text-right">Total Komisi Platform</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#23583E]">
                  {(auditData?.dailyData || []).map((row: any) => (
                    <tr key={row.date} className="hover:bg-[#0D2E1F]/50 transition-colors">
                      <td className="py-2.5 px-4 font-mono text-[#A5C9B8]">{row.date}</td>
                      <td className="py-2.5 px-4 font-bold text-white">{row.dayLabel}</td>
                      <td className="py-2.5 px-4 text-center font-bold text-[#FFD700]">{row.orderCount} order</td>
                      <td className="py-2.5 px-4 text-right font-black text-[#00E575]">
                        {formatRupiah(row.totalCommission)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ── KONFIGURASI PLATFORM ── */}
      {activeTab === 'config' && (
        <div className="flex flex-col gap-4">
          <div className="flex gap-2 items-end bg-[#06170E]/50 p-4 rounded-xl">
            <div className="flex flex-col gap-1 flex-1">
              <label className={labelCls}>Minimum Deposit Driver (MINIMUM_DRIVER_DEPOSIT)</label>
              <input className={inputCls} type="number" placeholder="20000" value={depositValue} onChange={(e) => setDepositValue(e.target.value)} />
            </div>
            <button
              onClick={() => {
                if (!depositValue) return;
                updateConfigMutation.mutate({ key: 'MINIMUM_DRIVER_DEPOSIT', value: depositValue });
              }}
              disabled={updateConfigMutation.isPending}
              className="bg-[#00E575] hover:bg-[#00E575]/80 disabled:opacity-50 text-[#06170E] text-xs font-black py-2.5 px-4 rounded-lg whitespace-nowrap"
            >
              Simpan
            </button>
          </div>
          <div className="flex flex-col gap-2">
            {config.length === 0 ? (
              <div className="text-center text-[10px] text-[#A5C9B8]/60 py-6 border border-dashed border-[#23583E] rounded-xl">Belum ada konfigurasi tersimpan (memakai nilai default sistem).</div>
            ) : config.map((c: any) => (
              <div key={c.key} className="flex justify-between bg-[#06170E] border border-[#23583E] p-3 rounded-xl text-[10px]">
                <span className="font-bold text-white">{c.key}</span>
                <span className="text-[#00E575] font-mono">{c.value}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function AdminRecapSection({ triggerToast }: { triggerToast: (m: string) => void }) {
  const [timeframe, setTimeframe] = useState<'daily' | 'weekly' | 'monthly'>('daily');
  const [activeCategory, setActiveCategory] = useState<'customers' | 'drivers' | 'transactions' | 'revenues'>('customers');
  const [searchQuery, setSearchQuery] = useState('');

  const { data: recapData, isLoading, refetch } = useQuery({
    queryKey: ['adminRecap', timeframe],
    queryFn: () => AdminAPI.getRecap(timeframe),
  });

  const [exportingFormat, setExportingFormat] = useState<'excel' | 'pdf' | null>(null);
  const handleExport = async (format: 'excel' | 'pdf') => {
    setExportingFormat(format);
    try {
      await AdminAPI.exportRecap(format, timeframe);
    } catch (err: any) {
      alert(err.response?.data?.error || `Gagal membuat file ${format === 'excel' ? 'Excel' : 'PDF'}.`);
    } finally {
      setExportingFormat(null);
    }
  };

  return (
    <div className="bg-[#0D2E1F] border border-[#23583E] p-6 rounded-3xl flex flex-col gap-5">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b border-[#23583E] pb-4">
        <div>
          <h3 className="text-xl font-black text-[#FFD700] flex items-center gap-2">
            <BarChart2 className="w-6 h-6 text-[#00E575]" /> Rekapitulasi Laporan Platform
          </h3>
          <p className="text-xs text-[#A5C9B8] mt-0.5">
            Laporan rekap menyeluruh pelanggan, driver & perolehan, volume transaksi, serta komisi platform.
          </p>
        </div>

        {/* Timeframe Scheme Buttons */}
        <div className="flex items-center gap-1.5 bg-[#06170E] p-1.5 rounded-2xl border border-[#23583E]">
          {[
            { id: 'daily', label: '📅 Harian (24 Jam)' },
            { id: 'weekly', label: '📅 Mingguan (7 Hari)' },
            { id: 'monthly', label: '📅 Bulanan (30 Hari)' },
          ].map((tf) => (
            <button
              key={tf.id}
              type="button"
              onClick={() => setTimeframe(tf.id as any)}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
                timeframe === tf.id
                  ? 'bg-[#00E575] text-[#071F14] shadow-md'
                  : 'text-[#A5C9B8] hover:text-white hover:bg-[#0D2E1F]'
              }`}
            >
              {tf.label}
            </button>
          ))}
          <button
            type="button"
            onClick={() => refetch()}
            className="p-1.5 text-[#A5C9B8] hover:text-[#00E575] rounded-xl transition-all ml-1"
            title="Refresh Data Rekap"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {/* Export PDF / Excel */}
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            disabled={exportingFormat !== null}
            onClick={() => handleExport('excel')}
            className="flex items-center gap-1.5 bg-[#1D6F42]/20 border border-[#1D6F42]/50 hover:border-[#1D6F42] text-[#4CAF50] text-xs font-bold px-3 py-2 rounded-xl transition-all disabled:opacity-50"
          >
            <FileSpreadsheet className="w-4 h-4" />
            {exportingFormat === 'excel' ? 'Membuat file...' : 'Unduh Excel'}
          </button>
          <button
            type="button"
            disabled={exportingFormat !== null}
            onClick={() => handleExport('pdf')}
            className="flex items-center gap-1.5 bg-red-500/15 border border-red-500/40 hover:border-red-500 text-red-400 text-xs font-bold px-3 py-2 rounded-xl transition-all disabled:opacity-50"
          >
            <FileText className="w-4 h-4" />
            {exportingFormat === 'pdf' ? 'Membuat file...' : 'Unduh PDF'}
          </button>
        </div>
      </div>

      {/* Category Tabs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        {[
          { id: 'customers', label: '👥 Pelanggan Terdaftar', count: recapData?.customers?.length || 0 },
          { id: 'drivers', label: '🏍️ Driver & Perolehan', count: recapData?.drivers?.length || 0 },
          { id: 'transactions', label: '📦 Volume Transaksi', count: recapData?.transactions?.length || 0 },
          { id: 'revenues', label: '💰 Platform Revenue', count: formatRupiah(recapData?.summary?.totalPlatformRevenue || 0) },
        ].map((cat) => (
          <button
            key={cat.id}
            type="button"
            onClick={() => setActiveCategory(cat.id as any)}
            className={`p-3 rounded-2xl border flex flex-col text-left transition-all ${
              activeCategory === cat.id
                ? 'bg-[#06170E] border-[#FFD700] text-white shadow-md'
                : 'bg-[#06170E]/60 border-[#23583E] text-[#A5C9B8] hover:border-[#00E575]'
            }`}
          >
            <span className="text-[10px] font-bold uppercase">{cat.label}</span>
            <span className="text-sm font-black text-[#FFD700] mt-1">{cat.count}</span>
          </button>
        ))}
      </div>

      {/* Search Input Filter */}
      <div className="flex items-center gap-2 bg-[#06170E] p-2.5 rounded-xl border border-[#23583E]">
        <Search className="w-4 h-4 text-[#A5C9B8]" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Cari berdasarkan nama, no. HP, alamat rute, atau ID..."
          className="bg-transparent text-xs text-white focus:outline-none w-full"
        />
        {searchQuery && (
          <button onClick={() => setSearchQuery('')} className="text-xs text-gray-400 hover:text-white font-bold">
            Clear
          </button>
        )}
      </div>

      {/* Content Table Views */}
      <div className="bg-[#06170E] rounded-2xl border border-[#23583E] overflow-hidden">
        {isLoading ? (
          <div className="p-8 text-center text-xs text-[#A5C9B8] animate-pulse">Memuat data rekapitulasi...</div>
        ) : activeCategory === 'customers' ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-[#0D2E1F] text-[#FFD700] text-[10px] uppercase border-b border-[#23583E]">
                <tr>
                  <th className="py-3 px-4 font-bold">Nama Lengkap</th>
                  <th className="py-3 px-4 font-bold">Email</th>
                  <th className="py-3 px-4 font-bold">No. HP Terdaftar</th>
                  <th className="py-3 px-4 font-bold">Tanggal Daftar</th>
                  <th className="py-3 px-4 font-bold text-center">Total Order</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#23583E] text-[#A5C9B8]">
                {(recapData?.customers || [])
                  .filter((c: any) =>
                    c.fullName.toLowerCase().includes(searchQuery.toLowerCase()) ||
                    c.phoneNumber.includes(searchQuery) ||
                    c.email.toLowerCase().includes(searchQuery.toLowerCase())
                  )
                  .map((c: any) => (
                    <tr key={c.id} className="hover:bg-[#0D2E1F]/50 transition-colors">
                      <td className="py-3 px-4 font-bold text-white">{c.fullName}</td>
                      <td className="py-3 px-4">{c.email}</td>
                      <td className="py-3 px-4 font-mono text-[#00E575] font-bold">{c.phoneNumber}</td>
                      <td className="py-3 px-4 text-[10px]">{new Date(c.registeredAt).toLocaleString('id-ID')}</td>
                      <td className="py-3 px-4 text-center font-bold text-white">{c.totalOrders}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        ) : activeCategory === 'drivers' ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-[#0D2E1F] text-[#FFD700] text-[10px] uppercase border-b border-[#23583E]">
                <tr>
                  <th className="py-3 px-4 font-bold">Mitra Pengemudi</th>
                  <th className="py-3 px-4 font-bold">No. HP Terdaftar</th>
                  <th className="py-3 px-4 font-bold">Kendaraan & Plat</th>
                  <th className="py-3 px-4 font-bold text-center">Order Selesai</th>
                  <th className="py-3 px-4 font-bold text-right">Perolehan Bersih (92%)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#23583E] text-[#A5C9B8]">
                {(recapData?.drivers || [])
                  .filter((d: any) =>
                    d.fullName.toLowerCase().includes(searchQuery.toLowerCase()) ||
                    d.phoneNumber.includes(searchQuery) ||
                    d.vehiclePlate.toLowerCase().includes(searchQuery.toLowerCase())
                  )
                  .map((d: any) => (
                    <tr key={d.id} className="hover:bg-[#0D2E1F]/50 transition-colors">
                      <td className="py-3 px-4 font-bold text-white">{d.fullName}</td>
                      <td className="py-3 px-4 font-mono text-[#00E575] font-bold">{d.phoneNumber}</td>
                      <td className="py-3 px-4">
                        <span className="font-bold text-white">{d.vehiclePlate}</span> ({d.vehicleModel})
                      </td>
                      <td className="py-3 px-4 text-center font-bold text-white">{d.completedOrdersCount}</td>
                      <td className="py-3 px-4 text-right font-black text-[#FFD700]">
                        {formatRupiah(d.perolehan)}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        ) : activeCategory === 'transactions' ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-[#0D2E1F] text-[#FFD700] text-[10px] uppercase border-b border-[#23583E]">
                <tr>
                  <th className="py-3 px-4 font-bold">Layanan & ID</th>
                  <th className="py-3 px-4 font-bold">Rute (Jemput ➡️ Tujuan)</th>
                  <th className="py-3 px-4 font-bold">Pelanggan Pemesan</th>
                  <th className="py-3 px-4 font-bold">Mitra Pengemudi</th>
                  <th className="py-3 px-4 font-bold text-right">Tarif</th>
                  <th className="py-3 px-4 font-bold text-center">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#23583E] text-[#A5C9B8]">
                {(recapData?.transactions || [])
                  .filter((t: any) =>
                    t.pickupAddress.toLowerCase().includes(searchQuery.toLowerCase()) ||
                    t.dropoffAddress.toLowerCase().includes(searchQuery.toLowerCase()) ||
                    t.customerName.toLowerCase().includes(searchQuery.toLowerCase()) ||
                    t.driverName.toLowerCase().includes(searchQuery.toLowerCase())
                  )
                  .map((t: any) => (
                    <tr key={t.id} className="hover:bg-[#0D2E1F]/50 transition-colors">
                      <td className="py-3 px-4 font-bold text-white">
                        <span className="text-[#FFD700] block">{t.serviceType}</span>
                        <span className="text-[9px] font-mono text-gray-400">#{t.id.substring(0, 8)}</span>
                      </td>
                      <td className="py-3 px-4 max-w-xs">
                        <span className="text-white block truncate">{t.pickupAddress}</span>
                        <span className="text-[#00E575] block truncate">➡️ {t.dropoffAddress}</span>
                      </td>
                      <td className="py-3 px-4">
                        <span className="font-bold text-white block">{t.customerName}</span>
                        <span className="text-[10px] font-mono text-[#00E575]">{t.customerPhone}</span>
                      </td>
                      <td className="py-3 px-4">
                        <span className="font-bold text-white block">{t.driverName}</span>
                        <span className="text-[10px] font-mono text-[#00E575]">{t.driverPhone}</span>
                      </td>
                      <td className="py-3 px-4 text-right font-black text-white">{formatRupiah(t.price)}</td>
                      <td className="py-3 px-4 text-center">
                        <span className={`px-2 py-0.5 rounded text-[9px] font-black ${
                          t.status === 'COMPLETED' ? 'bg-[#00E575]/20 text-[#00E575]' :
                          t.status === 'PENDING' ? 'bg-amber-500/20 text-amber-500' :
                          t.status === 'ACCEPTED' ? 'bg-cyan-500/20 text-cyan-500' : 'bg-red-500/20 text-red-500'
                        }`}>
                          {t.status}
                        </span>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-[#0D2E1F] text-[#FFD700] text-[10px] uppercase border-b border-[#23583E]">
                <tr>
                  <th className="py-3 px-4 font-bold">ID Order</th>
                  <th className="py-3 px-4 font-bold">Rute Perjalanan</th>
                  <th className="py-3 px-4 font-bold">Para Pihak</th>
                  <th className="py-3 px-4 font-bold text-right">Tarif Bruto</th>
                  <th className="py-3 px-4 font-bold text-right">Komisi Platform (8%)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#23583E] text-[#A5C9B8]">
                {(recapData?.platformRevenues || [])
                  .filter((r: any) =>
                    r.pickupAddress.toLowerCase().includes(searchQuery.toLowerCase()) ||
                    r.dropoffAddress.toLowerCase().includes(searchQuery.toLowerCase()) ||
                    r.customerName.toLowerCase().includes(searchQuery.toLowerCase()) ||
                    r.driverName.toLowerCase().includes(searchQuery.toLowerCase())
                  )
                  .map((r: any) => (
                    <tr key={r.id} className="hover:bg-[#0D2E1F]/50 transition-colors">
                      <td className="py-3 px-4 font-mono font-bold text-white">#{r.id.substring(0, 8)}</td>
                      <td className="py-3 px-4 max-w-xs">
                        <span className="text-white block truncate">{r.pickupAddress}</span>
                        <span className="text-[#00E575] block truncate">➡️ {r.dropoffAddress}</span>
                      </td>
                      <td className="py-3 px-4">
                        <span className="text-gray-300 block">Pemesan: <b className="text-white">{r.customerName}</b></span>
                        <span className="text-gray-300 block">Driver: <b className="text-white">{r.driverName}</b></span>
                      </td>
                      <td className="py-3 px-4 text-right font-bold text-white">{formatRupiah(r.grossPrice)}</td>
                      <td className="py-3 px-4 text-right font-black text-[#00E575] text-sm">
                        {formatRupiah(r.platformRevenue)}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

export default function AdminApp({ onBack, triggerToast }: PortalProps) {
  const { login, logout, user } = useAuthStore();
  const queryClient = useQueryClient();
  const [selectedDriverDocsModal, setSelectedDriverDocsModal] = useState<any | null>(null);
  const [modalImagePreviewUrl, setModalImagePreviewUrl] = useState<string | null>(null);

  // Fetch administrator dashboard stats, drivers list, and audit logs
  const { data: dashboardData, isLoading: isDashboardLoading, isError: isDashboardError, error: dashboardError, refetch: refetchDashboard } = useQuery({
    queryKey: ['adminDashboard'],
    queryFn: AdminAPI.getDashboard,
    enabled: !!user,
  });

  // Mutations
  const verifyDriverMutation = useMutation({
    mutationFn: (id: string) => AdminAPI.verifyDriver(id),
    onSuccess: (res) => {
      triggerToast(res.message);
      queryClient.invalidateQueries({ queryKey: ['adminDashboard'] });
    },
    onError: (err: any) => {
      triggerToast(err.response?.data?.error || 'Gagal menyetujui kemitraan!');
    },
  });

  const suspendDriverMutation = useMutation({
    mutationFn: (id: string) => AdminAPI.suspendDriver(id),
    onSuccess: (res) => {
      triggerToast(res.message);
      queryClient.invalidateQueries({ queryKey: ['adminDashboard'] });
    },
    onError: (err: any) => {
      triggerToast(err.response?.data?.error || 'Gagal menangguhkan driver!');
    },
  });

  if (!user) {
    return (
      <AuthFlow 
        role="ADMIN" 
        onBack={onBack} 
        onSuccess={(u, t, rt) => login(u, t, rt)} 
        triggerToast={triggerToast} 
      />
    );
  }

  return (
    <div className="w-full max-w-7xl mx-auto px-4 py-8 flex flex-col gap-6 flex-1">
      {/* Header Area */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-[#0D2E1F] p-6 rounded-3xl border border-red-500/30">
        <div>
          <h2 className="text-3xl font-black text-red-400">Dashboard Utama Admin</h2>
          <p className="text-xs text-[#A5C9B8]">Konektivitas langsung ke API Endpoint Admin: `/api/admin/*`</p>
        </div>
        <div className="flex gap-2">
          <button 
            onClick={async () => {
              const result = await refetchDashboard();
              if (result.isSuccess) {
                triggerToast('Sinkronisasi database audit log berhasil!');
              } else {
                triggerToast(
                  (result.error as any)?.response?.data?.error ||
                  'Sinkronisasi gagal — cek koneksi atau sesi login Anda.'
                );
              }
            }}
            className="flex items-center gap-2 bg-[#23583E] hover:bg-[#23583E]/80 text-red-400 text-xs font-bold px-4 py-2.5 rounded-xl transition-all"
          >
            <RefreshCw className="w-4 h-4" />
            <span>Sinkronisasi</span>
          </button>
        </div>
      </div>

      {/* Error banner — tampil kalau request dashboard gagal, supaya tidak diam-diam terlihat seperti "0 data" */}
      {isDashboardError && (
        <div className="bg-red-500/10 border border-red-500/40 text-red-400 text-xs font-semibold px-5 py-4 rounded-2xl">
          Gagal memuat data dashboard: {(dashboardError as any)?.response?.data?.error || (dashboardError as any)?.message || 'Terjadi kesalahan tidak diketahui.'}
          {(dashboardError as any)?.response?.status && (
            <span className="opacity-70"> (HTTP {(dashboardError as any).response.status})</span>
          )}
        </div>
      )}

      {/* Grid Stats Row */}
      {isDashboardLoading ? (
        <div className="text-center py-6 text-xs text-[#A5C9B8]">Menghitung data real...</div>
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          
          <div className="bg-[#0D2E1F] border border-[#23583E] p-4 rounded-2xl shadow-md">
            <span className="text-[10px] text-[#A5C9B8] block font-bold uppercase">Pelanggan Terdaftar</span>
            <span className="text-2xl font-black text-[#FFD700] block mt-1">{dashboardData?.stats?.totalCustomers || 0} User</span>
          </div>

          <div className="bg-[#0D2E1F] border border-[#23583E] p-4 rounded-2xl shadow-md">
            <span className="text-[10px] text-[#A5C9B8] block font-bold uppercase">Mitra Pengemudi</span>
            <span className="text-2xl font-black text-[#00E575] block mt-1">{dashboardData?.stats?.totalDrivers || 0} Mitra</span>
          </div>

          <div className="bg-[#0D2E1F] border border-[#23583E] p-4 rounded-2xl shadow-md">
            <span className="text-[10px] text-[#A5C9B8] block font-bold uppercase">Volume Transaksi</span>
            <span className="text-2xl font-black text-white block mt-1">{dashboardData?.stats?.totalOrders || 0} Perjalanan</span>
          </div>

          <div className="bg-[#0D2E1F] border border-red-500/20 p-4 rounded-2xl shadow-md">
            <span className="text-[10px] text-[#A5C9B8] block font-bold uppercase">Platform Revenue</span>
            <span className="text-2xl font-black text-red-400 block mt-1">
              {formatRupiah(Number(dashboardData?.stats?.totalRevenue || 0))}
            </span>
          </div>

        </div>
      )}

      {/* Main Control Board Content */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Left 2 Columns: Driver Management Panel */}
        <div className="bg-[#0D2E1F] border border-[#23583E] p-6 rounded-3xl flex flex-col gap-4 lg:col-span-2">
          <span className="text-xs font-black text-[#00E575] uppercase tracking-wider flex items-center gap-1.5">
            <UserCheck className="w-5 h-5" /> Kelola Kemitraan Pengemudi (Mitra Driver)
          </span>
          <p className="text-xs text-[#A5C9B8] -mt-2 leading-relaxed">
            Mitra baru yang mendaftar wajib diverifikasi secara manual oleh administrator untuk mengaktifkan satelit GPS Driver Companion dan status online di platform.
          </p>

          {isDashboardLoading ? (
            <div className="text-xs text-center py-6 text-[#A5C9B8]">Memuat data mitra...</div>
          ) : !dashboardData?.drivers || dashboardData.drivers.length === 0 ? (
            <div className="text-xs text-center py-8 bg-[#06170E] border border-dashed border-[#23583E] rounded-xl text-gray-400">
              Belum ada mitra driver terdaftar dalam sistem database.
            </div>
          ) : (
            <div className="flex flex-col gap-3 overflow-y-auto max-h-[450px]">
              {dashboardData.drivers.map((drv: any) => {
                const isCar = drv.vehicleModel?.toUpperCase().includes('CAR') || drv.vehicleModel?.toLowerCase().includes('mobil');
                const docCount = drv.documents?.length || 0;
                return (
                  <div key={drv.id} className="bg-[#06170E] border border-[#23583E] p-4 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div className="flex items-start gap-3">
                      <span className="text-2xl">{isCar ? '🚗' : '🏍️'}</span>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-white block text-sm">{drv.user?.fullName}</span>
                          <span className={`text-[9px] px-1.5 py-0.5 rounded font-black ${
                            isCar ? 'bg-[#FFD700]/20 text-[#FFD700] border border-[#FFD700]/30' : 'bg-[#00E575]/20 text-[#00E575] border border-[#00E575]/30'
                          }`}>
                            {isCar ? 'DHUKNOO CAR' : 'DHUKNOO BIKE'}
                          </span>
                        </div>
                        <span className="text-[10px] text-gray-400 block">{drv.user?.email}</span>
                        <div className="flex flex-wrap gap-2 mt-1.5">
                          <span className="bg-[#0D2E1F] text-[#A5C9B8] text-[9px] px-1.5 py-0.5 rounded font-mono">
                            Plat: {drv.vehiclePlate}
                          </span>
                          <span className="bg-[#0D2E1F] text-[#A5C9B8] text-[9px] px-1.5 py-0.5 rounded font-mono">
                            Model: {drv.vehicleModel}
                          </span>
                          <span className={`text-[9px] px-1.5 py-0.5 rounded font-black ${
                            drv.isVerified ? 'bg-[#00E575]/10 text-[#00E575]' : 'bg-red-500/10 text-red-400'
                          }`}>
                            {drv.isVerified ? 'VERIFIED' : 'UNVERIFIED'}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-2 sm:self-center">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          setSelectedDriverDocsModal(drv);
                        }}
                        className="bg-[#23583E] hover:bg-[#23583E]/80 text-[#00E575] text-[10px] font-bold py-2 px-2.5 rounded-lg transition-all flex items-center gap-1 border border-[#00E575]/30"
                      >
                        📁 Dokumen ({docCount})
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          verifyDriverMutation.mutate(drv.id);
                        }}
                        disabled={drv.isVerified || verifyDriverMutation.isPending}
                        className="bg-[#00E575] hover:bg-[#00ff80] text-[#071F14] text-[10px] font-black py-2 px-3 rounded-lg transition-all disabled:opacity-30 flex items-center gap-1"
                      >
                        <UserCheck className="w-3.5 h-3.5" /> Setujui
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          suspendDriverMutation.mutate(drv.id);
                        }}
                        disabled={!drv.isVerified || suspendDriverMutation.isPending}
                        className="bg-red-500 hover:bg-red-400 text-white text-[10px] font-black py-2 px-3 rounded-lg transition-all disabled:opacity-30 flex items-center gap-1"
                      >
                        <UserX className="w-3.5 h-3.5" /> Tangguhkan
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Right 1 Column: Audit Log Stream */}
        <div className="bg-[#0D2E1F] border border-red-500/20 p-6 rounded-3xl flex flex-col gap-4">
          <span className="text-xs font-black text-red-400 uppercase tracking-wider flex items-center gap-1.5">
            <ClipboardList className="w-5 h-5" /> Platform Logs & Audit Trail
          </span>
          <p className="text-[10px] text-[#A5C9B8] -mt-2 leading-relaxed">
            Menangkap riwayat aksi krusial pengguna platform (Top up, Order, verifikasi, dll) dari mesin audit PostgreSQL.
          </p>

          {isDashboardLoading ? (
            <div className="text-xs text-[#A5C9B8] text-center py-6">Memuat log...</div>
          ) : !dashboardData?.logs || dashboardData.logs.length === 0 ? (
            <div className="text-xs text-[#A5C9B8]/60 text-center py-8 border border-dashed border-[#23583E] rounded-xl bg-[#06170E]">
              Belum ada log aktivitas terdaftar dalam sistem.
            </div>
          ) : (
            <div className="flex flex-col gap-2 max-h-[400px] overflow-y-auto pr-1">
              {dashboardData.logs.map((log: any) => (
                <div key={log.id} className="bg-[#06170E] border border-[#23583E] p-3 rounded-xl text-[10px] flex flex-col gap-1">
                  <div className="flex justify-between font-bold text-red-400">
                    <span>{log.action}</span>
                    <span className="text-gray-400 font-mono font-normal">
                      {new Date(log.createdAt).toLocaleTimeString('id-ID')}
                    </span>
                  </div>
                  <p className="text-white text-xs leading-tight">{log.details}</p>
                  <span className="text-[9px] text-gray-500 font-semibold italic">
                    Oleh: {log.user?.fullName || 'Sistem'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

      </div>

      {/* Driver Documents Inspection Modal */}
      {selectedDriverDocsModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-[#0D2E1F] border-2 border-[#00E575] rounded-3xl p-6 max-w-2xl w-full flex flex-col gap-4 max-h-[85vh] overflow-y-auto">
            <div className="flex justify-between items-center border-b border-[#23583E] pb-3">
              <div>
                <span className="text-xs font-black text-[#00E575] uppercase tracking-wider block">
                  📁 Peninjauan Berkas Dokumen Mitra Driver
                </span>
                <h3 className="text-lg font-bold text-white mt-0.5">
                  {selectedDriverDocsModal.user?.fullName} ({selectedDriverDocsModal.vehiclePlate})
                </h3>
              </div>
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  setSelectedDriverDocsModal(null);
                }}
                className="text-gray-400 hover:text-white font-bold text-sm bg-[#06170E] px-3 py-1.5 rounded-xl border border-[#23583E]"
              >
                ✕ Tutup
              </button>
            </div>

            <div className="bg-[#06170E] border border-[#23583E] p-3 rounded-2xl flex flex-wrap gap-4 text-xs">
              <div>
                <span className="text-gray-400 block text-[9px]">Email Mitra:</span>
                <span className="text-white font-semibold">{selectedDriverDocsModal.user?.email}</span>
              </div>
              <div>
                <span className="text-gray-400 block text-[9px]">Model Kendaraan:</span>
                <span className="text-[#FFD700] font-semibold">{selectedDriverDocsModal.vehicleModel}</span>
              </div>
              <div>
                <span className="text-gray-400 block text-[9px]">Status Verifikasi:</span>
                <span className={`font-black ${selectedDriverDocsModal.isVerified ? 'text-[#00E575]' : 'text-red-400'}`}>
                  {selectedDriverDocsModal.isVerified ? 'VERIFIED' : 'UNVERIFIED'}
                </span>
              </div>
            </div>

            <div className="flex flex-col gap-3">
              <h4 className="text-xs font-bold text-[#A5C9B8] uppercase">Dokumen Terlampir ({selectedDriverDocsModal.documents?.length || 0}):</h4>
              {!selectedDriverDocsModal.documents || selectedDriverDocsModal.documents.length === 0 ? (
                <div className="text-center py-6 border border-dashed border-[#23583E] rounded-2xl text-xs text-gray-400 bg-[#06170E]">
                  Belum ada berkas dokumen (KTP/STNK) yang diunggah oleh mitra driver ini.
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {selectedDriverDocsModal.documents.map((doc: any) => (
                    <div key={doc.id} className="bg-[#06170E] border border-[#23583E] p-3 rounded-2xl flex flex-col gap-2 text-xs">
                      <div className="flex justify-between items-center">
                        <span className="font-bold text-[#FFD700]">
                          {doc.type === 'KTP_SELFIE' ? '🪪 Foto Diri + KTP' : doc.type === 'STNK' ? '📄 STNK Kendaraan' : '💳 SIM Driver (*Wajib)'}
                        </span>
                        <span className={`text-[9px] px-2 py-0.5 rounded font-black ${
                          doc.status === 'APPROVED' ? 'bg-[#00E575]/20 text-[#00E575]' : doc.status === 'REJECTED' ? 'bg-red-500/20 text-red-400' : 'bg-amber-500/20 text-amber-400'
                        }`}>
                          {doc.status}
                        </span>
                      </div>
                      {doc.imageUrl ? (
                        <div className="flex flex-col gap-2">
                          <div className="h-32 rounded-xl overflow-hidden border border-[#23583E] bg-black/40 flex items-center justify-center">
                            <img src={doc.imageUrl} alt="Dokumen" className="max-h-full object-contain" />
                          </div>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.preventDefault();
                              setModalImagePreviewUrl(doc.imageUrl);
                            }}
                            className="bg-[#23583E] hover:bg-[#00E575] text-[#00E575] hover:text-[#06170E] font-bold py-1.5 px-3 rounded-xl text-[10px] transition-all text-center"
                          >
                            🔍 Zoom Foto High-Res
                          </button>
                        </div>
                      ) : (
                        <span className="text-red-400 text-[10px]">Foto tidak tersedia</span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="flex gap-3 mt-2 pt-3 border-t border-[#23583E]">
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  verifyDriverMutation.mutate(selectedDriverDocsModal.id);
                  setSelectedDriverDocsModal(null);
                }}
                disabled={selectedDriverDocsModal.isVerified || verifyDriverMutation.isPending}
                className="flex-1 bg-[#00E575] hover:bg-[#00ff80] text-[#071F14] font-black py-2.5 rounded-xl text-xs transition-all disabled:opacity-40"
              >
                Setujui Kemitraan Driver
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  suspendDriverMutation.mutate(selectedDriverDocsModal.id);
                  setSelectedDriverDocsModal(null);
                }}
                disabled={!selectedDriverDocsModal.isVerified || suspendDriverMutation.isPending}
                className="flex-1 bg-red-500 hover:bg-red-400 text-white font-black py-2.5 rounded-xl text-xs transition-all disabled:opacity-40"
              >
                Tangguhkan Driver
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Standalone Modal Lightbox for Full High-Res Document Preview */}
      {modalImagePreviewUrl && (
        <div className="fixed inset-0 z-[60] bg-black/90 backdrop-blur-lg flex items-center justify-center p-4">
          <div className="bg-[#0D2E1F] border-2 border-[#00E575] rounded-3xl p-5 max-w-3xl w-full flex flex-col gap-4">
            <div className="flex justify-between items-center border-b border-[#23583E] pb-3">
              <span className="text-xs font-bold text-white flex items-center gap-2">
                🔍 High-Resolution Lightbox Pratinjau Dokumen
              </span>
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  setModalImagePreviewUrl(null);
                }}
                className="text-gray-400 hover:text-white font-bold text-sm bg-[#06170E] px-3 py-1.5 rounded-xl border border-[#23583E]"
              >
                ✕ Tutup
              </button>
            </div>
            <div className="max-h-[75vh] overflow-auto rounded-2xl border border-[#23583E] bg-black/60 p-2 flex items-center justify-center">
              <img src={modalImagePreviewUrl} alt="High Res Dokumen" className="max-h-[70vh] object-contain rounded-xl" />
            </div>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  setModalImagePreviewUrl(null);
                }}
                className="bg-[#00E575] text-[#06170E] font-black py-2 px-6 rounded-xl text-xs hover:bg-[#00ff80]"
              >
                Kembali
              </button>
            </div>
          </div>
        </div>
      )}

      <AdminRecapSection triggerToast={triggerToast} />
      <ReviewPanel triggerToast={triggerToast} />
      <TariffPanel triggerToast={triggerToast} />
    </div>
  );
}
