// src/pages/MerchantApp.tsx
import React, { useState, useEffect } from 'react';
import { useAuthStore } from '../store/useAuthStore';
import AuthFlow from '../components/auth/AuthFlow';
import { MerchantDashboard } from './Dashboard';
import { MerchantProducts } from './Products';
import { MerchantOrders } from './Orders';
import { MerchantSettings } from './Settings';
import { MerchantSidebar } from '../components/merchant/Sidebar';
import { socket } from '../services/socket';
import { startRingLoop, stopRingLoop, playBellRingSound } from '../utils/audio';

interface MerchantAppProps {
  onBack: () => void;
  triggerToast: (msg: string) => void;
}

type Tab = 'dashboard' | 'products' | 'orders' | 'settings';

function MerchantApp({ onBack, triggerToast }: MerchantAppProps) {
  const { login, user } = useAuthStore();
  const [activeTab, setActiveTab] = useState<Tab>('dashboard');
  const [orderCount, setOrderCount] = useState(0);

  // ============================================
  // SOCKET LISTENER UNTUK NOTIFIKASI ORDER BARU
  // ============================================
  useEffect(() => {
    if (!socket || !user) {
      console.log('🔌 MerchantApp: Socket atau user tidak tersedia, skip listener');
      return;
    }

    console.log('🔌 MerchantApp: Socket listener aktif untuk order baru - User ID:', user.id);

    // Handler untuk pesanan baru
    // PERBAIKAN: backend (order.service.ts createMerchantOrder) mengirim
    // event 'merchant_new_order' lewat emitToUser(merchant.ownerId, ...),
    // BUKAN 'newOrder'. Socket.IO event cocok persis (case-sensitive), jadi
    // sebelumnya handler ini tidak pernah terpanggil -- bel tidak bunyi.
    const handleNewOrder = (data: any) => {
      console.log('🛎️ PESANAN BARU MASUK:', data);
      
      // ✅ 1. MULAI RING LOOP (berbunyi terus sampai di-accept)
      try {
        startRingLoop();
        console.log('🔊 Ring loop started - menunggu driver menerima order');
      } catch (error) {
        console.error('❌ Gagal memulai ring loop:', error);
      }
      
      // 2. Tampilkan toast notifikasi
      // PERBAIKAN: field payload backend adalah 'price', bukan 'total'/'customerName'.
      const total = data.price || data.total || 0;
      const formattedTotal = total.toLocaleString('id-ID');
      
      triggerToast(`📦 Pesanan ${data.orderNumber || ''} baru! Total: Rp ${formattedTotal} ⏰ Menunggu driver...`);
      
      // 3. Update counter order masuk
      setOrderCount(prev => prev + 1);
      
      // 4. Jika user sedang di tab orders, refresh data otomatis
      if (activeTab === 'orders') {
        window.dispatchEvent(new CustomEvent('refreshOrders'));
      }
    };

    // Handler untuk status order yang diperbarui
    // PERBAIKAN: backend mengirim 'order_status_changed', bukan 'orderStatusUpdated'.
    const handleOrderStatusUpdate = (data: any) => {
      console.log('📋 Status order diperbarui:', data);
      
      // ✅ STOP RING LOOP jika order sudah di-accept atau selesai
      const status = data.status || '';
      if (['ACCEPTED', 'ON_THE_WAY', 'ARRIVED', 'PICKED_UP', 'ARRIVED_CUSTOMER', 'COMPLETED', 'CANCELLED'].includes(status)) {
        stopRingLoop();
        console.log('🔇 Ring loop stopped - order status changed to:', status);
      }
      
      triggerToast(`🔄 Status order #${data.orderId || 'unknown'}: ${data.status || 'diperbarui'}`);
      
      // Refresh orders jika user sedang di tab orders
      if (activeTab === 'orders') {
        window.dispatchEvent(new CustomEvent('refreshOrders'));
      }
    };

    // Handler untuk pembayaran order
    // PERBAIKAN: backend mengirim 'order_paid' (lihat payment.service.ts),
    // bukan 'orderPaid'.
    const handleOrderPayment = (data: any) => {
      console.log('💳 Pembayaran order:', data);
      
      // ✅ STOP RING LOOP jika sudah dibayar
      stopRingLoop();
      console.log('🔇 Ring loop stopped - order paid');
      
      triggerToast(`✅ Pembayaran order #${data.orderId || 'unknown'} berhasil!`);
      
      // Refresh orders jika user sedang di tab orders
      if (activeTab === 'orders') {
        window.dispatchEvent(new CustomEvent('refreshOrders'));
      }
    };

    // Daftarkan semua listener — nama event HARUS sama persis dengan yang
    // di-emit backend (lihat grep "SocketService.emitTo" di seluruh backend/src).
    socket.on('merchant_new_order', handleNewOrder);
    socket.on('order_status_changed', handleOrderStatusUpdate);
    socket.on('order_paid', handleOrderPayment);

    // Cleanup: hapus semua listener saat komponen unmount
    return () => {
      console.log('🔌 MerchantApp: Membersihkan semua socket listener');
      socket.off('merchant_new_order', handleNewOrder);
      socket.off('order_status_changed', handleOrderStatusUpdate);
      socket.off('order_paid', handleOrderPayment);
      
      // ✅ STOP ring loop saat komponen unmount
      stopRingLoop();
      console.log('🔇 Ring loop stopped - component unmount');
    };
  }, [user, triggerToast, activeTab]);

  // ============================================
  // AUTH GATE: Cek apakah user sudah login
  // ============================================
  if (!user) {
    return (
      <AuthFlow
        role="MERCHANT"
        onBack={onBack}
        onSuccess={(u, t, rt) => login(u, t, rt)}
        triggerToast={triggerToast}
      />
    );
  }

  // ============================================
  // RENDER KONTEN BERDASARKAN TAB
  // ============================================
  const renderContent = () => {
    switch (activeTab) {
      case 'dashboard':
        return <MerchantDashboard onNavigateTab={(tab) => setActiveTab(tab)} />;
      case 'products':
        return <MerchantProducts />;
      case 'orders':
        return <MerchantOrders />;
      case 'settings':
        return <MerchantSettings />;
      default:
        return <MerchantDashboard />;
    }
  };

  return (
    <div className="flex min-h-screen bg-[#06170E]">
      {/* Sidebar dengan badge notifikasi */}
      <MerchantSidebar 
        onBack={onBack} 
        setActiveTab={(tab: string) => setActiveTab(tab as Tab)} 
        activeTab={activeTab}
        orderCount={orderCount}
      />
      <div className="flex-1 p-6 overflow-y-auto">
        {renderContent()}
      </div>
    </div>
  );
}

// 🆕 OPTIMASI PERFORMA: lihat komentar yang sama di CustomerApp.tsx --
// mencegah seluruh MerchantApp re-render setiap kali parent re-render
// karena alasan tidak terkait (mis. toast global).
export default React.memo(MerchantApp);
