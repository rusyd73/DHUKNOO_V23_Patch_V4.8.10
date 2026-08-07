import React, { useState, useEffect } from 'react';
import { useAuthStore } from '../../store/useAuthStore';
import { AuthAPI } from '../../api';
import { PasswordResetModal } from '../modals/SharedModals';
import { MerchantRegister } from '../../pages/MerchantRegister';
import { Clock, Key, RefreshCw } from 'lucide-react';

// PERBAIKAN PERFORMA: AuthFlow dipakai oleh App.tsx (layar login/register awal)
// MAUPUN oleh CustomerApp/DriverApp/AdminApp (saat sesi re-login diperlukan di
// dalam salah satu role tsb). Dipisah ke file sendiri (bukan tinggal di
// App.tsx) supaya bisa diimpor langsung oleh ketiga halaman lazy-loaded itu
// tanpa harus "impor balik" dari App.tsx (yang akan merusak pemisahan bundle).

interface AuthFlowProps {
  role: 'CUSTOMER' | 'DRIVER' | 'ADMIN' | 'MERCHANT';
  onBack: () => void;
  onSuccess: (user: any, token: string, refreshToken: string) => void;
  triggerToast: (m: string) => void;
}

export default function AuthFlow({ role, onBack, onSuccess, triggerToast }: AuthFlowProps) {
  const { user } = useAuthStore();
  const [isRegisterMode, setIsRegisterMode] = useState(false);
  const [isPasswordResetOpen, setIsPasswordResetOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [driverVehicleType, setDriverVehicleType] = useState<'BIKE' | 'CAR'>('BIKE');
  const [vehicleModel, setVehicleModel] = useState('');
  const [vehiclePlate, setVehiclePlate] = useState('');
  const [adminPasskey, setAdminPasskey] = useState('');
  const [loading, setLoading] = useState(false);

  // Time limit login session (60 detik)
  const [loginTimeLeft, setLoginTimeLeft] = useState(60);
  const [isSessionExpired, setIsSessionExpired] = useState(false);

  useEffect(() => {
    setLoginTimeLeft(60);
    setIsSessionExpired(false);
    const timer = setInterval(() => {
      setLoginTimeLeft((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          setIsSessionExpired(true);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [role, isRegisterMode]);

  const handleResetLoginSession = () => {
    setLoginTimeLeft(60);
    setIsSessionExpired(false);
    triggerToast('⏱️ Sesi login diperbarui! Batas waktu 60 detik di-reset.');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;

    if (isSessionExpired) {
      triggerToast('⏰ Batas waktu login 60 detik telah berakhir! Silakan klik "Minta Ulang Sesi Login (60s)".');
      return;
    }

    if (!email || !password || (isRegisterMode && (!fullName || !phone))) {
      triggerToast('Mohon isi Nama Lengkap, Nomor HP/WhatsApp, Email, dan Password!');
      return;
    }

    setLoading(true);
    try {
      if (isRegisterMode) {
        // Build payload based on role
        const payload: any = {
          email,
          password,
          fullName,
          phone,
          role,
        };

        if (role === 'CUSTOMER') {
          payload.phoneNumber = phone;
          payload.isAppInstalled = true;
        } else if (role === 'DRIVER') {
          const typeBadge = driverVehicleType === 'BIKE' ? '[BIKE Motor]' : '[CAR Mobil]';
          const defaultModel = driverVehicleType === 'BIKE' ? 'Honda Vario 125' : 'Toyota Avanza';
          const rawModel = vehicleModel ? vehicleModel.trim() : defaultModel;
          payload.vehicleModel = `${typeBadge} ${rawModel}`;
          payload.vehiclePlate = vehiclePlate ? vehiclePlate.trim() : 'N 4321 OB';
          payload.driverServiceType = driverVehicleType;
        } else if (role === 'ADMIN') {
          if (adminPasskey !== 'DHUKNOO_SECRET_2026') {
            triggerToast('Kunci otorisasi pendaftaran admin salah!');
            setLoading(false);
            return;
          }
        }

        await AuthAPI.register(payload);
        triggerToast('Pendaftaran sukses! Silakan login.');
        setIsRegisterMode(false);
      } else {
        if (role === 'ADMIN' && adminPasskey !== 'DHUKNOO_SECRET_2026') {
          triggerToast('Kunci otorisasi masuk admin salah!');
          setLoading(false);
          return;
        }

        const response = await AuthAPI.login({ email, password });
        if (response.user.role !== role) {
          triggerToast(`Gagal: Akun terdaftar sebagai ${response.user.role}, bukan ${role}!`);
          setLoading(false);
          return;
        }
        triggerToast(`Selamat datang kembali, ${response.user.fullName}!`);
        onSuccess(response.user, response.accessToken, response.refreshToken);
      }
    } catch (err: any) {
      triggerToast(err.response?.data?.error || 'Terjadi kesalahan sistem.');
    } finally {
      setLoading(false);
    }
  };

  const getAccentColor = () => {
    if (role === 'CUSTOMER') return '#FFD700';
    if (role === 'DRIVER') return '#00E575';
    if (role === 'MERCHANT') return '#FF6B6B';
    return '#EF4444';
  };

  const accentColor = getAccentColor();

  // 🆕 PERBAIKAN (Merchant belum bisa diakses): akun MERCHANT TIDAK dibuat
  // lewat endpoint generik /api/auth/register (form di bawah ini tidak
  // pernah mengumpulkan data toko sama sekali — nama toko, kategori,
  // alamat, dst), melainkan lewat endpoint khusus /api/merchant/register
  // (komponen MerchantRegister) yang membuat User + profil Merchant
  // sekaligus dalam satu transaksi. Jadi untuk role MERCHANT, mode
  // "Daftar" menampilkan form pendaftaran merchant yang sesungguhnya,
  // bukan form generik customer/driver/admin di bawah.
  if (role === 'MERCHANT' && isRegisterMode) {
    return (
      <div className="w-full max-w-2xl mx-auto px-4 py-12 flex-1">
        <div className="bg-[#0D2E1F] border p-6 sm:p-8 rounded-3xl shadow-2xl" style={{ borderColor: accentColor }}>
          <MerchantRegister
            onDone={() => {
              triggerToast('Pendaftaran merchant sukses! Silakan login dengan email & password toko Anda.');
              setIsRegisterMode(false);
            }}
          />
        </div>
        <div className="flex flex-col gap-2 mt-4">
          <button
            type="button"
            onClick={() => setIsRegisterMode(false)}
            className="text-xs text-[#A5C9B8] hover:underline text-center"
          >
            Sudah punya akun? Login di sini
          </button>
          <button
            type="button"
            onClick={onBack}
            className="text-xs text-[#A5C9B8]/70 hover:underline text-center"
          >
            Kembali ke Launcher Hub
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-md mx-auto px-4 py-12 flex flex-col justify-center flex-1">
      <form 
        onSubmit={handleSubmit} 
        className="bg-[#0D2E1F] border p-8 rounded-3xl shadow-2xl flex flex-col gap-5"
        style={{ borderColor: accentColor }}
      >
        <div className="text-center">
          <span className="text-4xl">
            {role === 'CUSTOMER' ? '👤' : role === 'DRIVER' ? '🏍️' : role === 'MERCHANT' ? '🏪' : '🔑'}
          </span>
          <h2 className="text-2xl font-black mt-2" style={{ color: accentColor }}>
            {role === 'CUSTOMER' ? 'Client Customer' : role === 'DRIVER' ? 'Portal Mitra Driver' : role === 'MERCHANT' ? 'Portal Mitra Merchant' : 'Otoritas Admin'}
          </h2>
          <p className="text-xs text-[#A5C9B8] mt-1">
            {isRegisterMode ? 'Pendaftaran Akun Baru' : 'Autentikasi Kredensial'}
          </p>
        </div>

        {/* Live 60-second Login Session Limit Timer */}
        <div className="bg-[#06170E] border border-[#23583E] p-3 rounded-2xl flex flex-col gap-2">
          <div className="flex justify-between items-center text-[10px] font-bold">
            <span className="text-[#A5C9B8] flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5 text-[#FFD700]" />
              Batas Waktu Sesi Login:
            </span>
            <span className={loginTimeLeft <= 10 ? 'text-red-400 animate-pulse font-mono' : 'text-[#00E575] font-mono'}>
              {loginTimeLeft} Detik
            </span>
          </div>
          <div className="w-full bg-[#0D2E1F] h-1.5 rounded-full overflow-hidden border border-[#23583E]">
            <div 
              className={`h-full transition-all duration-1000 ${loginTimeLeft <= 10 ? 'bg-red-500' : 'bg-[#00E575]'}`}
              style={{ width: `${(loginTimeLeft / 60) * 100}%` }}
            />
          </div>
          {isSessionExpired ? (
            <div className="flex flex-col gap-1.5 mt-1">
              <p className="text-[10px] text-red-400 font-bold">
                ⚠️ Sesi login berakhir (Batas 60 detik)! Mohon minta ulang sesi login.
              </p>
              <button
                type="button"
                onClick={handleResetLoginSession}
                className="w-full py-1.5 bg-[#FFD700] hover:bg-[#FFD700]/80 text-[#06170E] text-[10px] font-black rounded-xl transition-all flex items-center justify-center gap-1"
              >
                <RefreshCw className="w-3 h-3" /> Minta Ulang Sesi Login (60s)
              </button>
            </div>
          ) : (
            <div className="flex justify-between items-center text-[9px] text-[#A5C9B8]/70">
              <span>Sesi aktif terbatas 60s demi keamanan akun</span>
              <button
                type="button"
                onClick={handleResetLoginSession}
                className="text-[#FFD700] hover:underline font-bold flex items-center gap-1"
              >
                <RefreshCw className="w-2.5 h-2.5" /> Reset 60s
              </button>
            </div>
          )}
        </div>

        {isRegisterMode && (
          <>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-bold text-[#A5C9B8]">Nama Lengkap *</label>
              <input 
                type="text" 
                required
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Contoh: Rusydi Dhuknoo" 
                className="bg-[#06170E] border border-[#23583E] text-white rounded-xl px-4 py-2.5 text-xs focus:outline-none focus:border-[#00E575]"
              />
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-xs font-bold text-[#A5C9B8]">Nomor HP / WhatsApp (Aktif) *</label>
              <input 
                type="text" 
                required
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="081252185515" 
                className="bg-[#06170E] border border-[#23583E] text-white rounded-xl px-4 py-2.5 text-xs focus:outline-none focus:border-[#00E575]"
              />
            </div>
          </>
        )}

        <div className="flex flex-col gap-1">
          <label className="text-xs font-bold text-[#A5C9B8]">Email Kredensial</label>
          <input 
            type="email" 
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="nama@email.com" 
            className="bg-[#06170E] border border-[#23583E] text-white rounded-xl px-4 py-2.5 text-xs focus:outline-none focus:border-[#00E575]"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs font-bold text-[#A5C9B8]">Kata Sandi</label>
          <input 
            type="password" 
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••" 
            className="bg-[#06170E] border border-[#23583E] text-white rounded-xl px-4 py-2.5 text-xs focus:outline-none focus:border-[#00E575]"
          />
        </div>

        {/* Role Specific Registration Fields */}

        {isRegisterMode && role === 'DRIVER' && (
          <>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-bold text-[#A5C9B8]">Kategori Pendaftaran Kendaraan</label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setDriverVehicleType('BIKE')}
                  className={`py-2.5 px-3 rounded-xl border text-xs font-black flex items-center justify-center gap-2 transition-all ${
                    driverVehicleType === 'BIKE'
                      ? 'bg-[#00E575] text-[#071F14] border-[#00E575] shadow-lg ring-2 ring-[#00E575]/40'
                      : 'bg-[#06170E] text-[#A5C9B8] border-[#23583E] hover:border-[#00E575]'
                  }`}
                >
                  <span className="text-base">🏍️</span>
                  <span>BIKE (Ojek Motor)</span>
                </button>
                <button
                  type="button"
                  onClick={() => setDriverVehicleType('CAR')}
                  className={`py-2.5 px-3 rounded-xl border text-xs font-black flex items-center justify-center gap-2 transition-all ${
                    driverVehicleType === 'CAR'
                      ? 'bg-[#FFD700] text-[#071F14] border-[#FFD700] shadow-lg ring-2 ring-[#FFD700]/40'
                      : 'bg-[#06170E] text-[#A5C9B8] border-[#23583E] hover:border-[#FFD700]'
                  }`}
                >
                  <span className="text-base">🚗</span>
                  <span>CAR (Mobil Taxi)</span>
                </button>
              </div>
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-xs font-bold text-[#A5C9B8]">Merk / Model Kendaraan Detail</label>
              <input 
                type="text" 
                required
                value={vehicleModel}
                onChange={(e) => setVehicleModel(e.target.value)}
                placeholder={driverVehicleType === 'BIKE' ? "Contoh: Honda Vario 125 / Yamaha NMAX" : "Contoh: Toyota Avanza / Daihatsu Xenia"} 
                className="bg-[#06170E] border border-[#23583E] text-white rounded-xl px-4 py-2.5 text-xs focus:outline-none focus:border-[#00E575]"
              />
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-xs font-bold text-[#A5C9B8]">Nomor Plat Kendaraan</label>
              <input 
                type="text" 
                required
                value={vehiclePlate}
                onChange={(e) => setVehiclePlate(e.target.value)}
                placeholder="Contoh: N 5678 AAB" 
                className="bg-[#06170E] border border-[#23583E] text-white rounded-xl px-4 py-2.5 text-xs focus:outline-none focus:border-[#00E575]"
              />
            </div>
          </>
        )}

        {role === 'ADMIN' && (
          <div className="flex flex-col gap-1">
            <label className="text-xs font-bold text-[#A5C9B8] text-red-400">Passkey Keamanan Admin</label>
            <input 
              type="password" 
              required
              value={adminPasskey}
              onChange={(e) => setAdminPasskey(e.target.value)}
              placeholder="Masukkan kode otorisasi internal..." 
              className="bg-[#06170E] border border-[#23583E] text-white rounded-xl px-4 py-2.5 text-xs focus:outline-none focus:border-red-500"
            />
            {isRegisterMode && <span className="text-[10px] text-red-300">Gunakan: DHUKNOO_SECRET_2026</span>}
          </div>
        )}

        <button 
          type="submit"
          disabled={loading || isSessionExpired}
          className="w-full py-3 rounded-xl font-bold text-[#071F14] transition-all transform active:scale-[0.98] flex items-center justify-center gap-2 disabled:opacity-50 cursor-pointer"
          style={{ backgroundColor: accentColor }}
        >
          {loading ? (
            <RefreshCw className="w-4 h-4 animate-spin" />
          ) : isRegisterMode ? (
            'Daftar Sekarang'
          ) : (
            'Buka Sesi Portal'
          )}
        </button>

        <div className="flex flex-col gap-2 mt-2">
          {!isRegisterMode && (
            <button
              type="button"
              onClick={() => setIsPasswordResetOpen(true)}
              className="text-xs text-[#FFD700] hover:underline text-center font-bold flex items-center justify-center gap-1.5 py-1"
            >
              <Key className="w-3.5 h-3.5" />
              <span>Lupa / Reset Kata Sandi?</span>
            </button>
          )}

          <button 
            type="button" 
            onClick={() => setIsRegisterMode(!isRegisterMode)} 
            className="text-xs text-[#A5C9B8] hover:underline text-center"
          >
            {isRegisterMode ? 'Sudah punya akun? Login di sini' : 'Belum terdaftar? Buat akun di sini'}
          </button>

          <button 
            type="button" 
            onClick={onBack} 
            className="text-xs text-[#A5C9B8]/70 hover:underline text-center"
          >
            Kembali ke Launcher Hub
          </button>
        </div>
      </form>

      <PasswordResetModal
        isOpen={isPasswordResetOpen}
        onClose={() => setIsPasswordResetOpen(false)}
        user={user}
        triggerToast={triggerToast}
      />
    </div>
  );
}

