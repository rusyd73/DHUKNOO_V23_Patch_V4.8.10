// src/pages/Orders.tsx
//
// 🆕 PERBAIKAN ("pengelolaan tambah data dll belum berfungsi" + "belum link
// dengan pesan layanan pada dashboard customer"): halaman ini sebelumnya
// cuma placeholder. Sekarang menampilkan daftar order MART (checkout dari
// toko ini, lihat order.service.ts createMerchantOrder & GET
// /api/merchant/my/orders) beserta status pengantaran & rincian item.
//
// ✅ TAMBAHAN: Auto-refresh realtime via socket event (merchant_new_order, order_status_changed, order_paid — lihat MerchantApp.tsx)
import React, { useEffect, useState } from 'react';
import { merchantApi } from '../api/merchant.api';
import { SkeletonList } from '../components/common/Skeleton';
import { QueryErrorState } from '../components/common/QueryErrorState';
import { Loader2, Package, User, Bike, RefreshCw, Bell, CheckCircle, XCircle, Truck, Clock } from 'lucide-react';

interface OrderItemRow {
  id: string;
  name: string;
  price: number | string;
  quantity: number;
  subtotal: number | string;
}

interface MerchantOrder {
  id: string;
  orderNumber?: string;
  status: string;
  price: number | string;
  dropoffAddress: string;
  paymentMethod: string;
  createdAt: string;
  orderItems: OrderItemRow[];
  customer?: { user?: { fullName?: string } };
  driver?: { user?: { fullName?: string } } | null;
}

const STATUS_LABEL: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  PENDING: { 
    label: 'Menunggu Driver', 
    color: 'text-yellow-400 bg-yellow-400/10 border-yellow-400/20',
    icon: <Clock className="w-3.5 h-3.5" />
  },
  ACCEPTED: { 
    label: 'Driver Menuju Toko', 
    color: 'text-blue-400 bg-blue-400/10 border-blue-400/20',
    icon: <Truck className="w-3.5 h-3.5" />
  },
  ON_THE_WAY: { 
    label: 'Driver Menuju Toko', 
    color: 'text-[#00E575] bg-[#00E575]/10 border-[#00E575]/20',
    icon: <Truck className="w-3.5 h-3.5" />
  },
  ARRIVED: { 
    label: 'Driver Tiba di Toko', 
    color: 'text-[#00E575] bg-[#00E575]/10 border-[#00E575]/20',
    icon: <CheckCircle className="w-3.5 h-3.5" />
  },
  PICKED_UP: {
    label: 'Pesanan Diambil · Menuju Customer',
    color: 'text-violet-400 bg-violet-400/10 border-violet-400/20',
    icon: <Truck className="w-3.5 h-3.5" />
  },
  ARRIVED_CUSTOMER: {
    label: 'Driver Tiba di Customer',
    color: 'text-sky-400 bg-sky-400/10 border-sky-400/20',
    icon: <CheckCircle className="w-3.5 h-3.5" />
  },
  COMPLETED: { 
    label: 'Selesai', 
    color: 'text-[#A5C9B8] bg-[#A5C9B8]/10 border-[#A5C9B8]/20',
    icon: <CheckCircle className="w-3.5 h-3.5" />
  },
  CANCELLED: { 
    label: 'Dibatalkan', 
    color: 'text-red-400 bg-red-400/10 border-red-400/20',
    icon: <XCircle className="w-3.5 h-3.5" />
  },
};

// Import Clock untuk icon
//import { Clock } from 'lucide-react';

export function MerchantOrders() {
  const [orders, setOrders] = useState<MerchantOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date());
  const [isRefreshing, setIsRefreshing] = useState(false);

  // ============================================
  // FUNGSI LOAD ORDERS
  // ============================================
  const loadOrders = async (showRefreshIndicator: boolean = false) => {
    if (showRefreshIndicator) {
      setIsRefreshing(true);
    } else {
      setLoading(true);
    }
    
    setError(null);
    try {
      const res = await merchantApi.getMyOrders();
      const newOrders = res.data?.data || [];
      setOrders(newOrders);
      setLastUpdated(new Date());
      
      // Log jumlah order untuk debugging
      console.log(`📦 Orders loaded: ${newOrders.length} orders`);
    } catch (err: any) {
      console.error('❌ Failed to load orders:', err);
      setError(err.response?.data?.error || 'Gagal memuat daftar pesanan.');
    } finally {
      setLoading(false);
      setIsRefreshing(false);
    }
  };

  // ============================================
  // AUTO-REFRESH VIA SOCKET EVENT
  // ============================================
  useEffect(() => {
    // Handler untuk refresh orders
    const handleRefreshOrders = () => {
      console.log('🔄 Auto-refresh orders triggered by socket event');
      loadOrders(true); // Refresh dengan indikator
    };

    // Daftarkan listener untuk custom event dari MerchantApp
    window.addEventListener('refreshOrders', handleRefreshOrders);

    // Cleanup
    return () => {
      window.removeEventListener('refreshOrders', handleRefreshOrders);
    };
  }, []);

  // ============================================
  // INITIAL LOAD + POLLING FALLBACK
  // ============================================
  useEffect(() => {
    // Load initial data
    loadOrders();

    // 🔄 Polling fallback: refresh tiap 30 detik (jika socket gagal)
    // Lebih jarang daripada sebelumnya (20 detik) karena socket sudah realtime
    const interval = setInterval(() => {
      console.log('🔄 Polling fallback: refreshing orders...');
      loadOrders(true);
    }, 30000);

    return () => clearInterval(interval);
  }, []);

  // ============================================
  // FORMAT WAKTU
  // ============================================
  const formatTime = (date: Date) => {
    return date.toLocaleTimeString('id-ID', { 
      hour: '2-digit', 
      minute: '2-digit',
      second: '2-digit'
    });
  };

  // ============================================
  // RENDER
  // ============================================
  return (
    <div className="text-white">
      {/* ==========================================
          HEADER
          ========================================== */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            📦 Pesanan Masuk
            {orders.length > 0 && (
              <span className="bg-[#22C55E]/20 text-[#22C55E] text-xs px-2.5 py-0.5 rounded-full font-bold">
                {orders.length}
              </span>
            )}
          </h1>
          <p className="text-sm text-[#A5C9B8] flex items-center gap-2">
            <span>Pesanan yang masuk lewat checkout customer.</span>
            <span className="text-[10px] bg-[#23583E]/30 px-2 py-0.5 rounded-full">
              Last update: {formatTime(lastUpdated)}
            </span>
          </p>
        </div>
        
        <div className="flex items-center gap-2">
          {/* Indikator realtime */}
          <div className="flex items-center gap-1.5 text-[10px] text-[#22C55E] bg-[#22C55E]/10 px-3 py-1.5 rounded-full border border-[#22C55E]/30">
            <Bell className="w-3 h-3" />
            <span className="font-medium">Realtime</span>
            <span className="w-1.5 h-1.5 rounded-full bg-[#22C55E] animate-pulse"></span>
          </div>
          
          <button
            onClick={() => loadOrders(true)}
            disabled={isRefreshing}
            className="text-xs px-3 py-2 rounded-xl border border-[#23583E] text-[#A5C9B8] hover:text-white hover:border-[#00E575] transition-all flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
            <span>{isRefreshing ? 'Memuat...' : 'Muat Ulang'}</span>
          </button>
        </div>
      </div>

      {/* ==========================================
          LOADING STATE
          ========================================== */}
      {loading && !isRefreshing ? (
        <SkeletonList count={4} />
      ) : error ? (
        <QueryErrorState message={error} onRetry={() => loadOrders(false)} />
      ) : orders.length === 0 ? (
        <div className="text-center py-16 bg-[#0D2E1F] rounded-3xl border border-[#23583E]">
          <Package className="w-12 h-12 text-[#23583E] mx-auto mb-3" />
          <p className="text-[#A5C9B8] font-medium">Belum ada pesanan masuk.</p>
          <p className="text-xs text-[#23583E] mt-1">Pesanan akan muncul secara realtime saat customer checkout</p>
        </div>
      ) : (
        /* ==========================================
            LIST ORDERS
            ========================================== */
        <div className="flex flex-col gap-3">
          {/* Indikator refresh */}
          {isRefreshing && (
            <div className="text-center text-[10px] text-[#A5C9B8] animate-pulse py-1">
              <Loader2 className="w-3 h-3 inline animate-spin mr-1" />
              Memperbarui pesanan...
            </div>
          )}
          
          {orders.map((o) => {
            const statusInfo = STATUS_LABEL[o.status] || { 
              label: o.status, 
              color: 'text-[#A5C9B8] bg-[#A5C9B8]/10 border-[#A5C9B8]/20',
              icon: <Package className="w-3.5 h-3.5" />
            };
            
            return (
              <div 
                key={o.id} 
                className="bg-[#0D2E1F] rounded-2xl border border-[#23583E] p-4 hover:border-[#22C55E]/50 transition-all hover:shadow-lg hover:shadow-[#22C55E]/5"
              >
                {/* Header: Order ID, Customer, Status */}
                <div className="flex items-start justify-between gap-3 mb-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-xs text-[#A5C9B8] font-mono">
                        #{o.id.slice(0, 8).toUpperCase()}
                      </p>
                      <span className="text-[10px] text-[#23583E]">·</span>
                      <p className="text-xs text-[#A5C9B8]">
                        {new Date(o.createdAt).toLocaleString('id-ID', {
                          day: 'numeric',
                          month: 'short',
                          hour: '2-digit',
                          minute: '2-digit'
                        })}
                      </p>
                      {o.status === 'PENDING' && (
                        <span className="bg-red-500/20 text-red-400 text-[9px] px-2 py-0.5 rounded-full animate-pulse border border-red-500/30">
                          NEW
                        </span>
                      )}
                    </div>
                    <p className="text-sm font-bold flex items-center gap-1 mt-1">
                      <User className="w-3.5 h-3.5 text-[#A5C9B8]" /> 
                      {o.customer?.user?.fullName || 'Pelanggan'}
                    </p>
                  </div>
                  <span className={`text-[10px] px-3 py-1.5 rounded-full font-bold whitespace-nowrap border flex items-center gap-1.5 ${statusInfo.color}`}>
                    {statusInfo.icon}
                    {statusInfo.label}
                  </span>
                </div>

                <div className="border-t border-[#23583E] my-2" />

                {/* Order Items */}
                <div className="flex flex-col gap-1 text-xs text-[#A5C9B8]">
                  {o.orderItems?.slice(0, 3).map((item) => (
                    <div key={item.id} className="flex justify-between">
                      <span>{item.quantity}x {item.name}</span>
                      <span>Rp{Number(item.subtotal).toLocaleString('id-ID')}</span>
                    </div>
                  ))}
                  {o.orderItems?.length > 3 && (
                    <div className="text-[10px] text-[#23583E] text-center">
                      +{o.orderItems.length - 3} item lainnya
                    </div>
                  )}
                </div>

                <div className="border-t border-[#23583E] my-2" />

                {/* Delivery Info */}
                <div className="flex flex-col gap-1 text-xs">
                  <div className="flex items-start gap-1.5 text-[#A5C9B8]">
                    <Truck className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                    <span className="break-words">{o.dropoffAddress}</span>
                  </div>
                  {o.driver?.user?.fullName && (
                    <div className="flex items-center gap-1.5 text-[#00E575]">
                      <Bike className="w-3.5 h-3.5" /> 
                      <span>Driver: {o.driver.user.fullName}</span>
                    </div>
                  )}
                </div>

                {/* Footer: Payment & Total */}
                <div className="flex items-center justify-between mt-3 pt-2 border-t border-[#23583E]/50">
                  <span className="text-[10px] text-[#A5C9B8] flex items-center gap-1">
                    <span className={`w-1.5 h-1.5 rounded-full ${o.paymentMethod === 'CASH' ? 'bg-yellow-400' : 'bg-[#22C55E]'}`}></span>
                    {o.paymentMethod === 'CASH' ? 'Bayar di Tempat' : 'Bayar Online'}
                  </span>
                  <span className="text-[#FFD700] font-black text-sm">
                    Rp{Number(o.price).toLocaleString('id-ID')}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}