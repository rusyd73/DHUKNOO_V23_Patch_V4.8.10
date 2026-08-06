// src/components/merchant/Sidebar.tsx
import React from 'react';
import { Store, Home, Menu, Receipt, BarChart, Settings, LogOut } from 'lucide-react';
import { useAuthStore } from '../../store/useAuthStore';

interface MerchantSidebarProps {
  onBack: () => void;
  setActiveTab: (tab: string) => void;
  activeTab: string;
}

export function MerchantSidebar({ onBack, setActiveTab, activeTab }: MerchantSidebarProps) {
  const { logout } = useAuthStore();

  const menuItems = [
    { key: 'dashboard', label: 'Dashboard', icon: <Home className="w-5 h-5" /> },
    { key: 'products', label: 'Kelola Menu', icon: <Menu className="w-5 h-5" /> },
    { key: 'orders', label: 'Pesanan Masuk', icon: <Receipt className="w-5 h-5" /> },
    { key: 'settings', label: 'Settings', icon: <Settings className="w-5 h-5" /> },
  ];

  const handleLogout = () => {
    logout();
    onBack();
    window.location.href = '/login';
  };

  return (
    <aside className="w-64 bg-[#0D2E1F] border-r border-[#23583E] h-screen flex flex-col">
      <div className="p-4 border-b border-[#23583E]">
        <h2 className="text-lg font-bold text-[#FF6B6B]">🏪 Merchant</h2>
        <p className="text-xs text-[#A5C9B8]/60">Panel Toko</p>
      </div>
      <nav className="flex-1 p-4 space-y-1">
        {menuItems.map((item) => (
          <button
            key={item.key}
            onClick={() => setActiveTab(item.key)}
            className={`flex items-center gap-3 w-full px-4 py-2.5 rounded-xl text-sm transition-all text-left ${
              activeTab === item.key
                ? 'bg-[#FF6B6B]/20 text-[#FF6B6B] border border-[#FF6B6B]/30'
                : 'text-[#A5C9B8] hover:bg-[#23583E]/30 hover:text-white'
            }`}
          >
            {item.icon}
            <span>{item.label}</span>
          </button>
        ))}
      </nav>
      <div className="p-4 border-t border-[#23583E]">
        <button
          onClick={handleLogout}
          className="flex items-center gap-3 w-full px-4 py-2.5 rounded-xl text-sm text-red-400 hover:bg-red-500/10 transition-all"
        >
          <LogOut className="w-5 h-5" />
          <span>Logout</span>
        </button>
      </div>
    </aside>
  );
}