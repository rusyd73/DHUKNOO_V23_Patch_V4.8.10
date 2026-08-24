import React, { useState, useEffect, useRef } from 'react';
import { MapContainer, TileLayer, Marker, useMapEvents, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Search, MapPin, RefreshCw, Navigation } from 'lucide-react';

// Custom Leaflet marker icons configuration for Vite/bundler compatibility
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png';
import markerIcon from 'leaflet/dist/images/marker-icon.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';

delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
});

interface LatLng {
  lat: number;
  lng: number;
}

interface LocationPickerProps {
  label: string;
  initialCenter: LatLng;
  value: LatLng | null;
  onChange: (pos: LatLng) => void;
  address: string;
  onAddressChange: (addr: string) => void;
  markerColor?: 'green' | 'red';
}

// ✅ PERBAIKAN 1: Fallback coordinates - UBAH ke Malang/Batu area
const FALLBACK_COORDS: LatLng = { lat: -7.8671, lng: 112.5239 };

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

// ✅ PERBAIKAN 3: Normalisasi nama kota untuk pencarian
const normalizeCity = (query: string): string => {
  const lower = query.toLowerCase().trim();
  // Deteksi apakah query menyebutkan kota tertentu
  const hasBatu = lower.includes('batu');
  const hasMalang = lower.includes('malang');
  const hasLowokwaru = lower.includes('lowokwaru');
  
  // Jika sudah ada nama kota, biarkan apa adanya
  if (hasBatu || hasMalang || hasLowokwaru) {
    return query;
  }
  
  // Jika tidak ada, tambahkan ", Malang Raya" untuk konteks
  return `${query}, Malang Raya`;
};


type NominatimAddress = Record<string, string | undefined>;

const cleanPart = (value?: string): string =>
  String(value || '')
    .replace(/\b(?:Kecamatan|Kelurahan)\s+/gi, '')
    .replace(/\s+/g, ' ')
    .trim();

const sameText = (a: string, b: string) => a.localeCompare(b, 'id', { sensitivity: 'base' }) === 0;

/**
 * Bangun label alamat dari komponen terstruktur Nominatim, bukan display_name mentah.
 * Ini mencegah komponen administratif dari hasil lama/berbeda ikut menempel pada titik
 * yang baru dipilih (contoh: titik Kota Batu tetapi label masih memuat Lowokwaru).
 */
const formatNominatimAddress = (raw: NominatimAddress | undefined, fallback = ''): string => {
  if (!raw) return cleanPart(fallback);

  const dominantCity = cleanPart(raw.city || raw.town || raw.municipality);
  const dominantCounty = cleanPart(raw.county);
  const cityDistrict = cleanPart(raw.city_district || raw.district);

  const isBatu = /(^|\s)kota\s+batu($|\s)|(^|\s)batu($|\s)/i.test(dominantCity);
  const isMalangCity = /kota\s+malang/i.test(dominantCity);

  // Nama kecamatan di Malang Raya tidak boleh menyeberang ke kota/kabupaten
  // lain setelah titik dipilih. Nominatim kadang mengirim city_district yang
  // tidak konsisten dengan city/town pada hasil yang sama.
  const batuDistricts = /batu|bumiaji|junrejo/i;
  const malangCityDistricts = /lowokwaru|klojen|blimbing|sukun|kedungkandang/i;
  const districtMatchesDominantCity =
    !cityDistrict ||
    (isBatu ? batuDistricts.test(cityDistrict) :
      isMalangCity ? malangCityDistricts.test(cityDistrict) : true);

  const candidates = [
    raw.amenity || raw.building || raw.shop || raw.tourism,
    raw.road || raw.pedestrian || raw.residential,
    raw.neighbourhood || raw.quarter,
    raw.suburb || raw.village || raw.hamlet,
    // city_district hanya dipakai bila konsisten dengan kota dominan.
    districtMatchesDominantCity ? cityDistrict : undefined,
    dominantCity || dominantCounty,
    dominantCity && dominantCounty && !sameText(dominantCity, dominantCounty) ? dominantCounty : undefined,
    raw.state,
  ].map(cleanPart).filter(Boolean);

  const filtered = candidates.filter((part) => {
    // Guard khusus Malang Raya: bila Nominatim sudah menegaskan Kota Batu,
    // jangan campurkan kecamatan Kota Malang seperti Lowokwaru.
    if (isBatu && /lowokwaru|klojen|blimbing|sukun|kedungkandang|kota\s+malang|kabupaten\s+malang/i.test(part)) return false;
    if (isMalangCity && /bumiaji|junrejo|kota\s+batu/i.test(part)) return false;
    return true;
  });

  const unique: string[] = [];
  for (const part of filtered) {
    if (!unique.some((existing) => sameText(existing, part))) unique.push(part);
  }

  return unique.join(', ') || cleanPart(fallback);
};

// Sub-component to handle map view updates (panning) when coordinates change
function ChangeView({ center }: { center: LatLng | null }) {
  const map = useMap();
  useEffect(() => {
    if (center && isValidCoords(center)) {
      map.setView([center.lat, center.lng], map.getZoom());
    }
  }, [center, map]);
  return null;
}

// Sub-component to capture map click events
function ClickHandler({ onMapClick }: { onMapClick: (pos: LatLng) => void }) {
  useMapEvents({
    click(e) {
      onMapClick({ lat: e.latlng.lat, lng: e.latlng.lng });
    },
  });
  return null;
}

export default function LocationPicker({
  label,
  initialCenter,
  value,
  onChange,
  address,
  onAddressChange,
  markerColor = 'green',
}: LocationPickerProps) {
  const [searchQuery, setSearchQuery] = useState(address);
  const [isSearching, setIsSearching] = useState(false);
  const [isReverseGeocoding, setIsReverseGeocoding] = useState(false);

  const skipNextAutoGeocodeRef = useRef(false);
  const requestSeqRef = useRef(0);
  const activeRequestRef = useRef<AbortController | null>(null);

  // Sync searchQuery with the parent address prop
  useEffect(() => {
    skipNextAutoGeocodeRef.current = true;
    setSearchQuery(address);
  }, [address]);

  const isMapActionRef = useRef(false);

  // FIX8: Forward geocoding memakai request terbaru saja + addressdetails terstruktur.
  const handleGeocode = async (queryToSearch: string) => {
    if (!queryToSearch || !queryToSearch.trim()) return;

    const requestId = ++requestSeqRef.current;
    activeRequestRef.current?.abort();
    const controller = new AbortController();
    activeRequestRef.current = controller;

    setIsSearching(true);
    isMapActionRef.current = false;

    try {
      const normalizedQuery = normalizeCity(queryToSearch.trim());
      let formattedQuery = normalizedQuery;

      if (!formattedQuery.toLowerCase().includes('malang') &&
          !formattedQuery.toLowerCase().includes('batu') &&
          !formattedQuery.toLowerCase().includes('lowokwaru')) {
        formattedQuery = `${formattedQuery}, Malang Raya`;
      }

      const search = async (q: string) => {
        const response = await fetch(
          `https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&q=${encodeURIComponent(q)}&limit=1&countrycodes=id&accept-language=id`,
          { signal: controller.signal }
        );
        if (!response.ok) throw new Error(`Geocoding HTTP ${response.status}`);
        return response.json();
      };

      let data = await search(formattedQuery);
      if ((!data || data.length === 0) && formattedQuery.includes('Malang Raya')) {
        data = await search(queryToSearch.trim());
      }

      if (requestId !== requestSeqRef.current || controller.signal.aborted) return;

      if (data && data.length > 0) {
        const lat = parseFloat(data[0].lat);
        const lng = parseFloat(data[0].lon);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

        const displayName = formatNominatimAddress(data[0].address, data[0].display_name);
        onChange({ lat, lng });
        onAddressChange(displayName);
        skipNextAutoGeocodeRef.current = true;
        setSearchQuery(displayName);
      }
    } catch (err: any) {
      if (err?.name !== 'AbortError') console.error('Error during geocoding:', err);
    } finally {
      if (requestId === requestSeqRef.current) setIsSearching(false);
    }
  };

  // FIX8: Reverse geocoding membatalkan pencarian lama dan memakai komponen alamat terstruktur.
  const handleReverseGeocode = async (coords: LatLng) => {
    const requestId = ++requestSeqRef.current;
    activeRequestRef.current?.abort();
    const controller = new AbortController();
    activeRequestRef.current = controller;

    setIsReverseGeocoding(true);
    isMapActionRef.current = true;

    try {
      const response = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=json&addressdetails=1&lat=${coords.lat}&lon=${coords.lng}&zoom=18&accept-language=id`,
        { signal: controller.signal }
      );
      if (!response.ok) throw new Error(`Reverse geocoding HTTP ${response.status}`);
      const data = await response.json();

      if (requestId !== requestSeqRef.current || controller.signal.aborted) return;

      if (data && data.display_name) {
        const displayName = formatNominatimAddress(data.address, data.display_name);
        onAddressChange(displayName);
        skipNextAutoGeocodeRef.current = true;
        setSearchQuery(displayName);
      } else {
        const fallback = `Lokasi Map (${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)})`;
        onAddressChange(fallback);
        skipNextAutoGeocodeRef.current = true;
        setSearchQuery(fallback);
      }
    } catch (err: any) {
      if (err?.name !== 'AbortError') console.error('Error during reverse geocoding:', err);
    } finally {
      if (requestId === requestSeqRef.current) setIsReverseGeocoding(false);
    }
  };

  const handleMapClick = (coords: LatLng) => {
    onChange(coords);
    handleReverseGeocode(coords);
  };

  // Debounced auto-geocode - CASE INSENSITIVE
  useEffect(() => {
    if (skipNextAutoGeocodeRef.current) {
      skipNextAutoGeocodeRef.current = false;
      return;
    }
    if (!searchQuery || !searchQuery.trim() || searchQuery.length < 3) return;

    const timer = setTimeout(() => {
      handleGeocode(searchQuery);
    }, 600);

    return () => clearTimeout(timer);
  }, [searchQuery]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newVal = e.target.value;
    setSearchQuery(newVal);
    onAddressChange(newVal);
  };

  const handleClearInput = () => {
    setSearchQuery('');
    onAddressChange('');
  };

  const handleUseCurrentLocation = () => {
    if (!navigator.geolocation) {
      alert('Browser Anda tidak mendukung fitur Geolocation GPS.');
      return;
    }
    setIsReverseGeocoding(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const coords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        onChange(coords);
        handleReverseGeocode(coords);
      },
      (err) => {
        setIsReverseGeocoding(false);
        console.error('Geolocation error:', err);
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  useEffect(() => () => {
    activeRequestRef.current?.abort();
  }, []);

  const customIcon = L.divIcon({
    className: '',
    html: `<div style="width:20px;height:20px;border-radius:50%;background:${
      markerColor === 'green' ? '#00E575' : '#EF4444'
    };border:3px solid white;box-shadow:0 0 8px rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;color:white;font-size:10px;font-weight:bold;">${
      markerColor === 'green' ? 'A' : 'B'
    }</div>`,
    iconSize: [20, 20],
    iconAnchor: [10, 10],
  });

  // ✅ PERBAIKAN 8: Pastikan mapCenter selalu valid
  const mapCenter = (value && isValidCoords(value)) ? value : 
                    (isValidCoords(initialCenter) ? initialCenter : FALLBACK_COORDS);

  // ✅ PERBAIKAN 9: Pastikan marker position valid
  const markerPosition = (value && isValidCoords(value)) ? value : null;

  return (
    <div id={`location-picker-${label.toLowerCase().replace(/\s+/g, '-')}`} className="flex flex-col gap-2 bg-[#06170E] p-4 rounded-2xl border border-[#23583E] isolate">
      <div className="flex justify-between items-center">
        <label className="text-[10px] font-bold text-[#A5C9B8] uppercase tracking-wide flex items-center gap-1.5">
          <MapPin className={`w-3.5 h-3.5 ${markerColor === 'green' ? 'text-[#00E575]' : 'text-[#EF4444]'}`} />
          {label}
        </label>
        {(isSearching || isReverseGeocoding) ? (
          <span className="text-[9px] text-[#00E575] flex items-center gap-1 animate-pulse">
            <RefreshCw className="w-2.5 h-2.5 animate-spin" />
            Memproses...
          </span>
        ) : (
          <span className="text-[9px] text-gray-400">Klik peta atau ketik alamat</span>
        )}
      </div>

      {/* Address Input Search Field */}
      <div className="flex items-center gap-2 bg-[#0D2E1F] p-2 rounded-xl border border-[#23583E]">
        <input
          type="text"
          value={searchQuery}
          onChange={handleInputChange}
          placeholder="Ketik alamat atau nama tempat (peta bergeser otomatis)..."
          className="bg-transparent text-xs text-white focus:outline-none w-full placeholder:text-gray-500"
        />
        {searchQuery && (
          <button
            type="button"
            onClick={handleClearInput}
            className="p-1 text-gray-400 hover:text-white rounded-lg transition-all text-xs font-bold"
            title="Reset / Hapus Teks"
          >
            ✕
          </button>
        )}
        <button
          type="button"
          onClick={() => handleGeocode(searchQuery)}
          className="p-1.5 bg-[#23583E] hover:bg-[#00E575] hover:text-[#071F14] text-[#A5C9B8] rounded-lg transition-all"
          title="Cari Alamat"
        >
          <Search className="w-3.5 h-3.5" />
        </button>
      </div>

      <button
        type="button"
        onClick={handleUseCurrentLocation}
        className="bg-[#23583E]/60 hover:bg-[#23583E] text-[#00E575] text-[10px] font-bold py-1.5 px-3 rounded-xl border border-[#23583E] transition-all flex items-center justify-center gap-1.5"
      >
        <Navigation className="w-3 h-3 text-[#00E575]" />
        🎯 Gunakan Lokasi Saya Saat Ini (GPS)
      </button>

      {/* Leaflet Map Box */}
      <div className="rounded-xl overflow-hidden border border-[#23583E] relative" style={{ height: 200 }}>
        <MapContainer
          center={[mapCenter.lat, mapCenter.lng]}
          zoom={14}
          style={{ height: '100%', width: '100%' }}
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <ClickHandler onMapClick={handleMapClick} />
          <ChangeView center={value} />
          
          {markerPosition && (
            <Marker position={[markerPosition.lat, markerPosition.lng]} icon={customIcon} />
          )}
        </MapContainer>
      </div>

      {value && isValidCoords(value) && (
        <div className="flex justify-between items-center text-[9px] text-gray-500 font-mono">
          <span>Lat: {value.lat.toFixed(5)}</span>
          <span>Lng: {value.lng.toFixed(5)}</span>
        </div>
      )}
    </div>
  );
}
