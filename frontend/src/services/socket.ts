import { io } from "socket.io-client";
import { getApiBaseUrl } from "@obama/shared-api";

// Socket.IO backend sekarang WAJIB autentikasi JWT saat handshake (lihat
// backend/src/websocket/socket.ts) — token diambil dari localStorage yang sama
// dipakai axios (lihat useAuthStore / apiClient.ts). Tanpa token, koneksi akan
// ditolak oleh server di tahap handshake, sebelum event apa pun bisa dikirim.
const getStoredToken = () => localStorage.getItem("dhuknoo_token");

export const socket = io(getApiBaseUrl(), {
  transports: ["websocket"],
  autoConnect: false, // baru connect setelah kita pastikan ada token (lihat connectSocket())
  auth: { token: getStoredToken() },
});

/**
 * Panggil setelah login berhasil, atau saat mount App kalau user sudah punya
 * token tersimpan. Aman dipanggil berkali-kali (no-op kalau sudah connected).
 */
export function connectSocket() {
  const token = getStoredToken();
  if (!token) return;
  socket.auth = { token };
  if (!socket.connected) {
    socket.connect();
  }
}

/** Panggil saat logout supaya koneksi lama (dengan token kedaluwarsa) tidak nyangkut. */
export function disconnectSocket() {
  socket.disconnect();
}

/**
 * Join room dengan acknowledgement dari server — server memvalidasi kepemilikan
 * (mis. customer hanya boleh join room order miliknya sendiri) sebelum benar-benar
 * memasukkan socket ke room tsb. Reject kalau server menolak.
 */
export function joinRoom(roomId: string): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.emit("join_room", roomId, (ok: boolean, reason?: string) => {
      if (ok) resolve();
      else reject(new Error(reason || `Gagal join room ${roomId}`));
    });
  });
}

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

socket.on("connect", () => {
  console.log("Socket Connected:", socket.id);
});

socket.on("connect_error", (err) => {
  console.warn("Socket connect_error:", err.message);
});

socket.on("disconnect", () => {
  console.log("Socket Disconnected");
});
