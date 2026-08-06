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

// ✅ PERBAIKAN 1: Fallback coordinates
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

// Sub-component to handle map view updates (panning) when coordinates change
function ChangeView({ center }: { center: LatLng | null }) {
  const map = useMap();
  useEffect(() => {
    // ✅ PERBAIKAN 3: Validasi sebelum pakai
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

  // Sync searchQuery with the parent address prop
  useEffect(() => {
    skipNextAutoGeocodeRef.current = true;
    setSearchQuery(address);
  }, [address]);

  const isMapActionRef = useRef(false);

  // Perform Geocoding
  const handleGeocode = async (queryToSearch: string) => {
    if (!queryToSearch || !queryToSearch.trim()) return;
    setIsSearching(true);
    isMapActionRef.current = false;

    try {
      let formattedQuery = queryToSearch;
      if (!formattedQuery.toLowerCase().includes('malang') && !formattedQuery.toLowerCase().includes('batu')) {
        formattedQuery += ', Malang Raya';
      }

      const response = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(formattedQuery)}&limit=1`
      );
      const data = await response.json();

      if (data && data.length > 0) {
        const lat = parseFloat(data[0].lat);
        const lng = parseFloat(data[0].lon);
        onChange({ lat, lng });
        onAddressChange(data[0].display_name);
        skipNextAutoGeocodeRef.current = true;
        setSearchQuery(data[0].display_name);
      }
    } catch (err) {
      console.error('Error during geocoding:', err);
    } finally {
      setIsSearching(false);
    }
  };

  // Perform Reverse Geocoding
  const handleReverseGeocode = async (coords: LatLng) => {
    setIsReverseGeocoding(true);
    isMapActionRef.current = true;

    try {
      const response = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=json&lat=${coords.lat}&lon=${coords.lng}`
      );
      const data = await response.json();

      if (data && data.display_name) {
        onAddressChange(data.display_name);
        skipNextAutoGeocodeRef.current = true;
        setSearchQuery(data.display_name);
      } else {
        const fallback = `Lokasi Map (${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)})`;
        onAddressChange(fallback);
        skipNextAutoGeocodeRef.current = true;
        setSearchQuery(fallback);
      }
    } catch (err) {
      console.error('Error during reverse geocoding:', err);
    } finally {
      setIsReverseGeocoding(false);
    }
  };

  const handleMapClick = (coords: LatLng) => {
    onChange(coords);
    handleReverseGeocode(coords);
  };

  // Debounced auto-geocode
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

  // ✅ PERBAIKAN 4: Pastikan mapCenter selalu valid
  const mapCenter = (value && isValidCoords(value)) ? value : 
                    (isValidCoords(initialCenter) ? initialCenter : FALLBACK_COORDS);

  // ✅ PERBAIKAN 5: Pastikan marker position valid
  const markerPosition = (value && isValidCoords(value)) ? value : null;

  return (
    <div id={`location-picker-${label.toLowerCase().replace(/\s+/g, '-')}`} className="flex flex-col gap-2 bg-[#06170E] p-4 rounded-2xl border border-[#23583E]">
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
        {/* ✅ PERBAIKAN 6: MapContainer selalu pakai koordinat valid */}
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
          
          {/* ✅ PERBAIKAN 7: Marker hanya render jika position valid */}
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