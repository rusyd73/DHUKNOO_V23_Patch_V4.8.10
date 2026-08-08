// components/admin/CommissionAuditBarChart.tsx
//
// 🆕 OPTIMASI BUNDLE: sebelumnya `import { BarChart, ... } from 'recharts'`
// ada langsung di puncak AdminApp.tsx, jadi setiap kali AdminApp (halaman
// Tarif Engine) di-buka -- termasuk saat admin hanya melihat tab
// Rules/Zones/Policies/Config yang TIDAK butuh grafik sama sekali -- seluruh
// bundle `recharts` (~366KB) ikut ter-download. Dengan mengeluarkan hanya
// bagian grafik ke file terpisah ini, AdminApp.tsx bisa me-lazy-load
// komponen ini via React.lazy() + Suspense HANYA saat tab "commissionAudit"
// benar-benar dibuka.
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Cell } from 'recharts';
import { formatRupiah } from '@obama/shared-utils';

interface CommissionAuditBarChartProps {
  dailyData: Array<{ date: string; dayLabel: string; orderCount: number; totalCommission: number }>;
}

export default function CommissionAuditBarChart({ dailyData }: CommissionAuditBarChartProps) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={dailyData || []} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#23583E" vertical={false} />
        <XAxis dataKey="dayLabel" stroke="#A5C9B8" fontSize={10} tickLine={false} axisLine={{ stroke: '#23583E' }} />
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
          {(dailyData || []).map((entry, index) => (
            <Cell key={`cell-${index}`} fill={entry.totalCommission > 0 ? '#00E575' : '#1e3e2d'} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
