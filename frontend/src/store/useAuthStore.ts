// frontend/src/store/useAuthStore.ts
import { create } from 'zustand';
import { connectSocket, disconnectSocket } from '../services/socket';

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
  role: Role; // ✅ Gunakan tipe Role
}

interface AuthState {
  token: string | null;
  refreshToken: string | null;
  user: User | null;
  currentRole: Role; // ✅ Gunakan tipe Role
  useSerifFont: boolean; // false = Arial (SansSerif), true = Times New Roman (Serif)
  fontScale: number; // e.g. 1.0 (100%), 1.15 (115%), 1.3 (130%)
  
  // Actions
  login: (user: User, token: string, refreshToken: string) => void;
  logout: () => void;
  setRole: (role: Role) => void; // ✅ Parameter menggunakan tipe Role
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

  login: (user, token, refreshToken) => {
    localStorage.setItem('dhuknoo_token', token);
    localStorage.setItem('dhuknoo_refresh_token', refreshToken);
    localStorage.setItem('dhuknoo_user', JSON.stringify(user));
    set({ user, token, refreshToken, currentRole: user.role });
    connectSocket();
  },

  logout: () => {
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
    if (next > 1.4) next = 1.0; // reset
    localStorage.setItem('dhuknoo_font_scale', String(next));
    return { fontScale: next };
  }),
}));