// hooks/useOnlineStatus.ts
//
// 🆕 PENINGKATAN UX: sebelumnya TIDAK ADA deteksi koneksi internet sama
// sekali di seluruh aplikasi (dicek: tidak ada satu pun listener untuk
// event 'online'/'offline' browser). Untuk aplikasi yang dipakai driver
// sedang di jalan (sinyal naik-turun) dan customer yang mungkin di dalam
// gedung/basement, ini penting -- tanpa ini, saat koneksi putus, request
// API gagal diam-diam atau melempar error generik yang membingungkan
// ("Gagal memuat data") padahal penyebabnya jelas: tidak ada internet.
import { useEffect, useState } from 'react';

export function useOnlineStatus(): boolean {
  const [isOnline, setIsOnline] = useState(() => (typeof navigator !== 'undefined' ? navigator.onLine : true));

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  return isOnline;
}
