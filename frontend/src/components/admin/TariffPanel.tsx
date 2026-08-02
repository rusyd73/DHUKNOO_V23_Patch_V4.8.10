// src/components/admin/TariffPanel.tsx
import React, { useState, Suspense } from 'react'; // Tambahkan Suspense
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { formatRupiah } from '@obama/shared-utils';
import { AdminAPI, TariffAPI } from '../../api';
import { Settings, PlusCircle, Power, Percent, TrendingUp, DollarSign, MapIcon, ClipboardList, RefreshCw } from 'lucide-react';

// 🚀 LAZY LOAD: Pindahkan library recharts (yang berat) ke komponen terpisah
const CommissionAuditChart = React.lazy(() => import('./CommissionAuditChart'));

function TariffPanel({ triggerToast }: { triggerToast: (msg: string) => void }) {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<'rules' | 'zones' | 'policies' | 'versions' | 'commissionAudit' | 'config'>('rules');

  const { data: zonesData } = useQuery({ queryKey: ['tariffZones'], queryFn: TariffAPI.listZones });
  const { data: rulesData } = useQuery({ queryKey: ['tariffRules'], queryFn: () => TariffAPI.listRules() });
  const { data: policiesData } = useQuery({ queryKey: ['tariffPolicies'], queryFn: TariffAPI.listRegionalPolicies });
  const { data: versionsData } = useQuery({ queryKey: ['tariffVersions'], queryFn: TariffAPI.listVersions });
  const { data: configData } = useQuery({ queryKey: ['tariffConfig'], queryFn: TariffAPI.listConfig });
  const { data: auditData, isLoading: isLoadingAudit, refetch: refetchAudit } = useQuery({
    queryKey: ['commissionAudit'],
    queryFn: AdminAPI.getCommissionAudit,
    enabled: activeTab === 'commissionAudit',
  });

  const zones = zonesData?.zones || [];
  const rules = rulesData?.rules || [];
  const policies = policiesData?.policies || [];
  const versions = versionsData?.versions || [];
  const config = configData?.config || [];

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ['tariffZones'] });
    queryClient.invalidateQueries({ queryKey: ['tariffRules'] });
    queryClient.invalidateQueries({ queryKey: ['tariffPolicies'] });
    queryClient.invalidateQueries({ queryKey: ['tariffVersions'] });
    queryClient.invalidateQueries({ queryKey: ['tariffConfig'] });
    queryClient.invalidateQueries({ queryKey: ['commissionAudit'] });
  };

  const onErr = (fallback: string) => (err: any) => triggerToast(err.response?.data?.error || fallback);
  const onOk = (fallback: string) => (res: any) => {
    triggerToast(res.message || fallback);
    invalidateAll();
  };

  const createZoneMutation = useMutation({
    mutationFn: (name: string) => TariffAPI.createZone(name),
    onSuccess: onOk('Zona dibuat!'),
    onError: onErr('Gagal membuat zona!'),
  });
  const createRuleMutation = useMutation({
    mutationFn: (payload: any) => TariffAPI.createRule(payload),
    onSuccess: onOk('Aturan tarif dibuat!'),
    onError: onErr('Gagal membuat aturan tarif!'),
  });
  const toggleRuleMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) => TariffAPI.updateRule(id, { isActive }),
    onSuccess: onOk('Status aturan tarif diperbarui!'),
    onError: onErr('Gagal mengubah status aturan!'),
  });
  const createPolicyMutation = useMutation({
    mutationFn: (payload: any) => TariffAPI.createRegionalPolicy(payload),
    onSuccess: onOk('Kebijakan regional dibuat!'),
    onError: onErr('Gagal membuat kebijakan regional!'),
  });
  const createVersionMutation = useMutation({
    mutationFn: (payload: any) => TariffAPI.createVersion(payload),
    onSuccess: onOk('Versi tarif dibuat! Aktifkan supaya berlaku.'),
    onError: onErr('Gagal membuat versi tarif!'),
  });
  const activateVersionMutation = useMutation({
    mutationFn: (id: string) => TariffAPI.activateVersion(id),
    onSuccess: onOk('Versi tarif diaktifkan! Berlaku langsung, tanpa rilis aplikasi baru.'),
    onError: onErr('Gagal mengaktifkan versi tarif!'),
  });
  const updateConfigMutation = useMutation({
    mutationFn: ({ key, value }: { key: string; value: string }) => TariffAPI.updateConfig(key, value),
    onSuccess: onOk('Konfigurasi disimpan!'),
    onError: onErr('Gagal menyimpan konfigurasi!'),
  });

  // ── Form state (sederhana, disimpan sebagai objek per-form) ──
  const [zoneName, setZoneName] = useState('');
  const [ruleForm, setRuleForm] = useState({ zoneId: '', serviceType: 'BIKE', baseFare: '', pickupFee: '0', perKmFee: '', perMinuteWaitFee: '0' });
  const [policyForm, setPolicyForm] = useState({ zoneId: '', tollFee: '0', parkingFee: '0', weatherSurcharge: '0', holidaySurcharge: '0' });
  const [versionForm, setVersionForm] = useState({ versionName: '', description: '', tiers: [{ maxOrderValue: '20000', rate: '0.08' }, { maxOrderValue: '50000', rate: '0.07' }, { maxOrderValue: '100000', rate: '0.06' }, { maxOrderValue: '', rate: '0.05' }] });
  const [depositValue, setDepositValue] = useState('');

  const tabs: { key: typeof activeTab; label: string }[] = [
    { key: 'rules', label: 'Aturan Tarif' },
    { key: 'zones', label: 'Zona' },
    { key: 'policies', label: 'Kebijakan Regional' },
    { key: 'versions', label: 'Versi Komisi' },
    { key: 'commissionAudit', label: 'Commission Audit 📊' },
    { key: 'config', label: 'Konfigurasi' },
  ];

  const inputCls = "w-full bg-[#06170E] border border-[#23583E] rounded-lg px-3 py-2 text-xs text-white placeholder:text-gray-500 focus:outline-none focus:border-[#00E575]";
  const labelCls = "text-[10px] font-bold text-[#A5C9B8] uppercase tracking-wide";

  return (
    <div className="bg-[#0D2E1F] border border-[#FFD700]/30 p-6 rounded-3xl flex flex-col gap-5">
      <div>
        <span className="text-xs font-black text-[#FFD700] uppercase tracking-wider flex items-center gap-1.5">
          <Settings className="w-5 h-5" /> Tariff Engine — Kelola Tarif
        </span>
        <p className="text-[10px] text-[#A5C9B8] mt-1 leading-relaxed">
          Semua komponen tarif (Tarif Dasar + Pickup + Perjalanan + Tunggu + Tol + Parkir + Cuaca + Hari Libur − Promo) dan komisi platform tiered dikendalikan dari sini — berlaku langsung tanpa rilis aplikasi baru.
        </p>
      </div>

      <div className="flex gap-2 flex-wrap border-b border-[#23583E] pb-3">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            className={`text-[10px] font-bold px-3 py-2 rounded-lg transition-all ${activeTab === t.key ? 'bg-[#FFD700] text-[#06170E]' : 'bg-[#06170E] text-[#A5C9B8] hover:text-white'}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ── ATURAN TARIF ── */}
      {activeTab === 'rules' && (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 md:grid-cols-6 gap-2 items-end bg-[#06170E]/50 p-4 rounded-xl">
            <div className="flex flex-col gap-1">
              <label className={labelCls}>Zona (opsional)</label>
              <select className={inputCls} value={ruleForm.zoneId} onChange={(e) => setRuleForm({ ...ruleForm, zoneId: e.target.value })}>
                <option value="">Semua Zona (fallback)</option>
                {zones.map((z: any) => <option key={z.id} value={z.id}>{z.name}</option>)}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className={labelCls}>Layanan</label>
              <select className={inputCls} value={ruleForm.serviceType} onChange={(e) => setRuleForm({ ...ruleForm, serviceType: e.target.value })}>
                <option value="BIKE">BIKE</option>
                <option value="CAR">CAR</option>
                <option value="SEND">SEND</option>
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className={labelCls}>Tarif Dasar</label>
              <input className={inputCls} type="number" placeholder="5000" value={ruleForm.baseFare} onChange={(e) => setRuleForm({ ...ruleForm, baseFare: e.target.value })} />
            </div>
            <div className="flex flex-col gap-1">
              <label className={labelCls}>Biaya Pickup</label>
              <input className={inputCls} type="number" value={ruleForm.pickupFee} onChange={(e) => setRuleForm({ ...ruleForm, pickupFee: e.target.value })} />
            </div>
            <div className="flex flex-col gap-1">
              <label className={labelCls}>Rp/Km</label>
              <input className={inputCls} type="number" placeholder="2000" value={ruleForm.perKmFee} onChange={(e) => setRuleForm({ ...ruleForm, perKmFee: e.target.value })} />
            </div>
            <div className="flex flex-col gap-1">
              <label className={labelCls}>Rp/Menit Tunggu</label>
              <input className={inputCls} type="number" value={ruleForm.perMinuteWaitFee} onChange={(e) => setRuleForm({ ...ruleForm, perMinuteWaitFee: e.target.value })} />
            </div>
            <button
              onClick={() => {
                if (!ruleForm.baseFare || !ruleForm.perKmFee) { triggerToast('Tarif Dasar dan Rp/Km wajib diisi!'); return; }
                createRuleMutation.mutate({
                  zoneId: ruleForm.zoneId || undefined,
                  serviceType: ruleForm.serviceType,
                  baseFare: Number(ruleForm.baseFare),
                  pickupFee: Number(ruleForm.pickupFee || 0),
                  perKmFee: Number(ruleForm.perKmFee),
                  perMinuteWaitFee: Number(ruleForm.perMinuteWaitFee || 0),
                });
              }}
              disabled={createRuleMutation.isPending}
              className="col-span-2 md:col-span-6 flex items-center justify-center gap-1.5 bg-[#00E575] hover:bg-[#00E575]/80 disabled:opacity-50 text-[#06170E] text-xs font-black py-2.5 rounded-lg transition-all"
            >
              <PlusCircle className="w-4 h-4 flex-shrink-0" /> 
            </button>
          </div>

          <div className="flex flex-col gap-2">
            {rules.length === 0 ? (
              <div className="text-center text-[10px] text-[#A5C9B8]/60 py-6 border border-dashed border-[#23583E] rounded-xl">Belum ada aturan tarif.</div>
            ) : rules.map((r: any) => (
              <div key={r.id} className={`flex flex-wrap justify-between items-center gap-2 bg-[#06170E] border ${r.isActive ? 'border-[#23583E]' : 'border-red-500/30 opacity-50'} p-3 rounded-xl text-[10px]`}>
                <div className="flex flex-col">
                  <span className="font-bold text-white">{r.serviceType} — {r.zone?.name || 'Semua Zona'}</span>
                  <span className="text-[#A5C9B8]">
                    Dasar {formatRupiah(Number(r.baseFare))} + Pickup {formatRupiah(Number(r.pickupFee))} + {formatRupiah(Number(r.perKmFee))}/km + {formatRupiah(Number(r.perMinuteWaitFee))}/menit tunggu
                  </span>
                </div>
                <button
                  onClick={() => toggleRuleMutation.mutate({ id: r.id, isActive: !r.isActive })}
                  className={`flex items-center gap-1 text-[10px] font-black py-1.5 px-3 rounded-lg transition-all ${r.isActive ? 'bg-red-500/20 text-red-400' : 'bg-[#00E575]/20 text-[#00E575]'}`}
                >
                  <Power className="w-3 h-3 flex-shrink-0" /> 
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── ZONA ── */}
      {activeTab === 'zones' && (
        <div className="flex flex-col gap-4">
          <div className="flex gap-2 bg-[#06170E]/50 p-4 rounded-xl">
            <input className={inputCls} placeholder="Nama zona, mis. Kota Batu" value={zoneName} onChange={(e) => setZoneName(e.target.value)} />
            <button
              onClick={() => { if (!zoneName.trim()) return; createZoneMutation.mutate(zoneName.trim()); setZoneName(''); }}
              disabled={createZoneMutation.isPending}
              className="flex items-center gap-1.5 bg-[#00E575] hover:bg-[#00E575]/80 disabled:opacity-50 text-[#06170E] text-xs font-black py-2.5 px-4 rounded-lg whitespace-nowrap"
            >
              <PlusCircle className="w-4 h-4 flex-shrink-0" /> 
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            {zones.length === 0 ? (
              <div className="text-center w-full text-[10px] text-[#A5C9B8]/60 py-6 border border-dashed border-[#23583E] rounded-xl">Belum ada zona.</div>
            ) : zones.map((z: any) => (
              <div key={z.id} className="flex items-center gap-1.5 bg-[#06170E] border border-[#23583E] px-3 py-2 rounded-full text-[10px] font-bold text-white">
                <MapIcon className="w-3 h-3 text-[#FFD700]" /> {z.name}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── KEBIJAKAN REGIONAL ── */}
      {activeTab === 'policies' && (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2 items-end bg-[#06170E]/50 p-4 rounded-xl">
            <div className="flex flex-col gap-1">
              <label className={labelCls}>Zona</label>
              <select className={inputCls} value={policyForm.zoneId} onChange={(e) => setPolicyForm({ ...policyForm, zoneId: e.target.value })}>
                <option value="">Pilih zona...</option>
                {zones.map((z: any) => <option key={z.id} value={z.id}>{z.name}</option>)}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className={labelCls}>Tol</label>
              <input className={inputCls} type="number" value={policyForm.tollFee} onChange={(e) => setPolicyForm({ ...policyForm, tollFee: e.target.value })} />
            </div>
            <div className="flex flex-col gap-1">
              <label className={labelCls}>Parkir</label>
              <input className={inputCls} type="number" value={policyForm.parkingFee} onChange={(e) => setPolicyForm({ ...policyForm, parkingFee: e.target.value })} />
            </div>
            <div className="flex flex-col gap-1">
              <label className={labelCls}>Cuaca Buruk</label>
              <input className={inputCls} type="number" value={policyForm.weatherSurcharge} onChange={(e) => setPolicyForm({ ...policyForm, weatherSurcharge: e.target.value })} />
            </div>
            <div className="flex flex-col gap-1">
              <label className={labelCls}>Hari Libur</label>
              <input className={inputCls} type="number" value={policyForm.holidaySurcharge} onChange={(e) => setPolicyForm({ ...policyForm, holidaySurcharge: e.target.value })} />
            </div>
            <button
              onClick={() => {
                if (!policyForm.zoneId) { triggerToast('Pilih zona dulu!'); return; }
                createPolicyMutation.mutate({
                  zoneId: policyForm.zoneId,
                  tollFee: Number(policyForm.tollFee || 0),
                  parkingFee: Number(policyForm.parkingFee || 0),
                  weatherSurcharge: Number(policyForm.weatherSurcharge || 0),
                  holidaySurcharge: Number(policyForm.holidaySurcharge || 0),
                });
              }}
              disabled={createPolicyMutation.isPending}
              className="col-span-2 md:col-span-5 flex items-center justify-center gap-1.5 bg-[#00E575] hover:bg-[#00E575]/80 disabled:opacity-50 text-[#06170E] text-xs font-black py-2.5 rounded-lg"
            >
              <PlusCircle className="w-4 h-4 flex-shrink-0" /> 
            </button>
          </div>
          <div className="flex flex-col gap-2">
            {policies.length === 0 ? (
              <div className="text-center text-[10px] text-[#A5C9B8]/60 py-6 border border-dashed border-[#23583E] rounded-xl">Belum ada kebijakan regional.</div>
            ) : policies.map((p: any) => (
              <div key={p.id} className="bg-[#06170E] border border-[#23583E] p-3 rounded-xl text-[10px]">
                <span className="font-bold text-white">{p.zone?.name}</span>
                <span className="text-[#A5C9B8]"> — Tol {formatRupiah(Number(p.tollFee))}, Parkir {formatRupiah(Number(p.parkingFee))}, Cuaca +{formatRupiah(Number(p.weatherSurcharge))}, Libur +{formatRupiah(Number(p.holidaySurcharge))}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── VERSI KOMISI (TIERED) ── */}
      {activeTab === 'versions' && (
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-3 bg-[#06170E]/50 p-4 rounded-xl">
            <div className="grid grid-cols-2 gap-2">
              <input className={inputCls} placeholder="Nama versi, mis. v2026-07-tiered" value={versionForm.versionName} onChange={(e) => setVersionForm({ ...versionForm, versionName: e.target.value })} />
              <input className={inputCls} placeholder="Deskripsi (opsional)" value={versionForm.description} onChange={(e) => setVersionForm({ ...versionForm, description: e.target.value })} />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className={labelCls}>Tier Komisi (nilai order maksimal → tarif komisi)</label>
              {versionForm.tiers.map((tier, idx) => (
                <div key={idx} className="flex gap-2 items-center">
                  <input
                    className={inputCls}
                    placeholder="Nilai order maksimal (kosongkan = tanpa batas)"
                    type="number"
                    value={tier.maxOrderValue}
                    onChange={(e) => {
                      const next = [...versionForm.tiers]; next[idx] = { ...next[idx], maxOrderValue: e.target.value };
                      setVersionForm({ ...versionForm, tiers: next });
                    }}
                  />
                  <input
                    className={inputCls}
                    placeholder="Rate (0.08 = 8%)"
                    type="number" step="0.01"
                    value={tier.rate}
                    onChange={(e) => {
                      const next = [...versionForm.tiers]; next[idx] = { ...next[idx], rate: e.target.value };
                      setVersionForm({ ...versionForm, tiers: next });
                    }}
                  />
                  <button onClick={() => setVersionForm({ ...versionForm, tiers: versionForm.tiers.filter((_, i) => i !== idx) })} className="text-red-400 text-xs px-2">✕</button>
                </div>
              ))}
              <button
                onClick={() => setVersionForm({ ...versionForm, tiers: [...versionForm.tiers, { maxOrderValue: '', rate: '' }] })}
                className="text-[10px] text-[#00E575] font-bold self-start"
              >
                + Tambah tier
              </button>
            </div>
            <button
              onClick={() => {
                if (!versionForm.versionName.trim()) { triggerToast('Nama versi wajib diisi!'); return; }
                const tiers = versionForm.tiers.map((t) => ({
                  maxOrderValue: t.maxOrderValue === '' ? null : Number(t.maxOrderValue),
                  rate: Number(t.rate),
                }));
                createVersionMutation.mutate({ versionName: versionForm.versionName.trim(), description: versionForm.description || undefined, commissionTiers: tiers });
              }}
              disabled={createVersionMutation.isPending}
              className="flex items-center justify-center gap-1.5 bg-[#00E575] hover:bg-[#00E575]/80 disabled:opacity-50 text-[#06170E] text-xs font-black py-2.5 rounded-lg"
            >
              <PlusCircle className="w-4 h-4 flex-shrink-0" /> 
            </button>
          </div>

          <div className="flex flex-col gap-2">
            {versions.length === 0 ? (
              <div className="text-center text-[10px] text-[#A5C9B8]/60 py-6 border border-dashed border-[#23583E] rounded-xl">Belum ada versi tarif.</div>
            ) : versions.map((v: any) => (
              <div key={v.id} className={`flex justify-between items-center gap-2 bg-[#06170E] border ${v.isActive ? 'border-[#FFD700]' : 'border-[#23583E]'} p-3 rounded-xl text-[10px]`}>
                <div className="flex flex-col gap-0.5">
                  <span className="font-bold text-white flex items-center gap-1.5">
                    <Percent className="w-3 h-3 text-[#FFD700]" /> {v.versionName} {v.isActive && <span className="text-[9px] bg-[#FFD700] text-[#06170E] px-1.5 py-0.5 rounded-full font-black">AKTIF</span>}
                  </span>
                  <span className="text-[#A5C9B8]">{v.description || 'Tanpa deskripsi'}</span>
                </div>
                {!v.isActive && (
                  <button
                    onClick={() => activateVersionMutation.mutate(v.id)}
                    disabled={activateVersionMutation.isPending}
                    className="bg-[#FFD700] hover:bg-[#FFD700]/80 text-[#06170E] text-[10px] font-black py-1.5 px-3 rounded-lg whitespace-nowrap"
                  >
                    Aktifkan
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── COMMISSION AUDIT (BAR CHART & METRICS) ── */}
      {activeTab === 'commissionAudit' && (
        <div className="flex flex-col gap-5">
          {/* Summary KPI Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="bg-[#06170E] border border-[#00E575]/30 p-3.5 rounded-xl flex flex-col justify-between">
              <span className="text-[10px] text-[#A5C9B8] uppercase font-bold flex items-center gap-1">
                <DollarSign className="w-3.5 h-3.5 text-[#00E575]" /> Total Komisi (7 Hari)
              </span>
              <span className="text-lg font-black text-[#00E575] mt-1">
                {formatRupiah(auditData?.summary?.totalCommissionEarned || 0)}
              </span>
            </div>

            <div className="bg-[#06170E] border border-[#FFD700]/30 p-3.5 rounded-xl flex flex-col justify-between">
              <span className="text-[10px] text-[#A5C9B8] uppercase font-bold flex items-center gap-1">
                <TrendingUp className="w-3.5 h-3.5 text-[#FFD700]" /> Komisi Hari Ini
              </span>
              <span className="text-lg font-black text-[#FFD700] mt-1">
                {formatRupiah(auditData?.summary?.todayCommission || 0)}
              </span>
            </div>

            <div className="bg-[#06170E] border border-[#23583E] p-3.5 rounded-xl flex flex-col justify-between">
              <span className="text-[10px] text-[#A5C9B8] uppercase font-bold flex items-center gap-1">
                <Percent className="w-3.5 h-3.5 text-emerald-400" /> Rata-Rata Harian
              </span>
              <span className="text-lg font-black text-white mt-1">
                {formatRupiah(auditData?.summary?.averageDailyCommission || 0)}
              </span>
            </div>

            <div className="bg-[#06170E] border border-[#23583E] p-3.5 rounded-xl flex flex-col justify-between">
              <span className="text-[10px] text-[#A5C9B8] uppercase font-bold flex items-center gap-1">
                <ClipboardList className="w-3.5 h-3.5 text-blue-400" /> Total Order Selesai
              </span>
              <span className="text-lg font-black text-white mt-1">
                {auditData?.summary?.totalOrdersProcessed || 0} Order
              </span>
            </div>
          </div>

          {/* Bar Chart Section - 🚀 DIGANTI DENGAN LAZY LOAD */}
          <Suspense fallback={<div className="text-center py-10 text-xs text-[#A5C9B8]">Memuat grafik statistik...</div>}>
            <CommissionAuditChart 
              auditData={auditData} 
              isLoadingAudit={isLoadingAudit} 
              refetchAudit={refetchAudit} 
            />
          </Suspense>

          {/* Daily Table Breakdown */}
          <div className="bg-[#06170E] border border-[#23583E] rounded-2xl overflow-hidden">
            <div className="p-3 bg-[#0D2E1F]/60 border-b border-[#23583E]">
              <span className="text-xs font-black text-white uppercase tracking-wider">
                Rincian Audit Komisi Per Hari
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[11px]">
                <thead className="bg-[#06170E] text-[#A5C9B8] uppercase text-[9px] border-b border-[#23583E]">
                  <tr>
                    <th className="py-2.5 px-4 font-bold">Tanggal</th>
                    <th className="py-2.5 px-4 font-bold">Hari / Bulan</th>
                    <th className="py-2.5 px-4 font-bold text-center">Order Completed</th>
                    <th className="py-2.5 px-4 font-bold text-right">Total Komisi Platform</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#23583E]">
                  {(auditData?.dailyData || []).map((row: any) => (
                    <tr key={row.date} className="hover:bg-[#0D2E1F]/50 transition-colors">
                      <td className="py-2.5 px-4 font-mono text-[#A5C9B8]">{row.date}</td>
                      <td className="py-2.5 px-4 font-bold text-white">{row.dayLabel}</td>
                      <td className="py-2.5 px-4 text-center font-bold text-[#FFD700]">{row.orderCount} order</td>
                      <td className="py-2.5 px-4 text-right font-black text-[#00E575]">
                        {formatRupiah(row.totalCommission)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ── KONFIGURASI PLATFORM ── */}
      {activeTab === 'config' && (
        <div className="flex flex-col gap-4">
          <div className="flex gap-2 items-end bg-[#06170E]/50 p-4 rounded-xl">
            <div className="flex flex-col gap-1 flex-1">
              <label className={labelCls}>Minimum Deposit Driver (MINIMUM_DRIVER_DEPOSIT)</label>
              <input className={inputCls} type="number" placeholder="20000" value={depositValue} onChange={(e) => setDepositValue(e.target.value)} />
            </div>
            <button
              onClick={() => {
                if (!depositValue) return;
                updateConfigMutation.mutate({ key: 'MINIMUM_DRIVER_DEPOSIT', value: depositValue });
              }}
              disabled={updateConfigMutation.isPending}
              className="bg-[#00E575] hover:bg-[#00E575]/80 disabled:opacity-50 text-[#06170E] text-xs font-black py-2.5 px-4 rounded-lg whitespace-nowrap"
            >
              Simpan
            </button>
          </div>
          <div className="flex flex-col gap-2">
            {config.length === 0 ? (
              <div className="text-center text-[10px] text-[#A5C9B8]/60 py-6 border border-dashed border-[#23583E] rounded-xl">Belum ada konfigurasi tersimpan (memakai nilai default sistem).</div>
            ) : config.map((c: any) => (
              <div key={c.key} className="flex justify-between bg-[#06170E] border border-[#23583E] p-3 rounded-xl text-[10px]">
                <span className="font-bold text-white">{c.key}</span>
                <span className="text-[#00E575] font-mono">{c.value}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ✅ Ekspor default
export default React.memo(TariffPanel);