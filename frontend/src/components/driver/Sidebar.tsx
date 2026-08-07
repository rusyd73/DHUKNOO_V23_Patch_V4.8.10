// src/components/driver/Sidebar.tsx
import React from 'react';
import { Home, ClipboardList, DollarSign, Settings, LogOut, Bell, Bike } from 'lucide-react';
import { useAuthStore } from '../../store/useAuthStore';

interface DriverSidebarProps {
  onBack: () => void;
  setActiveTab: (tab: string) => void;
  activeTab: string;
  orderCount?: number;
  isOnline?: boolean;
}

export function DriverSidebar({ 
  onBack, 
  setActiveTab, 
  activeTab, 
  orderCount = 0,
  isOnline = false 
}: DriverSidebarProps) {
  const { logout } = useAuthStore();

  const menuItems = [
    { key: 'dashboard', label: 'Dashboard', icon: <Home className="w-5 h-5" /> },
    { 
      key: 'orders', 
      label: 'Pesanan', 
      icon: <ClipboardList className="w-5 h-5" />,
      badge: orderCount > 0 ? orderCount : undefined
    },
    { key: 'earnings', label: 'Pendapatan', icon: <DollarSign className="w-5 h-5" /> },
    { key: 'settings', label: 'Settings', icon: <Settings className="w-5 h-5" /> },
  ];

  const handleLogout = () => {
    logout();
    onBack();
  };

  return (
    <aside className="w-64 bg-[#0D2E1F] border-r border-[#23583E] h-screen flex flex-col sticky top-0">
      {/* ==========================================
          HEADER
          ========================================== */}
      <div className="p-4 border-b border-[#23583E]">
        <h2 className="text-lg font-bold text-[#00E575] flex items-center gap-2">
          🏍️ Driver
          {orderCount > 0 && (
            <span className="ml-auto bg-red-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-full animate-pulse">
              {orderCount}
            </span>
          )}
        </h2>
        <div className="flex items-center justify-between mt-1">
          <p className="text-xs text-[#A5C9B8]/60">Panel Mitra</p>
          <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1 ${
            isOnline 
              ? 'bg-[#00E575]/20 text-[#00E575] border border-[#00E575]/30' 
              : 'bg-red-500/20 text-red-400 border border-red-500/30'
          }`}>
            <span className={`w-1.5 h-1.5 rounded-full ${isOnline ? 'bg-[#00E575] animate-ping' : 'bg-red-500'}`} />
            {isOnline ? 'ONLINE' : 'OFFLINE'}
          </span>
        </div>
        {orderCount > 0 && (
          <p className="text-[10px] text-red-400 flex items-center gap-1 mt-1">
            <Bell className="w-3 h-3" />
            {orderCount} pesanan baru tersedia
          </p>
        )}
      </div>

      {/* ==========================================
          NAVIGATION MENU
          ========================================== */}
      <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
        {menuItems.map((item) => (
          <button
            key={item.key}
            onClick={() => setActiveTab(item.key)}
            className={`flex items-center gap-3 w-full px-4 py-2.5 rounded-xl text-sm transition-all text-left relative ${
              activeTab === item.key
                ? 'bg-[#00E575]/20 text-[#00E575] border border-[#00E575]/30'
                : 'text-[#A5C9B8] hover:bg-[#23583E]/30 hover:text-white'
            }`}
          >
            <span className="flex-shrink-0">{item.icon}</span>
            <span className="flex-1">{item.label}</span>
            
            {/* Badge notifikasi */}
            {item.badge && item.badge > 0 && (
              <span className="bg-red-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-full min-w-[20px] text-center animate-pulse shadow-lg shadow-red-500/30">
                {item.badge}
              </span>
            )}
          </button>
        ))}
      </nav>

      {/* ==========================================
          FOOTER - LOGOUT
          ========================================== */}
      <div className="p-4 border-t border-[#23583E]">
        <button
          onClick={handleLogout}
          className="flex items-center gap-3 w-full px-4 py-2.5 rounded-xl text-sm text-red-400 hover:bg-red-500/10 transition-all hover:text-red-300"
        >
          <LogOut className="w-5 h-5" />
          <span>Logout</span>
        </button>
      </div>
    </aside>
  );
}