// src/pages/Settings.tsx
import React, { useState, useEffect, Suspense } from 'react';
import { useAuthStore } from '../store/useAuthStore';
import { merchantApi } from '../api/merchant.api';
import { playBellRingSound } from '../utils/audio';
import { 
  Volume2, Store, Bell, 
  Smartphone, Shield, RefreshCw, 
  Phone, Save, Loader2, AlertCircle,
  Clock, Mail, User, Settings as SettingsIcon,
  VolumeX, Volume1
} from 'lucide-react';

// 🆕 Lazy-load LocationPicker (leaflet) — sama seperti pola yang sudah
// dipakai di CustomerApp/DriverApp, supaya leaflet tidak ikut ter-bundle
// ke halaman yang tidak butuh peta.
const LocationPicker = React.lazy(() => import('../components/map/LocationPicker'));

// ============================================
// INTERFACES
// ============================================
interface MerchantSettingsProps {
  triggerToast?: (msg: string) => void;
}

interface StoreFormData {
  name: string;
  category: string;
  address: string;
  latitude: number | null;
  longitude: number | null;
  phone: string;
  imageUrl: string;
  isOpen: boolean;
}

// ============================================
// MAIN COMPONENT
// ============================================
export function MerchantSettings({ triggerToast }: MerchantSettingsProps = {}) {
  const { user } = useAuthStore();

  // State untuk preferensi
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [autoAccept, setAutoAccept] = useState(false);
  const [loading, setLoading] = useState(true);
  const [savingStore, setSavingStore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // State untuk form profil toko
  const [storeForm, setStoreForm] = useState<StoreFormData>({
    name: '',
    category: 'Kuliner',
    address: '',
    latitude: null,
    longitude: null,
    phone: '',
    imageUrl: '',
    isOpen: true,
  });

  // ============================================
  // UTILITY FUNCTIONS
  // ============================================
  const notify = (msg: string, isError: boolean = false) => {
    if (triggerToast) {
      triggerToast(msg);
    } else {
      alert(msg);
    }
    if (isError) {
      setError(msg);
    } else {
      setError(null);
    }
  };

  // ============================================
  // HANDLE TEST BELL SOUND
  // ============================================
  const handleTestBellSound = () => {
    if (soundEnabled) {
      playBellRingSound();
      notify('🔔 Suara notifikasi bel (Bell Ring) berhasil dites!');
    } else {
      notify('🔇 Suara notifikasi sedang dimatikan. Aktifkan terlebih dahulu.');
    }
  };

  // ============================================
  // DATA FETCHING
  // ============================================
  useEffect(() => {
    const fetchMerchantData = async () => {
      const token = useAuthStore.getState().token;
      if (!token) {
        setLoading(false);
        return;
      }

      setLoading(true);
      try {
        const res = await merchantApi.getMyMerchant();
        const data = res.data?.data;
        
        if (data) {
          setStoreForm({
            name: data.name || '',
            category: data.category || 'Kuliner',
            address: data.address || '',
            latitude: typeof data.latitude === 'number' ? data.latitude : null,
            longitude: typeof data.longitude === 'number' ? data.longitude : null,
            phone: data.phone || '',
            imageUrl: data.imageUrl || '',
            isOpen: data.isOpen ?? true,
          });
        }
      } catch (err: any) {
        if (err?.response?.status !== 401) {
          console.error('Failed to load merchant profile:', err);
          setError('Gagal memuat data toko. Silakan refresh halaman.');
        }
      } finally {
        setLoading(false);
      }
    };
    fetchMerchantData();
  }, []);

  // ============================================
  // HANDLE FORM SUBMIT
  // ============================================
  const handleSaveStoreProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!storeForm.name.trim() || !storeForm.address.trim()) {
      notify('Nama toko dan alamat wajib diisi!', true);
      return;
    }

    // 🆕 PERBAIKAN: sebelumnya lokasi (latitude/longitude) toko TIDAK PERNAH
    // bisa diatur lewat UI mana pun -- baik saat registrasi (nilai default
    // hardcode Malang untuk SEMUA merchant) maupun di sini. Akibatnya jarak
    // dari toko ke titik antar (dasar hitung ongkir per-km & platform fee di
    // tarif engine) SELALU salah untuk hampir semua merchant, dan titik
    // jemput di peta driver juga ikut salah. Sekarang wajib set lokasi lewat
    // peta/GPS sebelum bisa simpan.
    if (storeForm.latitude === null || storeForm.longitude === null) {
      notify('Titik lokasi toko di peta wajib diatur (klik peta atau pakai GPS) — ini menentukan perhitungan ongkir & titik jemput driver!', true);
      return;
    }

    setSavingStore(true);
    setError(null);
    
    try {
      await merchantApi.updateMyMerchant({
        name: storeForm.name.trim(),
        category: storeForm.category.trim() || undefined,
        address: storeForm.address.trim(),
        latitude: storeForm.latitude,
        longitude: storeForm.longitude,
        phone: storeForm.phone.trim() || undefined,
        imageUrl: storeForm.imageUrl.trim() || undefined,
        isOpen: storeForm.isOpen,
      });
      
      notify('Profil toko berhasil diperbarui!');
    } catch (err: any) {
      console.error('Failed to save merchant profile:', err);
      notify(err?.response?.data?.error || 'Gagal memperbarui profil toko.', true);
    } finally {
      setSavingStore(false);
    }
  };

  // ============================================
  // RENDER LOADING STATE
  // ============================================
  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-[#A5C9B8] gap-3">
        <Loader2 className="w-8 h-8 animate-spin text-[#22C55E]" />
        <span className="text-sm font-semibold">Memuat data toko...</span>
      </div>
    );
  }

  // ============================================
  // MAIN RENDER
  // ============================================
  return (
    <div className="max-w-4xl mx-auto flex flex-col gap-6 p-2 md:p-4">
      {/* ==========================================
          PAGE HEADER
          ========================================== */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[#23583E]/60 pb-5">
        <div>
          <h1 className="text-2xl md:text-3xl font-black text-white font-heading flex items-center gap-3">
            <span>⚙️ Pengaturan Toko & Operasional</span>
          </h1>
          <p className="text-xs md:text-sm text-[#A5C9B8] mt-1">
            Atur identitas merchant, lokasi toko, dan alarm notifikasi pesanan masuk.
          </p>
        </div>
      </div>

      {/* ==========================================
          ERROR MESSAGE
          ========================================== */}
      {error && (
        <div className="bg-red-500/10 border border-red-500/30 text-red-300 rounded-2xl p-4 text-sm flex items-center gap-2">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* ==========================================
          SECTION 1: STORE PROFILE
          ========================================== */}
      <div className="glass-card rounded-3xl p-6 border border-[#23583E]/60 flex flex-col gap-5">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-[#22C55E]/15 text-[#22C55E] flex items-center justify-center font-bold">
            <Store className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base md:text-lg font-bold text-white font-heading">
              Profil & Identitas Merchant Toko
            </h2>
            <p className="text-xs text-[#A5C9B8]">
              Informasi ini tampil di aplikasi pelanggan saat memesan produk Anda.
            </p>
          </div>
        </div>

        <form onSubmit={handleSaveStoreProfile} className="flex flex-col gap-4">
          {/* Name & Category - Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-bold text-[#A5C9B8] block mb-1">
                Nama Toko / Warung <span className="text-red-400">*</span>
              </label>
              <input
                type="text"
                required
                placeholder="Mis. Warung Bu Sri Spesial Bebek"
                value={storeForm.name}
                onChange={(e) => setStoreForm({ ...storeForm, name: e.target.value })}
                className="w-full bg-[#05110A] border border-[#1F4A34] rounded-xl px-3.5 py-2.5 text-xs text-white focus:outline-none focus:border-[#22C55E]"
              />
            </div>

            <div>
              <label className="text-xs font-bold text-[#A5C9B8] block mb-1">
                Kategori Usaha
              </label>
              <select
                value={storeForm.category}
                onChange={(e) => setStoreForm({ ...storeForm, category: e.target.value })}
                className="w-full bg-[#05110A] border border-[#1F4A34] rounded-xl px-3.5 py-2.5 text-xs text-white focus:outline-none focus:border-[#22C55E]"
              >
                <option value="Kuliner">🍽️ Kuliner (Makanan & Minuman)</option>
                <option value="Belanja Harian">🛒 Belanja Harian (Mart / Sembako)</option>
                <option value="Oleh-oleh">🎁 Oleh-oleh & Souvenir</option>
                <option value="Kesehatan">💊 Kesehatan & Apotek</option>
                <option value="Jasa">🔧 Jasa & Servis</option>
              </select>
            </div>
          </div>

          {/* Phone & Status - Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-bold text-[#A5C9B8] block mb-1">
                Nomor WhatsApp / Telepon Toko
              </label>
              <input
                type="text"
                placeholder="081234567890"
                value={storeForm.phone}
                onChange={(e) => setStoreForm({ ...storeForm, phone: e.target.value })}
                className="w-full bg-[#05110A] border border-[#1F4A34] rounded-xl px-3.5 py-2.5 text-xs text-white focus:outline-none focus:border-[#22C55E]"
              />
            </div>

            <div>
              <label className="text-xs font-bold text-[#A5C9B8] block mb-1">
                Status Operasional
              </label>
              <div className="flex items-center gap-3 pt-1">
                <button
                  type="button"
                  onClick={() => setStoreForm({ ...storeForm, isOpen: !storeForm.isOpen })}
                  className={`px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                    storeForm.isOpen
                      ? 'bg-[#22C55E]/20 text-[#22C55E] border border-[#22C55E]/40 hover:bg-[#22C55E]/30'
                      : 'bg-red-500/20 text-red-400 border border-red-500/40 hover:bg-red-500/30'
                  }`}
                >
                  {storeForm.isOpen ? '🟢 Toko Buka' : '🔴 Toko Tutup'}
                </button>
                <span className="text-[11px] text-[#A5C9B8]">
                  {storeForm.isOpen ? 'Toko aktif menerima pesanan' : 'Toko sementara tidak menerima pesanan'}
                </span>
              </div>
            </div>
          </div>

          {/* Address - Full width */}
          <div>
            <label className="text-xs font-bold text-[#A5C9B8] block mb-1">
              Alamat Fisik Lengkap Toko <span className="text-red-400">*</span>
            </label>
            <textarea
              rows={2}
              required
              placeholder="Jl. Raya Utama No. 123, Kota Batu..."
              value={storeForm.address}
              onChange={(e) => setStoreForm({ ...storeForm, address: e.target.value })}
              className="w-full bg-[#05110A] border border-[#1F4A34] rounded-xl px-3.5 py-2.5 text-xs text-white focus:outline-none focus:border-[#22C55E]"
            />
          </div>

          {/* 🆕 Titik Lokasi Toko di Peta — WAJIB diisi. Ini basis perhitungan
              jarak/ongkir per-km & platform fee di tarif engine, dan titik
              jemput yang muncul di peta driver saat menerima order. */}
          <div>
            <label className="text-xs font-bold text-[#A5C9B8] block mb-1">
              Titik Lokasi Toko di Peta <span className="text-red-400">*</span>
            </label>
            <Suspense
              fallback={
                <div className="h-[200px] flex items-center justify-center bg-[#06170E] border border-[#23583E] rounded-2xl text-[10px] text-[#A5C9B8] animate-pulse">
                  Memuat peta...
                </div>
              }
            >
              <LocationPicker
                label="Lokasi Toko"
                initialCenter={{ lat: storeForm.latitude ?? -7.9666, lng: storeForm.longitude ?? 112.6326 }}
                value={storeForm.latitude !== null && storeForm.longitude !== null ? { lat: storeForm.latitude, lng: storeForm.longitude } : null}
                onChange={(pos) => setStoreForm((prev) => ({ ...prev, latitude: pos.lat, longitude: pos.lng }))}
                address={storeForm.address}
                onAddressChange={(addr) => setStoreForm((prev) => ({ ...prev, address: addr }))}
                markerColor="green"
              />
            </Suspense>
            {storeForm.latitude === null && (
              <p className="text-[10px] text-amber-400 mt-1.5">
                ⚠️ Lokasi belum diatur — klik peta di atas atau tekan "Gunakan Lokasi Saya Saat Ini (GPS)" sebelum menyimpan.
              </p>
            )}
          </div>

          {/* Image URL */}
          <div>
            <label className="text-xs font-bold text-[#A5C9B8] block mb-1">
              URL Foto Toko
            </label>
            <input
              type="text"
              placeholder="https://..."
              value={storeForm.imageUrl}
              onChange={(e) => setStoreForm({ ...storeForm, imageUrl: e.target.value })}
              className="w-full bg-[#05110A] border border-[#1F4A34] rounded-xl px-3.5 py-2.5 text-xs text-white focus:outline-none focus:border-[#22C55E]"
            />
          </div>

          {/* Submit Button */}
          <div className="flex justify-end pt-2">
            <button
              type="submit"
              disabled={savingStore}
              className="px-5 py-2.5 rounded-xl bg-[#22C55E] hover:bg-[#16A34A] text-[#05110A] text-xs font-black transition-all shadow-md flex items-center gap-2 cursor-pointer active:scale-95 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {savingStore ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Menyimpan...</span>
                </>
              ) : (
                <>
                  <Save className="w-4 h-4" />
                  <span>Simpan Informasi Toko</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>

      {/* ==========================================
          SECTION 2: NOTIFICATION PREFERENCES (ENHANCED)
          ========================================== */}
      <div className="glass-card rounded-3xl p-6 border border-[#23583E]/60 flex flex-col gap-5">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-[#F59E0B]/15 text-[#F59E0B] flex items-center justify-center font-bold">
            <Bell className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base md:text-lg font-bold text-white font-heading">
              Preferensi Alarm & Notifikasi Order
            </h2>
            <p className="text-xs text-[#A5C9B8]">
              Atur suara alarm orderan masuk dan sistem otomatisasi merchant.
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-3">
          {/* Sound Notification Toggle */}
          <div className="flex items-center justify-between p-3.5 bg-[#06170E] border border-[#1F4A34] rounded-2xl">
            <div className="flex items-center gap-3">
              {soundEnabled ? (
                <Volume2 className="w-5 h-5 text-[#22C55E]" />
              ) : (
                <VolumeX className="w-5 h-5 text-[#A5C9B8]" />
              )}
              <div>
                <p className="text-sm font-bold text-white">Suara Notifikasi Orderan</p>
                <p className="text-xs text-[#A5C9B8]">
                  {soundEnabled 
                    ? 'Suara notifikasi aktif - dering saat pesanan baru masuk' 
                    : 'Suara notifikasi dimatikan'}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setSoundEnabled(!soundEnabled)}
                className={`w-12 h-6 rounded-full transition-colors relative p-0.5 cursor-pointer ${
                  soundEnabled ? 'bg-[#22C55E]' : 'bg-gray-700'
                }`}
              >
                <div className={`w-5 h-5 rounded-full bg-white transition-transform ${
                  soundEnabled ? 'translate-x-6' : 'translate-x-0'
                }`} />
              </button>
              {/* 🆕 TEST BELL SOUND BUTTON */}
              <button
                type="button"
                onClick={handleTestBellSound}
                disabled={!soundEnabled}
                className={`bg-[#06170E] hover:bg-[#23583E] border border-[#23583E] text-[#FFD700] px-3 py-2.5 rounded-xl text-[10px] font-bold flex items-center gap-1 shrink-0 transition-all ${
                  !soundEnabled ? 'opacity-50 cursor-not-allowed' : 'hover:border-[#FFD700]/50'
                }`}
                title={soundEnabled ? "Tes Suara Notifikasi Bel" : "Aktifkan suara terlebih dahulu untuk tes"}
              >
                <span>🔔 Tes Bel</span>
              </button>
            </div>
          </div>

          {/* Auto Accept Toggle */}
          <div className="flex items-center justify-between p-3.5 bg-[#06170E] border border-[#1F4A34] rounded-2xl">
            <div className="flex items-center gap-3">
              <Bell className="w-5 h-5 text-[#F59E0B]" />
              <div>
                <p className="text-sm font-bold text-white">Terima Pesanan Otomatis</p>
                <p className="text-xs text-[#A5C9B8]">Otomatis proses pesanan masuk tanpa perlu konfirmasi manual</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setAutoAccept(!autoAccept)}
              className={`w-12 h-6 rounded-full transition-colors relative p-0.5 cursor-pointer ${
                autoAccept ? 'bg-[#22C55E]' : 'bg-gray-700'
              }`}
            >
              <div className={`w-5 h-5 rounded-full bg-white transition-transform ${
                autoAccept ? 'translate-x-6' : 'translate-x-0'
              }`} />
            </button>
          </div>
        </div>
      </div>

      {/* ==========================================
          SECTION 3: SYSTEM INFO
          ========================================== */}
      <div className="glass-card rounded-3xl p-6 border border-[#23583E]/60 flex flex-col gap-4">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between text-xs text-[#A5C9B8] gap-2">
          <div className="flex flex-wrap items-center gap-4">
            <span className="flex items-center gap-2">
              <Shield className="w-4 h-4 text-[#22C55E]" />
              <span>Terhubung sebagai <strong className="text-white">{user?.fullName || 'Mitra Toko'}</strong></span>
            </span>
            <span className="flex items-center gap-2">
              <Mail className="w-4 h-4 text-[#A5C9B8]" />
              <span className="text-[#A5C9B8]">{user?.email || 'email@domain.com'}</span>
            </span>
          </div>
          <span className="bg-[#22C55E]/15 text-[#22C55E] font-mono px-3 py-1 rounded-full text-[10px] font-bold border border-[#22C55E]/30 whitespace-nowrap">
            Ekosistem Merchant v2.5
          </span>
        </div>
        
        <div className="pt-3 border-t border-[#23583E]/40 flex flex-wrap items-center justify-between gap-2 text-[10px] text-[#A5C9B8]">
          <span className="flex items-center gap-1">
            <RefreshCw className="w-3 h-3" />
            Status: <span className="text-[#22C55E] font-bold">● Online</span>
          </span>
          <span className="flex items-center gap-1">
            <Smartphone className="w-3 h-3" />
            Mobile Ready
          </span>
          <span className="flex items-center gap-1">
            <Clock className="w-3 h-3" />
            {new Date().toLocaleString('id-ID', { 
              day: 'numeric', 
              month: 'short', 
              year: 'numeric',
              hour: '2-digit',
              minute: '2-digit'
            })}
          </span>
        </div>
      </div>
    </div>
  );
}