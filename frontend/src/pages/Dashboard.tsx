// pages/Dashboard.tsx
import { useEffect, useState } from 'react';
import { merchantApi } from '../api/merchant.api';
import type { Merchant, MerchantStats } from '../types/merchant.types';

export const Dashboard = () => {
  const [merchant, setMerchant] = useState<Merchant | null>(null);
  const [stats, setStats] = useState<MerchantStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        setError(null);

        // 🔥 PERBAIKAN: Ambil data dari response.data.data
        const [merchantRes, statsRes] = await Promise.all([
          merchantApi.getMyMerchant(),
          merchantApi.getMyStats(),
        ]);

        // ✅ BENAR: merchantRes.data adalah ApiResponse<Merchant>
        // merchantRes.data.data adalah Merchant
        setMerchant(merchantRes.data);
        setStats(statsRes.data);
        
        console.log('✅ Merchant data loaded:', merchantRes.data);
        console.log('✅ Stats loaded:', statsRes.data);
        
      } catch (err: any) {
        if (err.response?.status === 401) {
          setError('Sesi Anda berakhir. Silakan login kembali.');
        } else {
          setError(err.response?.data?.message || 'Gagal mengambil data merchant');
        }
        console.error('❌ Error fetching merchant data:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 border-4 border-[#23583E] border-t-[#00E575] rounded-full animate-spin" />
          <span className="text-sm text-[#A5C9B8]">Memuat data merchant...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-6 max-w-md text-center">
          <div className="text-red-400 text-4xl mb-3">⚠️</div>
          <h3 className="text-red-400 font-bold text-lg mb-2">Gagal Memuat Data</h3>
          <p className="text-red-300/80 text-sm">{error}</p>
          <button
            onClick={() => window.location.reload()}
            className="mt-4 bg-red-500/20 hover:bg-red-500/30 text-red-400 px-4 py-2 rounded-lg text-sm font-bold transition-colors"
          >
            Coba Lagi
          </button>
        </div>
      </div>
    );
  }

  if (!merchant) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="bg-[#0D2E1F] border border-[#23583E] rounded-xl p-8 max-w-md text-center">
          <div className="text-4xl mb-3">🏪</div>
          <h3 className="text-white font-bold text-lg mb-2">Belum Memiliki Merchant</h3>
          <p className="text-[#A5C9B8] text-sm">
            Anda belum mendaftarkan merchant. Silakan daftar terlebih dahulu.
          </p>
          <button
            onClick={() => window.location.href = '/merchant/register'}
            className="mt-4 bg-[#00E575] text-[#071F14] px-6 py-2 rounded-lg text-sm font-bold hover:bg-[#00ff80] transition-colors"
          >
            Daftar Merchant Sekarang
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Merchant Header */}
      <div className="bg-[#0D2E1F] border border-[#23583E] rounded-2xl p-6 mb-6">
        <div className="flex items-start gap-6">
          {merchant.logo && (
            <img 
              src={merchant.logo} 
              alt={merchant.name}
              className="w-20 h-20 rounded-xl object-cover border-2 border-[#23583E]"
            />
          )}
          <div className="flex-1">
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-2xl font-bold text-white">{merchant.name}</h1>
              <span className={`px-3 py-1 rounded-full text-xs font-bold ${
                merchant.isOpen 
                  ? 'bg-green-500/20 text-green-400 border border-green-500/30'
                  : 'bg-red-500/20 text-red-400 border border-red-500/30'
              }`}>
                {merchant.isOpen ? '🟢 Buka' : '🔴 Tutup'}
              </span>
              {merchant.rating && (
                <span className="flex items-center gap-1 text-yellow-400 text-sm">
                  ⭐ {merchant.rating.toFixed(1)} ({merchant.totalReviews || 0} ulasan)
                </span>
              )}
            </div>
            <p className="text-[#A5C9B8] text-sm mt-1">{merchant.description}</p>
            <div className="flex flex-wrap gap-4 mt-3 text-sm text-[#A5C9B8]">
              <span>📂 {merchant.category}</span>
              <span>📍 {merchant.address}</span>
              {merchant.phone && <span>📞 {merchant.phone}</span>}
            </div>
          </div>
        </div>
      </div>

      {/* Stats Grid */}
      {stats && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <StatCard
            label="Total Produk"
            value={stats.totalProducts}
            icon="📦"
            color="blue"
          />
          <StatCard
            label="Total Pesanan"
            value={stats.totalOrders}
            icon="🛒"
            color="green"
          />
          <StatCard
            label="Total Pendapatan"
            value={`Rp${stats.totalRevenue.toLocaleString()}`}
            icon="💰"
            color="yellow"
          />
          <StatCard
            label="Rating Rata-rata"
            value={stats.averageRating.toFixed(1)}
            icon="⭐"
            color="purple"
          />
        </div>
      )}

      {/* Additional Stats */}
      {stats && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-[#0D2E1F] border border-[#23583E] rounded-xl p-4">
            <p className="text-xs text-[#A5C9B8]">Pesanan Hari Ini</p>
            <p className="text-2xl font-bold text-white">{stats.ordersToday}</p>
          </div>
          <div className="bg-[#0D2E1F] border border-[#23583E] rounded-xl p-4">
            <p className="text-xs text-[#A5C9B8]">Pendapatan Hari Ini</p>
            <p className="text-2xl font-bold text-[#00E575]">
              Rp{stats.revenueToday.toLocaleString()}
            </p>
          </div>
          <div className="bg-[#0D2E1F] border border-[#23583E] rounded-xl p-4">
            <p className="text-xs text-[#A5C9B8]">Total Pelanggan</p>
            <p className="text-2xl font-bold text-white">{stats.totalCustomers}</p>
          </div>
        </div>
      )}
    </div>
  );
};

// ============================================================
// STAT CARD COMPONENT
// ============================================================
interface StatCardProps {
  label: string;
  value: string | number;
  icon: string;
  color: 'blue' | 'green' | 'yellow' | 'purple' | 'red';
}

const StatCard = ({ label, value, icon, color }: StatCardProps) => {
  const colors = {
    blue: 'border-blue-500/30 bg-blue-500/10 text-blue-400',
    green: 'border-green-500/30 bg-green-500/10 text-green-400',
    yellow: 'border-yellow-500/30 bg-yellow-500/10 text-yellow-400',
    purple: 'border-purple-500/30 bg-purple-500/10 text-purple-400',
    red: 'border-red-500/30 bg-red-500/10 text-red-400',
  };

  return (
    <div className={`border rounded-xl p-4 ${colors[color]}`}>
      <div className="flex items-center justify-between">
        <span className="text-2xl">{icon}</span>
        <span className="text-xs opacity-60">{label}</span>
      </div>
      <p className="text-2xl font-bold mt-1">{value}</p>
    </div>
  );
};

export default Dashboard;