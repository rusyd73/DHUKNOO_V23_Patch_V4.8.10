// components/common/OfflineBanner.tsx
//
// 🆕 PENINGKATAN UX: banner tetap (sticky) yang muncul otomatis saat
// koneksi internet putus, dan pesan singkat saat koneksi pulih kembali.
// Dipasang sekali di root app (App.tsx) supaya berlaku di semua halaman
// role (Customer/Driver/Merchant/Admin) tanpa perlu diulang-ulang.
import { useEffect, useState } from 'react';
import { WifiOff, Wifi } from 'lucide-react';
import { useOnlineStatus } from '../../hooks/useOnlineStatus';

export function OfflineBanner() {
  const isOnline = useOnlineStatus();
  const [showReconnected, setShowReconnected] = useState(false);
  const [wasOffline, setWasOffline] = useState(false);

  useEffect(() => {
    if (!isOnline) {
      setWasOffline(true);
    } else if (wasOffline) {
      // Baru saja kembali online setelah sempat putus — tampilkan konfirmasi
      // singkat lalu sembunyikan otomatis, supaya user tahu boleh lanjut.
      setShowReconnected(true);
      setWasOffline(false);
      const timer = setTimeout(() => setShowReconnected(false), 3000);
      return () => clearTimeout(timer);
    }
  }, [isOnline, wasOffline]);

  if (!isOnline) {
    return (
      <div className="fixed top-0 left-0 right-0 z-[9999] bg-red-600 text-white text-xs font-bold py-2 px-4 flex items-center justify-center gap-2 shadow-lg">
        <WifiOff className="w-4 h-4" />
        <span>Tidak ada koneksi internet. Beberapa fitur mungkin tidak berfungsi sampai koneksi pulih.</span>
      </div>
    );
  }

  if (showReconnected) {
    return (
      <div className="fixed top-0 left-0 right-0 z-[9999] bg-[#00E575] text-[#06170E] text-xs font-bold py-2 px-4 flex items-center justify-center gap-2 shadow-lg animate-in fade-in">
        <Wifi className="w-4 h-4" />
        <span>Koneksi internet kembali tersambung.</span>
      </div>
    );
  }

  return null;
}

export default OfflineBanner;
