// src/pages/Dashboard.tsx
import React, { useEffect, useState } from 'react';
import { useAuthStore } from '../store/useAuthStore';
import { merchantApi } from '../api/merchant.api';
import { 
  ResponsiveContainer, AreaChart, Area, BarChart, Bar, 
  XAxis, YAxis, Tooltip, CartesianGrid, Legend 
} from 'recharts';
import { 
  Store, Menu, Receipt, BarChart2, Plus, Settings, DollarSign,
  TrendingUp, Calendar, Filter, ArrowUpRight
} from 'lucide-react';

// ============================================
// UTILITY FUNCTIONS
// ============================================
const navigate = (path: string) => {
  window.location.href = path;
};

// ============================================
// LOADING COMPONENT (Enhanced from File 1)
// ============================================
const Loading = () => (
  <div className="flex flex-col items-center justify-center py-16 text-[#A5C9B8]">
    <div className="w-10 h-10 border-4 border-[#22C55E] border-t-transparent rounded-full animate-spin mb-3"></div>
    <span className="text-sm font-semibold">Memuat Data Dashboard & Grafik...</span>
  </div>
);

// ============================================
// STAT CARD COMPONENT (Enhanced from File 1)
// ============================================
const StatCard = ({ title, value, icon, change }: any) => (
  <div className="glass-card p-5 rounded-2xl border border-[#23583E]/60 flex flex-col justify-between gap-3">
    <div className="flex items-center justify-between">
      <span className="text-xs text-[#A5C9B8] font-semibold">{title}</span>
      <div className="w-9 h-9 rounded-xl bg-[#22C55E]/10 text-[#22C55E] flex items-center justify-center border border-[#22C55E]/20">
        {icon}
      </div>
    </div>
    <div>
      <p className="text-2xl font-black text-white font-heading">{value}</p>
      {change && (
        <span className="text-[10px] text-[#22C55E] font-bold flex items-center gap-1 mt-1">
          <ArrowUpRight className="w-3 h-3" /> {change}
        </span>
      )}
    </div>
  </div>
);

// ============================================
// QUICK ACTION CARD COMPONENT (Enhanced from File 1)
// ============================================
const QuickActionCard = ({ title, description, icon, onClick }: any) => (
  <div 
    onClick={onClick}
    className="glass-card p-5 rounded-2xl border border-[#23583E]/60 cursor-pointer hover:border-[#22C55E] transition-all group"
  >
    <div className="flex items-center gap-3.5">
      <div className="w-10 h-10 rounded-2xl bg-[#F59E0B]/10 text-[#F59E0B] flex items-center justify-center border border-[#F59E0B]/20 group-hover:scale-110 transition-transform">
        {icon}
      </div>
      <div>
        <p className="text-sm font-bold text-white font-heading group-hover:text-[#22C55E] transition-colors">{title}</p>
        <p className="text-xs text-[#A5C9B8] mt-0.5">{description}</p>
      </div>
    </div>
  </div>
);

// ============================================
// MOCK DATA FOR CHARTS (From File 1)
// ============================================
const mockWeeklyAnalytics = [
  { day: 'Sen', totalRevenue: 145000, orderCount: 12, avgValue: 12083 },
  { day: 'Sel', totalRevenue: 220000, orderCount: 18, avgValue: 12222 },
  { day: 'Rab', totalRevenue: 185000, orderCount: 15, avgValue: 12333 },
  { day: 'Kam', totalRevenue: 290000, orderCount: 24, avgValue: 12083 },
  { day: 'Jum', totalRevenue: 340000, orderCount: 28, avgValue: 12142 },
  { day: 'Sab', totalRevenue: 480000, orderCount: 39, avgValue: 12307 },
  { day: 'Min', totalRevenue: 520000, orderCount: 42, avgValue: 12380 },
];

// ============================================
// MAIN COMPONENT INTERFACE (Merged from both files)
// ============================================
interface MerchantDashboardProps {
  // 🆕 FIX: onNavigateTab now supports all tabs including 'dashboard'
  onNavigateTab?: (tab: 'dashboard' | 'products' | 'orders' | 'settings') => void;
  triggerToast?: (msg: string) => void;
}

// ============================================
// MAIN DASHBOARD COMPONENT
// ============================================
export function MerchantDashboard({ onNavigateTab, triggerToast }: MerchantDashboardProps = {}) {
  const { user, theme } = useAuthStore();
  const [merchant, setMerchant] = useState<any>(null);
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [chartMetric, setChartMetric] = useState<'revenue' | 'orders'>('revenue');
  const [timeframe, setTimeframe] = useState<'7d' | '30d'>('7d');

  // ============================================
  // DATA FETCHING (Merged with fixes from File 2)
  // ============================================
  useEffect(() => {
    const fetchData = async () => {
      const token = useAuthStore.getState().token;
      if (!token) {
        setLoading(false);
        return;
      }

      try {
        // 🆕 FIX: Proper data extraction from axios response (from File 2)
        const merchantRes = await merchantApi.getMyMerchant();
        const statsRes = await merchantApi.getMyStats();
        // Backend wraps payload as { success, data }
        setMerchant(merchantRes.data?.data);
        setStats(statsRes.data?.data);
      } catch (error: any) {
        if (error?.response?.status !== 401) {
          console.error('Failed to fetch merchant data:', error);
          if (triggerToast) {
            triggerToast('Gagal memuat data dashboard');
          }
        }
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [user, triggerToast]);

  // ============================================
  // HELPER FUNCTIONS
  // ============================================
  const formatRupiah = (val: number) => `Rp${val.toLocaleString('id-ID')}`;
  const isLight = theme === 'light';

  // ============================================
  // HANDLE TOGGLE MERCHANT (Enhanced with toast)
  // ============================================
  const handleToggleMerchant = async () => {
    if (!merchant) return;
    
    try {
      await merchantApi.toggleMerchant(merchant.id, !merchant.isOpen);
      setMerchant({ ...merchant, isOpen: !merchant.isOpen });
      if (triggerToast) {
        triggerToast(merchant.isOpen ? 'Toko berhasil ditutup' : 'Toko berhasil dibuka');
      }
    } catch (error) {
      console.error('Failed to toggle merchant:', error);
      if (triggerToast) {
        triggerToast('Gagal mengubah status toko');
      }
    }
  };

  // ============================================
  // RENDER STATES
  // ============================================
  if (loading) return <Loading />;

  if (!merchant) {
    return (
      <div className="glass-card text-center py-12 px-6 rounded-3xl border border-[#23583E]/60 max-w-lg mx-auto my-10">
        <Store className="w-12 h-12 text-[#22C55E] mx-auto mb-4" />
        <h2 className="text-xl font-bold text-white font-heading">Belum Ada Profil Merchant</h2>
        <p className="text-xs text-[#A5C9B8] mt-2 leading-relaxed">
          Silakan daftarkan atau aktifkan merchant Anda terlebih dahulu untuk mengakses dashboard statistik.
        </p>
      </div>
    );
  }

  // ============================================
  // MAIN RENDER
  // ============================================
  return (
    <div className="flex flex-col gap-6 p-2 md:p-6 max-w-7xl mx-auto">
      {/* ==========================================
          HEADER SECTION (Merged from both files)
          ========================================== */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[#23583E]/60 pb-5">
        <div>
          <h1 className="text-2xl md:text-3xl font-black text-white font-heading flex items-center gap-3">
            <span>🏪 {merchant?.name || 'Dashboard Toko'}</span>
          </h1>
          <p className="text-xs text-[#A5C9B8] mt-1">
            Ringkasan performa penjualan, statistik pesanan, dan grafik tren realtime.
          </p>
        </div>

        {/* 🆕 Status Toggle Button (Enhanced from File 2 with toast) */}
        <div className="flex items-center gap-3">
          <div className="flex flex-col items-end">
            {/* 🆕 Nama pemilik toko — identitas akun yang sedang login, beda
                dari nama toko di atas, ditampilkan tepat di atas status
                Buka/Tutup (ruang kosong pojok kanan atas). */}
            <span className="text-[10px] text-[#A5C9B8] font-semibold">
              {merchant?.owner?.fullName || 'Pemilik Toko'}
            </span>
            <span className="text-[10px] text-[#A5C9B8]/70 font-semibold">Status Layanan</span>
            <span className={`text-xs font-bold ${merchant?.isOpen ? 'text-[#22C55E]' : 'text-red-400'}`}>
              {merchant?.isOpen ? '🟢 Toko Buka' : '🔴 Toko Tutup'}
            </span>
          </div>
          <button
            type="button"
            onClick={handleToggleMerchant}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all shadow-md cursor-pointer ${
              merchant?.isOpen
                ? 'bg-red-500/20 text-red-400 border border-red-500/40 hover:bg-red-500/30'
                : 'bg-[#22C55E] text-[#05110A] hover:bg-[#16A34A]'
            }`}
          >
            {merchant?.isOpen ? 'Tutup Toko' : 'Buka Toko'}
          </button>
        </div>
      </div>

      {/* ==========================================
          STATISTICS CARDS (Merged from both files)
          ========================================== */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard 
          title="Total Menu / Produk" 
          value={stats?.productCount || 0} 
          icon={<Menu className="w-5 h-5" />} 
          change="+2 menu aktif"
        />
        <StatCard 
          title="Pesanan Selesai" 
          value={stats?.orderCount || 0} 
          icon={<Receipt className="w-5 h-5" />} 
          change="+14.2% minggu ini"
        />
        <StatCard 
          title="Total Pendapatan Toko" 
          value={formatRupiah(stats?.totalRevenue || 0)} 
          icon={<DollarSign className="w-5 h-5" />} 
          change="+21.5% bulan ini"
        />
      </div>

      {/* ==========================================
          CHART SECTION (From File 1 - Enhanced)
          ========================================== */}
      <div className="glass-card rounded-3xl p-6 border border-[#23583E]/60 flex flex-col gap-6 shadow-xl">
        {/* Chart Header Controls */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-[#23583E]/40 pb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-[#22C55E]/15 text-[#22C55E] flex items-center justify-center font-bold">
              <BarChart2 className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base md:text-lg font-bold text-white font-heading">
                Grafik Analitik Penjualan & Order
              </h2>
              <p className="text-xs text-[#A5C9B8]">
                Visualisasi tren harian pendapatan dan volume pesanan toko
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Metric Selector */}
            <div className="bg-[#06170E] border border-[#1F4A34] rounded-xl p-1 flex items-center gap-1">
              <button
                type="button"
                onClick={() => setChartMetric('revenue')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                  chartMetric === 'revenue' 
                    ? 'bg-[#22C55E] text-[#05110A] shadow-md' 
                    : 'text-[#A5C9B8] hover:text-white'
                }`}
              >
                Pendapatan (Rp)
              </button>
              <button
                type="button"
                onClick={() => setChartMetric('orders')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                  chartMetric === 'orders' 
                    ? 'bg-[#F59E0B] text-[#05110A] shadow-md' 
                    : 'text-[#A5C9B8] hover:text-white'
                }`}
              >
                Jumlah Order
              </button>
            </div>

            {/* Timeframe Selector */}
            <div className="bg-[#06170E] border border-[#1F4A34] rounded-xl p-1 flex items-center gap-1">
              <button
                type="button"
                onClick={() => setTimeframe('7d')}
                className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold cursor-pointer ${
                  timeframe === '7d' ? 'bg-[#103826] text-[#22C55E]' : 'text-[#A5C9B8]'
                }`}
              >
                7 Hari
              </button>
              <button
                type="button"
                onClick={() => setTimeframe('30d')}
                className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold cursor-pointer ${
                  timeframe === '30d' ? 'bg-[#103826] text-[#22C55E]' : 'text-[#A5C9B8]'
                }`}
              >
                30 Hari
              </button>
            </div>
          </div>
        </div>

        {/* Recharts Container */}
        <div className="w-full h-72 md:h-80 pt-2">
          <ResponsiveContainer width="100%" height="100%">
            {chartMetric === 'revenue' ? (
              <AreaChart data={mockWeeklyAnalytics} margin={{ top: 10, right: 10, left: 10, bottom: 0 }}>
                <defs>
                  <linearGradient id="colorRevenue" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={isLight ? '#16A34A' : '#22C55E'} stopOpacity={0.4} />
                    <stop offset="95%" stopColor={isLight ? '#16A34A' : '#22C55E'} stopOpacity={0.0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke={isLight ? '#D2E5DB' : '#1F4A34'} vertical={false} />
                <XAxis 
                  dataKey="day" 
                  stroke={isLight ? '#38604E' : '#A5C9B8'} 
                  fontSize={12} 
                  tickLine={false} 
                />
                <YAxis 
                  stroke={isLight ? '#38604E' : '#A5C9B8'} 
                  fontSize={11} 
                  tickLine={false}
                  tickFormatter={(v) => `Rp${v / 1000}k`}
                />
                <Tooltip 
                  contentStyle={{ 
                    backgroundColor: isLight ? '#FFFFFF' : '#06170E', 
                    borderColor: isLight ? '#D2E5DB' : '#22C55E',
                    borderRadius: '12px',
                    color: isLight ? '#0A2B1D' : '#FFFFFF',
                    boxShadow: '0 8px 24px rgba(0,0,0,0.2)',
                    fontSize: '12px',
                    fontWeight: 'bold'
                  }}
                  formatter={(value: any) => [formatRupiah(Number(value)), 'Pendapatan']}
                />
                <Area 
                  type="monotone" 
                  dataKey="totalRevenue" 
                  stroke={isLight ? '#16A34A' : '#22C55E'} 
                  strokeWidth={3}
                  fillOpacity={1} 
                  fill="url(#colorRevenue)" 
                />
              </AreaChart>
            ) : (
              <BarChart data={mockWeeklyAnalytics} margin={{ top: 10, right: 10, left: 10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={isLight ? '#D2E5DB' : '#1F4A34'} vertical={false} />
                <XAxis 
                  dataKey="day" 
                  stroke={isLight ? '#38604E' : '#A5C9B8'} 
                  fontSize={12} 
                  tickLine={false} 
                />
                <YAxis 
                  stroke={isLight ? '#38604E' : '#A5C9B8'} 
                  fontSize={11} 
                  tickLine={false}
                />
                <Tooltip 
                  contentStyle={{ 
                    backgroundColor: isLight ? '#FFFFFF' : '#06170E', 
                    borderColor: isLight ? '#D2E5DB' : '#F59E0B',
                    borderRadius: '12px',
                    color: isLight ? '#0A2B1D' : '#FFFFFF',
                    boxShadow: '0 8px 24px rgba(0,0,0,0.2)',
                    fontSize: '12px',
                    fontWeight: 'bold'
                  }}
                  formatter={(value: any) => [`${value} pesanan`, 'Volume Order']}
                />
                <Bar 
                  dataKey="orderCount" 
                  fill={isLight ? '#D97706' : '#F59E0B'} 
                  radius={[8, 8, 0, 0]} 
                />
              </BarChart>
            )}
          </ResponsiveContainer>
        </div>

        {/* Insight Footer */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-4 border-t border-[#23583E]/40 text-xs">
          <div className="flex items-center gap-2 text-[#A5C9B8]">
            <span className="w-2 h-2 rounded-full bg-[#22C55E]"></span>
            <span>Jam Sibuk: <strong className="text-white">11:00 - 13:30 (Makan Siang)</strong></span>
          </div>
          <div className="flex items-center gap-2 text-[#A5C9B8]">
            <span className="w-2 h-2 rounded-full bg-[#F59E0B]"></span>
            <span>Rata-Rata Order: <strong className="text-white">Rp18.500 / pesanan</strong></span>
          </div>
          <div className="flex items-center gap-2 text-[#A5C9B8]">
            <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
            <span>Tingkat Penyelesaian: <strong className="text-white">98.4%</strong></span>
          </div>
        </div>
      </div>

      {/* ==========================================
          QUICK ACTION GRID (Merged from both files)
          ========================================== */}
      <div>
        <h3 className="text-base font-bold text-white font-heading mb-3">Aksi Cepat Manajemen</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <QuickActionCard 
            title="Kelola Produk / Menu" 
            description="Tambahkan, edit harga, atau atur ketersediaan menu" 
            icon={<Plus className="w-5 h-5" />} 
            onClick={() => onNavigateTab ? onNavigateTab('products') : navigate('/merchant/products')} 
          />
          <QuickActionCard 
            title="Kelola Pesanan Masuk" 
            description="Pantau dan proses pesanan pelanggan secara realtime" 
            icon={<Receipt className="w-5 h-5" />} 
            onClick={() => onNavigateTab ? onNavigateTab('orders') : navigate('/merchant/orders')} 
          />
          <QuickActionCard 
            title="Pengaturan Toko" 
            description="Atur operasional toko & alarm notifikasi" 
            icon={<Settings className="w-5 h-5" />} 
            onClick={() => onNavigateTab ? onNavigateTab('settings') : navigate('/merchant/settings')} 
          />
        </div>
      </div>
    </div>
  );
}