// src/pages/merchant.tsx
import { useEffect, useState } from 'react';
import { merchantApi } from '../api/merchant.api';
import type { Merchant } from '../types/merchant.types';

export const MerchantPage = () => {
  const [merchants, setMerchants] = useState<Merchant[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchMerchants = async () => {
      try {
        setLoading(true);
        setError(null);
        
        // 🔥 PERBAIKAN: Response adalah ApiResponse<Merchant[]>
        // Data ada di res.data.data
        const res = await merchantApi.getAll();
        setMerchants(res.data ?? []);
        
        console.log('✅ Merchants loaded:', res.data);
      } catch (err: any) {
        console.error('❌ Error fetching merchants:', err);
        setError(err.response?.data?.message || 'Gagal memuat data merchant');
      } finally {
        setLoading(false);
      }
    };

    fetchMerchants();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 border-4 border-[#23583E] border-t-[#00E575] rounded-full animate-spin" />
          <span className="text-sm text-[#A5C9B8]">Memuat daftar merchant...</span>
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

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-white">Daftar Merchant</h1>
        <span className="text-sm text-[#A5C9B8]">
          Total: {merchants.length} merchant
        </span>
      </div>

      {merchants.length === 0 ? (
        <div className="bg-[#0D2E1F] border border-[#23583E] rounded-xl p-8 text-center">
          <div className="text-4xl mb-3">🏪</div>
          <h3 className="text-white font-bold text-lg mb-2">Belum Ada Merchant</h3>
          <p className="text-[#A5C9B8] text-sm">
            Belum ada merchant yang terdaftar saat ini.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {merchants.map((merchant) => (
            <MerchantCard key={merchant.id} merchant={merchant} />
          ))}
        </div>
      )}
    </div>
  );
};

// ============================================================
// MERCHANT CARD COMPONENT
// ============================================================
interface MerchantCardProps {
  merchant: Merchant;
}

const MerchantCard = ({ merchant }: MerchantCardProps) => {
  return (
    <div className="bg-[#0D2E1F] border border-[#23583E] rounded-xl p-4 hover:border-[#00E575] transition-all cursor-pointer">
      <div className="flex items-start gap-4">
        {merchant.logo && (
          <img 
            src={merchant.logo} 
            alt={merchant.name}
            className="w-16 h-16 rounded-xl object-cover border border-[#23583E]"
          />
        )}
        <div className="flex-1 min-w-0">
          <h3 className="font-bold text-white truncate">{merchant.name}</h3>
          <p className="text-xs text-[#A5C9B8] truncate">{merchant.category}</p>
          <div className="flex items-center gap-2 mt-1">
            <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${
              merchant.isOpen 
                ? 'bg-green-500/20 text-green-400 border border-green-500/30'
                : 'bg-red-500/20 text-red-400 border border-red-500/30'
            }`}>
              {merchant.isOpen ? '🟢 Buka' : '🔴 Tutup'}
            </span>
            {merchant.rating && (
              <span className="text-xs text-yellow-400">
                ⭐ {merchant.rating.toFixed(1)}
              </span>
            )}
          </div>
          <p className="text-xs text-[#A5C9B8] mt-1 truncate">{merchant.address}</p>
        </div>
      </div>
    </div>
  );
};

export default MerchantPage;