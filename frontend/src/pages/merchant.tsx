// src/pages/merchant.tsx
import React, { useState, useEffect } from 'react';
import { merchantApi } from '../api/merchant.api';

// ✅ HAPUS useNavigate - pakai window.location
const navigate = (path: string) => {
  window.location.href = path;
};

export function AdminMerchants() {
  const [merchants, setMerchants] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    merchantApi.getAll()
      // Backend membungkus payload sebagai { success, data, count } — daftar
      // merchant-nya sendiri ada di res.data.data (sebelumnya kode ini
      // menyimpan seluruh objek tersebut, bukan array-nya, ke state).
      .then((res) => setMerchants(res.data?.data ?? []))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="text-white">Loading...</div>;

  return (
    <div className="text-white p-6">
      <h1 className="text-2xl font-bold mb-4">🏪 Kelola Merchant</h1>
      <button 
        onClick={() => navigate('/admin/merchants/create')}
        className="bg-[#00E575] text-black px-4 py-2 rounded"
      >
        + Tambah Merchant
      </button>
      {/* ... table merchants ... */}
    </div>
  );
}