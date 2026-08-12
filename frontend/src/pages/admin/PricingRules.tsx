import React, { useEffect, useState } from 'react';
import { AdminAPI } from '../../api/admin.api';

export function PricingRules() {
  const [rules, setRules] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);

  const fetchRules = async () => {
    const res = await AdminAPI.getPricingRules();
    setRules(res.data);
    setLoading(false);
  };

  useEffect(() => {
    fetchRules();
  }, []);

  const handleCreateRule = async (data: any) => {
    await AdminAPI.createPricingRule(data);
    await fetchRules();
    setShowForm(false);
  };

  return (
    <div className="p-6">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold text-white">Pricing Rules</h1>
        <button
          onClick={() => setShowForm(true)}
          className="bg-[#22C55E] text-black px-4 py-2 rounded-xl font-bold"
        >
          + Tambah Rule
        </button>
      </div>

      {/* Tabel Rules */}
      <div className="glass-card rounded-2xl p-4 border border-[#23583E]/60">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[#A5C9B8] border-b border-[#23583E]/40">
              <th className="text-left py-2">Service Type</th>
              <th className="text-left py-2">Base Fare</th>
              <th className="text-left py-2">Per KM</th>
              <th className="text-left py-2">Status</th>
              <th className="text-left py-2">Action</th>
            </tr>
          </thead>
          <tbody>
            {rules.map((rule: any) => (
              <tr key={rule.id} className="border-b border-[#23583E]/20">
                <td className="py-2 text-white">{rule.serviceType}</td>
                <td className="py-2 text-white">Rp{rule.baseFare}</td>
                <td className="py-2 text-white">Rp{rule.perKmFee}</td>
                <td className="py-2">
                  <span className={`px-2 py-1 rounded-full text-xs ${rule.isActive ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}>
                    {rule.isActive ? 'Active' : 'Inactive'}
                  </span>
                </td>
                <td className="py-2">
                  <button className="text-[#22C55E] text-xs">Edit</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Modal Form */}
      {showForm && (
        <PricingRuleForm
          onSubmit={handleCreateRule}
          onCancel={() => setShowForm(false)}
        />
      )}
    </div>
  );
}

// ============================================
// PricingRuleForm Component
// ============================================
function PricingRuleForm({ onSubmit, onCancel }: any) {
  const [formData, setFormData] = useState({
    serviceType: 'MART',
    baseFare: 5000,
    pickupFee: 3000,
    perKmFee: 2000,
    perMinuteWaitFee: 1000,
    zoneId: null,
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(formData);
  };

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
      <div className="bg-[#0D2E1F] p-6 rounded-2xl border border-[#23583E] w-full max-w-md">
        <h2 className="text-xl font-bold text-white mb-4">Tambah Pricing Rule</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="text-xs text-[#A5C9B8]">Service Type</label>
            <select
              value={formData.serviceType}
              onChange={(e) => setFormData({ ...formData, serviceType: e.target.value })}
              className="w-full bg-[#06170E] border border-[#23583E] rounded-xl p-2 text-white"
            >
              <option value="BIKE">BIKE</option>
              <option value="CAR">CAR</option>
              <option value="SEND">SEND</option>
              <option value="MART">MART</option>
            </select>
          </div>
          <div>
            <label className="text-xs text-[#A5C9B8]">Base Fare</label>
            <input
              type="number"
              value={formData.baseFare}
              onChange={(e) => setFormData({ ...formData, baseFare: Number(e.target.value) })}
              className="w-full bg-[#06170E] border border-[#23583E] rounded-xl p-2 text-white"
            />
          </div>
          <div>
            <label className="text-xs text-[#A5C9B8]">Pickup Fee</label>
            <input
              type="number"
              value={formData.pickupFee}
              onChange={(e) => setFormData({ ...formData, pickupFee: Number(e.target.value) })}
              className="w-full bg-[#06170E] border border-[#23583E] rounded-xl p-2 text-white"
            />
          </div>
          <div>
            <label className="text-xs text-[#A5C9B8]">Per KM Fee</label>
            <input
              type="number"
              value={formData.perKmFee}
              onChange={(e) => setFormData({ ...formData, perKmFee: Number(e.target.value) })}
              className="w-full bg-[#06170E] border border-[#23583E] rounded-xl p-2 text-white"
            />
          </div>
          <div>
            <label className="text-xs text-[#A5C9B8]">Per Minute Wait Fee</label>
            <input
              type="number"
              value={formData.perMinuteWaitFee}
              onChange={(e) => setFormData({ ...formData, perMinuteWaitFee: Number(e.target.value) })}
              className="w-full bg-[#06170E] border border-[#23583E] rounded-xl p-2 text-white"
            />
          </div>
          <div className="flex gap-3 pt-4">
            <button
              type="submit"
              className="flex-1 bg-[#22C55E] text-black font-bold py-2 rounded-xl"
            >
              Simpan
            </button>
            <button
              type="button"
              onClick={onCancel}
              className="flex-1 bg-red-500/20 text-red-400 font-bold py-2 rounded-xl"
            >
              Batal
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}