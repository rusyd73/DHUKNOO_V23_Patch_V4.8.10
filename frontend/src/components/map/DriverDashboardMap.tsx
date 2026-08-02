import React, { useEffect, useRef, useState } from 'react';
import { MapContainer, TileLayer, Marker, Circle, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Navigation, MapPin, WifiOff } from 'lucide-react';

interface LatLng {
  lat: number;
  lng: number;
}

interface DriverDashboardMapProps {
  isOnline: boolean;
  initialCoords?: LatLng | null;
  onLocationUpdate: (coords: LatLng) => void;
}

// Re-center the map whenever the driver's live position changes, without
// forcing the user to re-drag/re-zoom every single update.
function RecenterOnMove({ position }: { position: LatLng }) {
  const map = useMap();
  const hasCenteredOnce = useRef(false);
  useEffect(() => {
    if (!hasCenteredOnce.current) {
      map.setView([position.lat, position.lng], 15);
      hasCenteredOnce.current = true;
    } else {
      map.panTo([position.lat, position.lng], { animate: true });
    }
  }, [position, map]);
  return null;
}

/**
 * PERBAIKAN AKAR MASALAH: sebelumnya TIDAK ADA mekanisme sama sekali yang
 * mengirim update lokasi GPS driver ke backend di luar sesi trip aktif.
 * Akibatnya driver yang baru toggle ONLINE (apalagi setelah sebelumnya
 * OFFLINE) punya latitude/longitude NULL atau basi di database -- dan
 * SEMUA jalur dispatch/auto-accept mensyaratkan koordinat valid, jadi
 * driver itu otomatis tidak pernah muncul sebagai kandidat sama sekali.
 * Ini kemungkinan besar juga akar dari laporan "auto accept gagal"
 * sebelumnya.
 *
 * Komponen ini tampil di dashboard utama driver (bukan cuma saat trip
 * aktif), sebagai panduan visual DAN sekaligus mesin auto-update lokasi:
 * - Begitu driver ONLINE (termasuk transisi OFFLINE -> ONLINE), langsung
 *   kirim 1 update lokasi SEKETIKA (bukan menunggu interval berikutnya).
 * - Selama ONLINE, browser terus memantau posisi (watchPosition) dan
 *   mengirim update berkala ke backend (PATCH /api/location/driver).
 * - Begitu OFFLINE, watcher dihentikan (hemat baterai) dan peta
 *   menampilkan status "tidak memantau lokasi".
 */
export default function DriverDashboardMap({ isOnline, initialCoords, onLocationUpdate }: DriverDashboardMapProps) {
  const [coords, setCoords] = useState<LatLng | null>(initialCoords || null);
  const [accuracy, setAccuracy] = useState<number | null>(null);
  const [permissionError, setPermissionError] = useState<string | null>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null);
  const watchIdRef = useRef<number | null>(null);
  const wasOnlineRef = useRef(false);

  const pushUpdate = (pos: GeolocationPosition) => {
    const next = { lat: pos.coords.latitude, lng: pos.coords.longitude };
    setCoords(next);
    setAccuracy(pos.coords.accuracy);
    setPermissionError(null);
    setLastUpdatedAt(new Date());
    onLocationUpdate(next);
  };

  const handleError = (err: GeolocationPositionError) => {
    setPermissionError(
      err.code === err.PERMISSION_DENIED
        ? 'Izin lokasi ditolak. Aktifkan izin GPS di browser/HP Anda supaya bisa menerima order.'
        : 'Gagal mengambil lokasi GPS. Pastikan GPS aktif dan sinyal cukup baik.'
    );
  };

  useEffect(() => {
    if (!navigator.geolocation) {
      setPermissionError('Perangkat/browser ini tidak mendukung GPS (Geolocation API).');
      return;
    }

    if (isOnline) {
      // PENTING: transisi OFFLINE -> ONLINE (termasuk saat pertama kali
      // dashboard dibuka dalam keadaan sudah online) WAJIB langsung minta
      // posisi terbaru SEKETIKA -- jangan tunggu watchPosition dapat fix
      // pertamanya sendiri, supaya driver tidak "menggantung" tanpa
      // koordinat valid tepat di momen mereka baru online.
      if (!wasOnlineRef.current) {
        navigator.geolocation.getCurrentPosition(pushUpdate, handleError, {
          enableHighAccuracy: true,
          timeout: 15000,
          maximumAge: 0,
        });
      }

      if (watchIdRef.current === null) {
        watchIdRef.current = navigator.geolocation.watchPosition(pushUpdate, handleError, {
          enableHighAccuracy: true,
          timeout: 20000,
          maximumAge: 10000,
        });
      }
    } else if (watchIdRef.current !== null) {
      // OFFLINE -- hentikan pemantauan lokasi supaya tidak menguras baterai
      // driver percuma selagi mereka sedang tidak menerima order.
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }

    wasOnlineRef.current = isOnline;

    return () => {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOnline]);

  const driverIcon = L.divIcon({
    className: '',
    html: `
      <div class="relative flex items-center justify-center">
        <div class="absolute w-9 h-9 bg-[#00E575] rounded-full animate-ping opacity-25"></div>
        <div style="width:32px;height:32px;border-radius:50%;background:${isOnline ? '#00E575' : '#6b7280'};border:3px solid #071F14;box-shadow:0 0 10px rgba(0,0,0,0.6);display:flex;align-items:center;justify-content:center;font-size:16px;">
          🏍️
        </div>
      </div>
    `,
    iconSize: [36, 36],
    iconAnchor: [18, 18],
  });

  const displayCoords = coords || { lat: -7.9666, lng: 112.6326 }; // Fallback: Malang, sesuai lokasi default

  return (
    <div className="bg-[#0D2E1F] border border-[#23583E] p-4 rounded-3xl flex flex-col gap-3">
      <div className="flex justify-between items-center">
        <span className="text-xs font-black text-[#FFD700] uppercase tracking-wide flex items-center gap-1.5">
          <MapPin className="w-3.5 h-3.5 text-[#00E575]" />
          Peta Lokasi Anda
        </span>
        {isOnline ? (
          <span className="text-[9px] bg-[#00E575]/15 text-[#00E575] border border-[#00E575]/30 px-2 py-0.5 rounded font-bold uppercase flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-[#00E575] animate-pulse" />
            Auto-Update Aktif
          </span>
        ) : (
          <span className="text-[9px] bg-gray-700/30 text-gray-400 border border-gray-600/40 px-2 py-0.5 rounded font-bold uppercase flex items-center gap-1">
            <WifiOff className="w-3 h-3" /> Tidak Memantau (Offline)
          </span>
        )}
      </div>

      <div className="rounded-2xl overflow-hidden border border-[#23583E]" style={{ height: 220 }}>
        <MapContainer center={[displayCoords.lat, displayCoords.lng]} zoom={15} style={{ height: '100%', width: '100%' }}>
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          {coords && <RecenterOnMove position={coords} />}
          {coords && accuracy && <Circle center={[coords.lat, coords.lng]} radius={accuracy} pathOptions={{ color: '#00E575', fillOpacity: 0.08, weight: 1 }} />}
          <Marker position={[displayCoords.lat, displayCoords.lng]} icon={driverIcon} />
        </MapContainer>
      </div>

      {permissionError ? (
        <div className="bg-red-950/40 border border-red-500/40 text-red-300 text-[10px] px-3 py-2 rounded-xl">
          ⚠️ {permissionError}
        </div>
      ) : (
        <div className="flex justify-between items-center text-[9px] text-[#A5C9B8]/70 px-1">
          <span className="flex items-center gap-1">
            <Navigation className="w-3 h-3 text-[#00E575]" />
            {coords ? `${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)}` : 'Mencari sinyal GPS...'}
          </span>
          <span>
            {isOnline
              ? lastUpdatedAt
                ? `Diperbarui ${lastUpdatedAt.toLocaleTimeString('id-ID')}`
                : 'Menunggu fix GPS pertama...'
              : 'Nyalakan status Online untuk mulai memantau'}
          </span>
        </div>
      )}
    </div>
  );
}
