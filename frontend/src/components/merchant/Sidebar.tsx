// src/components/merchant/Sidebar.tsx
import React from 'react';
import { Store, Home, Menu, Receipt, BarChart, Settings, LogOut, Bell } from 'lucide-react';
import { useAuthStore } from '../../store/useAuthStore';

interface MerchantSidebarProps {
  onBack: () => void;
  setActiveTab: (tab: string) => void;
  activeTab: string;
  orderCount?: number; // ✅ Tambahkan props orderCount
}

export function MerchantSidebar({ onBack, setActiveTab, activeTab, orderCount = 0 }: MerchantSidebarProps) {
  const { logout } = useAuthStore();

  const menuItems = [
    { key: 'dashboard', label: 'Dashboard', icon: <Home className="w-5 h-5" /> },
    { key: 'products', label: 'Kelola Menu', icon: <Menu className="w-5 h-5" /> },
    { 
      key: 'orders', 
      label: 'Pesanan Masuk', 
      icon: <Receipt className="w-5 h-5" />,
      badge: orderCount > 0 ? orderCount : undefined // ✅ Tambahkan badge
    },
    { key: 'settings', label: 'Settings', icon: <Settings className="w-5 h-5" /> },
  ];

  const handleLogout = () => {
    logout();
    onBack();
  };

  // 🆕 RESPONSIVE FIX: sebelumnya panel ini SELALU vertikal & fixed w-64,
  // sehingga di layar HP (viewport sempit) memakan hampir separuh layar dan
  // mengunci fungsi utama "Kelola" merchant supaya sulit dijangkau.
  // Sekarang, di bawah breakpoint `lg` panel berubah jadi bar horizontal
  // ("landscape") ringkas yang menempel di atas konten, dan baru berubah
  // jadi sidebar vertikal penuh w-64 di layar besar (>= lg).
  return (
    <aside className="w-full lg:w-64 bg-[#0D2E1F] border-b lg:border-b-0 lg:border-r border-[#23583E] flex flex-row lg:flex-col items-center lg:items-stretch gap-2 lg:gap-0 px-2 lg:px-0 py-2 lg:py-0 lg:h-[calc(100vh-70px)] sticky top-[70px] z-30 shadow-lg shadow-[#06170E]/30">
      {/* ==========================================
          HEADER (mode landscape/mobile — ringkas, ikon toko + badge saja)
          ========================================== */}
      <div className="flex lg:hidden items-center gap-1.5 shrink-0 pl-1">
        <span className="text-xl leading-none">🏪</span>
        {orderCount > 0 && (
          <span className="bg-red-500 text-white text-[9px] font-bold px-1.5 py-0.5 rounded-full animate-pulse">
            {orderCount}
          </span>
        )}
      </div>

      {/* ==========================================
          HEADER (mode sidebar/desktop — lengkap seperti semula)
          ========================================== */}
      <div className="hidden lg:block p-4 border-b border-[#23583E]">
        <h2 className="text-lg font-bold text-[#FF6B6B] flex items-center gap-2">
          🏪 Merchant
          {orderCount > 0 && (
            <span className="ml-auto bg-red-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-full animate-pulse">
              {orderCount}
            </span>
          )}
        </h2>
        <p className="text-xs text-[#A5C9B8]/60 flex items-center justify-between">
          <span>Panel Toko</span>
          {orderCount > 0 && (
            <span className="text-[10px] text-red-400 flex items-center gap-1">
              <Bell className="w-3 h-3" />
              {orderCount} pesanan baru
            </span>
          )}
        </p>
      </div>

      {/* ==========================================
          NAVIGATION MENU
          — mobile: baris horizontal, bisa discroll ke samping (landscape bar)
          — desktop (lg+): kolom vertikal seperti sidebar semula
          ========================================== */}
      <nav className="flex-1 flex flex-row lg:flex-col gap-1 overflow-x-auto overflow-y-hidden lg:overflow-x-hidden lg:overflow-y-auto lg:p-4 dhuknoo-scrollbar min-w-0">
        {menuItems.map((item) => (
          <button
            key={item.key}
            onClick={() => {
              // Reset badge saat klik menu Orders
              if (item.key === 'orders') {
                // Badge akan hilang saat user membuka halaman Orders
                // karena orderCount akan di-reset di MerchantApp
              }
              setActiveTab(item.key);
            }}
            className={`flex flex-col lg:flex-row items-center justify-center lg:justify-start gap-0.5 lg:gap-3 shrink-0 lg:w-full px-3 lg:px-4 py-1.5 lg:py-2.5 rounded-xl text-[10px] lg:text-sm transition-all text-center lg:text-left relative whitespace-nowrap ${
              activeTab === item.key
                ? 'bg-[#FF6B6B]/20 text-[#FF6B6B] border border-[#FF6B6B]/30'
                : 'text-[#A5C9B8] hover:bg-[#23583E]/30 hover:text-white'
            }`}
          >
            <span className="flex-shrink-0">{item.icon}</span>
            <span className="lg:flex-1">{item.label}</span>
            
            {/* Badge notifikasi */}
            {item.badge && item.badge > 0 && (
              <span className="absolute -top-1 -right-1 lg:static bg-red-500 text-white text-[9px] lg:text-[10px] font-bold px-1.5 lg:px-2 py-0.5 rounded-full min-w-[16px] lg:min-w-[20px] text-center animate-pulse shadow-lg shadow-red-500/30">
                {item.badge}
              </span>
            )}
          </button>
        ))}
      </nav>

      {/* ==========================================
          FOOTER - LOGOUT
          — mobile: ikon saja di ujung bar landscape
          — desktop: tombol penuh dengan label seperti semula
          ========================================== */}
      <div className="shrink-0 lg:p-4 lg:border-t lg:border-[#23583E]">
        <button
          onClick={handleLogout}
          title="Logout"
          className="flex items-center gap-2 lg:w-full px-2.5 lg:px-4 py-1.5 lg:py-2.5 rounded-xl text-xs lg:text-sm text-red-400 hover:bg-red-500/10 transition-all hover:text-red-300"
        >
          <LogOut className="w-4 h-4 lg:w-5 lg:h-5" />
          <span className="hidden lg:inline">Logout</span>
        </button>
      </div>
    </aside>
  );
}
