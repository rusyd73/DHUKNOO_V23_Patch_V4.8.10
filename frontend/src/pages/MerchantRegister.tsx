// src/pages/MerchantRegister.tsx
import React, { useState } from 'react';
import { merchantApi } from '../api/merchant.api';

interface MerchantRegisterProps {
  // 🆕 PERBAIKAN (Merchant belum bisa diakses): sebelumnya component ini
  // langsung redirect ke `window.location.href = '/login'` setelah submit
  // sukses -- padahal app ini SPA murni berbasis state (App.tsx), TIDAK
  // PERNAH mendaftarkan route "/login" sama sekali (lihat App.tsx / react-
  // router tidak dipakai). Akibatnya browser reload ke URL yang tidak
  // dikenali server dan mendarat di halaman kosong/404 -- pengguna yang
  // baru saja sukses daftar jadi mentok, tidak pernah sampai ke form login.
  // Sekarang pemanggil (AuthFlow) yang menentukan apa yang terjadi setelah
  // sukses daftar (biasanya: kembali ke form login di layar yang sama).
  onDone: () => void;
}

export function MerchantRegister({ onDone }: MerchantRegisterProps) {
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({
    name: '',
    category: '',
    address: '',
    latitude: -7.9666,
    longitude: 112.6326,
    phone: '',
    ownerEmail: '',
    ownerPassword: '',
    ownerFullName: '',
    ownerPhone: '',
    isOpen: true,
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await merchantApi.register(form);
      onDone();
    } catch (error: any) {
      alert(error.response?.data?.error || 'Gagal mendaftarkan merchant');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto p-6">
      <h1 className="text-2xl font-bold text-white mb-6">🏪 Daftar Merchant</h1>
      <form onSubmit={handleSubmit} className="space-y-4">
        <input
          type="text"
          placeholder="Nama Merchant"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          className="w-full bg-[#0D2E1F] p-3 rounded-xl border border-[#23583E] text-white"
          required
        />
        <select
          value={form.category}
          onChange={(e) => setForm({ ...form, category: e.target.value })}
          className="w-full bg-[#0D2E1F] p-3 rounded-xl border border-[#23583E] text-white"
          required
        >
          <option value="">Pilih Kategori</option>
          <option value="Kuliner">Kuliner</option>
          <option value="Apotek">Apotek</option>
          <option value="Dokumen">Dokumen</option>
          <option value="Grosir">Grosir</option>
          <option value="Elektronik">Elektronik</option>
          <option value="Fashion">Fashion</option>
          <option value="Lainnya">Lainnya</option>
        </select>
        <input
          type="text"
          placeholder="Alamat"
          value={form.address}
          onChange={(e) => setForm({ ...form, address: e.target.value })}
          className="w-full bg-[#0D2E1F] p-3 rounded-xl border border-[#23583E] text-white"
          required
        />
        <input
          type="tel"
          placeholder="Telepon Merchant"
          value={form.phone}
          onChange={(e) => setForm({ ...form, phone: e.target.value })}
          className="w-full bg-[#0D2E1F] p-3 rounded-xl border border-[#23583E] text-white"
          required
        />
        <hr className="border-[#23583E]" />
        <h3 className="text-white font-bold">👤 Data Pemilik</h3>
        <input
          type="text"
          placeholder="Nama Lengkap Pemilik"
          value={form.ownerFullName}
          onChange={(e) => setForm({ ...form, ownerFullName: e.target.value })}
          className="w-full bg-[#0D2E1F] p-3 rounded-xl border border-[#23583E] text-white"
          required
        />
        <input
          type="email"
          placeholder="Email Pemilik"
          value={form.ownerEmail}
          onChange={(e) => setForm({ ...form, ownerEmail: e.target.value })}
          className="w-full bg-[#0D2E1F] p-3 rounded-xl border border-[#23583E] text-white"
          required
        />
        <input
          type="password"
          placeholder="Password"
          value={form.ownerPassword}
          onChange={(e) => setForm({ ...form, ownerPassword: e.target.value })}
          className="w-full bg-[#0D2E1F] p-3 rounded-xl border border-[#23583E] text-white"
          required
        />
        <input
          type="tel"
          placeholder="Telepon Pemilik"
          value={form.ownerPhone}
          onChange={(e) => setForm({ ...form, ownerPhone: e.target.value })}
          className="w-full bg-[#0D2E1F] p-3 rounded-xl border border-[#23583E] text-white"
          required
        />
        <button
          type="submit"
          disabled={loading}
          className="w-full bg-[#00E575] text-[#071F14] py-3 rounded-xl font-bold hover:bg-[#00ff80] disabled:opacity-50"
        >
          {loading ? 'Mendaftarkan...' : 'Daftar Merchant'}
        </button>
      </form>
    </div>
  );
}