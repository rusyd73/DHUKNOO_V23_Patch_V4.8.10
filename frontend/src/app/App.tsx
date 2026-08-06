// App.tsx
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
} from '@tanstack/react-query';
import { 
  ShieldAlert, 
  User, 
  Bike, 
  Store,
  ChevronRight,
  Info,
  Sparkles,
  Type,
  LogOut,
} from 'lucide-react';

// PERBAIKAN: Lazy load apps
const CustomerApp = React.lazy(() => import('../pages/CustomerApp'));
const DriverApp = React.lazy(() => import('../pages/DriverApp'));
const AdminApp = React.lazy(() => import('../pages/AdminApp'));
const MerchantApp = React.lazy(() => import('../pages/MerchantApp'));

// ============================================================
// QUERY CLIENT - Single instance
// ============================================================
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000, // 5 menit
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

// ============================================================
// FALLBACK LOADING
// ============================================================
function AppLoadingFallback() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-3 bg-[#06170E]">
      <div className="w-10 h-10 border-4 border-[#23583E] border-t-[#00E575] rounded-full animate-spin" />
      <span className="text-xs text-[#A5C9B8] animate-pulse">Memuat halaman...</span>
    </div>
  );
}

// ============================================================
// MAIN APP
// ============================================================
export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <DhuknooMainAppShell />
    </QueryClientProvider>
  );
}

// ============================================================
// APP SHELL
// ============================================================
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

  const [notification, setNotification] = useState<string | null>(null);

  const triggerToast = (msg: string) => {
    setNotification(msg);
    setTimeout(() => setNotification(null), 4000);
  };

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
      {/* Toast Notification */}
      {notification && (
        <div className="fixed top-6 left-1/2 transform -translate-x-1/2 z-50 w-full max-w-md px-4 animate-bounce">
          <div className="bg-[#00E575] text-[#071F14] px-6 py-4 rounded-2xl shadow-2xl font-bold flex items-center gap-3 border-2 border-[#FFD700]">
            <Sparkles className="w-5 h-5 shrink-0 animate-spin" />
            <span>{notification}</span>
          </div>
        </div>
      )}

      {/* Header */}
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
                  <span className="text-xs font-bold text-white">{user.fullName || user.name}</span>
                </div>
                <span className="text-[10px] text-[#00E575] font-semibold bg-[#00E575]/10 px-1.5 py-0.5 rounded border border-[#00E575]/30 mt-0.5">
                  🔒 {currentRole || 'No Role'}
                </span>
              </div>
            )}
            {currentRole && (
              <button
                onClick={() => {
                  const confirmLogout = window.confirm(
                    `🔒 KONFIRMASI KELUAR SESI:\n\nSesi ${user?.fullName || user?.name || 'Akun'} saat ini dijaga tetap log-in.\n\nApakah Anda yakin ingin keluar dari dashboard sekarang?`
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

      {/* MAIN CONTENT */}
      <main className="flex-1 flex flex-col">
        {!currentRole ? (
          <LauncherHub 
            onSelectRole={(role) => {
              // Hapus logout() karena akan mereset state
              // Kita hanya set role saja
              setRole(role);
              triggerToast(`🔄 Beralih ke portal ${role}`);
            }}
            useSerifFont={useSerifFont}
            fontScale={fontScale}
            onToggleFont={toggleFontFamily}
            onIncreaseFont={increaseFontScale}
          />
        ) : (
          <Suspense fallback={<AppLoadingFallback />}>
            {currentRole === 'CUSTOMER' && (
              <CustomerApp onBack={() => setRole(null)} triggerToast={triggerToast} />
            )}
            {currentRole === 'DRIVER' && (
              <DriverApp onBack={() => setRole(null)} triggerToast={triggerToast} />
            )}
            {currentRole === 'MERCHANT' && (
              <MerchantApp onBack={() => setRole(null)} triggerToast={triggerToast} />
            )}
            {currentRole === 'ADMIN' && (
              <AdminApp onBack={() => setRole(null)} triggerToast={triggerToast} />
            )}
          </Suspense>
        )}
      </main>

      {/* Footer */}
      <footer className="bg-[#05110A] border-t border-[#23583E]/50 py-6 text-center text-xs text-[#A5C9B8]/60">
        <div className="max-w-4xl mx-auto px-4 flex flex-col gap-2">
          <div className="font-semibold text-[#00E575] flex items-center justify-center gap-2">
            <Info className="w-4 h-4" />
            <span>DHUKNOO Platform - Single Backend API, Multi-Client Portals</span>
          </div>
        </div>
      </footer>
    </div>
  );
}

// ============================================================
// LAUNCHER HUB
// ============================================================
interface LauncherProps {
  onSelectRole: (role: 'CUSTOMER' | 'DRIVER' | 'MERCHANT' | 'ADMIN') => void;
  useSerifFont: boolean;
  fontScale: number;
  onToggleFont: () => void;
  onIncreaseFont: () => void;
}

function LauncherHub({ 
  onSelectRole, 
  useSerifFont, 
  fontScale, 
  onToggleFont, 
  onIncreaseFont 
}: LauncherProps) {
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
            V2
          </span>
        </div>
        <div>
          <h1 className="text-4xl md:text-6xl font-black tracking-tight text-[#FFD700]">
            DHUKNOO <span className="text-[#00E575]">Ride</span>
          </h1>
          <p className="text-[#A5C9B8] font-bold text-xl mt-1">Ojek Batu - Malang Raya Terpadu</p>
        </div>
      </div>

      {/* Accessibility Controls */}
      <div className="bg-[#0D2E1F] border border-[#23583E] rounded-3xl p-6 shadow-2xl flex flex-col gap-4">
        <div className="flex items-center gap-2 text-[#FFD700]">
          <Type className="w-5 h-5" />
          <h2 className="font-bold text-lg">Pengaturan Tampilan</h2>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="flex flex-col gap-2">
            <span className="text-xs font-bold text-[#A5C9B8]">Jenis Huruf</span>
            <div className="grid grid-cols-2 gap-2">
              <button 
                onClick={onToggleFont}
                className={`py-2.5 px-3 rounded-xl border text-sm font-bold transition-all ${
                  !useSerifFont 
                    ? 'bg-[#23583E] border-[#00E575] text-[#00E575]' 
                    : 'bg-[#06170E] border-[#23583E] text-[#A5C9B8] hover:border-[#00E575]'
                }`}
              >
                Sans-Serif
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
                Serif
              </button>
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <span className="text-xs font-bold text-[#A5C9B8]">Ukuran Font</span>
            <div className="flex items-center justify-between bg-[#06170E] border border-[#23583E] rounded-xl px-4 py-2">
              <span className="text-xs text-[#A5C9B8]/80">{Math.round(fontScale * 100)}%</span>
              <button 
                onClick={onIncreaseFont}
                className="bg-[#00E575] text-[#071F14] px-4 py-1.5 rounded-lg text-xs font-black hover:bg-[#00ff80] transition-all"
              >
                +10%
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Portal Grid */}
      <div className="flex flex-col gap-4">
        <h3 className="font-bold text-lg text-[#FFD700] px-1">Pilih Portal</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          
          {/* Customer */}
          <PortalCard
            icon={<User className="w-6 h-6" />}
            title="Customer"
            subtitle="Android/Web"
            color="#FFD700"
            description="Portal ojek & pengiriman. Top up dompet, pesan perjalanan."
            onClick={() => onSelectRole('CUSTOMER')}
          />

          {/* Driver */}
          <PortalCard
            icon={<Bike className="w-6 h-6" />}
            title="Driver"
            subtitle="Android"
            color="#00E575"
            description="Portal mitra pengemudi. Lacak order, terima pesanan."
            onClick={() => onSelectRole('DRIVER')}
          />

          {/* Merchant */}
          <PortalCard
            icon={<Store className="w-6 h-6" />}
            title="Merchant"
            subtitle="Web/Android"
            color="#FF6B6B"
            description="Portal mitra warung. Kelola produk, terima pesanan."
            onClick={() => onSelectRole('MERCHANT')}
          />

          {/* Admin - Hidden */}
          {adminAccessRevealed && (
            <PortalCard
              icon={<ShieldAlert className="w-6 h-6" />}
              title="Admin"
              subtitle="Web Panel"
              color="#EF4444"
              description="Panel kontrol. Audit finansial, verifikasi mitra."
              onClick={() => onSelectRole('ADMIN')}
            />
          )}

        </div>
      </div>
    </div>
  );
}

// ============================================================
// PORTAL CARD COMPONENT
// ============================================================
interface PortalCardProps {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  color: string;
  description: string;
  onClick: () => void;
}

function PortalCard({ icon, title, subtitle, color, description, onClick }: PortalCardProps) {
  return (
    <div 
      onClick={onClick}
      className="bg-[#0D2E1F] border border-[#23583E] hover:border-[color] hover:shadow-[0_0_15px_rgba(color,0.15)] p-6 rounded-3xl cursor-pointer transition-all hover:-translate-y-1.5 flex flex-col justify-between gap-6"
      style={{ 
        '--color': color,
        borderColor: 'var(--color, #23583E)',
      } as React.CSSProperties}
    >
      <div>
        <div 
          className="w-12 h-12 rounded-2xl flex items-center justify-center mb-4 border"
          style={{
            backgroundColor: `${color}10`,
            color: color,
            borderColor: `${color}20`,
          }}
        >
          {icon}
        </div>
        <h4 className="font-black text-xl text-white flex items-center gap-2">
          <span>Dhuknoo {title}</span>
          <span 
            className="text-[9px] px-1.5 py-0.5 rounded-md"
            style={{
              backgroundColor: `${color}20`,
              color: color,
            }}
          >
            {subtitle}
          </span>
        </h4>
        <p className="text-xs text-[#A5C9B8] mt-2 leading-relaxed">
          {description}
        </p>
      </div>
      <div 
        className="flex items-center justify-between text-xs font-bold pt-4 border-t border-[#23583E]/50"
        style={{ color }}
      >
        <span>Buka Portal</span>
        <ChevronRight className="w-4 h-4" />
      </div>
    </div>
  );
}