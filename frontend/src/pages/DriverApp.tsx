import React, { useState, useEffect, Suspense } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { socket, joinRoom } from '../services/socket';
import { formatRupiah } from '@obama/shared-utils';
import { startRingLoop, stopRingLoop, playBellRingSound, warmupAudioContext } from '../utils/audio';
import { useAuthStore } from '../store/useAuthStore';
import { DriverAPI, UploadAPI, WalletAPI, PaymentAPI, LocationAPI } from '../api';
import { OrderChatBox } from '../components/chat/OrderChatBox';
import { TopupModal } from '../components/modals/SharedModals';
import AuthFlow from '../components/auth/AuthFlow';
import { SkeletonList } from '../components/common/Skeleton';
import { QueryErrorState } from '../components/common/QueryErrorState';
import {
  AlertTriangle,
  ClipboardList,
  DollarSign,
  History,
  Navigation,
  RefreshCw,
  TrendingUp,
  UserCheck,
} from 'lucide-react';

// PERBAIKAN PERFORMA: sebelumnya DriverApp adalah bagian dari app/App.tsx
// monolitik (~5100 baris) yang ikut ter-parse & ter-load browser SETIAP kali
// aplikasi dibuka, walau yang login adalah CUSTOMER atau ADMIN sekalipun.
// Dipisah ke file sendiri supaya bisa di-lazy-load lewat React.lazy() --
// kode ini (termasuk peta Leaflet & mesin lokasi GPS-nya) sekarang hanya
// diunduh browser saat benar-benar dibutuhkan (role driver terpilih).

/** Fallback ringan ditampilkan sementara komponen peta (Leaflet, lazy-loaded)
 * sedang diunduh — hanya terjadi sekali per sesi browser (setelah itu ke-cache). */
function MapLoadingFallback() {
  return (
    <div className="h-[220px] rounded-xl border border-[#23583E] bg-[#06170E] flex items-center justify-center">
      <span className="text-[10px] text-[#A5C9B8] animate-pulse">Memuat peta...</span>
    </div>
  );
}

const LiveTripMap = React.lazy(() => import('../components/map/LiveTripMap'));
const DriverDashboardMap = React.lazy(() => import('../components/map/DriverDashboardMap'));

interface PortalProps {
  onBack: () => void;
  triggerToast: (m: string) => void;
}

function DriverApp({ onBack, triggerToast }: PortalProps) {
  const { login, logout, user } = useAuthStore();
  const queryClient = useQueryClient();
  const [activeTrip, setActiveTrip] = useState<any | null>(null);
  const [offeredJob, setOfferedJob] = useState<any | null>(null);

  // Fetch real driver profile
  const { data: profileData, isLoading: isProfileLoading, refetch: refetchProfile } = useQuery({
    queryKey: ['driverProfile'],
    queryFn: DriverAPI.getProfile,
    enabled: !!user,
  });

  // Fetch active available jobs
  const { data: jobsData, isLoading: isJobsLoading, isError: isJobsError, refetch: refetchJobs } = useQuery({
    queryKey: ['driverJobs'],
    queryFn: DriverAPI.getJobs,
    enabled: !!user,
    // P0 recovery: GET /jobs is the lifecycle source-of-truth after reconnect
    // or a Socket.IO race. Poll only while the driver is online so a PENDING
    // order cannot remain invisible merely because the offer event happened
    // before the dashboard listener was ready.
    refetchInterval: profileData?.profile?.isOnline ? 5000 : false,
    refetchIntervalInBackground: true,
  });

  // Mutations
  const toggleOnlineMutation = useMutation({
    mutationFn: (online: boolean) => DriverAPI.toggleOnlineStatus(online),
    onSuccess: (res, online) => {
      triggerToast(res.message);
      queryClient.invalidateQueries({ queryKey: ['driverProfile'] });
      queryClient.invalidateQueries({ queryKey: ['driverJobs'] });
      
      const driverId = profileData?.profile?.id || user?.id;
      if (driverId && socket.connected) {
        socket.emit("driver_sync_status", {
          driverId,
          isOnline: online,
          autoAccept: isAutoAcceptOn,
        });
      }
      refetchJobs();
    },
    onError: (err: any) => {
      triggerToast(err.response?.data?.error || 'Gagal mengubah status harian!');
    },
  });

  // BARU: opsi auto-accept — kalau aktif, order yang ditawarkan Dispatch
  // Engine ke driver ini langsung diterima otomatis tanpa perlu tap manual.
  const toggleAutoAcceptMutation = useMutation({
    mutationFn: (enabled: boolean) => DriverAPI.toggleAutoAccept(enabled),
    onSuccess: (res, enabled) => {
      triggerToast(res.message);
      queryClient.invalidateQueries({ queryKey: ['driverProfile'] });
      queryClient.invalidateQueries({ queryKey: ['driverJobs'] });

      const driverId = profileData?.profile?.id || user?.id;
      if (driverId && socket.connected) {
        socket.emit("driver_sync_status", {
          driverId,
          isOnline: profileData?.profile?.isOnline,
          autoAccept: enabled,
        });
      }
      refetchJobs();
    },
    onError: (err: any) => {
      triggerToast(err.response?.data?.error || 'Gagal mengubah pengaturan auto-accept!');
    },
  });

  const acceptJobMutation = useMutation({
    mutationFn: (orderId: string) => DriverAPI.acceptJob(orderId),
    // PERBARUAN: hentikan ring SEKETIKA saat driver tap "Terima Order" --
    // jangan tunggu response server dulu, supaya bel langsung berhenti persis
    // di momen mereka klik terima, sesuai permintaan.
    onMutate: (orderId) => {
      stopRingLoop();
      setOfferedJob((current) => current?.id === orderId ? null : current);
    },
    onSuccess: (res) => {
      triggerToast(res.message);
      if (res?.order && ['ACCEPTED', 'ON_THE_WAY', 'ARRIVED', 'PICKED_UP', 'ARRIVED_CUSTOMER'].includes(res.order.status)) {
        setActiveTrip(res.order);
      }
      queryClient.invalidateQueries({ queryKey: ['driverJobs'] });
      refetchJobs();
    },
    onError: (err: any) => {
      triggerToast(err.response?.data?.error || 'Gagal menerima orderan!');
    },
  });

  // PERBAIKAN AKAR MASALAH: sebelumnya tidak ada jalur sama sekali yang
  // mengirim lokasi GPS driver ke backend di luar sesi trip aktif --
  // driver yang baru online (apalagi setelah offline) punya koordinat
  // NULL/basi, sehingga tidak lolos filter dispatch/auto-accept manapun.
  // Dipanggil oleh DriverDashboardMap setiap kali browser mendapat fix
  // GPS baru selama driver berstatus online.
  const updateLocationMutation = useMutation({
    mutationFn: ({ lat, lng }: { lat: number; lng: number }) =>
      LocationAPI.updateMyLocation(lat, lng, profileData?.profile?.isOnline),
    onError: () => {
      // Senyap -- ini update latar belakang berkala, jangan ganggu driver
      // dengan toast tiap kali gagal (mis. sinyal internet sempat putus).
    },
  });

  const handleDriverLocationUpdate = (coords: { lat: number; lng: number }) => {
    updateLocationMutation.mutate(coords);
  };

  const updateJobStatusMutation = useMutation({
    mutationFn: ({ orderId, status }: { orderId: string; status: string }) => 
      DriverAPI.updateJobStatus(orderId, status),
    onSuccess: (res) => {
      triggerToast(res.message);
      const nextOrder = res?.order;
      if (nextOrder && ['ACCEPTED', 'ON_THE_WAY', 'ARRIVED', 'PICKED_UP', 'ARRIVED_CUSTOMER'].includes(nextOrder.status)) {
        setActiveTrip(nextOrder);
      } else if (nextOrder && ['COMPLETED', 'CANCELLED'].includes(nextOrder.status)) {
        setActiveTrip(null);
      }
      queryClient.invalidateQueries({ queryKey: ['driverJobs'] });
      queryClient.invalidateQueries({ queryKey: ['driverProfile'] });
      refetchJobs();
    },
    onError: (err: any) => {
      triggerToast(err.response?.data?.error || 'Gagal memperbarui status orderan!');
    },
  });

  // Dokumen verifikasi driver (KTP+selfie, STNK)
  const { data: documentsData, refetch: refetchDocuments } = useQuery({
    queryKey: ['driverDocuments'],
    queryFn: DriverAPI.getMyDocuments,
    enabled: !!user,
  });
  const uploadDocumentMutation = useMutation({
    mutationFn: async ({ type, file }: { type: 'KTP_SELFIE' | 'STNK' | 'SIM'; file: File }) => {
      const uploaded = await UploadAPI.uploadImage(file);
      return DriverAPI.uploadDocument(type, uploaded.url);
    },
    onSuccess: (res: any) => {
      triggerToast(res.message || 'Dokumen berhasil diupload! Menunggu peninjauan Admin.');
      refetchDocuments();
    },
    onError: (err: any) => {
      triggerToast(err.response?.data?.error || 'Gagal mengupload dokumen!');
    },
  });

  const [driverTopupAmount, setDriverTopupAmount] = useState('');
  const [isDriverTopupModalOpen, setIsDriverTopupModalOpen] = useState(false);
  const [driverCoords, setDriverCoords] = useState<{ lat: number; lng: number } | null>(null);

  const isAutoAcceptOn = Boolean(profileData?.profile?.autoAcceptEnabled ?? profileData?.profile?.autoAccept);

  const currentDriverId = profileData?.profile?.id || user?.id;
  // Find if this driver is currently busy with an accepted order
  // P0: restore active trip from explicit activeJobs, with API compatibility fallback.
  const normalizedJobs = Array.isArray(jobsData?.jobs)
    ? jobsData.jobs
    : Array.isArray(jobsData?.data)
      ? jobsData.data
      : [];

  // V4: GET /jobs sekarang scoped ke driver yang login. Jangan membuat
  // lifecycle bergantung pada kecocokan ID User vs DriverProfile secara
  // diam-diam. Jika backend mengirim activeJob/activeJobs, gunakan itu;
  // fallback ke daftar jobs yang juga sudah scoped.
  const serverActiveJob =
    (jobsData?.activeJob && ['ACCEPTED', 'ON_THE_WAY', 'ARRIVED', 'PICKED_UP', 'ARRIVED_CUSTOMER'].includes(jobsData.activeJob.status))
      ? jobsData.activeJob
      : (Array.isArray(jobsData?.activeJobs) ? jobsData.activeJobs : normalizedJobs)
          .find((j: any) =>
            ['ACCEPTED', 'ON_THE_WAY', 'ARRIVED', 'PICKED_UP', 'ARRIVED_CUSTOMER'].includes(j.status) &&
            (!j.driverId || j.driverId === currentDriverId)
          );

  const activeJob = activeTrip || serverActiveJob;

  useEffect(() => {
    if (serverActiveJob) {
      setActiveTrip(serverActiveJob);
    } else if (!updateJobStatusMutation.isPending) {
      setActiveTrip(null);
    }
  }, [serverActiveJob?.id, serverActiveJob?.status, updateJobStatusMutation.isPending]);

  // 🔥 WARMUP AUDIOCONTEXT - Dipanggil saat komponen mount (user gesture dari klik menu)
  useEffect(() => {
    warmupAudioContext();
    console.log('🔊 AudioContext warmed up for DriverApp');
  }, []);

  // PERBAIKAN: driver sebelumnya TIDAK PERNAH join room "drivers_pool" --
  // akibatnya broadcast SocketService.emitToDriversPool() (mis. saat order
  // baru dipublikasikan atau order diambil driver lain) tidak pernah sampai
  // ke siapa pun. Offer per-driver (dispatch.service.ts) tetap terkirim
  // lewat emitToUser (room user_<id>, auto-join), tapi join di sini
  // melengkapi jalur broadcast pool sebagai lapisan tambahan.
  useEffect(() => {
    if (!user) return;

    const joinPool = () => {
      joinRoom('drivers_pool').catch((err) => {
        console.warn('Driver gagal join room drivers_pool:', err);
      });
    };

    if (socket.connected) joinPool();
    socket.on('connect', joinPool);
    return () => {
      socket.off('connect', joinPool);
    };
  }, [user]);

  // Join active job socket room
  useEffect(() => {
    if (activeJob) {
      const roomId = `order_${activeJob.id}`;
      joinRoom(roomId)
        .then(() => {
          console.log(`Driver joined active job room: ${roomId}`);
        })
        .catch((err) => {
          console.error('Driver failed to join room:', err);
        });
    } else {
      setDriverCoords(null);
    }
  }, [activeJob]);

  // Effect untuk sinkronisasi status driver online & auto-accept dengan backend & socket
  useEffect(() => {
    if (profileData?.profile) {
      const isOnline = Boolean(profileData.profile.isOnline);
      const autoAccept = Boolean(profileData.profile.autoAcceptEnabled ?? profileData.profile.autoAccept);
      const driverId = profileData.profile.id || user?.id;

      if (socket.connected && driverId) {
        socket.emit("driver_sync_status", {
          driverId,
          isOnline,
          autoAccept,
        });
      }

      // Bila driver online dan auto-accept aktif, refetch jobs untuk periksa orderan pending otomatis
      if (isOnline && autoAccept) {
        refetchJobs();
      }
    }
  }, [profileData?.profile?.isOnline, isAutoAcceptOn, user?.id, refetchJobs]);

  // ============================================
  // SOCKET LISTENER UNTUK ORDER BARU (DRIVER)
  // ============================================
  useEffect(() => {
    if (!socket || !user) {
      console.log('🔌 DriverApp: Socket atau user tidak tersedia, skip listener');
      return;
    }

    console.log('🔌 DriverApp: Socket listener aktif untuk order baru - User ID:', user.id);

    // 🔥 HANDLER ORDER BARU DITAWARKAN KE DRIVER
    // PERBAIKAN: backend (lihat backend/src/modules/dispatch/dispatch.constants.ts
    // & order.service.ts) mengirim event 'new_order_available', BUKAN 'newOrder'.
    // Event Socket.IO case-sensitive exact-match, jadi sebelumnya listener ini
    // TIDAK PERNAH terpanggil sama sekali -- makanya bel/ring tidak pernah bunyi.
    const handleNewOrderOffered = (data: any) => {
      console.log('🛎️ ORDER BARU DITAWARKAN KE DRIVER:', data);

      // P0: event ini adalah offer TARGETED dari DispatchService, bukan
      // broadcast pool. Simpan sebagai local offer supaya driver memiliki
      // tombol TERIMA yang langsung bekerja tanpa menunggu GET /jobs.
      setOfferedJob({
        ...data,
        id: data.orderId,
        status: 'PENDING',
      });

      try {
        startRingLoop();
      } catch (error) {
        console.error('❌ Gagal memulai ring loop:', error);
      }

      const total = Number(data.price || data.total || 0);
      const formattedTotal = total.toLocaleString('id-ID');
      triggerToast(`📦 Order baru! ${data.pickupAddress ? `Dari ${data.pickupAddress}. ` : ''}Total: Rp ${formattedTotal}`);
      refetchJobs();
    };

    // 🔥 HANDLER ORDER DIAMBIL DRIVER LAIN
    // PERBAIKAN: backend mengirim 'order_taken', BUKAN 'orderTaken'.
    const handleOrderTakenByOther = (data: any) => {
      console.log('🔄 Order diambil driver lain:', data);
      stopRingLoop();
      setOfferedJob((current) => current?.id === data.orderId ? null : current);
      triggerToast(`⏳ Order #${data.orderId || 'unknown'} sudah diambil driver lain`);
      refetchJobs();
    };

    // 🔥 HANDLER OFFER KADALUWARSA / TIDAK ADA DRIVER
    // PERBAIKAN: backend mengirim 'order_expired' (lihat
    // DISPATCH_CONSTANTS.ORDER_EXPIRED_EVENT), BUKAN 'orderExpired'.
    const handleOrderExpired = (data: any) => {
      console.log('⏰ Order expired:', data);
      stopRingLoop();
      setOfferedJob((current) => current?.id === data.orderId ? null : current);
      triggerToast(`⏰ Order #${data.orderId || 'unknown'} telah kadaluwarsa`);
      refetchJobs();
    };

    // 🔥 HANDLER OFFER KADALUWARSA UNTUK DRIVER INI SECARA SPESIFIK
    // (dispatch pindah ke kandidat driver berikutnya — lihat
    // dispatch.service.ts, DISPATCH_CONSTANTS.ORDER_TIMEOUT_EVENT)
    const handleOfferTimeout = (data: any) => {
      console.log('⏱️ Offer order timeout untuk driver ini:', data);
      stopRingLoop();
      setOfferedJob((current) => current?.id === data.orderId ? null : current);
    };

    // Daftarkan semua listener — nama event HARUS sama persis dengan yang
    // di-emit backend (lihat grep "SocketService.emitTo" di seluruh backend/src).
    const handleAssignedOrStatusChanged = (data: any) => {
      console.log('🔄 Driver active order sync:', data);
      if (data?.orderId && data?.status) {
        stopRingLoop();
        setOfferedJob((current) => current?.id === data.orderId ? null : current);
        if (['COMPLETED', 'CANCELLED'].includes(data.status)) {
          setActiveTrip((current: any) => current?.id === data.orderId ? null : current);
        } else if (data.order) {
          setActiveTrip(data.order);
        } else {
          setActiveTrip((current: any) => {
            if (!current || current.id === data.orderId) {
              return current ? { ...current, status: data.status } : current;
            }
            return current;
          });
        }
      }
      refetchJobs();
      queryClient.invalidateQueries({ queryKey: ['driverJobs'] });
    };

    socket.on('new_order_available', handleNewOrderOffered);
    socket.on('order_taken', handleOrderTakenByOther);
    socket.on('order_expired', handleOrderExpired);
    socket.on('order_timeout', handleOfferTimeout);
    socket.on('order_accepted', handleAssignedOrStatusChanged);
    socket.on('order_status_changed', handleAssignedOrStatusChanged);
    socket.on('order_updated', handleAssignedOrStatusChanged);

    // Cleanup
    return () => {
      console.log('🔌 DriverApp: Membersihkan semua socket listener');
      socket.off('new_order_available', handleNewOrderOffered);
      socket.off('order_taken', handleOrderTakenByOther);
      socket.off('order_expired', handleOrderExpired);
      socket.off('order_timeout', handleOfferTimeout);
      socket.off('order_accepted', handleAssignedOrStatusChanged);
      socket.off('order_status_changed', handleAssignedOrStatusChanged);
      socket.off('order_updated', handleAssignedOrStatusChanged);
      
      // ✅ STOP ring loop saat komponen unmount
      stopRingLoop();
      console.log('🔇 Ring loop stopped - component unmount');
    };
  }, [user, triggerToast, refetchJobs]);

  const driverTopupMutation = useMutation({
    mutationFn: (amount: number) => WalletAPI.topup(amount),
    onSuccess: (res: any) => {
      triggerToast(res?.message || 'Permintaan top up deposit berhasil dikirim! Menunggu verifikasi & persetujuan Admin.');
      setDriverTopupAmount('');
      queryClient.invalidateQueries({ queryKey: ['driverProfile'] });
    },
    onError: (err: any) => {
      triggerToast(err.response?.data?.error || 'Gagal mengajukan top up deposit!');
    },
  });

  const confirmCashMutation = useMutation({
    mutationFn: (orderId: string) => PaymentAPI.confirmCash(orderId),
    onSuccess: (res: any) => {
      triggerToast(res.message || 'Cash dikonfirmasi!');
      queryClient.invalidateQueries({ queryKey: ['driverJobs'] });
      queryClient.invalidateQueries({ queryKey: ['driverProfile'] });
    },
    onError: (err: any) => {
      triggerToast(err.response?.data?.error || 'Gagal mengonfirmasi pembayaran cash!');
    },
  });

  if (!user) {
    return (
      <AuthFlow 
        role="DRIVER" 
        onBack={onBack} 
        onSuccess={(u, t, rt) => login(u, t, rt)} 
        triggerToast={triggerToast} 
      />
    );
  }

  // Handler to emit driver location updates when dragged or simulated
  const handleDriverCoordsChange = (coords: { lat: number; lng: number }) => {
    setDriverCoords(coords);
    if (profileData?.profile?.id) {
      socket.emit('driver_location_update', {
        driverId: profileData.profile.id,
        lat: coords.lat,
        lng: coords.lng,
      });
    }
  };

  return (
    <div className="w-full max-w-7xl mx-auto px-4 py-8 flex flex-col gap-6 flex-1">
      {/* Title Panel */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-[#0D2E1F] p-6 rounded-3xl border border-[#23583E]">
        <div>
          <h2 className="text-3xl font-black text-[#00E575]">Mitra Portal - Dhuknoo Driver</h2>
          <p className="text-xs text-[#A5C9B8]">Konektivitas langsung ke API Endpoint Driver: `/api/driver/*`</p>
        </div>
        <div className="flex gap-2">
          <button 
            onClick={() => {
              refetchProfile();
              refetchJobs();
              triggerToast('Sinkronisasi orderan aktif sukses!');
            }}
            className="flex items-center gap-2 bg-[#23583E] hover:bg-[#23583E]/80 text-[#00E575] text-xs font-bold px-4 py-2.5 rounded-xl transition-all"
          >
            <RefreshCw className="w-4 h-4" />
            <span>Segarkan</span>
          </button>
        </div>
      </div>

      {/* Main Layout Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Left Column: Driver Shift & Active Orders */}
        <div className="flex flex-col gap-6 lg:col-span-2">

          {/* BARU: Notifikasi upload dokumen untuk driver baru — sebelumnya
              tidak ada pemberitahuan sama sekali; driver baru hanya tahu perlu
              upload KTP/SIM/STNK kalau kebetulan scroll ke bagian dokumen. */}
          {(() => {
            const REQUIRED_TYPES: Array<'KTP_SELFIE' | 'STNK' | 'SIM'> = ['KTP_SELFIE', 'STNK', 'SIM'];
            const uploadedTypes = new Set((documentsData?.documents || []).map((d: any) => d.type));
            const missingTypes = REQUIRED_TYPES.filter((t) => !uploadedTypes.has(t));
            if (missingTypes.length === 0) return null;

            const labelMap: Record<string, string> = { KTP_SELFIE: 'KTP + Selfie', STNK: 'STNK', SIM: 'SIM' };
            return (
              <div className="bg-[#FFD700]/10 border-2 border-[#FFD700] p-5 rounded-3xl flex flex-col gap-2">
                <div className="flex items-center gap-2 text-[#FFD700]">
                  <AlertTriangle className="w-5 h-5" />
                  <h3 className="font-black text-sm">Lengkapi Dokumen Verifikasi Anda</h3>
                </div>
                <p className="text-xs text-[#A5C9B8]">
                  Selamat bergabung sebagai mitra! Sebelum bisa menerima order, unggah dulu dokumen berikut yang belum dikirim:{' '}
                  <span className="font-bold text-white">{missingTypes.map((t) => labelMap[t]).join(', ')}</span>.
                  Cari bagian "Verifikasi Dokumen" di bawah untuk mengunggah.
                </p>
              </div>
            );
          })()}

          {/* Shift State & Stats Dashboard */}
          <div className="bg-[#0D2E1F] border border-[#23583E] p-6 rounded-3xl grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="flex flex-col justify-between gap-4">
              <div>
                <span className="text-[10px] text-[#A5C9B8] uppercase font-bold">Kemitraan Platform</span>
                <div className="flex items-center gap-2 mt-1">
                  <span className={`w-3.5 h-3.5 rounded-full ${profileData?.profile?.isOnline ? 'bg-[#00E575] animate-ping' : 'bg-red-500'}`}></span>
                  <span className="font-black text-xl text-white">
                    {profileData?.profile?.isOnline ? 'ONLINE (Narik Aktif)' : 'OFFLINE (Selesai Narik)'}
                  </span>
                </div>
              </div>

              {/* 🆕 Nama driver — ditampilkan tepat di atas Plat Nomor/Tipe
                  Kendaraan, sejajar dengan status ONLINE/OFFLINE di atasnya,
                  mengisi ruang kosong pojok atas kartu ini. */}
              <div className="text-xs text-[#A5C9B8]">
                <div className="flex justify-between border-b border-[#23583E]/50 pb-1">
                  <span>Nama Driver:</span>
                  <span className="font-bold text-white">{profileData?.fullName || 'Memuat...'}</span>
                </div>
              </div>

              <div className="text-xs text-[#A5C9B8]">
                <div className="flex justify-between border-b border-[#23583E]/50 pb-1">
                  <span>Plat Nomor:</span>
                  <span className="font-bold text-white">{profileData?.profile?.vehiclePlate || 'Memuat...'}</span>
                </div>
                <div className="flex justify-between pt-1">
                  <span>Tipe Kendaraan:</span>
                  <span className="font-bold text-white">{profileData?.profile?.vehicleModel || 'Memuat...'}</span>
                </div>
              </div>

              <button
                onClick={() => toggleOnlineMutation.mutate(!profileData?.profile?.isOnline)}
                disabled={toggleOnlineMutation.isPending || !profileData?.profile?.isVerified}
                className={`w-full py-3 rounded-xl text-xs font-black text-[#071F14] transition-all transform active:scale-95 ${
                  !profileData?.profile?.isVerified 
                    ? 'bg-gray-700 text-gray-500 cursor-not-allowed'
                    : profileData?.profile?.isOnline 
                      ? 'bg-red-500 hover:bg-red-400 text-white' 
                      : 'bg-[#00E575] hover:bg-[#00ff80]'
                }`}
              >
                {!profileData?.profile?.isVerified 
                  ? 'MITRA BELUM DIVERIFIKASI ADMIN' 
                  : profileData?.profile?.isOnline 
                    ? 'Selesai Narik (Set Offline)' 
                    : 'Mulai Sesi Narik (Set Online)'}
              </button>

              {/* BARU: opsi auto-accept — order dari Dispatch Engine langsung
                  diterima otomatis tanpa perlu tap manual. Default OFF, alur
                  manual (tap "Terima" di notifikasi order) tetap ada seperti
                  biasa kalau opsi ini tidak diaktifkan. */}
              <div className="flex gap-2 w-full">
                <button
                  type="button"
                  onClick={() => toggleAutoAcceptMutation.mutate(!isAutoAcceptOn)}
                  disabled={toggleAutoAcceptMutation.isPending || !profileData?.profile?.isVerified}
                  className={`flex-1 flex items-center justify-between px-4 py-2.5 rounded-xl text-[10px] font-bold transition-all ${
                    isAutoAcceptOn
                      ? 'bg-[#FFD700]/15 border border-[#FFD700] text-[#FFD700]'
                      : 'bg-[#06170E] border border-[#23583E] text-[#A5C9B8]'
                  } ${!profileData?.profile?.isVerified ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                  <span>⚡ Auto-Accept ({isAutoAcceptOn ? 'AKTIF' : 'OFF'})</span>
                  <span className={`w-8 h-4 rounded-full relative transition-all ${isAutoAcceptOn ? 'bg-[#FFD700]' : 'bg-[#23583E]'}`}>
                    <span
                      className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all ${
                        isAutoAcceptOn ? 'left-4' : 'left-0.5'
                      }`}
                    />
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    playBellRingSound();
                    triggerToast("🔔 Suara notifikasi bel (Bell Ring) berhasil dites!");
                  }}
                  className="bg-[#06170E] hover:bg-[#23583E] border border-[#23583E] text-[#FFD700] px-3 py-2.5 rounded-xl text-[10px] font-bold flex items-center gap-1 shrink-0 transition-all"
                  title="Tes Suara Notifikasi Bel"
                >
                  <span>🔔 Tes Bel</span>
                </button>
              </div>
            </div>

            {/* Total Balance / Earnings */}
            <div className="bg-[#06170E] p-6 rounded-2xl border border-[#23583E] flex flex-col justify-between gap-4">
              <div className="flex items-center gap-2 text-[#FFD700]">
                <TrendingUp className="w-5 h-5" />
                <span className="text-xs font-bold uppercase tracking-wider">Deposit Penghasilan</span>
              </div>
              <div>
                <span className="text-[10px] text-[#A5C9B8] block">Bisa dicairkan kapan saja</span>
                <span className="text-3xl font-black text-[#00E575]">
                  {formatRupiah(Number(profileData?.wallet?.balance || 0))}
                </span>
              </div>
              <p className="text-[10px] text-[#A5C9B8]/60">Penghasilan Anda akan langsung bertambah setiap kali perjalanan diselesaikan dengan sukses!</p>

              {/* Top-up Deposit Driver — wajib punya saldo minimum supaya bisa menerima order */}
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  setIsDriverTopupModalOpen(true);
                }}
                className="flex gap-2 pt-1 border-t border-[#23583E]/50 mt-1"
              >
                <input
                  type="number"
                  min={1}
                  placeholder="Nominal top up deposit..."
                  value={driverTopupAmount}
                  onChange={(e) => setDriverTopupAmount(e.target.value)}
                  className="flex-1 bg-[#0D2E1F] border border-[#23583E] rounded-lg px-3 py-2 text-xs text-white placeholder:text-gray-500 focus:outline-none focus:border-[#00E575]"
                />
                <button
                  type="submit"
                  className="bg-[#00E575] hover:bg-[#00E575]/80 text-[#06170E] text-xs font-black px-4 rounded-lg whitespace-nowrap"
                >
                  Pilih Bayar
                </button>
              </form>
            </div>
          </div>

          {/* PANDUAN LOKASI DRIVER: peta yang tampil di dashboard utama
              (bukan cuma saat trip aktif) sekaligus mesin auto-update lokasi
              GPS ke backend -- terutama saat driver baru transisi dari
              OFFLINE ke ONLINE, supaya koordinat langsung ter-update dan
              driver bisa lolos filter dispatch/auto-accept. */}
          <Suspense fallback={<MapLoadingFallback />}>
            <DriverDashboardMap
              isOnline={Boolean(profileData?.profile?.isOnline)}
              initialCoords={
                profileData?.profile?.latitude && profileData?.profile?.longitude
                  ? { lat: Number(profileData.profile.latitude), lng: Number(profileData.profile.longitude) }
                  : null
              }
              onLocationUpdate={handleDriverLocationUpdate}
            />
          </Suspense>

          {/* Active Work Progress Bar */}
          {activeJob && (
            <div className="bg-[#0D2E1F] border-2 border-[#00E575] p-6 rounded-3xl flex flex-col gap-4">
              <div className="flex justify-between items-center">
                <span className="text-xs font-black text-[#00E575] uppercase tracking-wider flex items-center gap-1.5 animate-pulse">
                  ⚡ Tugas Perjalanan Aktif
                </span>
                <span className="text-[10px] bg-[#00E575]/20 text-[#00E575] px-2 py-0.5 rounded font-bold">
                  Status: {activeJob.status}
                </span>
              </div>

              <div className="bg-[#06170E] p-4 rounded-xl border border-[#23583E] flex flex-col gap-2 text-xs">
                <div>
                  <span className="text-gray-400 block text-[9px]">PELANGGAN:</span>
                  <span className="font-bold text-white text-sm">{activeJob.customer?.user?.fullName}</span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mt-1">
                  <div>
                    <span className="text-gray-400 block text-[9px]">LOKASI JEMPUT:</span>
                    <span className="text-white truncate block">{activeJob.pickupAddress}</span>
                  </div>
                  <div>
                    <span className="text-gray-400 block text-[9px]">LOKASI TUJUAN:</span>
                    <span className="text-white truncate block">{activeJob.dropoffAddress}</span>
                  </div>
                </div>
                <div className="flex justify-between items-center border-t border-[#23583E]/50 pt-2 mt-2">
                  <span className="font-bold text-white">Tarif: {formatRupiah(Number(activeJob.price))}</span>
                  <span className="text-[10px] text-[#A5C9B8]">Tipe: {activeJob.serviceType}</span>
                </div>
              </div>

              <Suspense fallback={<MapLoadingFallback />}>
                <LiveTripMap
                  orderId={activeJob.id}
                  pickupCoords={{ lat: Number(activeJob.pickupLat), lng: Number(activeJob.pickupLng) }}
                  dropoffCoords={{ lat: Number(activeJob.dropoffLat), lng: Number(activeJob.dropoffLng) }}
                  driverCoords={driverCoords}
                  isDriverSide={true}
                  onDriverCoordsChange={handleDriverCoordsChange}
                  orderStatus={activeJob.status}
                />
              </Suspense>

              {/* In-App Direct Chat Box Driver <-> Customer */}
              <OrderChatBox
                orderId={activeJob.id}
                currentUserId={user?.id || ''}
                currentUserRole="DRIVER"
                otherPartyName={activeJob.customer?.user?.fullName}
                otherPartyPhone={activeJob.customer?.phoneNumber || activeJob.customer?.user?.phoneNumber}
              />

              {/* Progress Stepper Buttons — MART memiliki dua titik ARRIVED. */}
              <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                <button
                  onClick={() => updateJobStatusMutation.mutate({ orderId: activeJob.id, status: 'ON_THE_WAY' })}
                  disabled={activeJob.status !== 'ACCEPTED'}
                  className="bg-amber-500 hover:bg-amber-400 text-white py-2 rounded-xl text-[10px] font-black transition-all disabled:opacity-30"
                >
                  {activeJob.serviceType === 'MART' ? 'Menuju Merchant' : 'Menuju Jemput'}
                </button>
                <button
                  onClick={() => updateJobStatusMutation.mutate({ orderId: activeJob.id, status: 'ARRIVED' })}
                  disabled={activeJob.status !== 'ON_THE_WAY'}
                  className="bg-cyan-500 hover:bg-cyan-400 text-white py-2 rounded-xl text-[10px] font-black transition-all disabled:opacity-30"
                >
                  {activeJob.serviceType === 'MART' ? 'Tiba di Merchant' : 'Tiba di Lokasi'}
                </button>
                <button
                  onClick={() => updateJobStatusMutation.mutate({ orderId: activeJob.id, status: 'PICKED_UP' })}
                  disabled={activeJob.serviceType !== 'MART' || activeJob.status !== 'ARRIVED'}
                  className="bg-violet-500 hover:bg-violet-400 text-white py-2 rounded-xl text-[10px] font-black transition-all disabled:opacity-30"
                >
                  Ambil & Menuju Customer
                </button>
                {activeJob.serviceType === 'MART' && (
                  <button
                    onClick={() => updateJobStatusMutation.mutate({ orderId: activeJob.id, status: 'ARRIVED_CUSTOMER' })}
                    disabled={activeJob.status !== 'PICKED_UP'}
                    className="bg-sky-500 hover:bg-sky-400 text-white py-2 rounded-xl text-[10px] font-black transition-all disabled:opacity-30"
                  >
                    Tiba di Customer
                  </button>
                )}
                <button
                  onClick={() => updateJobStatusMutation.mutate({ orderId: activeJob.id, status: 'COMPLETED' })}
                  disabled={activeJob.serviceType === 'MART' ? activeJob.status !== 'ARRIVED_CUSTOMER' : activeJob.status !== 'ARRIVED'}
                  className="bg-[#00E575] hover:bg-[#00ff80] text-[#071F14] py-2 rounded-xl text-[10px] font-black transition-all disabled:opacity-30"
                >
                  Selesaikan Order
                </button>
                <button
                  onClick={() => updateJobStatusMutation.mutate({ orderId: activeJob.id, status: 'CANCELLED' })}
                  disabled={activeJob.status === 'COMPLETED' || activeJob.status === 'CANCELLED'}
                  className="bg-red-500 hover:bg-red-400 text-white py-2 rounded-xl text-[10px] font-black transition-all disabled:opacity-30 col-span-2 md:col-span-5"
                >
                  Batalkan Order
                </button>
              </div>
            </div>
          )}

          {/* Order Selesai — Menunggu Konfirmasi Cash */}
          {normalizedJobs.some((j: any) => j.status === 'COMPLETED' && !j.isPaid && j.paymentMethod === 'CASH' && j.driverId === profileData?.profile?.id) && (
            <div className="bg-[#0D2E1F] border border-[#FFD700]/40 p-6 rounded-3xl flex flex-col gap-3">
              <h3 className="font-black text-sm text-[#FFD700] flex items-center gap-1.5">
                <DollarSign className="w-4 h-4" /> Order Selesai — Menunggu Konfirmasi Cash
              </h3>
              <p className="text-[10px] text-[#A5C9B8]/70 -mt-2">
                Order ini dibayar tunai oleh customer. Konfirmasi kalau uangnya sudah benar-benar Anda terima —
                komisi platform akan otomatis dipotong dari deposit Anda.
              </p>
              {jobsData.jobs
                .filter((j: any) => j.status === 'COMPLETED' && !j.isPaid && j.paymentMethod === 'CASH' && j.driverId === profileData?.profile?.id)
                .map((job: any) => (
                  <div key={job.id} className="flex justify-between items-center bg-[#06170E] border border-[#23583E] p-3 rounded-xl text-[10px]">
                    <div className="flex flex-col">
                      <span className="text-white font-bold">{formatRupiah(Number(job.price) - Number(job.discount || 0))}</span>
                      <span className="text-[#A5C9B8] truncate max-w-[200px]">{job.dropoffAddress}</span>
                    </div>
                    <button
                      onClick={() => confirmCashMutation.mutate(job.id)}
                      disabled={confirmCashMutation.isPending}
                      className="bg-[#FFD700] hover:bg-[#FFD700]/80 disabled:opacity-50 text-[#06170E] font-black px-3 py-2 rounded-lg whitespace-nowrap"
                    >
                      {confirmCashMutation.isPending ? '...' : 'Konfirmasi Cash Diterima'}
                    </button>
                  </div>
                ))}
            </div>
          )}

          {/* P0 MANUAL OFFER — actionable offer yang diterima lewat Socket.IO.
              Jangan menggantungkan tombol Terima hanya pada GET /jobs karena
              offer dispatch bisa datang lebih cepat daripada refresh query. */}
          {offeredJob && !activeJob && (
            <div className="bg-[#102F20] border-2 border-[#FFD700] p-5 rounded-3xl flex flex-col gap-3 shadow-lg">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 className="font-black text-lg text-[#FFD700]">🔔 Pesanan Masuk — Menunggu Anda</h3>
                  <p className="text-[10px] text-[#A5C9B8]">Offer ini sudah diterima secara manual. Pengaturan Auto-Accept berlaku untuk offer berikutnya.</p>
                </div>
                <span className="text-[10px] font-black text-white bg-[#23583E] px-2 py-1 rounded-lg">{offeredJob.serviceType}</span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
                <div className="bg-[#06170E] border border-[#23583E] rounded-xl p-3"><span className="text-[#A5C9B8]">Jemput</span><div className="text-white font-bold mt-1">{offeredJob.pickupAddress || '-'}</div></div>
                <div className="bg-[#06170E] border border-[#23583E] rounded-xl p-3"><span className="text-[#A5C9B8]">Tujuan</span><div className="text-white font-bold mt-1">{offeredJob.dropoffAddress || '-'}</div></div>
              </div>
              <div className="flex items-center justify-between gap-3 border-t border-[#23583E] pt-3">
                <span className="font-black text-white">Rp {Number(offeredJob.price || 0).toLocaleString('id-ID')}</span>
                <button
                  onClick={() => acceptJobMutation.mutate(offeredJob.id)}
                  disabled={acceptJobMutation.isPending}
                  className="bg-[#00E575] hover:bg-[#00ff80] text-[#071F14] font-black px-5 py-2.5 rounded-xl disabled:opacity-50"
                >
                  {acceptJobMutation.isPending ? 'Menerima...' : 'Terima Order'}
                </button>
              </div>
            </div>
          )}

          {/* Job Pool (Available orders) */}
          <div className="bg-[#0D2E1F] border border-[#23583E] p-6 rounded-3xl flex flex-col gap-4">
            <h3 className="font-black text-lg text-[#00E575] flex items-center gap-1.5">
              <ClipboardList className="w-5 h-5" /> Lowongan Pesanan Di Sekitar Batu
            </h3>
            
            {(() => {
              const hasUnconfirmedCash = normalizedJobs.some(
                (j: any) => j.status === 'COMPLETED' && !j.isPaid && j.paymentMethod === 'CASH' && j.driverId === profileData?.profile?.id
              );

              // PERBARUAN: driver dengan pembayaran CASH yang belum dikonfirmasi
              // sekarang DIBEKUKAN backend dari menerima order baru (lihat
              // DispatchRepository.getAvailableDrivers, tryAutoAcceptOnCreation,
              // acceptOrder, & /jobs/:id/accept). Banner ini menjelaskan kenapa
              // ke driver alih-alih membiarkan mereka menebak lewat error 403.
              if (hasUnconfirmedCash) {
                return (
                  <div className="p-6 bg-red-950/40 border-2 border-red-500/50 rounded-2xl text-center text-xs text-red-300 flex flex-col items-center gap-2">
                    <span className="text-xl">🔒</span>
                    <span className="font-black text-red-200">Akun Anda Dibekukan Sementara</span>
                    <span>
                      Anda tidak akan menerima order baru (manual maupun auto-accept) sampai
                      Anda mengonfirmasi pembayaran CASH dari order sebelumnya sudah diterima.
                      Klik "Konfirmasi Cash Diterima" di atas untuk melanjutkan.
                    </span>
                  </div>
                );
              }

              return !profileData?.profile?.isOnline ? (
              <div className="p-6 bg-[#06170E] border border-dashed border-[#23583E] rounded-2xl text-center text-xs text-[#A5C9B8]">
                Silakan nyalakan status harian Anda ke **ONLINE** terlebih dahulu untuk mendeteksi lowongan pesanan aktif.
              </div>
            ) : isJobsLoading ? (
              <SkeletonList count={3} />
            ) : isJobsError ? (
              <QueryErrorState message="Gagal memuat daftar order. Periksa koneksi internet Anda." onRetry={() => refetchJobs()} />
            ) : !jobsData?.jobs || jobsData.jobs.filter((j: any) => j.status === 'PENDING').length === 0 ? (
              <div className="p-8 bg-[#06170E] border border-dashed border-[#23583E] rounded-2xl text-center text-xs text-[#A5C9B8]/70">
                Belum ada pesanan masuk saat ini di wilayah Malang Raya. Menunggu orderan baru...
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {jobsData.jobs.filter((j: any) => j.status === 'PENDING').map((job: any) => (
                  <div key={job.id} className="bg-[#06170E] border border-[#23583E] p-4 rounded-2xl flex flex-col justify-between gap-3">
                    <div>
                      <div className="flex justify-between items-center">
                        <span className="text-[10px] font-bold text-[#FFD700]">Tipe: {job.serviceType}</span>
                        <span className="text-[10px] text-gray-400">Baru</span>
                      </div>
                      <div className="text-xs text-[#A5C9B8] mt-2 flex flex-col gap-1">
                        <span className="truncate"><strong className="text-white">Jemput:</strong> {job.pickupAddress}</span>
                        <span className="truncate"><strong className="text-white">Tujuan:</strong> {job.dropoffAddress}</span>
                      </div>
                    </div>

                    <div className="flex justify-between items-center border-t border-[#23583E]/50 pt-2 mt-2">
                      <span className="font-bold text-white text-xs">{formatRupiah(Number(job.price))}</span>
                      <button
                        onClick={() => acceptJobMutation.mutate(job.id)}
                        disabled={acceptJobMutation.isPending || !!activeJob}
                        className="bg-[#00E575] hover:bg-[#00ff80] text-[#071F14] text-[10px] font-black px-3 py-1.5 rounded-lg transition-all disabled:opacity-50"
                      >
                        {acceptJobMutation.isPending ? 'Mengambil...' : 'Terima Order'}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
              );
            })()}
          </div>
        </div>

        {/* Right Column: Companion GPS Verification */}
        <div className="flex flex-col gap-6">
          <div className="bg-[#0D2E1F] border border-[#23583E] p-5 rounded-3xl flex flex-col gap-4">
            <span className="text-xs font-bold text-[#00E575] uppercase tracking-wider flex items-center gap-1.5">
              <Navigation className="w-4 h-4" /> Satelit GPS Pendamping
            </span>
            <div className="bg-[#06170E] p-4 rounded-xl border border-[#23583E] text-xs">
              <div className="flex justify-between items-center">
                <span>Instalasi Driver Companion:</span>
                <span className="text-[#00E575] font-bold">TERPASANG</span>
              </div>
              <div className="flex justify-between items-center mt-2">
                <span>Status Akun:</span>
                <span className={`font-bold ${profileData?.profile?.isVerified ? 'text-[#00E575]' : 'text-red-400'}`}>
                  {profileData?.profile?.isVerified ? 'VERIFIED (AKTIF)' : 'BELUM DIVERIFIKASI'}
                </span>
              </div>
              {!profileData?.profile?.isVerified && (
                <p className="text-[10px] text-red-300 mt-2">
                  Akun Anda belum bisa digunakan untuk menerima pesanan (Narik). Silakan minta verifikasi akun Anda pada **Dashboard Admin**.
                </p>
              )}
            </div>
          </div>

          {/* Verifikasi Dokumen: KTP+Selfie, STNK & SIM (*Wajib) */}
          <div className="bg-[#0D2E1F] border border-[#23583E] p-5 rounded-3xl flex flex-col gap-3">
            <span className="text-xs font-bold text-[#00E575] uppercase tracking-wider flex items-center gap-1.5">
              <UserCheck className="w-4 h-4" /> Verifikasi Dokumen Driver
            </span>
            <p className="text-[10px] text-[#A5C9B8]/70 -mt-1">
              Upload foto KTP + Selfie, STNK Kendaraan, dan foto SIM (*Wajib). Admin akan meninjau sebelum akun benar-benar aktif.
            </p>

            {(['KTP_SELFIE', 'STNK', 'SIM'] as const).map((docType) => {
              const existing = documentsData?.documents?.find((d: any) => d.type === docType);
              const label = docType === 'KTP_SELFIE' ? '🪪 Foto Diri + KTP (*Wajib)' : docType === 'STNK' ? '📄 Foto STNK Kendaraan (*Wajib)' : '💳 Foto SIM Driver (*Wajib)';
              return (
                <div key={docType} className="bg-[#06170E] p-3 rounded-xl border border-[#23583E] flex flex-col gap-2">
                  <div className="flex justify-between items-center">
                    <span className="text-[10px] font-bold text-white">{label}</span>
                    {existing && (
                      <span
                        className={`text-[9px] font-black px-2 py-0.5 rounded-full ${
                          existing.status === 'APPROVED'
                            ? 'bg-[#00E575]/20 text-[#00E575]'
                            : existing.status === 'REJECTED'
                            ? 'bg-red-500/20 text-red-400'
                            : 'bg-[#FFD700]/20 text-[#FFD700]'
                        }`}
                      >
                        {existing.status === 'APPROVED' ? 'DISETUJUI' : existing.status === 'REJECTED' ? 'DITOLAK' : 'DITINJAU'}
                      </span>
                    )}
                  </div>
                  {existing?.status === 'REJECTED' && (
                    <div className="flex flex-col gap-1 bg-red-500/10 border border-red-500/30 p-2 rounded-lg">
                      <span className="text-[9px] font-bold text-red-400">⚠️ Dokumen Ditolak. Silakan Unggah Berkas Perbaikan Baru:</span>
                      {existing.reviewNote && (
                        <span className="text-[9px] text-red-300">Alasan: {existing.reviewNote}</span>
                      )}
                    </div>
                  )}
                  {(!existing || existing.status === 'REJECTED') && (
                    <div className="flex flex-col gap-1 mt-1">
                      <span className="text-[9px] text-[#00E575] font-bold">
                        {existing?.status === 'REJECTED' ? '🔄 Kirim Ulang Dokumen Perbaikan:' : '📤 Pilih Berkas Foto:'}
                      </span>
                      <input
                        type="file"
                        accept="image/*"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) uploadDocumentMutation.mutate({ type: docType, file });
                        }}
                        className="text-[9px] text-[#A5C9B8] file:mr-2 file:py-1.5 file:px-2 file:rounded-lg file:border-0 file:bg-[#00E575] file:text-[#06170E] file:text-[9px] file:font-bold"
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div className="bg-[#0D2E1F] border border-[#23583E] p-5 rounded-3xl flex-1 flex flex-col gap-3">
            <span className="text-xs font-bold text-[#FFD700] uppercase tracking-wider flex items-center gap-1.5">
              <History className="w-4 h-4" /> Jurnal Transaksi Driver
            </span>

            {!profileData?.wallet?.transactions || profileData.wallet.transactions.length === 0 ? (
              <div className="text-xs text-[#A5C9B8]/60 text-center py-8 border border-dashed border-[#23583E] rounded-xl bg-[#06170E]">
                Belum ada transaksi pendapatan masuk harian.
              </div>
            ) : (
              <div className="flex flex-col gap-2 max-h-[300px] overflow-y-auto pr-1">
                {profileData.wallet.transactions.map((tx: any) => (
                  <div key={tx.id} className="bg-[#06170E] border border-[#23583E] p-2.5 rounded-xl flex justify-between items-center text-xs">
                    <div>
                      <span className="text-white font-bold block">{tx.description}</span>
                      <span className="text-[9px] text-gray-400">{new Date(tx.createdAt).toLocaleTimeString('id-ID')}</span>
                    </div>
                    <span className={`font-black ${Number(tx.amount) >= 0 ? 'text-[#00E575]' : 'text-red-400'}`}>
                      {Number(tx.amount) >= 0 ? '+' : ''}{formatRupiah(Number(tx.amount))}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <TopupModal
        isOpen={isDriverTopupModalOpen}
        onClose={() => setIsDriverTopupModalOpen(false)}
        user={user}
        initialAmount={driverTopupAmount}
        triggerToast={triggerToast}
        onSuccess={() => {
          refetchProfile();
          setDriverTopupAmount('');
        }}
      />
    </div>
  );
}
// 🆕 OPTIMASI PERFORMA: lihat komentar yang sama di CustomerApp.tsx --
// mencegah seluruh DriverApp (peta, ring loop, listener socket, dst)
// re-render setiap kali parent re-render karena alasan tidak terkait
// (mis. toast global).
export default React.memo(DriverApp);
