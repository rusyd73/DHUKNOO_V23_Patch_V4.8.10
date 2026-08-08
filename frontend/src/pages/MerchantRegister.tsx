// src/pages/MerchantRegister.tsx
import React, { useState, Suspense } from 'react';
import { merchantApi } from '../api/merchant.api';

// 🆕 PERBAIKAN: sebelumnya form ini TIDAK PUNYA input lokasi sama sekali --
// latitude/longitude di-hardcode ke satu titik tetap (pusat kota Malang)
// untuk SEMUA merchant yang mendaftar, apa pun lokasi toko mereka
// sebenarnya. Ini merusak dua hal: (1) perhitungan jarak/ongkir per-km &
// platform fee di tarif engine untuk order MART (lihat order.service.ts
// createMerchantOrder), dan (2) titik jemput yang ditampilkan di peta
// driver saat order diterima -- SELALU menunjuk ke titik yang sama,
// bukan toko sungguhan. LocationPicker (peta interaktif + pencarian
// alamat + tombol GPS) yang sudah dipakai di alur pickup/dropoff
// customer & driver sekarang dipakai juga di sini.
const LocationPicker = React.lazy(() => import('../components/map/LocationPicker'));

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
  const [locationSet, setLocationSet] = useState(false);
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
    // 🆕 Wajib set lokasi toko yang sebenarnya sebelum bisa daftar --
    // tanpa ini form akan diam-diam terkirim dengan koordinat placeholder
    // (pusat kota Malang) seperti sebelumnya.
    if (!locationSet) {
      alert('Titik lokasi toko di peta wajib diatur (klik peta, cari alamat, atau pakai GPS) sebelum mendaftar — ini menentukan perhitungan ongkir & titik jemput driver!');
      return;
    }
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

        {/* 🆕 Titik Lokasi Toko di Peta — WAJIB, lihat komentar di atas. */}
        <div>
          <label className="text-xs font-bold text-[#A5C9B8] block mb-1.5">
            Titik Lokasi Toko di Peta <span className="text-red-400">*</span>
          </label>
          <Suspense
            fallback={
              <div className="h-[200px] flex items-center justify-center bg-[#0D2E1F] border border-[#23583E] rounded-2xl text-[10px] text-[#A5C9B8] animate-pulse">
                Memuat peta...
              </div>
            }
          >
            <LocationPicker
              label="Lokasi Toko"
              initialCenter={{ lat: form.latitude, lng: form.longitude }}
              value={locationSet ? { lat: form.latitude, lng: form.longitude } : null}
              onChange={(pos) => {
                setForm((prev) => ({ ...prev, latitude: pos.lat, longitude: pos.lng }));
                setLocationSet(true);
              }}
              address={form.address}
              onAddressChange={(addr) => setForm((prev) => ({ ...prev, address: addr }))}
              markerColor="green"
            />
          </Suspense>
          {!locationSet && (
            <p className="text-[10px] text-amber-400 mt-1.5">
              ⚠️ Klik peta, cari alamat, atau tekan "Gunakan Lokasi Saya Saat Ini (GPS)" untuk mengatur titik toko yang sebenarnya.
            </p>
          )}
        </div>

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