import React, { useState, useEffect, Suspense } from 'react';
import { socket, connectSocket, joinRoom } from "../services/socket";
import { formatRupiah } from '@obama/shared-utils';
import { playBellRingSound, startRingLoop, stopRingLoop } from '../utils/audio';
import { 
  useAuthStore 
} from '../store/useAuthStore';
import { 
  QueryClient, 
  QueryClientProvider, 
  useQuery, 
  useMutation,
  useQueryClient
} from '@tanstack/react-query';
import { 
  ShieldAlert, 
  User, 
  Bike, 
  Key, 
  RefreshCw, 
  MapPin, 
  Navigation, 
  Wallet, 
  Lock, 
  CheckCircle, 
  LogOut, 
  Smartphone, 
  Sparkles, 
  Type, 
  ChevronRight,
  Info,
  DollarSign,
  ClipboardList,
  AlertTriangle,
  UserCheck,
  UserX,
  History,
  Send,
  PlusCircle,
  TrendingUp,
  Settings,
  Percent,
  Map as MapIcon,
  Power,
  MessageCircle,
  Camera,
  QrCode,
  Copy,
  FileSpreadsheet,
  FileText,
  Clock,
  XCircle,
  Calendar,
  Users,
  BarChart2,
  Search,
  PhoneCall,
  ExternalLink
} from 'lucide-react';

// PERBAIKAN PERFORMA: CustomerApp/DriverApp/AdminApp sebelumnya adalah
// bagian dari file monolitik ini (~5100 baris total, ikut ter-download &
// ter-parse browser SEMUA sekaligus di awal walau cuma 1 role yang dipakai
// per sesi). Sekarang dipecah ke file terpisah & di-lazy-load lewat
// React.lazy() -- hanya kode role yang benar-benar dipilih user yang
// diunduh, plus library berat yang cuma dipakai 1 role (mis. recharts di
// AdminApp) tidak lagi ikut initial bundle sama sekali.
const CustomerApp = React.lazy(() => import('../pages/CustomerApp'));
const DriverApp = React.lazy(() => import('../pages/DriverApp'));
const AdminApp = React.lazy(() => import('../pages/AdminApp'));

const queryClient = new QueryClient();

/** Fallback ditampilkan sementara modul role (Customer/Driver/Admin App,
 * lazy-loaded) sedang diunduh -- hanya terjadi sekali per sesi browser
 * (setelah itu ke-cache oleh browser). */
function AppLoadingFallback() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-3 bg-[#06170E]">
      <div className="w-10 h-10 border-4 border-[#23583E] border-t-[#00E575] rounded-full animate-spin" />
      <span className="text-xs text-[#A5C9B8] animate-pulse">Memuat halaman...</span>
    </div>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <DhuknooMainAppShell />
    </QueryClientProvider>
  );
}

function DhuknooMainAppShell() {
  const {
    currentRole,
    setRole,
    useSerifFont,
    fontScale,
    toggleFontFamily,
    increaseFontScale,
    logout,
    user
  } = useAuthStore();

  const queryClient = useQueryClient();

  const [notification, setNotification] = useState<string | null>(null);

  const triggerToast = (msg: string) => {
    setNotification(msg);
    setTimeout(() => setNotification(null), 4000);
  };

  // ============================
  // Socket.IO Realtime
  // ============================
  // 1. Dedicated effect for socket connection and room registration
  useEffect(() => {
    if (!user) return;

    connectSocket();

    const registerUserAndRooms = () => {
      if (!socket.connected) return;

      console.log("✅ Socket Connected & Registering Rooms for user:", user.id, user.role);

      // Room umum untuk lacak peta driver secara live.
      joinRoom("map_updates").catch(() => {});

      // Room personal user
      joinRoom(`user_${user.id}`).catch(() => {});

      // Room driver
      if (user.role === "DRIVER") {
        joinRoom("drivers_pool").catch(() => {});
        joinRoom(`driver_${user.id}`).catch(() => {});
      }

      // Room admin
      if (user.role === "ADMIN") {
        joinRoom("admins").catch(() => {});
      }

      // Kirim event pendaftaran socket ke server
      socket.emit("register_user", {
        userId: user.id,
        role: user.role,
      });
    };

    if (socket.connected) {
      registerUserAndRooms();
    }

    socket.on("connect", registerUserAndRooms);

    return () => {
      socket.off("connect", registerUserAndRooms);
    };
  }, [user]);

  // 2. Main Socket Event Listeners Effect
  useEffect(() => {
    if (!user) return;

    const onDisconnect = () => {
      console.log("❌ Socket Disconnected");
    };

    const onDriverStatusChanged = (data: { driverId?: string; isOnline?: boolean; autoAccept?: boolean }) => {
      queryClient.invalidateQueries({ queryKey: ['driverProfile'] });
      queryClient.invalidateQueries({ queryKey: ['driverJobs'] });
      queryClient.invalidateQueries({ queryKey: ['adminDashboard'] });
    };

    const onOrderStatusChanged = (data: { orderId: string; status: string }) => {
      triggerToast(`Status order #${data.orderId?.slice(0, 8)} berubah: ${data.status}`);
      queryClient.invalidateQueries({ queryKey: ['customerOrders'] });
      queryClient.invalidateQueries({ queryKey: ['driverJobs'] });
    };

    const onOrderAccepted = (data: { orderId: string; driver?: any; order?: any; autoAccepted?: boolean }) => {
      queryClient.invalidateQueries({ queryKey: ['customerOrders'] });
      queryClient.invalidateQueries({ queryKey: ['driverJobs'] });
      queryClient.invalidateQueries({ queryKey: ['driverProfile'] });

      const currentDriverId = user?.id;
      const acceptedDriverId = data?.driver?.id || data?.order?.driverId;

      if (user?.role === 'DRIVER') {
        // PERBARUAN: matikan loop ring begitu order diterima (auto atau manual) --
        // sebelumnya bel cuma berbunyi sekali di awal jadi tidak ada loop yang
        // perlu dimatikan; sekarang WAJIB di-stop supaya tidak bunyi terus.
        stopRingLoop();
        if (!acceptedDriverId || acceptedDriverId === currentDriverId) {
          playBellRingSound();
          triggerToast(`🔔⚡ [Auto-Accept] Orderan #${data.orderId?.slice(0, 8)} DITERIMA OLEH ANDA!`);
        }
      } else if (user?.role === 'CUSTOMER') {
        triggerToast(`Order #${data.orderId?.slice(0, 8)} telah diterima oleh Mitra Driver!`);
      }
    };

    const onOrderAutoAccepted = (data: { orderId: string; driver?: any; order?: any }) => {
      queryClient.invalidateQueries({ queryKey: ['customerOrders'] });
      queryClient.invalidateQueries({ queryKey: ['driverJobs'] });
      queryClient.invalidateQueries({ queryKey: ['driverProfile'] });

      const currentDriverId = user?.id;
      const acceptedDriverId = data?.driver?.id || data?.order?.driverId;

      if (user?.role === 'DRIVER') {
        stopRingLoop();
        if (!acceptedDriverId || acceptedDriverId === currentDriverId) {
          playBellRingSound();
          triggerToast(`🔔⚡ [Auto-Accept] Orderan #${data.orderId?.slice(0, 8)} BERHASIL DITERIMA OTOMATIS!`);
        }
      }
    };

    const onOrderCompleted = (data: { orderId: string }) => {
      triggerToast(`Perjalanan #${data.orderId?.slice(0, 8)} selesai!`);
      queryClient.invalidateQueries({ queryKey: ['customerOrders'] });
      queryClient.invalidateQueries({ queryKey: ['driverJobs'] });
    };

    const onOrderCancelled = (data: { orderId: string }) => {
      triggerToast(`Order #${data.orderId?.slice(0, 8)} dibatalkan.`);
      queryClient.invalidateQueries({ queryKey: ['customerOrders'] });
      queryClient.invalidateQueries({ queryKey: ['driverJobs'] });
    };

    const onNewOrderAvailable = () => {
      // PERBAIKAN: sebelumnya publikasi order baru cuma berbunyi SEKALI SAJA
      // (sekilas, gampang terlewat kalau layar sedang tidak dilihat), lalu
      // diam lagi. Sekarang bel berbunyi TERUS MENERUS di volume paling
      // keras (startRingLoop) sampai order diterima otomatis ATAU driver
      // tap "Terima Order" manual -- di-stop lewat stopRingLoop() pada
      // onOrderAccepted/onOrderAutoAccepted/onOrderTaken/acceptJobMutation.
      if (user.role === 'DRIVER') {
        startRingLoop();
        triggerToast('🔔 Ada lowongan order baru masuk!');
      }
      queryClient.invalidateQueries({ queryKey: ['driverJobs'] });
    };

    const onOrderTaken = () => {
      if (user?.role === 'DRIVER') {
        stopRingLoop();
      }
      queryClient.invalidateQueries({ queryKey: ['driverJobs'] });
    };

    const onPaymentReceived = (data: { orderId: string }) => {
      triggerToast(`💰 Pembayaran order #${data.orderId?.slice(0, 8)} masuk ke wallet Anda!`);
      queryClient.invalidateQueries({ queryKey: ['driverProfile'] });
      queryClient.invalidateQueries({ queryKey: ['driverJobs'] });
    };

    const onPaymentConfirmed = (data: { orderId: string }) => {
      triggerToast(`✅ Pembayaran order #${data.orderId?.slice(0, 8)} berhasil dikonfirmasi!`);
      queryClient.invalidateQueries({ queryKey: ['customerOrders'] });
      queryClient.invalidateQueries({ queryKey: ['customerProfile'] });
    };

    const onOrderPaid = () => {
      queryClient.invalidateQueries({ queryKey: ['customerOrders'] });
      queryClient.invalidateQueries({ queryKey: ['driverJobs'] });
      queryClient.invalidateQueries({ queryKey: ['pendingProofs'] });
      queryClient.invalidateQueries({ queryKey: ['adminDashboard'] });
    };

    const onOrderCreated = () => {
      queryClient.invalidateQueries({ queryKey: ['adminDashboard'] });
      queryClient.invalidateQueries({ queryKey: ['driverJobs'] });
    };

    const onNewChatMessage = (data: { orderId: string; message: string; senderRole: string }) => {
      triggerToast(`💬 Pesan baru (${data.senderRole}): ${data.message}`);
    };

    const onForcedOffline = (data: { reason: string }) => {
      triggerToast(`⚠️ ${data.reason}`);
      queryClient.invalidateQueries({ queryKey: ['driverProfile'] });
    };

    socket.on("disconnect", onDisconnect);
    socket.on("driver_status_changed", onDriverStatusChanged);
    socket.on("order_status_changed", onOrderStatusChanged);
    socket.on("order_accepted", onOrderAccepted);
    socket.on("order_auto_accepted", onOrderAutoAccepted);
    socket.on("order_completed", onOrderCompleted);
    socket.on("order_cancelled", onOrderCancelled);
    socket.on("new_order_available", onNewOrderAvailable);
    socket.on("order_taken", onOrderTaken);
    socket.on("payment_received", onPaymentReceived);
    socket.on("payment_confirmed", onPaymentConfirmed);
    socket.on("order_paid", onOrderPaid);
    socket.on("order_created", onOrderCreated);
    socket.on("new_chat_message", onNewChatMessage);
    socket.on("forced_offline", onForcedOffline);

    return () => {
      socket.off("disconnect", onDisconnect);
      socket.off("driver_status_changed", onDriverStatusChanged);
      socket.off("order_status_changed", onOrderStatusChanged);
      socket.off("order_accepted", onOrderAccepted);
      socket.off("order_auto_accepted", onOrderAutoAccepted);
      socket.off("order_completed", onOrderCompleted);
      socket.off("order_cancelled", onOrderCancelled);
      socket.off("new_order_available", onNewOrderAvailable);
      socket.off("order_taken", onOrderTaken);
      socket.off("payment_received", onPaymentReceived);
      socket.off("payment_confirmed", onPaymentConfirmed);
      socket.off("order_paid", onOrderPaid);
      socket.off("order_created", onOrderCreated);
      socket.off("new_chat_message", onNewChatMessage);
      socket.off("forced_offline", onForcedOffline);
      // Cegah interval ring loop menggantung (bunyi terus) kalau komponen
      // unmount / user logout / pindah tab saat bel sedang berbunyi.
      stopRingLoop();
    };
  }, [user, queryClient]);

  const fontStyle = {
    fontFamily: useSerifFont
      ? '"Times New Roman", Times, serif'
      : 'system-ui, -apple-system, sans-serif',
    fontSize: `${fontScale * 100}%`,
  };

  return (
    <div 
      style={fontStyle} 
      className="min-h-screen bg-[#06170E] text-[#E4F3EC] flex flex-col transition-all duration-300 relative selection:bg-[#00E575] selection:text-[#071F14]"
    >
      {/* Toast Notification Banner */}
      {notification && (
        <div className="fixed top-6 left-1/2 transform -translate-x-1/2 z-50 w-full max-w-md px-4 animate-bounce">
          <div className="bg-[#00E575] text-[#071F14] px-6 py-4 rounded-2xl shadow-2xl font-bold flex items-center gap-3 border-2 border-[#FFD700]">
            <Sparkles className="w-5 h-5 shrink-0 animate-spin" />
            <span>{notification}</span>
          </div>
        </div>
      )}

      {/* Header Bar */}
      <header className="bg-[#0D2E1F] border-b border-[#23583E] py-4 px-6 sticky top-0 z-40">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3 cursor-pointer" onClick={() => setRole(null)}>
            <div className="w-10 h-10 bg-[#FFD700] rounded-xl flex items-center justify-center font-bold text-xl text-[#071F14]">
              🍏
            </div>
            <div>
              <span className="text-xl font-black text-[#FFD700]">DHUKNOO <span className="text-[#00E575]">Platform</span></span>
              <span className="hidden sm:inline text-xs text-[#A5C9B8]/80 block -mt-1 font-semibold">Ojek Batu - Malang Raya</span>
            </div>
          </div>

          <div className="flex items-center gap-3 sm:gap-4">
            {user && (
              <div className="hidden md:flex flex-col items-end text-right">
                <div className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-[#00E575] animate-pulse"></span>
                  <span className="text-xs font-bold text-white">{user.fullName}</span>
                </div>
                <span className="text-[10px] text-[#00E575] font-semibold bg-[#00E575]/10 px-1.5 py-0.5 rounded border border-[#00E575]/30 mt-0.5">
                  🔒 Sesi Aktif ({user.role})
                </span>
              </div>
            )}
            {currentRole && (
              <button
                onClick={() => {
                  const confirmLogout = window.confirm(
                    `🔒 KONFIRMASI KELUAR SESI:\n\nSesi ${user?.fullName || 'Akun'} saat ini dijaga tetap log-in untuk memastikan kelancaran proses penyelesaian order & konfirmasi transaksi pembayaran.\n\nApakah Anda yakin ingin membatalkan/keluar dari sesi dashboard sekarang?`
                  );
                  if (confirmLogout) {
                    logout();
                    setRole(null);
                    triggerToast('Sesi ditutup. Kembali ke Launcher Hub.');
                  }
                }}
                className="flex items-center gap-2 bg-red-500/10 hover:bg-red-500/20 text-red-400 text-xs font-bold py-2 px-3 rounded-xl border border-red-500/30 transition-all cursor-pointer"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>Ganti Akun</span>
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="flex-1 flex flex-col">
        {!currentRole ? (
          // Launcher Hub
          <LauncherHub 
            onSelectRole={(role) => {
              // Reset credentials on role change to ensure sterile environment
              logout();
              setRole(role);
            }}
            useSerifFont={useSerifFont}
            fontScale={fontScale}
            onToggleFont={toggleFontFamily}
            onIncreaseFont={increaseFontScale}
          />
        ) : (
          <Suspense fallback={<AppLoadingFallback />}>
            {currentRole === 'CUSTOMER' ? (
              <CustomerApp onBack={() => setRole(null)} triggerToast={triggerToast} />
            ) : currentRole === 'DRIVER' ? (
              <DriverApp onBack={() => setRole(null)} triggerToast={triggerToast} />
            ) : (
              <AdminApp onBack={() => setRole(null)} triggerToast={triggerToast} />
            )}
          </Suspense>
        )}
      </main>

      {/* Architectural Diagram Info Button */}
      <footer className="bg-[#05110A] border-t border-[#23583E]/50 py-6 text-center text-xs text-[#A5C9B8]/60">
        <div className="max-w-4xl mx-auto px-4 flex flex-col gap-2">
          <div className="font-semibold text-[#00E575] flex items-center justify-center gap-2">
            <Info className="w-4 h-4" />
            <span>Arsitektur DHUKNOO: Single Backend API - Multi-Client Portals (Customer, Driver, Admin)</span>
          </div>
          <p className="leading-relaxed">
            Dipisahkan secara penuh berdasarkan **Otorisasi Role**, **Hak Akses Permission**, **Endpoint API Mandiri**, dan **Antarmuka Layar Screen** untuk mengeliminasi kebocoran otentikasi data antar user.
          </p>
        </div>
      </footer>
    </div>
  );
}

/* ==========================================================================
   1. LAUNCHER HUB
   ========================================================================== */
interface LauncherProps {
  onSelectRole: (role: 'CUSTOMER' | 'DRIVER' | 'ADMIN') => void;
  useSerifFont: boolean;
  fontScale: number;
  onToggleFont: () => void;
  onIncreaseFont: () => void;
}

function LauncherHub({ onSelectRole, useSerifFont, fontScale, onToggleFont, onIncreaseFont }: LauncherProps) {
  // BARU: dashboard admin disembunyikan dari grid utama (item #7) — hanya
  // muncul lewat cara tertentu: klik logo 5x dalam 2 detik, ATAU buka dengan
  // parameter URL ?portal=admin. Sekadar tahu URL app-nya saja TIDAK cukup
  // untuk login sebagai admin — tetap wajib passkey (lihat pengecekan di
  // handleSubmit, sekarang berlaku juga saat LOGIN, bukan cuma registrasi).
  const [adminAccessRevealed, setAdminAccessRevealed] = useState(
    () => new URLSearchParams(window.location.search).get('portal') === 'admin'
  );
  const logoClickCountRef = React.useRef(0);
  const logoClickTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleLogoClick = () => {
    logoClickCountRef.current += 1;
    if (logoClickTimerRef.current) clearTimeout(logoClickTimerRef.current);
    logoClickTimerRef.current = setTimeout(() => {
      logoClickCountRef.current = 0;
    }, 2000);
    if (logoClickCountRef.current >= 5) {
      setAdminAccessRevealed(true);
      logoClickCountRef.current = 0;
    }
  };

  return (
    <div className="w-full max-w-5xl mx-auto px-4 py-8 md:py-16 flex flex-col gap-10 flex-1 justify-center">
      {/* Brand Header */}
      <div className="text-center flex flex-col items-center gap-4">
        <div className="relative" onClick={handleLogoClick}>
          <div className="w-24 h-24 bg-[#FFD700] border-4 border-[#00E575] rounded-3xl flex items-center justify-center shadow-2xl text-5xl transform hover:rotate-12 transition-transform duration-300 cursor-pointer select-none">
            🍏
          </div>
          <span className="absolute -top-2 -right-2 bg-red-500 text-white font-black text-[10px] px-2 py-0.5 rounded-full uppercase tracking-widest animate-pulse border border-white">
            V2 Real API
          </span>
        </div>
        <div>
          <h1 className="text-4xl md:text-6xl font-black tracking-tight text-[#FFD700]">
            DHUKNOO <span className="text-[#00E575]">Ride</span>
          </h1>
          <p className="text-[#A5C9B8] font-bold text-xl mt-1">Ojek Batu - Malang Raya Terpadu</p>
        </div>
        <p className="max-w-2xl text-sm md:text-base text-[#A5C9B8]/80 leading-relaxed">
          Refaktorisasi platform dengan Arsitektur Unified Backend & Dedicated Client Portals. Menggunakan PostgreSQL + Prisma, JWT State Otorisasi, dan logging audit.
        </p>
      </div>

      {/* Accessibility Controls Panel */}
      <div className="bg-[#0D2E1F] border border-[#23583E] rounded-3xl p-6 shadow-2xl flex flex-col gap-4">
        <div className="flex items-center gap-2 text-[#FFD700]">
          <Type className="w-5 h-5" />
          <h2 className="font-bold text-lg">Pengaturan Tampilan & Aksesibilitas</h2>
        </div>
        <p className="text-xs text-[#A5C9B8]/80 -mt-2">
          Ganti jenis huruf antara Sans-Serif (Arial) untuk modernitas atau Serif (Times New Roman) untuk kenyamanan baca, serta atur ukuran teks demi aksesibilitas optimal.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-1">
          {/* Font Type Selection */}
          <div className="flex flex-col gap-2">
            <span className="text-xs font-bold text-[#A5C9B8]">Jenis Huruf (Font Family)</span>
            <div className="grid grid-cols-2 gap-2">
              <button 
                onClick={onToggleFont}
                className={`py-2.5 px-3 rounded-xl border text-sm font-bold transition-all ${
                  !useSerifFont 
                    ? 'bg-[#23583E] border-[#00E575] text-[#00E575]' 
                    : 'bg-[#06170E] border-[#23583E] text-[#A5C9B8] hover:border-[#00E575]'
                }`}
              >
                Arial (Sans-Serif)
              </button>
              <button 
                onClick={onToggleFont}
                className={`py-2.5 px-3 rounded-xl border text-sm font-bold transition-all ${
                  useSerifFont 
                    ? 'bg-[#23583E] border-[#00E575] text-[#00E575]' 
                    : 'bg-[#06170E] border-[#23583E] text-[#A5C9B8] hover:border-[#00E575]'
                }`}
                style={{ fontFamily: 'Georgia, serif' }}
              >
                Times New Roman
              </button>
            </div>
          </div>

          {/* Font Size Scaling */}
          <div className="flex flex-col gap-2 justify-between">
            <span className="text-xs font-bold text-[#A5C9B8]">Ukuran Font Pembesaran</span>
            <div className="flex items-center justify-between bg-[#06170E] border border-[#23583E] rounded-xl px-4 py-2">
              <span className="text-xs text-[#A5C9B8]/80">Skala Saat Ini: {Math.round(fontScale * 100)}%</span>
              <button 
                onClick={onIncreaseFont}
                className="bg-[#00E575] text-[#071F14] px-4 py-1.5 rounded-lg text-xs font-black hover:bg-[#00ff80] transition-all transform active:scale-95"
              >
                Ubah Ukuran
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Grid of Modular Sub-Apps */}
      <div className="flex flex-col gap-4">
        <h3 className="font-bold text-lg text-[#FFD700] px-1 text-center sm:text-left">Pilih Portal Aplikasi Client</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          
          {/* Card Customer */}
          <div 
            onClick={() => onSelectRole('CUSTOMER')}
            className="bg-[#0D2E1F] border border-[#23583E] hover:border-[#FFD700] hover:shadow-[0_0_15px_rgba(255,215,0,0.15)] p-6 rounded-3xl cursor-pointer transition-all hover:-translate-y-1.5 flex flex-col justify-between gap-6"
          >
            <div>
              <div className="w-12 h-12 bg-[#FFD700]/10 text-[#FFD700] rounded-2xl flex items-center justify-center mb-4 border border-[#FFD700]/20">
                <User className="w-6 h-6" />
              </div>
              <h4 className="font-black text-xl text-white flex items-center gap-2">
                <span>Dhuknoo Customer</span>
                <span className="bg-[#FFD700]/20 text-[#FFD700] text-[9px] px-1.5 py-0.5 rounded-md">Android/Web</span>
              </h4>
              <p className="text-xs text-[#A5C9B8] mt-2 leading-relaxed">
                Portal ojek & pengiriman barang. Lakukan isi saldo (top up) dompet digital terpusat, pesan perjalanan cepat, dan monitor riwayat order aktif.
              </p>
            </div>
            <div className="flex items-center justify-between text-xs font-bold text-[#FFD700] pt-4 border-t border-[#23583E]/50">
              <span>Buka Aplikasi Customer</span>
              <ChevronRight className="w-4 h-4" />
            </div>
          </div>

          {/* Card Driver */}
          <div 
            onClick={() => onSelectRole('DRIVER')}
            className="bg-[#0D2E1F] border border-[#23583E] hover:border-[#00E575] hover:shadow-[0_0_15px_rgba(0,229,117,0.15)] p-6 rounded-3xl cursor-pointer transition-all hover:-translate-y-1.5 flex flex-col justify-between gap-6"
          >
            <div>
              <div className="w-12 h-12 bg-[#00E575]/10 text-[#00E575] rounded-2xl flex items-center justify-center mb-4 border border-[#00E575]/20">
                <Bike className="w-6 h-6" />
              </div>
              <h4 className="font-black text-xl text-white flex items-center gap-2">
                <span>Dhuknoo Driver</span>
                <span className="bg-[#00E575]/20 text-[#00E575] text-[9px] px-1.5 py-0.5 rounded-md">Android</span>
              </h4>
              <p className="text-xs text-[#A5C9B8] mt-2 leading-relaxed">
                Portal khusus mitra pengemudi. Lacak lowongan pesanan terdekat, terima orderan secara realtime, atur status online, dan terima deposit saldo harian.
              </p>
            </div>
            <div className="flex items-center justify-between text-xs font-bold text-[#00E575] pt-4 border-t border-[#23583E]/50">
              <span>Buka Portal Mitra Driver</span>
              <ChevronRight className="w-4 h-4" />
            </div>
          </div>

          {/* Card Admin — HANYA muncul kalau adminAccessRevealed (klik logo 5x
              atau URL ?portal=admin). Sebelumnya kartu ini selalu tampil ke
              siapa pun yang buka halaman utama. */}
          {adminAccessRevealed && (
          <div 
            onClick={() => onSelectRole('ADMIN')}
            className="bg-[#0D2E1F] border border-[#23583E] hover:border-red-500 hover:shadow-[0_0_15px_rgba(239,68,68,0.15)] p-6 rounded-3xl cursor-pointer transition-all hover:-translate-y-1.5 flex flex-col justify-between gap-6"
          >
            <div>
              <div className="w-12 h-12 bg-red-500/10 text-red-400 rounded-2xl flex items-center justify-center mb-4 border border-red-500/20">
                <ShieldAlert className="w-6 h-6" />
              </div>
              <h4 className="font-black text-xl text-white flex items-center gap-2">
                <span>Dhuknoo Admin</span>
                <span className="bg-red-500/20 text-red-400 text-[9px] px-1.5 py-0.5 rounded-md">Web Panel</span>
              </h4>
              <p className="text-xs text-[#A5C9B8] mt-2 leading-relaxed">
                Panel kontrol administrasi. Menampilkan ringkasan audit finansial platform, verifikasi pendaftaran mitra pengemudi baru, dan akses data logs terpusat.
              </p>
            </div>
            <div className="flex items-center justify-between text-xs font-bold text-red-400 pt-4 border-t border-[#23583E]/50">
              <span>Buka Dashboard Admin</span>
              <ChevronRight className="w-4 h-4" />
            </div>
          </div>
          )}

        </div>
      </div>
    </div>
  );
}

