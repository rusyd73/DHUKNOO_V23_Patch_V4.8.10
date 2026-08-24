// src/services/socket.ts
import { io } from "socket.io-client";
import { getApiBaseUrl } from "@obama/shared-api";

// Socket.IO backend sekarang WAJIB autentikasi JWT saat handshake (lihat
// backend/src/websocket/socket.ts) — token diambil dari localStorage yang sama
// dipakai axios (lihat useAuthStore / apiClient.ts). Tanpa token, koneksi akan
// ditolak oleh server di tahap handshake, sebelum event apa pun bisa dikirim.
const getStoredToken = () => localStorage.getItem("dhuknoo_token");

// ============================================
// SOCKET INSTANCE WITH RECONNECT CONFIG
// ============================================
export const socket = io(getApiBaseUrl(), {
  transports: ["websocket"],
  autoConnect: false,
  // 🆕 FIX ("driver online >15 menit, socket reconnect pakai token basi"):
  // sebelumnya `auth: { token: getStoredToken() }` -- object literal ini
  // dievaluasi SEKALI saat file ini pertama dimuat, nilainya "dibekukan"
  // selamanya. Setiap kali socket reconnect (mis. setelah HP di-lock,
  // app di-background, jaringan sempat putus -- lumrah terjadi driver
  // yang online lama menunggu order), token BASI yang sama tetap
  // dikirim walau access token aslinya sudah lama kadaluarsa (15 menit),
  // sehingga handshake ditolak dan driver diam-diam berhenti menerima
  // notifikasi order sama sekali. Sekarang `auth` berupa function --
  // socket.io-client memanggilnya ulang di SETIAP percobaan (re)connect,
  // jadi selalu ambil token TERBARU dari localStorage.
  auth: (cb) => cb({ token: getStoredToken() }),
  
  // ✅ TAMBAHAN: Konfigurasi reconnect
  reconnection: true,
  reconnectionAttempts: 10, // Maksimal 10 kali percobaan reconnect
  reconnectionDelay: 1000, // Delay awal 1 detik
  reconnectionDelayMax: 10000, // Maksimal delay 10 detik
  randomizationFactor: 0.5, // Randomisasi untuk menghindari thundering herd
  timeout: 20000, // Timeout koneksi 20 detik
});

// ============================================
// RECONNECT STATE
// ============================================
let reconnectAttempts = 0;
let isReconnecting = false;

// ============================================
// CONNECT SOCKET
// ============================================
/**
 * Panggil setelah login berhasil, atau saat mount App kalau user sudah punya
 * token tersimpan. Aman dipanggil berkali-kali (no-op kalau sudah connected).
 * 
 * 🆕 Support parameter userId (opsional):
 * - Jika userId diberikan, akan disimpan di socket.auth.userId
 * - Berguna untuk kasus di mana userId diperlukan untuk join room tertentu
 */
export function connectSocket(userId?: string) {
  const token = getStoredToken();
  if (!token) {
    console.warn('🔌 connectSocket: No token found, skipping connection');
    return;
  }
  
  // Set auth dengan token dan userId (jika ada)
  socket.auth = { 
    token,
    ...(userId && { userId }) // Tambahkan userId jika diberikan
  };
  
  if (!socket.connected) {
    console.log('🔌 Connecting socket...');
    socket.connect();
  } else {
    console.log('🔌 Socket already connected');
  }
}

// ============================================
// DISCONNECT SOCKET
// ============================================
/** Panggil saat logout supaya koneksi lama (dengan token kedaluwarsa) tidak nyangkut. */
export function disconnectSocket() {
  console.log('🔌 Disconnecting socket...');
  reconnectAttempts = 0;
  isReconnecting = false;
  socket.disconnect();
}

// ============================================
// JOIN ROOM
// ============================================
/**
 * Join room dengan acknowledgement dari server — server memvalidasi kepemilikan
 * (mis. customer hanya boleh join room order miliknya sendiri) sebelum benar-benar
 * memasukkan socket ke room tsb. Reject kalau server menolak.
 */
export function joinRoom(roomId: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!socket.connected) {
      reject(new Error('Socket tidak terhubung. Silakan coba lagi.'));
      return;
    }
    
    socket.emit("join_room", roomId, (ok: boolean, reason?: string) => {
      if (ok) {
        console.log(`✅ Joined room: ${roomId}`);
        resolve();
      } else {
        console.error(`❌ Failed to join room ${roomId}:`, reason);
        reject(new Error(reason || `Gagal join room ${roomId}`));
      }
    });
  });
}

// ============================================
// REPORT READY EVENT
// ============================================
export interface ReportReadyPayload {
  reportType: string;
  format: "pdf" | "excel";
  downloadUrl: string;
}

/**
 * Dengarkan event `report_ready` (dikirim backend lewat SocketService.emitToUser
 * setelah laporan async selesai di-generate — lihat backend/src/modules/report).
 * Balikin fungsi unsubscribe supaya gampang dibersihkan di useEffect cleanup.
 */
export function onReportReady(callback: (payload: ReportReadyPayload) => void): () => void {
  const handler = (payload: ReportReadyPayload) => callback(payload);
  socket.on("report_ready", handler);
  return () => {
    socket.off("report_ready", handler);
  };
}

// ============================================
// FORCE LOGOUT EVENT (single-device login lock)
// ============================================
export interface ForceLogoutPayload {
  reason: string;
  at: string;
}

/**
 * Dengarkan event `force_logout` (dikirim backend lewat SocketService.emitToUser
 * di auth.service.ts setiap kali akun yang sama login dari device/tab lain --
 * fitur "penguncian hanya 1 akun login pada satu waktu"). Balikin fungsi
 * unsubscribe supaya gampang dibersihkan di useEffect cleanup.
 */
export function onForceLogout(callback: (payload: ForceLogoutPayload) => void): () => void {
  const handler = (payload: ForceLogoutPayload) => callback(payload);
  socket.on("force_logout", handler);
  return () => {
    socket.off("force_logout", handler);
  };
}

// ============================================
// SOCKET EVENT HANDLERS
// ============================================

// ----- CONNECT -----
socket.on("connect", () => {
  console.log("✅ Socket Connected:", socket.id);
  reconnectAttempts = 0;
  isReconnecting = false;
});

// ----- CONNECT ERROR -----
socket.on("connect_error", (err) => {
  console.warn("❌ Socket connect_error:", err.message);
  
  // Cek apakah error karena auth token
  if (err.message.includes('auth') || err.message.includes('token')) {
    console.warn('🔑 Auth error - token mungkin expired atau invalid');
    // Bisa trigger logout jika perlu
    // useAuthStore.getState().logout();
  }
});

// ----- DISCONNECT -----
socket.on("disconnect", (reason) => {
  console.log("🔌 Socket Disconnected:", reason);
  
  // Log reason untuk debugging
  if (reason === "io server disconnect") {
    // Server yang memutus koneksi, perlu reconnect manual
    console.warn("🔌 Server disconnected socket, attempting reconnect...");
    const token = getStoredToken();
    if (token) {
      setTimeout(() => {
        socket.connect();
      }, 1000);
    }
  } else if (reason === "transport close") {
    // Transport error, biasanya network issue
    console.warn("🔌 Transport closed, will auto-reconnect");
  }
});

// ----- RECONNECT ATTEMPT -----
socket.on("reconnect_attempt", (attempt) => {
  reconnectAttempts = attempt;
  isReconnecting = true;
  console.log(`🔄 Reconnect attempt ${attempt}/${socket.io?.opts?.reconnectionAttempts || 10}`);
  
  // Refresh token sebelum reconnect attempt
  const freshToken = getStoredToken();
  if (freshToken) {
    socket.auth = { ...socket.auth, token: freshToken };
  }
});

// ----- RECONNECT -----
socket.on("reconnect", (attempt) => {
  console.log(`🔄 Reconnected successfully after ${attempt} attempts`);
  reconnectAttempts = 0;
  isReconnecting = false;
});

// ----- RECONNECT ERROR -----
socket.on("reconnect_error", (err) => {
  console.warn("🔄 Reconnect error:", err.message);
});

// ----- RECONNECT FAILED -----
socket.on("reconnect_failed", () => {
  console.error("❌ Reconnect failed after maximum attempts");
  isReconnecting = false;
  
  // Notifikasi user bahwa koneksi gagal
  // Bisa trigger toast atau alert
  const event = new CustomEvent('socketReconnectFailed', {
    detail: { message: 'Koneksi realtime gagal. Silakan refresh halaman.' }
  });
  window.dispatchEvent(event);
});

// ----- ERROR -----
socket.on("error", (err) => {
  console.error("❌ Socket error:", err);
});

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Cek status koneksi socket
 */
export function isSocketConnected(): boolean {
  return socket.connected;
}

/**
 * Dapatkan status reconnect
 */
export function getReconnectStatus(): { isReconnecting: boolean; attempts: number } {
  return {
    isReconnecting,
    attempts: reconnectAttempts
  };
}

/**
 * Force reconnect socket
 */
export function forceReconnect(): void {
  if (socket.connected) {
    console.log('🔄 Force reconnecting...');
    socket.disconnect();
    setTimeout(() => {
      const token = getStoredToken();
      if (token) {
        socket.auth = { ...socket.auth, token };
        socket.connect();
      }
    }, 500);
  } else {
    connectSocket();
  }
}