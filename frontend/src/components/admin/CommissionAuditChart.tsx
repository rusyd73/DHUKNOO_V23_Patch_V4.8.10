// src/components/admin/CommissionAuditChart.tsx
import React from 'react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Cell } from 'recharts';
import { formatRupiah } from '@obama/shared-utils';
import { RefreshCw, TrendingUp } from 'lucide-react'; // ✅ Tambahkan TrendingUp di sini

interface CommissionAuditChartProps {
  auditData: any;
  isLoadingAudit: boolean;
  refetchAudit: () => void;
}

export default function CommissionAuditChart({ auditData, isLoadingAudit, refetchAudit }: CommissionAuditChartProps) {
  return (
    <div className="bg-[#06170E] border border-[#23583E] p-4 rounded-2xl flex flex-col gap-3">
      <div className="flex justify-between items-center border-b border-[#23583E] pb-3">
        <div>
          <h4 className="text-xs font-black text-white uppercase tracking-wider flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-[#00E575]" /> Grafik Komisi Platform Harian
          </h4>
          <p className="text-[10px] text-[#A5C9B8] mt-0.5">
            Visualisasi total pendapatan komisi bersih yang diperoleh sistem DHUKNOO per hari
          </p>
        </div>
        <button
          onClick={() => refetchAudit()}
          className="flex items-center gap-1 bg-[#0D2E1F] border border-[#23583E] hover:border-[#00E575] text-[#A5C9B8] hover:text-white text-[10px] font-bold px-2.5 py-1.5 rounded-lg transition-all"
        >
          <RefreshCw className={`w-3 h-3 ${isLoadingAudit ? 'animate-spin' : ''}`} /> Refresh Data
        </button>
      </div>

      {isLoadingAudit ? (
        <div className="h-60 flex items-center justify-center text-xs text-[#A5C9B8] animate-pulse">
          Memuat grafik audit komisi...
        </div>
      ) : (
        <div className="w-full h-64 pt-2">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={auditData?.dailyData || []} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#23583E" vertical={false} />
              <XAxis
                dataKey="dayLabel"
                stroke="#A5C9B8"
                fontSize={10}
                tickLine={false}
                axisLine={{ stroke: '#23583E' }}
              />
              <YAxis
                stroke="#A5C9B8"
                fontSize={10}
                tickLine={false}
                axisLine={{ stroke: '#23583E' }}
                tickFormatter={(val: number) => `Rp${(val / 1000).toFixed(0)}k`}
              />
              <Tooltip
                content={({ active, payload, label }: any) => {
                  if (active && payload && payload.length) {
                    const item = payload[0].payload;
                    return (
                      <div className="bg-[#0D2E1F] border border-[#00E575] p-3 rounded-xl shadow-xl text-xs flex flex-col gap-1">
                        <span className="font-black text-[#FFD700]">{label}</span>
                        <div className="text-white font-bold">
                          Komisi: <span className="text-[#00E575]">{formatRupiah(item.totalCommission)}</span>
                        </div>
                        <div className="text-[#A5C9B8] text-[10px]">
                          Order Selesai: <strong className="text-white">{item.orderCount}</strong>
                        </div>
                      </div>
                    );
                  }
                  return null;
                }}
              />
              <Bar dataKey="totalCommission" radius={[6, 6, 0, 0]}>
                {(auditData?.dailyData || []).map((entry: any, index: number) => (
                  <Cell
                    key={`cell-${index}`}
                    fill={entry.totalCommission > 0 ? '#00E575' : '#1e3e2d'}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}