// frontend/src/pages/Products.tsx
//
// 🆕 PERBAIKAN ("pengelolaan tambah data dll belum berfungsi"): halaman ini
// sebelumnya cuma placeholder ("Halaman manajemen produk/menu merchant.")
// tanpa form atau daftar produk sama sekali -- padahal backend-nya (add/
// update/delete product) sudah ada. Sekarang halaman ini benar-benar
// menampilkan daftar menu toko, dan form tambah/edit/hapus yang terhubung
// ke merchantApi.
import React, { useEffect, useState } from 'react';
import { merchantApi } from '../api/merchant.api';
import { Plus, Pencil, Trash2, X, Loader2, ImageOff } from 'lucide-react';

interface ProductItem {
  id: string;
  name: string;
  description?: string | null;
  price: number | string;
  imageUrl?: string | null;
  isAvailable: boolean;
}

const emptyForm = {
  name: '',
  description: '',
  price: '',
  imageUrl: '',
  isAvailable: true,
};

export function MerchantProducts() {
  const [products, setProducts] = useState<ProductItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<typeof emptyForm>(emptyForm);
  const [saving, setSaving] = useState(false);

  const loadProducts = async () => {
    setLoading(true);
    setError(null);
    try {
      // Halaman ini menampilkan menu TOKO SENDIRI. getMyMerchant() sudah
      // mengembalikan relasi products (lihat merchant.controller.ts getMine).
      const res = await merchantApi.getMyMerchant();
      const merchant = res.data?.data;
      setProducts(merchant?.products || []);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Gagal memuat daftar menu.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadProducts();
  }, []);

  const openAddForm = () => {
    setEditingId(null);
    setForm(emptyForm);
    setShowForm(true);
  };

  const openEditForm = (p: ProductItem) => {
    setEditingId(p.id);
    setForm({
      name: p.name,
      description: p.description || '',
      price: String(p.price),
      imageUrl: p.imageUrl || '',
      isAvailable: p.isAvailable,
    });
    setShowForm(true);
  };

  const closeForm = () => {
    setShowForm(false);
    setEditingId(null);
    setForm(emptyForm);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) {
      alert('Nama menu wajib diisi!');
      return;
    }
    const price = Number(form.price);
    if (!price || price <= 0) {
      alert('Harga harus lebih dari 0!');
      return;
    }

    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        description: form.description.trim() || undefined,
        price,
        imageUrl: form.imageUrl.trim() || undefined,
        isAvailable: form.isAvailable,
      };

      if (editingId) {
        await merchantApi.updateProduct(editingId, payload);
      } else {
        await merchantApi.addProduct(payload);
      }

      await loadProducts();
      closeForm();
    } catch (err: any) {
      alert(err.response?.data?.error || 'Gagal menyimpan menu.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (p: ProductItem) => {
    if (!confirm(`Hapus menu "${p.name}"? Tindakan ini tidak bisa dibatalkan.`)) return;
    try {
      await merchantApi.deleteProduct(p.id);
      setProducts((prev) => prev.filter((x) => x.id !== p.id));
    } catch (err: any) {
      alert(err.response?.data?.error || 'Gagal menghapus menu.');
    }
  };

  const handleToggleAvailable = async (p: ProductItem) => {
    try {
      await merchantApi.updateProduct(p.id, { isAvailable: !p.isAvailable });
      setProducts((prev) => prev.map((x) => (x.id === p.id ? { ...x, isAvailable: !x.isAvailable } : x)));
    } catch (err: any) {
      alert(err.response?.data?.error || 'Gagal mengubah status menu.');
    }
  };

  return (
    <div className="text-white">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">📋 Kelola Menu</h1>
          <p className="text-sm text-[#A5C9B8]">Tambah, ubah, atau hapus produk/menu toko Anda.</p>
        </div>
        <button
          onClick={openAddForm}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#FF6B6B] text-[#06170E] font-bold text-sm hover:bg-[#FF8787] transition-all"
        >
          <Plus className="w-4 h-4" /> Tambah Menu
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16 text-[#A5C9B8] gap-2">
          <Loader2 className="w-5 h-5 animate-spin" /> Memuat menu...
        </div>
      ) : error ? (
        <div className="bg-red-500/10 border border-red-500/30 text-red-300 rounded-2xl p-4 text-sm">{error}</div>
      ) : products.length === 0 ? (
        <div className="text-center py-16 bg-[#0D2E1F] rounded-3xl border border-[#23583E]">
          <p className="text-[#A5C9B8] mb-4">Belum ada menu. Tambahkan menu pertama toko Anda.</p>
          <button
            onClick={openAddForm}
            className="px-4 py-2 rounded-xl bg-[#FF6B6B] text-[#06170E] font-bold text-sm"
          >
            + Tambah Menu
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {products.map((p) => (
            <div key={p.id} className="bg-[#0D2E1F] rounded-2xl border border-[#23583E] overflow-hidden flex flex-col">
              <div className="h-32 bg-[#06170E] flex items-center justify-center">
                {p.imageUrl ? (
                  <img src={p.imageUrl} alt={p.name} className="w-full h-full object-cover" />
                ) : (
                  <ImageOff className="w-8 h-8 text-[#23583E]" />
                )}
              </div>
              <div className="p-4 flex-1 flex flex-col gap-2">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="font-bold text-sm">{p.name}</h3>
                  <span
                    className={`text-[10px] px-2 py-0.5 rounded-full font-bold whitespace-nowrap ${
                      p.isAvailable ? 'bg-[#00E575]/20 text-[#00E575]' : 'bg-red-500/20 text-red-400'
                    }`}
                  >
                    {p.isAvailable ? 'Tersedia' : 'Habis'}
                  </span>
                </div>
                {p.description && <p className="text-xs text-[#A5C9B8] line-clamp-2">{p.description}</p>}
                <p className="text-[#FFD700] font-black">Rp{Number(p.price).toLocaleString('id-ID')}</p>

                <div className="flex items-center gap-2 mt-auto pt-2">
                  <button
                    onClick={() => handleToggleAvailable(p)}
                    className="flex-1 text-xs px-2 py-1.5 rounded-lg border border-[#23583E] text-[#A5C9B8] hover:text-white hover:border-[#00E575] transition-all"
                  >
                    {p.isAvailable ? 'Tandai Habis' : 'Tandai Tersedia'}
                  </button>
                  <button
                    onClick={() => openEditForm(p)}
                    className="p-1.5 rounded-lg border border-[#23583E] text-[#A5C9B8] hover:text-[#FFD700] hover:border-[#FFD700] transition-all"
                    title="Edit"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => handleDelete(p)}
                    className="p-1.5 rounded-lg border border-[#23583E] text-[#A5C9B8] hover:text-red-400 hover:border-red-400 transition-all"
                    title="Hapus"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {showForm && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={closeForm}>
          <div
            className="bg-[#0D2E1F] border border-[#23583E] rounded-3xl p-6 w-full max-w-md"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold">{editingId ? 'Edit Menu' : 'Tambah Menu Baru'}</h2>
              <button onClick={closeForm} className="text-[#A5C9B8] hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleSubmit} className="flex flex-col gap-3">
              <div>
                <label className="text-xs text-[#A5C9B8]">Nama Menu *</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="w-full mt-1 px-3 py-2 rounded-xl bg-[#06170E] border border-[#23583E] text-white text-sm focus:outline-none focus:border-[#FF6B6B]"
                  placeholder="Contoh: Nasi Goreng Spesial"
                  required
                />
              </div>
              <div>
                <label className="text-xs text-[#A5C9B8]">Deskripsi</label>
                <textarea
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  className="w-full mt-1 px-3 py-2 rounded-xl bg-[#06170E] border border-[#23583E] text-white text-sm focus:outline-none focus:border-[#FF6B6B]"
                  rows={2}
                  placeholder="Deskripsi singkat menu (opsional)"
                />
              </div>
              <div>
                <label className="text-xs text-[#A5C9B8]">Harga (Rp) *</label>
                <input
                  type="number"
                  min={1}
                  value={form.price}
                  onChange={(e) => setForm({ ...form, price: e.target.value })}
                  className="w-full mt-1 px-3 py-2 rounded-xl bg-[#06170E] border border-[#23583E] text-white text-sm focus:outline-none focus:border-[#FF6B6B]"
                  placeholder="15000"
                  required
                />
              </div>
              <div>
                <label className="text-xs text-[#A5C9B8]">URL Gambar</label>
                <input
                  type="text"
                  value={form.imageUrl}
                  onChange={(e) => setForm({ ...form, imageUrl: e.target.value })}
                  className="w-full mt-1 px-3 py-2 rounded-xl bg-[#06170E] border border-[#23583E] text-white text-sm focus:outline-none focus:border-[#FF6B6B]"
                  placeholder="https://... (opsional)"
                />
              </div>
              <label className="flex items-center gap-2 text-sm text-[#A5C9B8]">
                <input
                  type="checkbox"
                  checked={form.isAvailable}
                  onChange={(e) => setForm({ ...form, isAvailable: e.target.checked })}
                />
                Tersedia untuk dipesan
              </label>

              <button
                type="submit"
                disabled={saving}
                className="mt-2 px-4 py-2.5 rounded-xl bg-[#FF6B6B] text-[#06170E] font-bold text-sm hover:bg-[#FF8787] transition-all disabled:opacity-60"
              >
                {saving ? 'Menyimpan...' : editingId ? 'Simpan Perubahan' : 'Tambah Menu'}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
