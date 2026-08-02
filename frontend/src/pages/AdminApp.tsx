import React, { useState, Suspense } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { formatRupiah } from '@obama/shared-utils';
import { sendAdminThankYouChat, openWhatsAppMessage } from '../utils/whatsapp';
import { useAuthStore } from '../store/useAuthStore';
import { AdminAPI, PaymentAPI, TariffAPI } from '../api';
import AuthFlow from '../components/auth/AuthFlow';
import { RefreshCw, UserCheck, UserX, ClipboardList } from 'lucide-react';

// 🚀 LAZY LOAD: Pisahkan komponen berat dari file AdminApp.tsx
const ReviewPanel = React.lazy(() => import('../components/admin/ReviewPanel'));
const TariffPanel = React.lazy(() => import('../components/admin/TariffPanel'));
const AdminRecapSection = React.lazy(() => import('../components/admin/AdminRecapSection'));

interface PortalProps {
  onBack: () => void;
  triggerToast: (m: string) => void;
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
    <div className="w-full max-w-7xl mx-auto px-4 py-8 flex flex-col gap-6 flex-1 min-h-screen">
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

      {isDashboardError && (
        <div className="bg-red-500/10 border border-red-500/40 text-red-400 text-xs font-semibold px-5 py-4 rounded-2xl">
          Gagal memuat data dashboard: {(dashboardError as any)?.response?.data?.error || (dashboardError as any)?.message || 'Terjadi kesalahan tidak diketahui.'}
        </div>
      )}

      {/* Grid Stats Row */}
      {/* Grid Stats Row */}
      {isDashboardLoading ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 animate-pulse">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="bg-[#0D2E1F] border border-[#23583E] p-4 rounded-2xl h-24 w-full"></div>
          ))}
        </div>
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
        <div className="bg-[#0D2E1F] border border-[#23583E] p-6 rounded-3xl flex flex-col gap-4 lg:col-span-2">
          <span className="text-xs font-black text-[#00E575] uppercase tracking-wider flex items-center gap-1.5">
            <UserCheck className="w-5 h-5" /> Kelola Kemitraan Pengemudi (Mitra Driver)
          </span>
          <p className="text-xs text-[#A5C9B8] -mt-2 leading-relaxed">
            Mitra baru yang mendaftar wajib diverifikasi secara manual oleh administrator.
          </p>
          {isDashboardLoading ? (
            <div className="text-xs text-center py-6 text-[#A5C9B8]">Memuat data mitra...</div>
          ) : !dashboardData?.drivers || dashboardData.drivers.length === 0 ? (
            <div className="text-xs text-center py-8 bg-[#06170E] border border-dashed border-[#23583E] rounded-xl text-gray-400">
              Belum ada mitra driver terdaftar dalam sistem.
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
                          <span className={`text-[9px] px-1.5 py-0.5 rounded font-black ${isCar ? 'bg-[#FFD700]/20 text-[#FFD700] border border-[#FFD700]/30' : 'bg-[#00E575]/20 text-[#00E575] border border-[#00E575]/30'}`}>
                            {isCar ? 'DHUKNOO CAR' : 'DHUKNOO BIKE'}
                          </span>
                        </div>
                        <span className="text-[10px] text-gray-400 block">{drv.user?.email}</span>
                        <div className="flex flex-wrap gap-2 mt-1.5">
                          <span className="bg-[#0D2E1F] text-[#A5C9B8] text-[9px] px-1.5 py-0.5 rounded font-mono">Plat: {drv.vehiclePlate}</span>
                          <span className="bg-[#0D2E1F] text-[#A5C9B8] text-[9px] px-1.5 py-0.5 rounded font-mono">Model: {drv.vehicleModel}</span>
                          <span className={`text-[9px] px-1.5 py-0.5 rounded font-black ${drv.isVerified ? 'bg-[#00E575]/10 text-[#00E575]' : 'bg-red-500/10 text-red-400'}`}>
                            {drv.isVerified ? 'VERIFIED' : 'UNVERIFIED'}
                          </span>
                        </div>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2 sm:self-center">
                      <button onClick={() => setSelectedDriverDocsModal(drv)} className="bg-[#23583E] hover:bg-[#23583E]/80 text-[#00E575] text-[10px] font-bold py-2 px-2.5 rounded-lg transition-all flex items-center gap-1 border border-[#00E575]/30">
                        📁 Dokumen ({docCount})
                      </button>
                      <button onClick={() => verifyDriverMutation.mutate(drv.id)} disabled={drv.isVerified || verifyDriverMutation.isPending} className="bg-[#00E575] hover:bg-[#00ff80] text-[#071F14] text-[10px] font-black py-2 px-3 rounded-lg disabled:opacity-30 flex items-center gap-1">
                        <UserCheck className="w-3.5 h-3.5" /> Setujui
                      </button>
                      <button onClick={() => suspendDriverMutation.mutate(drv.id)} disabled={!drv.isVerified || suspendDriverMutation.isPending} className="bg-red-500 hover:bg-red-400 text-white text-[10px] font-black py-2 px-3 rounded-lg disabled:opacity-30 flex items-center gap-1">
                        <UserX className="w-3.5 h-3.5" /> Tangguhkan
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="bg-[#0D2E1F] border border-red-500/20 p-6 rounded-3xl flex flex-col gap-4">
          <span className="text-xs font-black text-red-400 uppercase tracking-wider flex items-center gap-1.5">
            <ClipboardList className="w-5 h-5" /> Platform Logs & Audit Trail
          </span>
          <p className="text-[10px] text-[#A5C9B8] -mt-2 leading-relaxed">
            Menangkap riwayat aksi krusial pengguna platform (Top up, Order, verifikasi, dll).
          </p>
          {isDashboardLoading ? (
            <div className="text-xs text-[#A5C9B8] text-center py-6">Memuat log...</div>
          ) : !dashboardData?.logs || dashboardData.logs.length === 0 ? (
            <div className="text-xs text-[#A5C9B8]/60 text-center py-8 border border-dashed border-[#23583E] rounded-xl bg-[#06170E]">
              Belum ada log aktivitas.
            </div>
          ) : (
            <div className="flex flex-col gap-2 max-h-[400px] overflow-y-auto pr-1">
              {dashboardData.logs.map((log: any) => (
                <div key={log.id} className="bg-[#06170E] border border-[#23583E] p-3 rounded-xl text-[10px] flex flex-col gap-1">
                  <div className="flex justify-between font-bold text-red-400">
                    <span>{log.action}</span>
                    <span className="text-gray-400 font-mono font-normal">{new Date(log.createdAt).toLocaleTimeString('id-ID')}</span>
                  </div>
                  <p className="text-white text-xs leading-tight">{log.details}</p>
                  <span className="text-[9px] text-gray-500 font-semibold italic">Oleh: {log.user?.fullName || 'Sistem'}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Modal Dokumen Driver */}
      {selectedDriverDocsModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-[#0D2E1F] border-2 border-[#00E575] rounded-3xl p-6 max-w-2xl w-full flex flex-col gap-4 max-h-[85vh] overflow-y-auto">
            <div className="flex justify-between items-center border-b border-[#23583E] pb-3">
              <div>
                <span className="text-xs font-black text-[#00E575] uppercase tracking-wider block">📁 Peninjauan Berkas Dokumen</span>
                <h3 className="text-lg font-bold text-white mt-0.5">{selectedDriverDocsModal.user?.fullName} ({selectedDriverDocsModal.vehiclePlate})</h3>
              </div>
              <button onClick={() => setSelectedDriverDocsModal(null)} className="text-gray-400 hover:text-white font-bold text-sm bg-[#06170E] px-3 py-1.5 rounded-xl border border-[#23583E]">✕ Tutup</button>
            </div>
            <div className="flex flex-col gap-3">
              {selectedDriverDocsModal.documents?.map((doc: any) => (
                <div key={doc.id} className="bg-[#06170E] border border-[#23583E] p-3 rounded-2xl flex flex-col gap-2 text-xs">
                  <div className="flex justify-between items-center">
                    <span className="font-bold text-[#FFD700]">{doc.type}</span>
                    <span className={`text-[9px] px-2 py-0.5 rounded font-black ${doc.status === 'APPROVED' ? 'bg-[#00E575]/20 text-[#00E575]' : doc.status === 'REJECTED' ? 'bg-red-500/20 text-red-400' : 'bg-amber-500/20 text-amber-400'}`}>
                      {doc.status}
                    </span>
                  </div>
                  {doc.imageUrl && (
                    <button onClick={() => setModalImagePreviewUrl(doc.imageUrl)} className="bg-[#23583E] hover:bg-[#00E575] text-[#00E575] hover:text-[#06170E] font-bold py-1.5 px-3 rounded-xl text-[10px] text-center transition-all">
                      🔍 Zoom Foto High-Res
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
      
      {modalImagePreviewUrl && (
        <div className="fixed inset-0 z-[60] bg-black/90 backdrop-blur-lg flex items-center justify-center p-4">
          <div className="bg-[#0D2E1F] border-2 border-[#00E575] rounded-3xl p-5 max-w-3xl w-full flex flex-col gap-4">
            <button onClick={() => setModalImagePreviewUrl(null)} className="self-end text-white font-bold">✕ Tutup</button>
            <img src={modalImagePreviewUrl} alt="Dokumen" className="max-h-[70vh] object-contain rounded-xl" />
          </div>
        </div>
      )}

      {/* 💡 BUNGKUS SUB-KOMPONEN LAZY DENGAN SUSPENSE */}
      <Suspense fallback={<div className="text-center py-4 text-xs text-[#A5C9B8]">Memuat modul Rekap...</div>}>
        <AdminRecapSection triggerToast={triggerToast} />
      </Suspense>
      <Suspense fallback={<div className="text-center py-4 text-xs text-[#A5C9B8]">Memuat modul Peninjauan...</div>}>
        <ReviewPanel triggerToast={triggerToast} />
      </Suspense>
      <Suspense fallback={<div className="text-center py-4 text-xs text-[#A5C9B8]">Memuat modul Tarif...</div>}>
        <TariffPanel triggerToast={triggerToast} />
      </Suspense>

    </div>
  );
}