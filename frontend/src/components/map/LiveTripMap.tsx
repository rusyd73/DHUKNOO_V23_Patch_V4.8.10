import React, { useState, useEffect, useRef, useMemo } from 'react';
import { MapContainer, TileLayer, Marker, Polyline, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Play, Square, Navigation, MapPin } from 'lucide-react';

interface LatLng {
  lat: number;
  lng: number;
}

interface LiveTripMapProps {
  orderId: string;
  pickupCoords: LatLng;      // Wajib ada
  dropoffCoords: LatLng;     // Wajib ada
  driverCoords: LatLng | null;
  isDriverSide: boolean;
  onDriverCoordsChange?: (coords: LatLng) => void;
  orderStatus: string;
}

// ✅ PERBAIKAN 1: Koordinat fallback (Malang)
const FALLBACK_COORDS: LatLng = { lat: -7.9666, lng: 112.6326 };

// ✅ PERBAIKAN 2: Fungsi validasi koordinat
const isValidCoords = (coords: any): coords is LatLng => {
  return coords && 
         typeof coords.lat === 'number' && 
         typeof coords.lng === 'number' &&
         !isNaN(coords.lat) && 
         !isNaN(coords.lng) &&
         coords.lat >= -90 && coords.lat <= 90 &&
         coords.lng >= -180 && coords.lng <= 180;
};

// Sub-component to auto-fit the map viewport to fit all active markers
function FitBounds({ pickup, dropoff, driver }: { pickup: LatLng; dropoff: LatLng; driver: LatLng | null }) {
  const map = useMap();
  
  useEffect(() => {
    // ✅ PERBAIKAN 3: Validasi sebelum pakai
    const points: [number, number][] = [];
    
    if (isValidCoords(pickup)) {
      points.push([pickup.lat, pickup.lng]);
    }
    if (isValidCoords(dropoff)) {
      points.push([dropoff.lat, dropoff.lng]);
    }
    if (driver && isValidCoords(driver)) {
      points.push([driver.lat, driver.lng]);
    }
    
    // ✅ Jika tidak ada points, pakai fallback
    if (points.length === 0) {
      points.push([FALLBACK_COORDS.lat, FALLBACK_COORDS.lng]);
    }
    
    const bounds = L.latLngBounds(points);
    map.fitBounds(bounds, { padding: [40, 40] });
  }, [pickup, dropoff, driver, map]);
  
  return null;
}

export default function LiveTripMap({
  orderId,
  pickupCoords,
  dropoffCoords,
  driverCoords,
  isDriverSide,
  onDriverCoordsChange,
  orderStatus,
}: LiveTripMapProps) {
  const [isSimulating, setIsSimulating] = useState(false);
  const simulationIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ✅ PERBAIKAN 4: Validasi pickupCoords dan dropoffCoords
  const safePickup = isValidCoords(pickupCoords) ? pickupCoords : FALLBACK_COORDS;
  const safeDropoff = isValidCoords(dropoffCoords) ? dropoffCoords : FALLBACK_COORDS;

  // ✅ PERBAIKAN 5: Pastikan driverCoords valid
  const safeDriverCoords = driverCoords && isValidCoords(driverCoords) 
    ? driverCoords 
    : null;

  // ✅ PERBAIKAN 6: Fallback untuk effectiveDriverCoords
  const effectiveDriverCoords = useMemo(() => {
    if (safeDriverCoords) return safeDriverCoords;
    // Buat titik di dekat pickup
    return {
      lat: safePickup.lat + 0.01,
      lng: safePickup.lng - 0.01,
    };
  }, [safeDriverCoords, safePickup]);

  // Custom styling markers
  const pickupIcon = L.divIcon({
    className: '',
    html: `<div style="width:24px;height:24px;border-radius:50%;background:#00E575;border:3px solid white;box-shadow:0 0 8px rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;color:white;font-size:11px;font-weight:extrabold;">A</div>`,
    iconSize: [24, 24],
    iconAnchor: [12, 12],
  });

  const dropoffIcon = L.divIcon({
    className: '',
    html: `<div style="width:24px;height:24px;border-radius:50%;background:#EF4444;border:3px solid white;box-shadow:0 0 8px rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;color:white;font-size:11px;font-weight:extrabold;">B</div>`,
    iconSize: [24, 24],
    iconAnchor: [12, 12],
  });

  const driverIcon = L.divIcon({
    className: '',
    html: `
      <div class="relative flex items-center justify-center">
        <div class="absolute w-10 h-10 bg-[#FFD700] rounded-full animate-ping opacity-25"></div>
        <div style="width:36px;height:36px;border-radius:50%;background:#FFD700;border:3px solid #071F14;box-shadow:0 0 10px rgba(0,0,0,0.6);display:flex;align-items:center;justify-content:center;font-size:18px;">
          🏍️
        </div>
      </div>
    `,
    iconSize: [40, 40],
    iconAnchor: [20, 20],
  });

  // Handler for manual dragging of driver marker
  const markerRef = useRef<L.Marker>(null);
  const eventHandlers = useMemo(
    () => ({
      dragend() {
        const marker = markerRef.current;
        if (marker != null && onDriverCoordsChange) {
          const latLng = marker.getLatLng();
          onDriverCoordsChange({ lat: latLng.lat, lng: latLng.lng });
        }
      },
    }),
    [onDriverCoordsChange]
  );

  // Simulation Engine
  const startSimulation = () => {
    if (!onDriverCoordsChange) return;
    setIsSimulating(true);

    let progress = 0;
    const totalSteps = 40;
    const currentPos = effectiveDriverCoords;

    if (simulationIntervalRef.current) clearInterval(simulationIntervalRef.current);

    simulationIntervalRef.current = setInterval(() => {
      progress += 1;
      let targetLat = currentPos.lat;
      let targetLng = currentPos.lng;

      if (progress <= 16) {
        const ratio = progress / 16;
        targetLat = currentPos.lat + (safePickup.lat - currentPos.lat) * ratio;
        targetLng = currentPos.lng + (safePickup.lng - currentPos.lng) * ratio;
      } else {
        const ratio = (progress - 16) / (totalSteps - 16);
        targetLat = safePickup.lat + (safeDropoff.lat - safePickup.lat) * ratio;
        targetLng = safePickup.lng + (safeDropoff.lng - safePickup.lng) * ratio;
      }

      onDriverCoordsChange({ lat: targetLat, lng: targetLng });

      if (progress >= totalSteps) {
        stopSimulation();
      }
    }, 1200);
  };

  const stopSimulation = () => {
    setIsSimulating(false);
    if (simulationIntervalRef.current) {
      clearInterval(simulationIntervalRef.current);
      simulationIntervalRef.current = null;
    }
  };

  useEffect(() => {
    return () => {
      if (simulationIntervalRef.current) clearInterval(simulationIntervalRef.current);
    };
  }, []);

  return (
    <div id={`live-trip-map-${orderId}`} className="bg-[#06170E] p-4 rounded-3xl border border-[#23583E] flex flex-col gap-3">
      <div className="flex justify-between items-center">
        <div>
          <span className="text-xs font-black text-[#FFD700] uppercase tracking-wide flex items-center gap-1.5">
            <Navigation className="w-3.5 h-3.5 text-[#00E575] animate-pulse" />
            Live Tracking GPS
          </span>
          <span className="text-[10px] text-gray-400 block mt-0.5">Order ID: #{orderId.slice(0, 8)}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] bg-[#00E575]/15 text-[#00E575] border border-[#00E575]/30 px-2 py-0.5 rounded font-bold uppercase">
            {orderStatus}
          </span>
        </div>
      </div>

      {/* Map stage */}
      <div className="rounded-2xl overflow-hidden border border-[#23583E]" style={{ height: 300 }}>
        {/* ✅ PERBAIKAN 7: MapContainer selalu pakai koordinat valid */}
        <MapContainer
          center={[safePickup.lat, safePickup.lng]}
          zoom={13}
          style={{ height: '100%', width: '100%' }}
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          
          {/* ✅ PERBAIKAN 8: FitBounds selalu dapat koordinat valid */}
          <FitBounds 
            pickup={safePickup} 
            dropoff={safeDropoff} 
            driver={safeDriverCoords} 
          />

          {/* Polyline Route */}
          <Polyline
            positions={[
              [safePickup.lat, safePickup.lng],
              [safeDropoff.lat, safeDropoff.lng],
            ]}
            color="#FFD700"
            weight={4}
            dashArray="10, 10"
            opacity={0.85}
          />

          {/* Pickup Point A */}
          <Marker position={[safePickup.lat, safePickup.lng]} icon={pickupIcon} />

          {/* Dropoff Point B */}
          <Marker position={[safeDropoff.lat, safeDropoff.lng]} icon={dropoffIcon} />

          {/* Active Driver Icon */}
          <Marker
            ref={markerRef}
            draggable={isDriverSide && !isSimulating}
            eventHandlers={eventHandlers}
            position={[effectiveDriverCoords.lat, effectiveDriverCoords.lng]}
            icon={driverIcon}
          />
        </MapContainer>
      </div>

      {/* Driver Realtime Map Controls */}
      {isDriverSide && onDriverCoordsChange && (
        <div className="flex flex-col gap-2 bg-[#0D2E1F] p-3 rounded-2xl border border-[#23583E] mt-1">
          <div className="flex justify-between items-center">
            <span className="text-[10px] font-bold text-[#A5C9B8]">
              📍 Peta Realtime Lokasi Driver (GPS Live Tracking)
            </span>
            <span className="text-[9px] text-[#00E575] font-bold flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-[#00E575] animate-ping"></span>
              Realtime GPS Aktif
            </span>
          </div>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                if (navigator.geolocation) {
                  navigator.geolocation.getCurrentPosition(
                    (pos) => {
                      onDriverCoordsChange({ lat: pos.coords.latitude, lng: pos.coords.longitude });
                    },
                    (err) => console.error(err),
                    { enableHighAccuracy: true }
                  );
                }
              }}
              className="flex items-center justify-center gap-1.5 flex-1 bg-[#00E575] hover:bg-[#00ff80] text-[#071F14] py-2 rounded-xl text-xs font-black transition-all transform active:scale-95 shadow-md"
            >
              <Navigation className="w-3.5 h-3.5 shrink-0" />
              Perbarui Posisi GPS Saya Saat Ini
            </button>
          </div>
          <p className="text-[9px] text-[#A5C9B8]/70 text-center">
            Seret marker motor di atas atau klik tombol di atas untuk mengirim update koordinat realtime ke Customer.
          </p>
        </div>
      )}

      {/* Info display */}
      <div className="flex justify-between items-center text-[9px] text-[#A5C9B8]/70 px-1">
        <span className="flex items-center gap-1">
          <MapPin className="w-3 h-3 text-[#00E575]" /> 
          Jemput: {safePickup.lat.toFixed(5)}, {safePickup.lng.toFixed(5)}
        </span>
        <span className="flex items-center gap-1">
          <MapPin className="w-3 h-3 text-[#EF4444]" /> 
          Tujuan: {safeDropoff.lat.toFixed(5)}, {safeDropoff.lng.toFixed(5)}
        </span>
      </div>
    </div>
  );
}