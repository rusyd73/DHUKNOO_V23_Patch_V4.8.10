// frontend/src/store/useAuthStore.ts
import { create } from 'zustand';
import { connectSocket, disconnectSocket } from '../services/socket';
import { AuthAPI } from '../api/auth.api';

// ✅ Tipe Role yang benar (tanpa backtick)
type Role = 'CUSTOMER' | 'DRIVER' | 'MERCHANT' | 'ADMIN' | null;

// ✅ Parse user dari localStorage
const savedUser = JSON.parse(
  localStorage.getItem("dhuknoo_user") || "null"
);

interface User {
  id: string;
  email: string;
  fullName: string;
  role: Role;
}

// 🆕 Tipe untuk Theme
type Theme = 'light' | 'dark';

interface AuthState {
  token: string | null;
  refreshToken: string | null;
  user: User | null;
  currentRole: Role;
  useSerifFont: boolean;
  fontScale: number;
  
  // 🆕 TAMBAHKAN INI:
  theme: Theme;
  setTheme: (theme: Theme) => void;
  
  // Actions
  login: (user: User, token: string, refreshToken: string) => void;
  logout: () => void;
  setRole: (role: Role) => void;
  toggleFontFamily: () => void;
  increaseFontScale: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  token: localStorage.getItem('dhuknoo_token'),
  refreshToken: localStorage.getItem('dhuknoo_refresh_token'),
  user: savedUser,
  currentRole: savedUser?.role ?? null,
  useSerifFont: localStorage.getItem('dhuknoo_use_serif') === 'true',
  fontScale: parseFloat(localStorage.getItem('dhuknoo_font_scale') || '1.15'),
  
  // 🆕 TAMBAHKAN INI:
  theme: (localStorage.getItem('dhuknoo_theme') as Theme) || 'light',
  setTheme: (theme) => {
    localStorage.setItem('dhuknoo_theme', theme);
    set({ theme });
  },

  login: (user, token, refreshToken) => {
    localStorage.setItem('dhuknoo_token', token);
    localStorage.setItem('dhuknoo_refresh_token', refreshToken);
    localStorage.setItem('dhuknoo_user', JSON.stringify(user));
    set({ user, token, refreshToken, currentRole: user.role });
    connectSocket();
  },

  logout: () => {
    // 🆕 Guard anti-reentrant: kalau logout() sudah pernah dipanggil dan
    // token sudah kosong, jangan panggil AuthAPI.logout() lagi (tidak ada
    // gunanya — tidak ada sesi untuk dicabut — dan mencegah request
    // berulang kalau logout() ternyata terpanggil dari beberapa tempat
    // hampir bersamaan).
    const alreadyLoggedOut = !useAuthStore.getState().token && !useAuthStore.getState().refreshToken;
    if (!alreadyLoggedOut) {
      // Cabut refresh token di server juga (bukan cuma hapus di client).
      // Fire-and-forget + catch diam-diam: logout LOKAL harus tetap berhasil
      // walau request ini gagal (mis. user sedang offline saat menekan
      // "Keluar") -- jangan sampai user "terjebak" tidak bisa logout hanya
      // karena tidak ada koneksi internet. Request ini sendiri DIKECUALIKAN
      // dari alur refresh-otomatis di apiClient.ts, jadi kalaupun gagal
      // 401, TIDAK akan memicu logout() lagi (lihat komentar di sana).
      AuthAPI.logout().catch(() => {
        // Diabaikan dengan sengaja — lihat komentar di atas.
      });
    }
    localStorage.removeItem('dhuknoo_token');
    localStorage.removeItem('dhuknoo_refresh_token');
    localStorage.removeItem('dhuknoo_user');
    set({ user: null, token: null, refreshToken: null, currentRole: null });
    disconnectSocket();
  },

  setRole: (role) => set({ currentRole: role }),

  toggleFontFamily: () => set((state) => {
    const next = !state.useSerifFont;
    localStorage.setItem('dhuknoo_use_serif', String(next));
    return { useSerifFont: next };
  }),

  increaseFontScale: () => set((state) => {
    let next = state.fontScale + 0.05;
    if (next > 1.4) next = 1.0;
    localStorage.setItem('dhuknoo_font_scale', String(next));
    return { fontScale: next };
  }),
}));