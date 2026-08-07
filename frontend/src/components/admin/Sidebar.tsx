// frontend/src/components/admin/Sidebar.tsx
import React from 'react';
import { Store, Home, Users, Settings, LogOut } from 'lucide-react';
import { useAuthStore } from '../../store/useAuthStore'; // ✅ Ganti path

export function AdminSidebar({ onBack }: { onBack: () => void }) {
  const { logout } = useAuthStore();

  const menuItems = [
    { label: 'Dashboard', icon: <Home className="w-5 h-5" />, path: '/admin/dashboard' },
    { label: 'Merchant', icon: <Store className="w-5 h-5" />, path: '/admin/merchants' },
    { label: 'Users', icon: <Users className="w-5 h-5" />, path: '/admin/users' },
    { label: 'Settings', icon: <Settings className="w-5 h-5" />, path: '/admin/settings' },
  ];

  // ... render sidebar
}