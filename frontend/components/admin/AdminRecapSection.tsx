// src/components/admin/AdminRecapSection.tsx
import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { formatRupiah } from '@obama/shared-utils';
import { AdminAPI } from '../../api';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Cell } from 'recharts';
import { BarChart2, RefreshCw, FileSpreadsheet, FileText, Search } from 'lucide-react';

export default function AdminRecapSection({ triggerToast }: { triggerToast: (m: string) => void }) {
  const [timeframe, setTimeframe] = useState<'daily' | 'weekly' | 'monthly'>('daily');
  const [activeCategory, setActiveCategory] = useState<'customers' | 'drivers' | 'transactions' | 'revenues'>('customers');
  const [searchQuery, setSearchQuery] = useState('');

  const { data: recapData, isLoading, refetch } = useQuery({
    queryKey: ['adminRecap', timeframe],
    queryFn: () => AdminAPI.getRecap(timeframe),
    refetchInterval: 15_000,
    refetchOnWindowFocus: true,
    staleTime: 5_000,
  });

  const [exportingFormat, setExportingFormat] = useState<'excel' | 'pdf' | null>(null);
  const handleExport = async (format: 'excel' | 'pdf') => {
    setExportingFormat(format);
    try {
      await AdminAPI.exportRecap(format, timeframe);
    } catch (err: any) {
      alert(err.response?.data?.error || `Gagal membuat file ${format === 'excel' ? 'Excel' : 'PDF'}.`);
    } finally {
      setExportingFormat(null);
    }
  };

  return (
    <div className="bg-[#0D2E1F] border border-[#23583E] p-6 rounded-3xl flex flex-col gap-5">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b border-[#23583E] pb-4">
        <div>
          <h3 className="text-xl font-black text-[#FFD700] flex items-center gap-2">
            <BarChart2 className="w-6 h-6 text-[#00E575]" /> Rekapitulasi Laporan Platform
          </h3>
          <p className="text-xs text-[#A5C9B8] mt-0.5">
            Laporan rekap menyeluruh pelanggan, driver & perolehan, volume transaksi, serta komisi platform.
          </p>
        </div>

        {/* Timeframe Scheme Buttons */}
        <div className="flex items-center gap-1.5 bg-[#06170E] p-1.5 rounded-2xl border border-[#23583E]">
          {[
            { id: 'daily', label: '📅 Harian (24 Jam)' },
            { id: 'weekly', label: '📅 Mingguan (7 Hari)' },
            { id: 'monthly', label: '📅 Bulanan (30 Hari)' },
          ].map((tf) => (
            <button
              key={tf.id}
              type="button"
              onClick={() => setTimeframe(tf.id as any)}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
                timeframe === tf.id
                  ? 'bg-[#00E575] text-[#071F14] shadow-md'
                  : 'text-[#A5C9B8] hover:text-white hover:bg-[#0D2E1F]'
              }`}
            >
              {tf.label}
            </button>
          ))}
          <button
            type="button"
            onClick={() => refetch()}
            className="p-1.5 text-[#A5C9B8] hover:text-[#00E575] rounded-xl transition-all ml-1"
            title="Refresh Data Rekap"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {/* Export PDF / Excel */}
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            disabled={exportingFormat !== null}
            onClick={() => handleExport('excel')}
            className="flex items-center gap-1.5 bg-[#1D6F42]/20 border border-[#1D6F42]/50 hover:border-[#1D6F42] text-[#4CAF50] text-xs font-bold px-3 py-2 rounded-xl transition-all disabled:opacity-50"
          >
            <FileSpreadsheet className="w-4 h-4" />
            {exportingFormat === 'excel' ? 'Membuat file...' : 'Unduh Excel'}
          </button>
          <button
            type="button"
            disabled={exportingFormat !== null}
            onClick={() => handleExport('pdf')}
            className="flex items-center gap-1.5 bg-red-500/15 border border-red-500/40 hover:border-red-500 text-red-400 text-xs font-bold px-3 py-2 rounded-xl transition-all disabled:opacity-50"
          >
            <FileText className="w-4 h-4" />
            {exportingFormat === 'pdf' ? 'Membuat file...' : 'Unduh PDF'}
          </button>
        </div>
      </div>

      {/* Category Tabs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        {[
          { id: 'customers', label: '👥 Pelanggan Terdaftar', count: recapData?.customers?.length || 0 },
          { id: 'drivers', label: '🏍️ Driver & Perolehan', count: recapData?.drivers?.length || 0 },
          { id: 'transactions', label: '📦 Volume Transaksi', count: recapData?.transactions?.length || 0 },
          { id: 'revenues', label: '💰 Platform Revenue', count: formatRupiah(recapData?.summary?.totalPlatformRevenue || 0) },
        ].map((cat) => (
          <button
            key={cat.id}
            type="button"
            onClick={() => setActiveCategory(cat.id as any)}
            className={`p-3 rounded-2xl border flex flex-col text-left transition-all ${
              activeCategory === cat.id
                ? 'bg-[#06170E] border-[#FFD700] text-white shadow-md'
                : 'bg-[#06170E]/60 border-[#23583E] text-[#A5C9B8] hover:border-[#00E575]'
            }`}
          >
            <span className="text-[10px] font-bold uppercase">{cat.label}</span>
            <span className="text-sm font-black text-[#FFD700] mt-1">{cat.count}</span>
          </button>
        ))}
      </div>

      {/* Search Input Filter */}
      <div className="flex items-center gap-2 bg-[#06170E] p-2.5 rounded-xl border border-[#23583E]">
        <Search className="w-4 h-4 text-[#A5C9B8]" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Cari berdasarkan nama, no. HP, alamat rute, atau ID..."
          className="bg-transparent text-xs text-white focus:outline-none w-full"
        />
        {searchQuery && (
          <button onClick={() => setSearchQuery('')} className="text-xs text-gray-400 hover:text-white font-bold">
            Clear
          </button>
        )}
      </div>

      {/* Content Table Views - 🔥 PERBAIKAN SYNTAX TERNARY DI SINI */}
      <div className="bg-[#06170E] rounded-2xl border border-[#23583E] overflow-hidden">
        {isLoading ? (
          <div className="p-8 text-center text-xs text-[#A5C9B8] animate-pulse">Memuat data rekapitulasi...</div>
        ) : activeCategory === 'customers' ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-[#0D2E1F] text-[#FFD700] text-[10px] uppercase border-b border-[#23583E]">
                <tr>
                  <th className="py-3 px-4 font-bold">Nama Lengkap</th>
                  <th className="py-3 px-4 font-bold">Email</th>
                  <th className="py-3 px-4 font-bold">No. HP Terdaftar</th>
                  <th className="py-3 px-4 font-bold">Tanggal Daftar</th>
                  <th className="py-3 px-4 font-bold text-center">Total Order</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#23583E] text-[#A5C9B8]">
                {(recapData?.customers || [])
                  .filter((c: any) =>
                    c.fullName.toLowerCase().includes(searchQuery.toLowerCase()) ||
                    c.phoneNumber.includes(searchQuery) ||
                    c.email.toLowerCase().includes(searchQuery.toLowerCase())
                  )
                  .map((c: any) => (
                    <tr key={c.id} className="hover:bg-[#0D2E1F]/50 transition-colors">
                      <td className="py-3 px-4 font-bold text-white">{c.fullName}</td>
                      <td className="py-3 px-4">{c.email}</td>
                      <td className="py-3 px-4 font-mono text-[#00E575] font-bold">{c.phoneNumber}</td>
                      <td className="py-3 px-4 text-[10px]">{new Date(c.registeredAt).toLocaleString('id-ID')}</td>
                      <td className="py-3 px-4 text-center font-bold text-white">{c.totalOrders}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        ) : activeCategory === 'drivers' ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-[#0D2E1F] text-[#FFD700] text-[10px] uppercase border-b border-[#23583E]">
                <tr>
                  <th className="py-3 px-4 font-bold">Mitra Pengemudi</th>
                  <th className="py-3 px-4 font-bold">No. HP Terdaftar</th>
                  <th className="py-3 px-4 font-bold">Kendaraan & Plat</th>
                  <th className="py-3 px-4 font-bold text-center">Order Selesai</th>
                  <th className="py-3 px-4 font-bold text-right">Perolehan Bersih (92%)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#23583E] text-[#A5C9B8]">
                {(recapData?.drivers || [])
                  .filter((d: any) =>
                    d.fullName.toLowerCase().includes(searchQuery.toLowerCase()) ||
                    d.phoneNumber.includes(searchQuery) ||
                    d.vehiclePlate.toLowerCase().includes(searchQuery.toLowerCase())
                  )
                  .map((d: any) => (
                    <tr key={d.id} className="hover:bg-[#0D2E1F]/50 transition-colors">
                      <td className="py-3 px-4 font-bold text-white">{d.fullName}</td>
                      <td className="py-3 px-4 font-mono text-[#00E575] font-bold">{d.phoneNumber}</td>
                      <td className="py-3 px-4">
                        <span className="font-bold text-white">{d.vehiclePlate}</span> ({d.vehicleModel})
                      </td>
                      <td className="py-3 px-4 text-center font-bold text-white">{d.completedOrdersCount}</td>
                      <td className="py-3 px-4 text-right font-black text-[#FFD700]">
                        {formatRupiah(d.perolehan)}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        ) : activeCategory === 'transactions' ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-[#0D2E1F] text-[#FFD700] text-[10px] uppercase border-b border-[#23583E]">
                <tr>
                  <th className="py-3 px-4 font-bold">Layanan & ID</th>
                  <th className="py-3 px-4 font-bold">Rute (Jemput ➡️ Tujuan)</th>
                  <th className="py-3 px-4 font-bold">Pelanggan Pemesan</th>
                  <th className="py-3 px-4 font-bold">Mitra Pengemudi</th>
                  <th className="py-3 px-4 font-bold text-right">Tarif</th>
                  <th className="py-3 px-4 font-bold text-center">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#23583E] text-[#A5C9B8]">
                {(recapData?.transactions || [])
                  .filter((t: any) =>
                    t.pickupAddress.toLowerCase().includes(searchQuery.toLowerCase()) ||
                    t.dropoffAddress.toLowerCase().includes(searchQuery.toLowerCase()) ||
                    t.customerName.toLowerCase().includes(searchQuery.toLowerCase()) ||
                    t.driverName.toLowerCase().includes(searchQuery.toLowerCase())
                  )
                  .map((t: any) => (
                    <tr key={t.id} className="hover:bg-[#0D2E1F]/50 transition-colors">
                      <td className="py-3 px-4 font-bold text-white">
                        <span className="text-[#FFD700] block">{t.serviceType}</span>
                        <span className="text-[9px] font-mono text-gray-400">#{t.id.substring(0, 8)}</span>
                      </td>
                      <td className="py-3 px-4 max-w-xs">
                        <span className="text-white block truncate">{t.pickupAddress}</span>
                        <span className="text-[#00E575] block truncate">➡️ {t.dropoffAddress}</span>
                      </td>
                      <td className="py-3 px-4">
                        <span className="font-bold text-white block">{t.customerName}</span>
                        <span className="text-[10px] font-mono text-[#00E575]">{t.customerPhone}</span>
                      </td>
                      <td className="py-3 px-4">
                        <span className="font-bold text-white block">{t.driverName}</span>
                        <span className="text-[10px] font-mono text-[#00E575]">{t.driverPhone}</span>
                      </td>
                      <td className="py-3 px-4 text-right font-black text-white">{formatRupiah(t.price)}</td>
                      <td className="py-3 px-4 text-center">
                        <span className={`px-2 py-0.5 rounded text-[9px] font-black ${
                          t.status === 'COMPLETED' ? 'bg-[#00E575]/20 text-[#00E575]' :
                          t.status === 'PENDING' ? 'bg-amber-500/20 text-amber-500' :
                          t.status === 'ACCEPTED' ? 'bg-cyan-500/20 text-cyan-500' : 'bg-red-500/20 text-red-500'
                        }`}>
                          {t.status}
                        </span>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-[#0D2E1F] text-[#FFD700] text-[10px] uppercase border-b border-[#23583E]">
                <tr>
                  <th className="py-3 px-4 font-bold">ID Order</th>
                  <th className="py-3 px-4 font-bold">Rute Perjalanan</th>
                  <th className="py-3 px-4 font-bold">Para Pihak</th>
                  <th className="py-3 px-4 font-bold text-right">Jarak</th>
                  <th className="py-3 px-4 font-bold text-right">Tarif Bruto</th>
                  <th className="py-3 px-4 font-bold text-right">Komisi Platform (8%)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#23583E] text-[#A5C9B8]">
                {(recapData?.platformRevenues || [])
                  .filter((r: any) =>
                    r.pickupAddress.toLowerCase().includes(searchQuery.toLowerCase()) ||
                    r.dropoffAddress.toLowerCase().includes(searchQuery.toLowerCase()) ||
                    r.customerName.toLowerCase().includes(searchQuery.toLowerCase()) ||
                    r.driverName.toLowerCase().includes(searchQuery.toLowerCase())
                  )
                  .map((r: any) => (
                    <tr key={r.id} className="hover:bg-[#0D2E1F]/50 transition-colors">
                      <td className="py-3 px-4 font-mono font-bold text-white">#{r.id.substring(0, 8)}</td>
                      <td className="py-3 px-4 max-w-xs">
                        <span className="text-white block truncate">{r.pickupAddress}</span>
                        <span className="text-[#00E575] block truncate">➡️ {r.dropoffAddress}</span>
                      </td>
                      <td className="py-3 px-4">
                        <span className="text-gray-300 block">Pemesan: <b className="text-white">{r.customerName}</b></span>
                        <span className="text-gray-300 block">Driver: <b className="text-white">{r.driverName}</b></span>
                      </td>
                      <td className="py-3 px-4 text-right font-bold text-white">{Number(r.distanceKm || 0).toFixed(2)} km</td>
                      <td className="py-3 px-4 text-right font-bold text-white">{formatRupiah(r.grossPrice)}</td>
                      <td className="py-3 px-4 text-right font-black text-[#00E575] text-sm">
                        {formatRupiah(r.platformRevenue)}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
