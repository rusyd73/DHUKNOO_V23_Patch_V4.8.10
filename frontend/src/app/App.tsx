// src/app/App.tsx
import React, { useState, useEffect, Suspense } from 'react';
import { socket, connectSocket } from "../services/socket";
import { startProactiveTokenRefresh, stopProactiveTokenRefresh } from "../api/apiClient";
import { ErrorBoundary } from "../components/common/ErrorBoundary";
import { OfflineBanner } from "../components/common/OfflineBanner";
import { BrandMark } from "../components/common/BrandMark";
import PublicExperience from '../pages/public/PublicExperience';
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
  Store,
  ShoppingBag,
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
  Sun,
  Moon,
  ChevronRight,
  ChevronDown,
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

// ============================================
// LAZY LOADED COMPONENTS
// ============================================
const CustomerApp = React.lazy(() => import('../pages/CustomerApp'));
const DriverApp = React.lazy(() => import('../pages/DriverApp'));
const AdminApp = React.lazy(() => import('../pages/AdminApp'));
const MerchantApp = React.lazy(() => import('../pages/MerchantApp'));

// 🆕 OPTIMASI PERFORMA: sebelumnya `new QueryClient()` tanpa config sama
// sekali, artinya staleTime default 0 -- SETIAP kali komponen mount/
// remount (mis. pindah tab lalu balik lagi), React Query langsung
// refetch walau datanya baru saja diambil beberapa detik lalu. Karena app
// ini sudah punya socket-driven `invalidateQueries()` untuk update
// realtime (order diterima, order baru, dst -- lihat DriverApp/
// MerchantApp/CustomerApp), staleTime 0 jadi mubazir: query yang sama
// bisa fetch ulang lewat network padahal datanya sudah pasti fresh dari
// event socket. `mutations.retry: 0` sengaja BUKAN default (yang bernilai
// 0 juga secara default, tapi dipertegas di sini) -- retry otomatis pada
// mutasi (create order, charge payment, dst) BERBAHAYA: kalau request
// pertama sebenarnya berhasil di server tapi response-nya tidak sampai ke
// client (timeout jaringan), retry otomatis bisa menyebabkan aksi
// terkirim dua kali (order dobel, pembayaran dobel).
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000, // data dianggap fresh 30 detik sebelum refetch otomatis
      gcTime: 5 * 60_000, // cache disimpan 5 menit setelah tidak dipakai (default)
      refetchOnWindowFocus: true,
      retry: 2,
      retryDelay: (attempt: number) => Math.min(1000 * 2 ** attempt, 10_000),
    },
    mutations: {
      retry: 0,
    },
  },
});

// ============================================
// LOADING FALLBACK
// ============================================
function AppLoadingFallback() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-3 bg-[#06170E]">
      <div className="w-10 h-10 border-4 border-[#23583E] border-t-[#A6E22E] rounded-full animate-spin" />
      <span className="text-xs text-[#A5C9B8] animate-pulse">Memuat halaman...</span>
    </div>
  );
}

// ============================================
// MAIN APP COMPONENT
// ============================================
export default function App() {
  // Public Experience routes must be resolved before the operational
  // Customer/Driver/Merchant/Admin launcher. Nginx serves the SPA for
  // direct URLs, so routing here ensures /public, /survey and /beta do
  // not fall through to the main dashboard. Query strings are ignored
  // because window.location.pathname contains only the URL path.
  const normalizedPath = (window.location.pathname.replace(/\/+$/, '') || '/').toLowerCase();
  const isPublicExperience = ['/public', '/survey', '/beta'].includes(normalizedPath);

  if (isPublicExperience) {
    return <PublicExperience />;
  }

  return (
    <QueryClientProvider client={queryClient}>
      <ErrorBoundary boundaryName="Aplikasi DHUKNOO">
        <OfflineBanner />
        <DhuknooMainAppShell />
      </ErrorBoundary>
    </QueryClientProvider>
  );
}

// ============================================
// MAIN APP SHELL
// ============================================
function DhuknooMainAppShell() {
  const {
    currentRole,
    setRole,
    useSerifFont,
    fontScale,
    toggleFontFamily,
    increaseFontScale,
    logout,
    user,
    theme,
    setTheme
  } = useAuthStore();

  const queryClient = useQueryClient();

  const [notification, setNotification] = useState<string | null>(null);

  // 🆕 OPTIMASI PERFORMA: useCallback supaya referensi fungsi ini STABIL
  // antar render. Sebelumnya didefinisikan ulang setiap render
  // DhuknooMainAppShell (root shell yang sering re-render karena socket
  // event, notifikasi, dll) dan diteruskan sebagai prop ke SEMUA halaman
  // role (CustomerApp/DriverApp/MerchantApp/AdminApp) -- kalau halaman-
  // halaman itu dibungkus React.memo(), referensi prop yang selalu
  // berubah ini akan tetap memicu re-render setiap kali, meniadakan
  // manfaat memo. Dependency array kosong karena hanya memakai `setState`
  // (stabil dari React, tidak perlu di-declare).
  const triggerToast = React.useCallback((msg: string) => {
    setNotification(msg);
    setTimeout(() => setNotification(null), 4000);
  }, []);

  // 🆕 Sama seperti triggerToast di atas — dulu `() => setRole(null)` ditulis
  // inline di setiap `<XxxApp onBack={...} />` di bawah, jadi referensi baru
  // setiap render walau perilakunya selalu sama.
  const handleBackToLauncher = React.useCallback(() => setRole(null), [setRole]);

  // ============================================
  // SOCKET CONNECTION
  // ============================================
  useEffect(() => {
    if (user?.id) {
      connectSocket(user.id);
      startProactiveTokenRefresh();
      // PERBAIKAN: room pribadi user SUDAH otomatis di-join backend saat
      // connect (`socket.join(\`user_${user.id}\`)` — lihat backend
      // src/websocket/socket.ts). joinRoom(user.id) sebelumnya mencoba
      // join room bernama ID mentah (tanpa prefix "user_"), yang selalu
      // ditolak canJoinRoom (fail-closed default) dan cuma menghasilkan
      // error di console tanpa manfaat apa pun.
    }
    return () => {
      stopProactiveTokenRefresh();
      if (socket) {
        socket.disconnect();
      }
    };
  }, [user?.id]);

  // ============================================
  // FONT STYLE
  // ============================================
  const fontStyle = {
    fontFamily: useSerifFont
      ? '"Times New Roman", Times, serif'
      : 'system-ui, -apple-system, sans-serif',
    fontSize: `${fontScale * 100}%`,
  };

  // ============================================
  // THEME CLASSES
  // ============================================
  const isLight = theme === 'light';
  const bgClass = isLight ? 'bg-[#F5F9F7]' : 'bg-[#06170E]';
  const textClass = isLight ? 'text-[#0A2B1D]' : 'text-[#E4F3EC]';
  const headerBgClass = isLight 
    ? 'bg-white/90 backdrop-blur-md border-b border-[#D2E5DB]' 
    : 'bg-[#0B2318]/90 backdrop-blur-md border-b border-[#1A4533]';
  const footerBgClass = isLight 
    ? 'bg-[#E8F3ED] border-t border-[#D2E5DB]' 
    : 'bg-[#05110A] border-t border-[#23583E]/50';

  return (
    <div 
      style={fontStyle} 
      className={`min-h-screen ${bgClass} ${textClass} flex flex-col transition-all duration-300 relative selection:bg-[#A6E22E] selection:text-[#071F14]`}
    >
      {/* ==========================================
          TOAST NOTIFICATION
          🆕 FIX (percobaan ke-2): pola sebelumnya (`left-4 right-4
          mx-auto max-w-md` pada elemen `fixed` yang SAMA) masih bisa
          "over-constrained" di sebagian browser -- kalau `left`, `right`,
          DAN `width/max-width` semuanya diset eksplisit pada elemen fixed
          yang sama, mesin render boleh mengabaikan salah satunya, jadi
          box tetap bisa nempel ke kanan & terpotong seperti yang terlihat
          di screenshot. Sekarang dipisah jadi 2 layer (pola yang dipakai
          hampir semua library toast profesional seperti react-hot-toast/
          sonner): elemen `fixed` LUAR melebar penuh dari tepi kiri ke
          kanan viewport TANPA width sendiri (`inset-x-0`), lalu di
          dalamnya pakai flexbox (`flex justify-center`) untuk menengahkan
          kotak hijau (`max-w-md w-full`) sebagai child. Flexbox centering
          semacam ini tidak bisa "over-constrained" seperti kombinasi
          left/right/margin di atas -- dijamin selalu center & tidak
          pernah terpotong di layar berapa pun. */}
      {notification && (
        <div className="fixed inset-x-0 top-4 z-[200] flex justify-center px-4 pointer-events-none">
          <div className="pointer-events-auto w-full max-w-md animate-bounce">
            <div className="bg-[#A6E22E] text-[#071F14] px-5 py-4 rounded-2xl shadow-2xl font-bold flex items-start gap-3 border-2 border-[#F59E0B]">
              <Sparkles className="w-5 h-5 shrink-0 mt-0.5 animate-spin" />
              <span className="break-words leading-snug">{notification}</span>
            </div>
          </div>
        </div>
      )}

      {/* ==========================================
          HEADER
          ========================================== */}
      <header className={`${headerBgClass} py-3.5 px-6 sticky top-0 z-40 transition-all`}>
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3 cursor-pointer group" onClick={() => setRole(null)}>
            <div className={`w-10 h-10 ${isLight ? 'bg-[#A6E22E]/20 border-[#A6E22E]/40 text-[#0A2B1D]' : 'bg-gradient-to-br from-[#103D27] to-[#0B2318] border-[#A6E22E]/30 text-[#A6E22E]'} border rounded-xl flex items-center justify-center shadow-lg group-hover:scale-105 transition-transform p-2`}>
              <BrandMark className="w-full h-full" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className={`text-xl font-black tracking-tight font-heading ${isLight ? 'text-[#0A2B1D]' : 'text-white'}`}>
                  DHUKNOO <span className="text-[#A6E22E]">Platform</span>
                </span>
              </div>
              <span className={`hidden sm:block text-xs ${isLight ? 'text-[#38604E]/70' : 'text-[#A5C9B8]/70'} font-medium`}>
                Batu - Malang Raya
              </span>
            </div>
          </div>

          <div className="flex items-center gap-3 sm:gap-4">
            {user && (
              <div className="hidden md:flex flex-col items-end text-right">
                <div className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-[#A6E22E] animate-pulse"></span>
                  <span className={`text-xs font-bold ${isLight ? 'text-[#0A2B1D]' : 'text-white'}`}>
                    {user.fullName}
                  </span>
                </div>
                <span className={`${isLight ? 'bg-[#A6E22E]/10 text-[#A6E22E] border-[#A6E22E]/30' : 'bg-[#A6E22E]/10 text-[#A6E22E] border-[#A6E22E]/30'} text-[10px] font-semibold px-2 py-0.5 rounded-md border mt-0.5`}>
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
                className="flex items-center gap-2 bg-red-500/10 hover:bg-red-500/20 text-red-400 text-xs font-bold py-2 px-3.5 rounded-xl border border-red-500/30 transition-all cursor-pointer hover:shadow-lg active:scale-95"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>Ganti Akun</span>
              </button>
            )}
          </div>
        </div>
      </header>

      {/* ==========================================
          MAIN CONTENT
          ========================================== */}
      <main className="flex-1 flex flex-col">
        {!currentRole ? (
          <LauncherHub 
            onSelectRole={(role) => {
              logout();
              setRole(role);
            }}
            useSerifFont={useSerifFont}
            fontScale={fontScale}
            onToggleFont={toggleFontFamily}
            onIncreaseFont={increaseFontScale}
            theme={theme}
            setTheme={setTheme}
          />
        ) : (
          <Suspense fallback={<AppLoadingFallback />}>
            {currentRole === 'CUSTOMER' && (
              <ErrorBoundary boundaryName="Dashboard Customer">
                <CustomerApp onBack={handleBackToLauncher} triggerToast={triggerToast} />
              </ErrorBoundary>
            )}
            {currentRole === 'DRIVER' && (
              <ErrorBoundary boundaryName="Dashboard Driver">
                <DriverApp onBack={handleBackToLauncher} triggerToast={triggerToast} />
              </ErrorBoundary>
            )}
            {currentRole === 'MERCHANT' && (
              <ErrorBoundary boundaryName="Dashboard Merchant">
                <MerchantApp onBack={handleBackToLauncher} triggerToast={triggerToast} />
              </ErrorBoundary>
            )}
            {currentRole === 'ADMIN' && (
              <ErrorBoundary boundaryName="Dashboard Admin">
                <AdminApp onBack={handleBackToLauncher} triggerToast={triggerToast} />
              </ErrorBoundary>
            )}
          </Suspense>
        )}
      </main>

      {/* ==========================================
          FOOTER
          🆕 Disederhanakan: sebelumnya menampilkan detail teknis
          arsitektur (Single Backend API, pemisahan role, dst) yang tidak
          perlu tampil ke pengguna akhir di semua dashboard. Sekarang
          cukup atribusi tim + hak cipta, konsisten di dashboard utama,
          Customer, Driver, dan Merchant (footer ini satu-satunya
          implementasi, dipakai bersama oleh semua dashboard).
          ========================================== */}
      <footer className={`${footerBgClass} py-6 text-center text-xs ${isLight ? 'text-[#38604E]/60' : 'text-[#A5C9B8]/60'}`}>
        <div className="max-w-4xl mx-auto px-4">
          <p className="italic">@Arsitektur Team Dhuknoo</p>
          <p>Dilindungi oleh Hak Cipta 2026.</p>
        </div>
      </footer>
    </div>
  );
}

// ============================================
// LAUNCHER HUB (Dashboard Utama)
// ============================================
interface LauncherProps {
  onSelectRole: (role: 'CUSTOMER' | 'DRIVER' | 'MERCHANT' | 'ADMIN') => void;
  useSerifFont: boolean;
  fontScale: number;
  onToggleFont: () => void;
  onIncreaseFont: () => void;
  theme: 'light' | 'dark';
  setTheme: (theme: 'light' | 'dark') => void;
}

function LauncherHub({ 
  onSelectRole, 
  useSerifFont, 
  fontScale, 
  onToggleFont, 
  onIncreaseFont,
  theme,
  setTheme
}: LauncherProps) {
  const [adminAccessRevealed, setAdminAccessRevealed] = useState(
    () => new URLSearchParams(window.location.search).get('portal') === 'admin'
  );
  // 🆕 AUTO-HIDE: panel "Pengaturan Tampilan & Aksesibilitas" sebelumnya
  // SELALU terbuka penuh di dashboard utama (Launcher), padahal ini cuma
  // pengaturan pendukung (tema/font), bukan aksi utama (pilih portal
  // client). Sekarang disembunyikan otomatis secara default & baru
  // terbuka kalau user sengaja mengetuk tombolnya — dashboard utama jadi
  // lebih ringkas & fokus ke "Pilih Portal Client".
  const [showAccessibilitySettings, setShowAccessibilitySettings] = useState(false);
  const logoClickCountRef = React.useRef(0);
  const logoClickTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const isLight = theme === 'light';
  const cardBgClass = isLight ? 'bg-white/80' : 'glass-card';
  const cardBorderClass = isLight ? 'border-[#D2E5DB]' : 'border-[#23583E]/60';
  const cardHoverBorderClass = isLight ? 'hover:border-[#A6E22E]' : 'hover:border-[#A6E22E]/80';
  const textMutedClass = isLight ? 'text-[#38604E]' : 'text-[#A5C9B8]';
  const textMutedLightClass = isLight ? 'text-[#38604E]/80' : 'text-[#A5C9B8]/80';

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
    <div className="w-full max-w-6xl mx-auto px-4 py-8 md:py-14 flex flex-col gap-10 flex-1 justify-center">
      {/* ==========================================
          BRAND HEADER
          ========================================== */}
      <div className="text-center flex flex-col items-center gap-4 relative">
        <div className="relative cursor-pointer group" onClick={handleLogoClick}>
          <div className={`w-20 h-20 md:w-24 md:h-24 ${isLight ? 'bg-[#A6E22E]/20 border-[#A6E22E]/40 text-[#0A2B1D]' : 'bg-gradient-to-br from-[#1B4D33] via-[#103D27] to-[#0A2318] border-[#A6E22E]/40 text-[#A6E22E]'} border-2 rounded-3xl flex items-center justify-center shadow-2xl transform group-hover:scale-105 group-hover:rotate-6 transition-all duration-300 select-none p-5`}>
            <BrandMark className="w-full h-full" />
          </div>
          <span className="absolute -top-2 -right-3 bg-gradient-to-r from-[#A6E22E] to-[#8BCF1A] text-[#05110A] font-black text-[10px] px-2.5 py-0.5 rounded-full uppercase tracking-wider shadow-md border border-[#A6E22E]/50">
            v2.5 Live
          </span>
        </div>
        <div>
          <h1 className={`text-4xl md:text-6xl font-black tracking-tight ${isLight ? 'text-[#0A2B1D]' : 'text-white'} font-heading`}>
            DHUKNOO <span className="text-[#A6E22E]">Ride</span>
          </h1>
          <p className={`${textMutedClass} font-bold text-lg md:text-xl mt-1 tracking-wide`}>
            Batu — Malang Raya
          </p>
        </div>
        <p className={`max-w-2xl text-xs md:text-sm ${textMutedLightClass} leading-relaxed`}>
          Platform layanan Ride (motor/mobil), Food, Merchant, dan Send.
		  Lebih Dekat, Terjangkau, Lebih Adil
        </p>
      </div>

      {/* ==========================================
          ACCESSIBILITY CONTROLS (HANYA DI DASHBOARD UTAMA)
          🆕 AUTO-HIDE: konten pengaturan (theme/font/skala) disembunyikan
          secara default, hanya header ringkas + badge mode aktif yang
          selalu terlihat. Klik header untuk expand/collapse.
          ========================================== */}
      <div className={`${cardBgClass} rounded-3xl p-6 shadow-xl flex flex-col gap-4 border ${cardBorderClass}`}>
        <button
          type="button"
          onClick={() => setShowAccessibilitySettings((v) => !v)}
          aria-expanded={showAccessibilitySettings}
          className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-left cursor-pointer"
        >
          <div className="flex items-center gap-2 text-[#A6E22E]">
            <Type className="w-5 h-5" />
            <h2 className={`font-bold text-base md:text-lg ${isLight ? 'text-[#0A2B1D]' : 'text-white'} font-heading`}>
              Pengaturan Tampilan & Aksesibilitas
            </h2>
          </div>
          <div className="flex items-center gap-2">
            <span className={`text-xs font-bold px-3 py-1.5 rounded-full border flex items-center gap-1.5 shrink-0 ${
              isLight 
                ? 'bg-amber-500/10 text-amber-600 border-amber-500/30' 
                : 'bg-[#A6E22E]/10 text-[#A6E22E] border-[#A6E22E]/30'
            }`}>
              {isLight ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
              <span>Mode {isLight ? 'Terang' : 'Gelap'}</span>
            </span>
            <ChevronDown
              className={`w-4 h-4 shrink-0 transition-transform ${textMutedClass} ${showAccessibilitySettings ? 'rotate-180' : ''}`}
            />
          </div>
        </button>

        {showAccessibilitySettings && (
          <>
        <p className={`text-xs ${textMutedLightClass} -mt-2`}>
          Sesuaikan mode tema tampilan (gelap/terang), jenis huruf, dan perbesaran teks untuk kenyamanan navigasi di layar smartphone maupun komputer.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-1">
          {/* Theme Switcher */}
          <div className="flex flex-col gap-2">
            <span className={`text-xs font-semibold ${textMutedClass}`}>Mode Tampilan (Theme)</span>
            <div className="grid grid-cols-2 gap-2">
              <button 
                onClick={() => setTheme('dark')}
                className={`py-2.5 px-3 rounded-xl border text-xs font-bold transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                  !isLight 
                    ? `${isLight ? 'bg-[#103826] border-[#A6E22E] text-[#A6E22E]' : 'bg-[#103826] border-[#A6E22E] text-[#A6E22E]'} shadow-md` 
                    : `${isLight ? 'bg-[#F5F9F7] border-[#D2E5DB] text-[#38604E]' : 'bg-[#06170E] border-[#1F4A34] text-[#A5C9B8]'} hover:border-[#A6E22E]/50`
                }`}
              >
                <Moon className="w-4 h-4" />
                <span>Mode Gelap</span>
              </button>
              <button 
                onClick={() => setTheme('light')}
                className={`py-2.5 px-3 rounded-xl border text-xs font-bold transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                  isLight 
                    ? 'bg-amber-500/15 border-amber-500 text-amber-500 shadow-md' 
                    : `${isLight ? 'bg-[#F5F9F7] border-[#D2E5DB] text-[#38604E]' : 'bg-[#06170E] border-[#1F4A34] text-[#A5C9B8]'} hover:border-amber-500/50`
                }`}
              >
                <Sun className="w-4 h-4" />
                <span>Mode Terang</span>
              </button>
            </div>
          </div>

          {/* Font Type Selection */}
          <div className="flex flex-col gap-2">
            <span className={`text-xs font-semibold ${textMutedClass}`}>Jenis Huruf (Typography)</span>
            <div className="grid grid-cols-2 gap-2">
              <button 
                onClick={onToggleFont}
                className={`py-2.5 px-3 rounded-xl border text-xs font-bold transition-all cursor-pointer ${
                  !useSerifFont 
                    ? `${isLight ? 'bg-[#A6E22E]/20 border-[#A6E22E] text-[#A6E22E]' : 'bg-[#103826] border-[#A6E22E] text-[#A6E22E]'} shadow-md` 
                    : `${isLight ? 'bg-[#F5F9F7] border-[#D2E5DB] text-[#38604E]' : 'bg-[#06170E] border-[#1F4A34] text-[#A5C9B8]'} hover:border-[#A6E22E]/50`
                }`}
              >
                Sans-Serif
              </button>
              <button 
                onClick={onToggleFont}
                className={`py-2.5 px-3 rounded-xl border text-xs font-bold transition-all cursor-pointer ${
                  useSerifFont 
                    ? `${isLight ? 'bg-[#A6E22E]/20 border-[#A6E22E] text-[#A6E22E]' : 'bg-[#103826] border-[#A6E22E] text-[#A6E22E]'} shadow-md` 
                    : `${isLight ? 'bg-[#F5F9F7] border-[#D2E5DB] text-[#38604E]' : 'bg-[#06170E] border-[#1F4A34] text-[#A5C9B8]'} hover:border-[#A6E22E]/50`
                }`}
                style={{ fontFamily: 'Georgia, serif' }}
              >
                Serif
              </button>
            </div>
          </div>

          {/* Font Size Scaling */}
          <div className="flex flex-col gap-2 justify-between">
            <span className={`text-xs font-semibold ${textMutedClass}`}>Ukuran Teks (Font Scale)</span>
            <div className={`flex items-center justify-between ${isLight ? 'bg-[#F5F9F7] border-[#D2E5DB]' : 'bg-[#06170E] border-[#1F4A34]'} border rounded-xl px-4 py-2`}>
              <span className={`text-xs ${textMutedClass} font-mono`}>Skala: {Math.round(fontScale * 100)}%</span>
              <button 
                onClick={onIncreaseFont}
                className="bg-[#A6E22E] hover:bg-[#8BCF1A] text-[#05110A] px-3.5 py-1.5 rounded-lg text-xs font-black transition-all transform active:scale-95 cursor-pointer shadow-md"
              >
                Ubah Skala
              </button>
            </div>
          </div>
        </div>
          </>
        )}
      </div>

      {/* ==========================================
          ROLE CARDS GRID
          ========================================== */}
      <div className="flex flex-col gap-4">
        <h3 className={`font-bold text-lg ${isLight ? 'text-[#0A2B1D]' : 'text-white'} font-heading px-1 text-center sm:text-left flex items-center gap-2`}>
          <span>Pilih Portal Client</span>
          <span className={`text-xs font-normal ${textMutedLightClass}`}>(Sesuai Otorisasi Akses)</span>
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
          
          {/* Card Customer */}
          <div 
            onClick={() => onSelectRole('CUSTOMER')}
            className={`${cardBgClass} p-6 rounded-3xl cursor-pointer transition-all hover:-translate-y-1.5 flex flex-col justify-between gap-6 border ${cardBorderClass} ${cardHoverBorderClass} group`}
          >
            <div>
              <div className={`w-12 h-12 bg-[#A6E22E]/10 text-[#A6E22E] rounded-2xl flex items-center justify-center mb-4 border border-[#A6E22E]/20 group-hover:scale-110 transition-transform`}>
                <User className="w-6 h-6" />
              </div>
              <h4 className={`font-black text-lg ${isLight ? 'text-[#0A2B1D]' : 'text-white'} flex items-center justify-between gap-2 font-heading`}>
                <span>Customer</span>
                <span className="bg-[#A6E22E]/20 text-[#A6E22E] text-[10px] font-bold px-2 py-0.5 rounded-full border border-[#A6E22E]/30">Web / App</span>
              </h4>
              <p className={`text-xs ${textMutedClass} mt-2 leading-relaxed`}>
                Pesan perjalanan bike/car, kirim paket, belanja produk merchant, top-up dompet digital & lacak pesanan aktif.
              </p>
            </div>
            <div className={`flex items-center justify-between text-xs font-bold text-[#A6E22E] pt-4 border-t ${isLight ? 'border-[#D2E5DB]/60' : 'border-[#1F4A34]/60'} group-hover:translate-x-1 transition-transform`}>
              <span>Masuk Customer</span>
              <ChevronRight className="w-4 h-4" />
            </div>
          </div>

          {/* Card Driver */}
          <div 
            onClick={() => onSelectRole('DRIVER')}
            className={`${cardBgClass} p-6 rounded-3xl cursor-pointer transition-all hover:-translate-y-1.5 flex flex-col justify-between gap-6 border ${cardBorderClass} ${cardHoverBorderClass} group`}
          >
            <div>
              <div className={`w-12 h-12 bg-[#A6E22E]/10 text-[#A6E22E] rounded-2xl flex items-center justify-center mb-4 border border-[#A6E22E]/20 group-hover:scale-110 transition-transform`}>
                <Bike className="w-6 h-6" />
              </div>
              <h4 className={`font-black text-lg ${isLight ? 'text-[#0A2B1D]' : 'text-white'} flex items-center justify-between gap-2 font-heading`}>
                <span>Mitra Driver</span>
                <span className="bg-[#A6E22E]/20 text-[#A6E22E] text-[10px] font-bold px-2 py-0.5 rounded-full border border-[#A6E22E]/30">Driver App</span>
              </h4>
              <p className={`text-xs ${textMutedClass} mt-2 leading-relaxed`}>
                Portal pengemudi. Terima orderan ride/delivery realtime, atur status ketersediaan online, dan kelola dompet deposit.
              </p>
            </div>
            <div className={`flex items-center justify-between text-xs font-bold text-[#A6E22E] pt-4 border-t ${isLight ? 'border-[#D2E5DB]/60' : 'border-[#1F4A34]/60'} group-hover:translate-x-1 transition-transform`}>
              <span>Masuk Portal Driver</span>
              <ChevronRight className="w-4 h-4" />
            </div>
          </div>

          {/* Card Merchant */}
          <div 
            onClick={() => onSelectRole('MERCHANT')}
            className={`${cardBgClass} p-6 rounded-3xl cursor-pointer transition-all hover:-translate-y-1.5 flex flex-col justify-between gap-6 border ${cardBorderClass} hover:border-[#F59E0B]/80 group`}
          >
            <div>
              <div className={`w-12 h-12 bg-[#F59E0B]/10 text-[#F59E0B] rounded-2xl flex items-center justify-center mb-4 border border-[#F59E0B]/20 group-hover:scale-110 transition-transform`}>
                <Store className="w-6 h-6" />
              </div>
              <h4 className={`font-black text-lg ${isLight ? 'text-[#0A2B1D]' : 'text-white'} flex items-center justify-between gap-2 font-heading`}>
                <span>Mitra Merchant</span>
                <span className="bg-[#F59E0B]/20 text-[#F59E0B] text-[9px] font-bold px-2 py-0.5 rounded-full border border-[#F59E0B]/30">Merchant / food</span>
              </h4>
              <p className={`text-xs ${textMutedClass} mt-2 leading-relaxed`}>
                Portal merchant. Kelola katalog menu/produk, terima pesanan masuk dari customer, pantau pendapatan toko, dan jam operasional.
              </p>
            </div>
            <div className={`flex items-center justify-between text-xs font-bold text-[#F59E0B] pt-4 border-t ${isLight ? 'border-[#D2E5DB]/60' : 'border-[#1F4A34]/60'} group-hover:translate-x-1 transition-transform`}>
              <span>Masuk Portal Merchant</span>
              <ChevronRight className="w-4 h-4" />
            </div>
          </div>

          {/* Card Admin - Hidden unless revealed */}
          {adminAccessRevealed && (
          <div 
            onClick={() => onSelectRole('ADMIN')}
            className={`${cardBgClass} p-6 rounded-3xl cursor-pointer transition-all hover:-translate-y-1.5 flex flex-col justify-between gap-6 border ${cardBorderClass} hover:border-[#EF4444]/80 group`}
          >
            <div>
              <div className={`w-12 h-12 bg-red-500/10 text-red-400 rounded-2xl flex items-center justify-center mb-4 border border-red-500/20 group-hover:scale-110 transition-transform`}>
                <ShieldAlert className="w-6 h-6" />
              </div>
              <h4 className={`font-black text-lg ${isLight ? 'text-[#0A2B1D]' : 'text-white'} flex items-center justify-between gap-2 font-heading`}>
                <span>Dhuknoo Admin</span>
                <span className="bg-red-500/20 text-red-400 text-[9px] font-bold px-2 py-0.5 rounded-full border border-red-500/30">Admin Panel</span>
              </h4>
              <p className={`text-xs ${textMutedClass} mt-2 leading-relaxed`}>
                Panel kontrol administrasi platform. Audit laporan keuangan, verifikasi dokumen driver, kelola komisi & log sistem terpusat.
              </p>
            </div>
            <div className={`flex items-center justify-between text-xs font-bold text-red-400 pt-4 border-t ${isLight ? 'border-[#D2E5DB]/60' : 'border-[#1F4A34]/60'} group-hover:translate-x-1 transition-transform`}>
              <span>Masuk Admin Panel</span>
              <ChevronRight className="w-4 h-4" />
            </div>
          </div>
          )}

        </div>
      </div>
    </div>
  );
}