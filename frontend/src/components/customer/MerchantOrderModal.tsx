// frontend/src/components/customer/MerchantOrderModal.tsx
//
// 🆕 ("belum link dengan pesan layanan pada dashboard customer"): sebelumnya
// modul Merchant sama sekali tidak punya jalan untuk customer benar-benar
// MEMESAN dari toko -- toko bisa jualan produk, tapi tidak ada cara
// belanja+checkout dari sisi customer. Komponen ini: pilih toko -> lihat
// menu -> keranjang -> pilih alamat antar -> checkout lewat
// CustomerAPI.checkoutMerchant(), yang membuat Order (serviceType MART) dan
// masuk ke pipeline dispatch yang SAMA dengan order BIKE/CAR/SEND -- jadi
// tracking, chat, & call di CustomerApp.tsx otomatis ikut jalan tanpa kode
// tambahan (activeOrder di sana sudah generik untuk semua serviceType).
import React, { Suspense, useEffect, useState } from 'react';
import { merchantApi } from '../../api/merchant.api';
import { CustomerAPI } from '../../api';
import { X, Store, Search, Plus, Minus, ShoppingCart, ArrowLeft, Loader2 } from 'lucide-react';

const LocationPicker = React.lazy(() => import('../map/LocationPicker'));

function MapLoadingFallback() {
  return (
    <div className="h-[180px] rounded-xl border border-[#23583E] bg-[#06170E] flex items-center justify-center">
      <span className="text-[10px] text-[#A5C9B8] animate-pulse">Memuat peta...</span>
    </div>
  );
}

interface Merchant {
  id: string;
  name: string;
  category: string;
  address: string;
  imageUrl?: string | null;
  isOpen: boolean;
}

interface Product {
  id: string;
  name: string;
  description?: string | null;
  price: number | string;
  imageUrl?: string | null;
  isAvailable: boolean;
}

interface CartLine {
  product: Product;
  quantity: number;
}

interface MerchantOrderModalProps {
  onClose: () => void;
  onCheckoutSuccess: () => void;
  triggerToast: (msg: string) => void;
}

type Step = 'list' | 'menu' | 'checkout';

export default function MerchantOrderModal({ onClose, onCheckoutSuccess, triggerToast }: MerchantOrderModalProps) {
  const [step, setStep] = useState<Step>('list');
  const [merchants, setMerchants] = useState<Merchant[]>([]);
  const [loadingMerchants, setLoadingMerchants] = useState(true);
  const [search, setSearch] = useState('');

  const [selectedMerchant, setSelectedMerchant] = useState<Merchant | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [loadingProducts, setLoadingProducts] = useState(false);
  const [cart, setCart] = useState<Record<string, CartLine>>({});

  const [dropoffAddress, setDropoffAddress] = useState('');
  const [dropoffCoords, setDropoffCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<'WALLET' | 'CASH'>('WALLET');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    (async () => {
      setLoadingMerchants(true);
      try {
        const res = await merchantApi.getAll({ isOpen: true });
        setMerchants(res.data?.data || []);
      } catch (err) {
        triggerToast('Gagal memuat daftar toko.');
      } finally {
        setLoadingMerchants(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openMerchant = async (m: Merchant) => {
    setSelectedMerchant(m);
    setCart({});
    setStep('menu');
    setLoadingProducts(true);
    try {
      const res = await merchantApi.getProducts(m.id);
      setProducts((res.data?.data || []).filter((p: Product) => p.isAvailable));
    } catch (err) {
      triggerToast('Gagal memuat menu toko.');
    } finally {
      setLoadingProducts(false);
    }
  };

  const addToCart = (p: Product) => {
    setCart((prev) => {
      const existing = prev[p.id];
      return { ...prev, [p.id]: { product: p, quantity: (existing?.quantity || 0) + 1 } };
    });
  };

  const removeFromCart = (p: Product) => {
    setCart((prev) => {
      const existing = prev[p.id];
      if (!existing) return prev;
      const nextQty = existing.quantity - 1;
      const next = { ...prev };
      if (nextQty <= 0) {
        delete next[p.id];
      } else {
        next[p.id] = { ...existing, quantity: nextQty };
      }
      return next;
    });
  };

  const cartLines = Object.values(cart);
  const cartTotal = cartLines.reduce((sum, line) => sum + Number(line.product.price) * line.quantity, 0);
  const cartCount = cartLines.reduce((sum, line) => sum + line.quantity, 0);

  const filteredMerchants = merchants.filter(
    (m) =>
      m.name.toLowerCase().includes(search.toLowerCase()) ||
      m.category.toLowerCase().includes(search.toLowerCase())
  );

  const handleCheckout = async () => {
    if (cartLines.length === 0) {
      triggerToast('Keranjang masih kosong!');
      return;
    }
    if (!dropoffAddress || !dropoffCoords) {
      triggerToast('Pilih alamat pengantaran di peta terlebih dahulu!');
      return;
    }
    setSubmitting(true);
    try {
      await CustomerAPI.checkoutMerchant({
        merchantId: selectedMerchant!.id,
        items: cartLines.map((l) => ({ productId: l.product.id, quantity: l.quantity })),
        dropoffAddress,
        dropoffLat: dropoffCoords.lat,
        dropoffLng: dropoffCoords.lng,
        paymentMethod,
      });
      triggerToast(`✅ Pesanan dari ${selectedMerchant!.name} berhasil dibuat! Mencari driver...`);
      onCheckoutSuccess();
      onClose();
    } catch (err: any) {
      triggerToast(err.response?.data?.error || 'Gagal membuat pesanan.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
      <div className="bg-[#0D2E1F] border border-[#23583E] rounded-3xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-[#23583E]">
          <div className="flex items-center gap-2">
            {step !== 'list' && (
              <button
                onClick={() => setStep(step === 'checkout' ? 'menu' : 'list')}
                className="text-[#A5C9B8] hover:text-white"
              >
                <ArrowLeft className="w-5 h-5" />
              </button>
            )}
            <h2 className="text-lg font-bold text-[#FF6B6B]">
              {step === 'list' && '🏪 Belanja dari Toko'}
              {step === 'menu' && selectedMerchant?.name}
              {step === 'checkout' && 'Checkout Pesanan'}
            </h2>
          </div>
          <button onClick={onClose} className="text-[#A5C9B8] hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {/* STEP 1: Daftar Toko */}
          {step === 'list' && (
            <>
              <div className="relative mb-4">
                <Search className="w-4 h-4 text-[#A5C9B8] absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Cari toko atau kategori..."
                  className="w-full pl-9 pr-3 py-2 rounded-xl bg-[#06170E] border border-[#23583E] text-white text-sm focus:outline-none focus:border-[#FF6B6B]"
                />
              </div>

              {loadingMerchants ? (
                <div className="flex items-center justify-center py-12 text-[#A5C9B8] gap-2">
                  <Loader2 className="w-5 h-5 animate-spin" /> Memuat toko...
                </div>
              ) : filteredMerchants.length === 0 ? (
                <p className="text-center text-[#A5C9B8] py-12">Belum ada toko yang buka saat ini.</p>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {filteredMerchants.map((m) => (
                    <button
                      key={m.id}
                      onClick={() => openMerchant(m)}
                      className="text-left bg-[#06170E] border border-[#23583E] rounded-2xl p-3 hover:border-[#FF6B6B] transition-all flex gap-3"
                    >
                      <div className="w-14 h-14 rounded-xl bg-[#0D2E1F] flex items-center justify-center overflow-hidden flex-shrink-0">
                        {m.imageUrl ? (
                          <img src={m.imageUrl} alt={m.name} className="w-full h-full object-cover" />
                        ) : (
                          <Store className="w-6 h-6 text-[#23583E]" />
                        )}
                      </div>
                      <div>
                        <p className="font-bold text-sm text-white">{m.name}</p>
                        <p className="text-xs text-[#A5C9B8]">{m.category}</p>
                        <p className="text-[10px] text-[#A5C9B8]/70 line-clamp-1">{m.address}</p>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}

          {/* STEP 2: Menu Toko */}
          {step === 'menu' && (
            <>
              {loadingProducts ? (
                <div className="flex items-center justify-center py-12 text-[#A5C9B8] gap-2">
                  <Loader2 className="w-5 h-5 animate-spin" /> Memuat menu...
                </div>
              ) : products.length === 0 ? (
                <p className="text-center text-[#A5C9B8] py-12">Toko ini belum punya menu tersedia.</p>
              ) : (
                <div className="flex flex-col gap-2">
                  {products.map((p) => {
                    const qty = cart[p.id]?.quantity || 0;
                    return (
                      <div key={p.id} className="flex items-center justify-between gap-3 bg-[#06170E] border border-[#23583E] rounded-2xl p-3">
                        <div className="flex-1 min-w-0">
                          <p className="font-bold text-sm text-white truncate">{p.name}</p>
                          {p.description && <p className="text-xs text-[#A5C9B8] line-clamp-1">{p.description}</p>}
                          <p className="text-[#FFD700] font-black text-sm mt-1">Rp{Number(p.price).toLocaleString('id-ID')}</p>
                        </div>
                        {qty === 0 ? (
                          <button
                            onClick={() => addToCart(p)}
                            className="px-3 py-1.5 rounded-xl bg-[#FF6B6B] text-[#06170E] font-bold text-xs flex-shrink-0"
                          >
                            + Tambah
                          </button>
                        ) : (
                          <div className="flex items-center gap-2 flex-shrink-0">
                            <button
                              onClick={() => removeFromCart(p)}
                              className="w-7 h-7 rounded-full bg-[#23583E] flex items-center justify-center text-white"
                            >
                              <Minus className="w-3.5 h-3.5" />
                            </button>
                            <span className="text-white font-bold w-4 text-center">{qty}</span>
                            <button
                              onClick={() => addToCart(p)}
                              className="w-7 h-7 rounded-full bg-[#FF6B6B] flex items-center justify-center text-[#06170E]"
                            >
                              <Plus className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}

          {/* STEP 3: Checkout */}
          {step === 'checkout' && (
            <div className="flex flex-col gap-4">
              <div className="bg-[#06170E] border border-[#23583E] rounded-2xl p-3">
                <p className="text-xs text-[#A5C9B8] mb-2">Ringkasan Pesanan</p>
                {cartLines.map((l) => (
                  <div key={l.product.id} className="flex justify-between text-sm text-white py-0.5">
                    <span>{l.quantity}x {l.product.name}</span>
                    <span>Rp{(Number(l.product.price) * l.quantity).toLocaleString('id-ID')}</span>
                  </div>
                ))}
                <div className="border-t border-[#23583E] mt-2 pt-2 flex justify-between text-sm font-bold text-[#FFD700]">
                  <span>Subtotal Belanja</span>
                  <span>Rp{cartTotal.toLocaleString('id-ID')}</span>
                </div>
                <p className="text-[10px] text-[#A5C9B8] mt-1">+ ongkos antar (dihitung otomatis dari jarak toko ke alamat Anda)</p>
              </div>

              <div>
                <p className="text-xs text-[#A5C9B8] mb-2">Alamat Pengantaran</p>
                <Suspense fallback={<MapLoadingFallback />}>
                  <LocationPicker
                    label="Titik Pengantaran"
                    initialCenter={{ lat: -7.9666, lng: 112.6326 }}
                    value={dropoffCoords}
                    onChange={setDropoffCoords}
                    address={dropoffAddress}
                    onAddressChange={setDropoffAddress}
                    markerColor="red"
                  />
                </Suspense>
              </div>

              <div>
                <p className="text-xs text-[#A5C9B8] mb-2">Metode Pembayaran</p>
                <div className="flex gap-2">
                  {(['WALLET', 'CASH'] as const).map((pm) => (
                    <button
                      key={pm}
                      onClick={() => setPaymentMethod(pm)}
                      className={`flex-1 py-2 rounded-xl text-xs font-bold border transition-all ${
                        paymentMethod === pm
                          ? 'bg-[#FF6B6B]/20 border-[#FF6B6B] text-[#FF6B6B]'
                          : 'border-[#23583E] text-[#A5C9B8]'
                      }`}
                    >
                      {pm === 'WALLET' ? '💳 Saldo Wallet' : '💵 Tunai (COD)'}
                    </button>
                  ))}
                </div>
              </div>

              <button
                onClick={handleCheckout}
                disabled={submitting}
                className="px-4 py-3 rounded-xl bg-[#FF6B6B] text-[#06170E] font-black hover:bg-[#FF8787] transition-all disabled:opacity-60"
              >
                {submitting ? 'Memproses...' : `Buat Pesanan — Rp${cartTotal.toLocaleString('id-ID')}+`}
              </button>
            </div>
          )}
        </div>

        {/* Bottom bar: keranjang (hanya muncul di step menu) */}
        {step === 'menu' && cartCount > 0 && (
          <div className="p-4 border-t border-[#23583E]">
            <button
              onClick={() => setStep('checkout')}
              className="w-full flex items-center justify-between px-4 py-3 rounded-xl bg-[#FF6B6B] text-[#06170E] font-black"
            >
              <span className="flex items-center gap-2">
                <ShoppingCart className="w-4 h-4" /> {cartCount} item
              </span>
              <span>Lanjut — Rp{cartTotal.toLocaleString('id-ID')}</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
