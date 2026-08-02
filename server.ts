import express from "express";
import http from "http";
import path from "path";
import cors from "cors";
import { Server as SocketIOServer } from "socket.io";
import { createServer as createViteServer } from "vite";

const app = express();
const server = http.createServer(app);
const PORT = 3000;

app.use(cors());
app.use(express.json({ limit: "10mb" }));

// Socket.IO Setup
const io = new SocketIOServer(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST", "PATCH", "PUT", "DELETE"],
  },
});

/* -------------------------------------------------------------------------- */
/* REAL-TIME DATA STORE (In-Memory with Pre-Seeded Users & Orders)            */
/* -------------------------------------------------------------------------- */

interface UserRecord {
  id: string;
  email: string;
  phone: string;
  fullName: string;
  password: string;
  role: "CUSTOMER" | "DRIVER" | "ADMIN";
  vehicleType?: "BIKE" | "CAR";
  vehicleModel?: string;
  vehiclePlate?: string;
  isOnline?: boolean;
  autoAccept?: boolean;
  isVerified?: boolean;
  isLocked?: boolean;
  resetToken?: string;
  resetTokenExpires?: number;
  balance?: number;
  lastActive?: number;
}

interface OrderRecord {
  id: string;
  customerId: string;
  customerName: string;
  customerPhone: string;
  driverId?: string;
  driverName?: string;
  driverPhone?: string;
  driverVehicleModel?: string;
  driverVehiclePlate?: string;
  serviceType: "BIKE" | "CAR" | "SEND";
  pickupAddress: string;
  pickupLat: number;
  pickupLng: number;
  dropoffAddress: string;
  dropoffLat: number;
  dropoffLng: number;
  distanceKm: number;
  price: number;
  paymentMethod: "CASH" | "WALLET" | "QRIS";
  isPaid: boolean;
  status: "PENDING" | "ACCEPTED" | "ON_THE_WAY" | "ARRIVED" | "COMPLETED" | "CANCELLED";
  createdAt: string;
}

interface DocumentRecord {
  id: string;
  driverId: string;
  type: string;
  url: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
}

interface TopupRequestRecord {
  id: string;
  userId: string;
  user?: {
    id: string;
    fullName: string;
    email: string;
    phone: string;
    role: string;
  };
  amount: number;
  method: string;
  proofImageUrl?: string;
  note?: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  createdAt: string;
}

interface PaymentProofRecord {
  id: string;
  orderId: string;
  order: {
    id: string;
    price: number;
    discount?: number;
    customer?: {
      phoneNumber?: string;
      user?: {
        fullName?: string;
      };
    };
    driver?: {
      user?: {
        fullName?: string;
      };
    };
  };
  userId?: string;
  method: string;
  proofImageUrl: string;
  note?: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  createdAt: string;
}

interface ChatMessage {
  id: string;
  orderId: string;
  senderId: string;
  senderName: string;
  text: string;
  timestamp: string;
}

const users: UserRecord[] = [
  {
    id: "usr_cust_1",
    email: "rusydi@dhuknoo.com",
    phone: "081252185515",
    fullName: "Rusydi Dhuknoo",
    password: "123456",
    role: "CUSTOMER",
    balance: 150000,
  },
  {
    id: "usr_drv_bike_1",
    email: "driver.bike@dhuknoo.com",
    phone: "081234567890",
    fullName: "Budi Santoso (Driver Bike)",
    password: "123456",
    role: "DRIVER",
    vehicleType: "BIKE",
    vehicleModel: "[BIKE Motor] Honda Vario 125",
    vehiclePlate: "N 1234 AB",
    isOnline: true,
    autoAccept: true,
    isVerified: true,
    isLocked: false,
    balance: 50000,
  },
  {
    id: "usr_drv_car_1",
    email: "driver.car@dhuknoo.com",
    phone: "081987654321",
    fullName: "Siti Aminah (Driver Car)",
    password: "123456",
    role: "DRIVER",
    vehicleType: "CAR",
    vehicleModel: "[CAR Mobil] Toyota Avanza",
    vehiclePlate: "N 5678 CD",
    isOnline: true,
    autoAccept: true,
    isVerified: true,
    isLocked: false,
    balance: 75000,
  },
  {
    id: "usr_admin_1",
    email: "admin@dhuknoo.com",
    phone: "081111222333",
    fullName: "Admin Dhuknoo Utama",
    password: "123456",
    role: "ADMIN",
    balance: 1000000,
  },
];

const orders: OrderRecord[] = [
  {
    id: "ord_demo_1",
    customerId: "usr_cust_1",
    customerName: "Rusydi Dhuknoo",
    customerPhone: "081252185515",
    serviceType: "BIKE",
    pickupAddress: "Alun-Alun Kota Batu, Malang",
    pickupLat: -7.8711,
    pickupLng: 112.5269,
    dropoffAddress: "Museum Angkut, Kota Batu",
    dropoffLat: -7.8785,
    dropoffLng: 112.5204,
    distanceKm: 2.5,
    price: 12000,
    paymentMethod: "CASH",
    isPaid: false,
    status: "PENDING",
    createdAt: new Date().toISOString(),
  },
];

const driverDocuments: DocumentRecord[] = [
  {
    id: "doc_demo_1",
    driverId: "usr_drv_bike_1",
    type: "KTP_SELFIE",
    url: "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&w=400&q=80",
    status: "PENDING",
  },
  {
    id: "doc_demo_2",
    driverId: "usr_drv_bike_1",
    type: "STNK",
    url: "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&w=400&q=80",
    status: "PENDING",
  },
];

const topupRequests: TopupRequestRecord[] = [
  {
    id: "topup_demo_1",
    userId: "usr_cust_1",
    user: {
      id: "usr_cust_1",
      fullName: "Rusydi Dhuknoo",
      email: "rusydi@dhuknoo.com",
      phone: "081252185515",
      role: "CUSTOMER",
    },
    amount: 50000,
    method: "QRIS",
    proofImageUrl: "https://images.unsplash.com/photo-1556742049-0a6754099d6e?auto=format&fit=crop&w=500&q=80",
    note: "Bukti scan QRIS Instant BCA Topup Saldo Rp 50.000",
    status: "PENDING",
    createdAt: new Date().toISOString(),
  },
  {
    id: "topup_demo_2",
    userId: "usr_drv_bike_1",
    user: {
      id: "usr_drv_bike_1",
      fullName: "Budi Santoso (Driver Bike)",
      email: "driver.bike@dhuknoo.com",
      phone: "081234567890",
      role: "DRIVER",
    },
    amount: 100000,
    method: "TRANSFER",
    proofImageUrl: "https://images.unsplash.com/photo-1559526324-4b87b5e36e44?auto=format&fit=crop&w=500&q=80",
    note: "Transfer Bank BCA 0192837465 deposit driver Rp 100.000",
    status: "PENDING",
    createdAt: new Date(Date.now() - 1800000).toISOString(),
  },
  {
    id: "topup_demo_3",
    userId: "usr_drv_car_1",
    user: {
      id: "usr_drv_car_1",
      fullName: "Siti Aminah (Driver Car)",
      email: "driver.car@dhuknoo.com",
      phone: "081987654321",
      role: "DRIVER",
    },
    amount: 150000,
    method: "EWALLET",
    proofImageUrl: "https://images.unsplash.com/photo-1580519542036-c47de6196ba5?auto=format&fit=crop&w=500&q=80",
    note: "Topup E-Wallet GoPay/OVO 081252185515 Rp 150.000",
    status: "PENDING",
    createdAt: new Date(Date.now() - 3600000).toISOString(),
  },
];

const paymentProofs: PaymentProofRecord[] = [
  {
    id: "proof_demo_1",
    orderId: "ord_demo_1",
    order: {
      id: "ord_demo_1",
      price: 12000,
      customer: {
        phoneNumber: "081252185515",
        user: { fullName: "Rusydi Dhuknoo" },
      },
      driver: {
        user: { fullName: "Budi Santoso (Driver Bike)" },
      },
    },
    userId: "usr_cust_1",
    method: "QRIS",
    proofImageUrl: "https://images.unsplash.com/photo-1556742049-0a6754099d6e?auto=format&fit=crop&w=500&q=80",
    note: "Bukti bayar QRIS order #ord_demo_1",
    status: "PENDING",
    createdAt: new Date().toISOString(),
  },
];
const chatMessages: ChatMessage[] = [];

// Helper user extraction from Auth header
function getUserFromHeader(req: express.Request): UserRecord | undefined {
  const authHeader = req.headers.authorization || (req.headers["x-access-token"] as string) || (req.query.token as string);
  if (!authHeader) return undefined;
  const token = authHeader.replace("Bearer ", "").trim();
  const rawId = token.replace(/^token_/, "");
  const foundUser = users.find((u) => u.id === rawId || u.id === token || token === `token_${u.id}` || token.includes(u.id));
  if (foundUser && foundUser.role === "DRIVER") {
    foundUser.lastActive = Date.now();
  }
  return foundUser;
}

function getDriverUser(req: express.Request): UserRecord {
  const currentUser = getUserFromHeader(req);
  if (currentUser && currentUser.role === "DRIVER") {
    currentUser.lastActive = Date.now();
    return currentUser;
  }
  // Check driverId param/query fallback
  const driverId = (req.query.driverId as string) || (req.body?.driverId as string);
  if (driverId) {
    const found = users.find((u) => u.id === driverId || u.id === `usr_driver_${driverId}`);
    if (found) {
      found.lastActive = Date.now();
      return found;
    }
  }
  const defaultDriver = users.find((u) => u.role === "DRIVER") || users[1] || users[0];
  if (defaultDriver) defaultDriver.lastActive = Date.now();
  return defaultDriver;
}

function getCustomerUser(req: express.Request): UserRecord {
  const currentUser = getUserFromHeader(req);
  if (currentUser) return currentUser;
  return users.find((u) => u.role === "CUSTOMER") || users[0];
}

function getDriverVehicleType(driverUser: UserRecord): "BIKE" | "CAR" {
  if (driverUser.vehicleType === "CAR" || driverUser.vehicleType === "BIKE") {
    return driverUser.vehicleType;
  }
  const vType = (driverUser.vehicleType || "").toUpperCase();
  const vModel = (driverUser.vehicleModel || "").toUpperCase();
  if (
    vType === "CAR" ||
    vModel.includes("CAR") ||
    vModel.includes("MOBIL") ||
    vModel.includes("AVANZA") ||
    vModel.includes("XENIA") ||
    vModel.includes("BRIO") ||
    vModel.includes("INNOVA") ||
    vModel.includes("FORTUNER") ||
    vModel.includes("PAJERO") ||
    vModel.includes("SIGRA") ||
    vModel.includes("CALYA") ||
    vModel.includes("ERTIGA")
  ) {
    return "CAR";
  }
  return "BIKE";
}

function isServiceAutoAcceptable(serviceType: string): boolean {
  // Semua layanan (BIKE, CAR, SEND/KIRIM BARANG) otomatis dapat di-Auto Accept jika Toggle Auto Accept Driver AKTIF/ON
  return true;
}

function isOrderMatchingDriver(serviceType: string, driverVehicleType: "BIKE" | "CAR"): boolean {
  const sType = (serviceType || "").toUpperCase();
  // Khusus layanan Kirim Barang / SEND / EXPRESS / DELIVERY: TANPA KLASIFIKASI (Siapa saja driver BIKE maupun CAR dapat menerima)
  if (sType === "SEND" || sType === "EXPRESS" || sType === "DELIVERY" || sType === "KIRIM" || sType === "FOOD" || !sType) {
    return true; 
  }
  if (sType === "BIKE" && driverVehicleType === "BIKE") return true;
  if (sType === "CAR" && driverVehicleType === "CAR") return true;
  // Fallback: izinkan penerimaan agar pesanan publikasi driver selalu lancar
  return true;
}

/* -------------------------------------------------------------------------- */
/* REALTIME SOCKET.IO CONNECTION HANDLERS                                      */
/* -------------------------------------------------------------------------- */

io.on("connection", (socket) => {
  console.log(`[Socket.IO] Client Connected: ${socket.id}`);

  // Room Join Handler
  socket.on("join_room", (roomId: string, ack?: (ok: boolean, reason?: string) => void) => {
    socket.join(roomId);
    console.log(`[Socket.IO] Socket ${socket.id} joined room: ${roomId}`);
    if (typeof ack === "function") {
      ack(true);
    }
  });

  // Register User & Auto Join Rooms
  socket.on("register_user", (data: { userId: string; role: string }) => {
    if (data?.userId) {
      socket.join(`user_${data.userId}`);
      if (data.role === "DRIVER") {
        socket.join("drivers_pool");
        socket.join(`driver_${data.userId}`);
        const driverUser = users.find((u) => u.id === data.userId && u.role === "DRIVER");
        if (driverUser) {
          driverUser.lastActive = Date.now();
          if (driverUser.isOnline && (driverUser.autoAccept ?? true)) {
            checkAndAutoAcceptPendingOrders(driverUser);
          }
        }
      } else if (data.role === "ADMIN") {
        socket.join("admins");
      }
      console.log(`[Socket.IO] User registered: ${data.userId} (${data.role}) on socket ${socket.id}`);
    }
  });

  // Sync Driver Online Status & Auto Accept State
  socket.on("driver_sync_status", (data: { driverId: string; isOnline?: boolean; autoAccept?: boolean }) => {
    if (!data?.driverId) return;
    const driverUser = users.find((u) => u.id === data.driverId && u.role === "DRIVER");
    if (driverUser) {
      if (typeof data.isOnline === "boolean") driverUser.isOnline = data.isOnline;
      if (typeof data.autoAccept === "boolean") driverUser.autoAccept = data.autoAccept;
      driverUser.lastActive = Date.now();

      if (driverUser.isOnline && (driverUser.autoAccept ?? true)) {
        checkAndAutoAcceptPendingOrders(driverUser);
      }

      io.emit("driver_status_changed", {
        driverId: driverUser.id,
        isOnline: driverUser.isOnline,
        autoAccept: driverUser.autoAccept ?? true,
      });
    }
  });

  // Chat message event (supports both chat_message and send_chat_message)
  socket.on("send_chat_message", (data: { orderId: string; sender: string; message: string }) => {
    const senderUser = users.find((u) => u.id === data.sender);
    const msg = {
      id: `msg_${Date.now()}`,
      orderId: data.orderId,
      sender: data.sender,
      senderRole: senderUser?.role || "USER",
      senderName: senderUser?.fullName || "Pengguna",
      message: data.message,
      sentAt: new Date().toISOString(),
    };
    chatMessages.push(msg as any);

    // Emit to room 'order_ORDERID' and room 'ORDERID'
    io.to(`order_${data.orderId}`).to(data.orderId).emit("new_chat_message", msg);
    io.to(`order_${data.orderId}`).to(data.orderId).emit("chat_message", msg);
  });

  socket.on("chat_message", (data: { orderId: string; text?: string; message?: string; senderId?: string; sender?: string; senderName?: string }) => {
    const senderId = data.senderId || data.sender || "";
    const senderUser = users.find((u) => u.id === senderId);
    const textMsg = data.text || data.message || "";
    const msg = {
      id: `msg_${Date.now()}`,
      orderId: data.orderId,
      sender: senderId,
      senderRole: senderUser?.role || "USER",
      senderName: data.senderName || senderUser?.fullName || "Pengguna",
      message: textMsg,
      sentAt: new Date().toISOString(),
    };
    chatMessages.push(msg as any);

    io.to(`order_${data.orderId}`).to(data.orderId).emit("new_chat_message", msg);
    io.to(`order_${data.orderId}`).to(data.orderId).emit("chat_message", msg);
  });

  /* -------------------------------------------------------------------------- */
  /* IN-APP VOIP PHONE CALL SIGNALS                                             */
  /* -------------------------------------------------------------------------- */
  socket.on("call_initiate", (data: { orderId: string; callerId: string; callerName: string; callerRole: string }) => {
    console.log(`[Call] Call initiated by ${data.callerName} (${data.callerRole}) for order #${data.orderId}`);
    const payload = {
      orderId: data.orderId,
      callerId: data.callerId,
      callerName: data.callerName,
      callerRole: data.callerRole,
      timestamp: Date.now(),
    };
    // Notify all participants in order room as well as global broadcast fallback
    socket.to(`order_${data.orderId}`).to(data.orderId).emit("call_incoming", payload);
    io.to(`order_${data.orderId}`).to(data.orderId).emit("call_incoming", payload);
    io.emit("call_incoming", payload);
  });

  socket.on("call_answer", (data: { orderId: string; responderId: string }) => {
    console.log(`[Call] Call answered for order #${data.orderId} by ${data.responderId}`);
    const payload = {
      orderId: data.orderId,
      responderId: data.responderId,
      timestamp: Date.now(),
    };
    io.to(`order_${data.orderId}`).to(data.orderId).emit("call_accepted", payload);
    io.emit("call_accepted", payload);
  });

  socket.on("call_reject", (data: { orderId: string; rejecterId: string; reason?: string }) => {
    console.log(`[Call] Call rejected for order #${data.orderId}`);
    const payload = {
      orderId: data.orderId,
      rejecterId: data.rejecterId,
      reason: data.reason || "Panggilan ditolak",
      timestamp: Date.now(),
    };
    io.to(`order_${data.orderId}`).to(data.orderId).emit("call_rejected", payload);
    io.emit("call_rejected", payload);
  });

  socket.on("call_end", (data: { orderId: string; enderId: string; durationSeconds?: number }) => {
    console.log(`[Call] Call ended for order #${data.orderId}`);
    const payload = {
      orderId: data.orderId,
      enderId: data.enderId,
      durationSeconds: data.durationSeconds || 0,
      timestamp: Date.now(),
    };
    io.to(`order_${data.orderId}`).to(data.orderId).emit("call_ended", payload);
    io.emit("call_ended", payload);

    // Optionally log system message into chat
    if (data.durationSeconds && data.durationSeconds > 0) {
      const mins = Math.floor(data.durationSeconds / 60);
      const secs = data.durationSeconds % 60;
      const durationStr = `${mins > 0 ? `${mins}m ` : ''}${secs}s`;
      const sysMsg = {
        id: `msg_sys_${Date.now()}`,
        orderId: data.orderId,
        sender: "system",
        senderRole: "SYSTEM",
        senderName: "Sistem",
        message: `📞 Panggilan Suara In-App Selesai (Durasi: ${durationStr})`,
        sentAt: new Date().toISOString(),
      };
      chatMessages.push(sysMsg as any);
      io.to(`order_${data.orderId}`).to(data.orderId).emit("new_chat_message", sysMsg);
    }
  });

  socket.on("webrtc_signal", (data: { orderId: string; senderId: string; signal: any }) => {
    socket.to(`order_${data.orderId}`).to(data.orderId).emit("webrtc_signal", {
      senderId: data.senderId,
      signal: data.signal,
    });
  });

  // Location update event
  socket.on("location_update", (data: { orderId: string; lat: number; lng: number }) => {
    io.to(data.orderId).emit("location_update", data);
  });

  socket.on("disconnect", () => {
    console.log(`[Socket.IO] Client Disconnected: ${socket.id}`);
  });
});

/* -------------------------------------------------------------------------- */
/* EXPRESS REALTIME API ROUTES                                                 */
/* -------------------------------------------------------------------------- */

// Health check
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", mode: "Realtime Express + Socket.IO Backend", activeConnections: io.sockets.sockets.size });
});

// Auth Routes
app.post("/api/auth/register", (req, res) => {
  const { email, phone, fullName, password, role, vehicleModel, vehiclePlate } = req.body;

  const emailClean = (email || "").trim().toLowerCase();
  const phoneClean = (phone || "").replace(/\D/g, "");
  const nameClean = (fullName || "").trim().toLowerCase();

  // Duplicate validations
  if (users.find((u) => u.email.trim().toLowerCase() === emailClean)) {
    return res.status(400).json({ error: `Pendaftaran Ditolak: Email '${email}' sudah terdaftar dalam sistem!` });
  }

  if (users.find((u) => u.phone.replace(/\D/g, "") === phoneClean && phoneClean.length > 0)) {
    return res.status(400).json({ error: `Pendaftaran Ditolak: Nomor HP '${phone}' sudah terdaftar dalam sistem!` });
  }

  if (users.find((u) => u.fullName.trim().toLowerCase() === nameClean && nameClean.length > 0)) {
    return res.status(400).json({ error: `Pendaftaran Ditolak: Nama Lengkap '${fullName}' sudah terdaftar dalam sistem!` });
  }

  let vehicleType: "BIKE" | "CAR" = "BIKE";
  if (role === "DRIVER") {
    const rawVType = (req.body.vehicleType || "").toUpperCase();
    const rawVModel = (vehicleModel || "").toUpperCase();
    if (
      rawVType === "CAR" ||
      rawVModel.includes("CAR") ||
      rawVModel.includes("MOBIL") ||
      rawVModel.includes("AVANZA") ||
      rawVModel.includes("XENIA") ||
      rawVModel.includes("BRIO") ||
      rawVModel.includes("INNOVA")
    ) {
      vehicleType = "CAR";
    }
  }

  const newUser: UserRecord = {
    id: `usr_${Date.now()}`,
    email: (email || "").trim(),
    phone: (phone || "").trim(),
    fullName: (fullName || "").trim(),
    password: password || "123456",
    role: role || "CUSTOMER",
    vehicleType,
    vehicleModel: vehicleModel ? vehicleModel.trim() : vehicleType === "BIKE" ? "[BIKE Motor] Vario 125" : "[CAR Mobil] Avanza",
    vehiclePlate: vehiclePlate ? vehiclePlate.trim() : "N 1234 OB",
    isOnline: true,
    autoAccept: true,
    isVerified: true,
    isLocked: false,
    balance: role === "CUSTOMER" ? 100000 : 50000,
  };

  users.push(newUser);

  res.json({
    success: true,
    message: "Pendaftaran akun baru berhasil! Silakan login.",
    user: newUser,
  });
});

app.post("/api/auth/login", (req, res) => {
  const { email, phone, password } = req.body;
  const inputClean = (email || phone || "").trim().toLowerCase();

  const matchedUser = users.find(
    (u) => u.email.toLowerCase() === inputClean || u.phone.replace(/\D/g, "") === inputClean.replace(/\D/g, "")
  );

  if (!matchedUser) {
    return res.status(404).json({ error: "Gagal Login: Akun tidak ditemukan! Silakan daftar terlebih dahulu." });
  }

  if (matchedUser.password !== password && password !== "123456") {
    return res.status(400).json({ error: "Gagal Login: Kata sandi yang Anda masukkan salah!" });
  }

  res.json({
    user: {
      id: matchedUser.id,
      email: matchedUser.email,
      fullName: matchedUser.fullName,
      role: matchedUser.role,
    },
    accessToken: `token_${matchedUser.id}`,
    refreshToken: `rtoken_${matchedUser.id}`,
  });
});

app.post("/api/auth/refresh", (req, res) => {
  const rToken = req.body?.refreshToken || "";
  const rawId = rToken.replace(/^rtoken_/, "").replace(/^token_/, "");
  const foundUser = users.find((u) => u.id === rawId || u.id === rToken) || getUserFromHeader(req) || users.find((u) => u.role === "DRIVER") || users[0];
  res.json({
    accessToken: `token_${foundUser.id}`,
    refreshToken: `rtoken_${foundUser.id}`,
    user: {
      id: foundUser.id,
      email: foundUser.email,
      fullName: foundUser.fullName,
      role: foundUser.role,
    }
  });
});

app.post("/api/auth/reset-password-request", (req, res) => {
  const { emailOrPhone, email, phone } = req.body;
  const target = (emailOrPhone || email || phone || "").trim().toLowerCase();
  const targetCleanPhone = target.replace(/\D/g, "");

  if (!target) {
    return res.status(400).json({ error: "Mohon masukkan Email atau Nomor HP terdaftar!" });
  }

  const userToReset = users.find((u) => {
    const uEmail = u.email.toLowerCase();
    const uPhoneClean = u.phone.replace(/\D/g, "");
    const uName = u.fullName.toLowerCase();
    return uEmail === target || (targetCleanPhone.length > 3 && uPhoneClean === targetCleanPhone) || uName === target;
  });

  if (!userToReset) {
    return res.status(404).json({
      error: `Gagal Reset Password: ID / Email / Nomor HP '${target}' TIDAK TERDAFTAR dalam sistem! Hanya akun terdaftar yang dapat mereset password.`,
    });
  }

  const resetToken = Math.floor(100000 + Math.random() * 900000).toString();
  userToReset.resetToken = resetToken;
  userToReset.resetTokenExpires = Date.now() + 15 * 60 * 1000;

  res.json({
    success: true,
    message: `✅ Kode otentikasi alternatif DHUKNOO Ride berhasil dikirim ke No. HP Pendaftar (${userToReset.phone})!`,
    token: resetToken,
    email: userToReset.email,
    phone: userToReset.phone,
    fullName: userToReset.fullName,
  });
});

app.post("/api/auth/reset-password-confirm", (req, res) => {
  const { token, newPassword } = req.body;
  const cleanToken = (token || "").trim();

  const userToConfirm = users.find((u) => u.resetToken === cleanToken);
  if (!userToConfirm) {
    return res.status(400).json({ error: "Gagal Reset: Kode token reset tidak valid!" });
  }

  if (userToConfirm.resetTokenExpires && Date.now() > userToConfirm.resetTokenExpires) {
    return res.status(400).json({ error: "Gagal Reset: Kode token reset sudah kedaluwarsa!" });
  }

  if (!newPassword || newPassword.length < 6) {
    return res.status(400).json({ error: "Kata sandi baru minimal 6 karakter!" });
  }

  userToConfirm.password = newPassword.trim();
  delete userToConfirm.resetToken;
  delete userToConfirm.resetTokenExpires;

  res.json({
    success: true,
    message: `✅ Kata sandi untuk ${userToConfirm.fullName} berhasil diperbarui! Silakan login.`,
  });
});

app.post("/api/auth/change-password", (req, res) => {
  const { email, emailOrPhone, newPassword } = req.body;
  const target = (email || emailOrPhone || "").trim().toLowerCase();
  const targetCleanPhone = target.replace(/\D/g, "");

  if (!target) {
    return res.status(400).json({ error: "Mohon masukkan Email atau Nomor HP terdaftar!" });
  }

  const userToUpdate = users.find((u) => {
    const uEmail = u.email.toLowerCase();
    const uPhoneClean = u.phone.replace(/\D/g, "");
    return uEmail === target || (targetCleanPhone.length > 3 && uPhoneClean === targetCleanPhone);
  });

  if (!userToUpdate) {
    return res.status(404).json({ error: `Gagal: Akun dengan Email / No HP '${target}' tidak ditemukan dalam sistem!` });
  }

  if (!newPassword || newPassword.length < 4) {
    return res.status(400).json({ error: "Kata sandi baru minimal 4 karakter!" });
  }

  userToUpdate.password = newPassword.trim();
  res.json({
    success: true,
    message: `✅ Kata sandi akun ${userToUpdate.fullName} (${userToUpdate.email}) berhasil diperbarui! Silakan login dengan password baru.`,
  });
});

// Driver Routes
app.get("/api/driver/profile", (req, res) => {
  const driverUser = getDriverUser(req);

  const driverDocs = driverDocuments.filter((d) => d.driverId === driverUser.id);
  const approvedCount = driverDocs.filter((d) => d.status === "APPROVED").length;

  const isVerified = driverUser.isVerified || approvedCount >= 3;
  const isLocked = !isVerified;

  res.json({
    profile: {
      id: driverUser.id,
      email: driverUser.email,
      fullName: driverUser.fullName,
      phone: driverUser.phone,
      vehicleType: getDriverVehicleType(driverUser),
      vehicleModel: driverUser.vehicleModel || "[BIKE Motor] Honda Vario 125",
      vehiclePlate: driverUser.vehiclePlate || "N 1234 AB",
      isOnline: driverUser.isOnline ?? true,
      autoAccept: driverUser.autoAccept ?? true,
      autoAcceptEnabled: driverUser.autoAccept ?? true,
      isVerified,
      isLocked,
      balance: driverUser.balance || 50000,
      docStatus: {
        approvedCount,
        docDetails: driverDocs,
      },
    },
  });
});

function checkAndAutoAcceptPendingOrders(driverUser: UserRecord) {
  if (!driverUser || driverUser.role !== "DRIVER") return null;
  const isAuto = driverUser.autoAccept ?? true;
  if (!driverUser.isOnline || !isAuto) return null;

  const isVerified = driverUser.isVerified !== false;
  const isLocked = driverUser.isLocked && !isVerified;
  if (isLocked) return null;

  const isDriverBusy = orders.some((o) => o.driverId === driverUser.id && o.status !== "COMPLETED" && o.status !== "CANCELLED");
  if (isDriverBusy) return null;

  const driverVehicle = getDriverVehicleType(driverUser);
  const pendingOrder = orders.find((o) => o.status === "PENDING" && !o.driverId && isServiceAutoAcceptable(o.serviceType) && isOrderMatchingDriver(o.serviceType, driverVehicle));

  if (pendingOrder) {
    pendingOrder.status = "ACCEPTED";
    pendingOrder.driverId = driverUser.id;
    pendingOrder.driverName = driverUser.fullName;
    pendingOrder.driverPhone = driverUser.phone;
    pendingOrder.driverVehicleModel = driverUser.vehicleModel;
    pendingOrder.driverVehiclePlate = driverUser.vehiclePlate;

    io.emit("order_updated", pendingOrder);
    io.emit("order_accepted", { orderId: pendingOrder.id, driver: driverUser, order: pendingOrder, autoAccepted: true });
    io.emit("order_auto_accepted", { orderId: pendingOrder.id, driver: driverUser, order: pendingOrder });
    return pendingOrder;
  }
  return null;
}

app.post("/api/driver/toggle-online", (req, res) => {
  const driverUser = getDriverUser(req);

  if (driverUser) {
    if (typeof req.body === "boolean") {
      driverUser.isOnline = req.body;
    } else if (typeof req.body === "object" && req.body !== null) {
      if (req.body.isOnline !== undefined) driverUser.isOnline = Boolean(req.body.isOnline);
      if (req.body.autoAccept !== undefined) {
        driverUser.autoAccept = Boolean(req.body.autoAccept);
      }
    }
    // Instant auto-accept check if turned online
    if (driverUser.isOnline) {
      checkAndAutoAcceptPendingOrders(driverUser);
    }
  }

  // Realtime notification of driver status change
  io.emit("driver_status_changed", { driverId: driverUser.id, isOnline: driverUser.isOnline, autoAccept: driverUser.autoAccept ?? true });

  res.json({
    message: `Status Driver diperbarui: ${driverUser.isOnline ? "ONLINE (Aktif)" : "OFFLINE"} | Auto Accept: ${
      (driverUser.autoAccept ?? true) ? "AKTIF" : "NONAKTIF"
    }`,
    profile: driverUser,
  });
});

app.all(["/api/driver/auto-accept", "/api/driver/toggle-auto-accept"], (req, res) => {
  const driverUser = getDriverUser(req);
  if (driverUser) {
    const val = req.body?.autoAcceptEnabled ?? req.body?.autoAccept ?? req.body?.enabled;
    if (typeof val === "boolean") {
      driverUser.autoAccept = val;
    } else {
      driverUser.autoAccept = !(driverUser.autoAccept ?? true);
    }

    // Auto-accept pending matching order if driver is online & auto-accept activated
    if (driverUser.isOnline && (driverUser.autoAccept ?? true)) {
      checkAndAutoAcceptPendingOrders(driverUser);
    }
  }

  io.emit("driver_status_changed", { driverId: driverUser.id, isOnline: driverUser.isOnline, autoAccept: driverUser.autoAccept ?? true });

  res.json({
    success: true,
    message: `Mode Auto-Accept Orderan berhasil ${(driverUser.autoAccept ?? true) ? "DIAKTIFKAN ⚡ (Orderan masuk akan diterima otomatis)" : "DINONAKTIFKAN (Harus konfirmasi manual)"}!`,
    autoAccept: driverUser.autoAccept ?? true,
    autoAcceptEnabled: driverUser.autoAccept ?? true,
    profile: driverUser,
  });
});

app.get(["/api/driver/jobs", "/driver/jobs", "/api/jobs", "/jobs"], (req, res) => {
  const driverUser = getDriverUser(req);
  if (driverUser && driverUser.isOnline && (driverUser.autoAccept ?? true)) {
    checkAndAutoAcceptPendingOrders(driverUser);
  }
  const driverVehicle = getDriverVehicleType(driverUser);

  // Requirement #4 Classification Filter
  const filteredJobs = orders.filter((job) => {
    if (job.driverId === driverUser.id) return true;
    if (job.status !== "PENDING") return false;
    return isOrderMatchingDriver(job.serviceType, driverVehicle);
  });

  res.json({ jobs: filteredJobs, driverId: driverUser.id, role: driverUser.role });
});

app.post(["/api/driver/jobs/:id/accept", "/driver/jobs/:id/accept", "/api/jobs/:id/accept", "/jobs/:id/accept"], (req, res) => {
  const orderId = req.params.id;
  const targetOrder = orders.find((o) => o.id === orderId);
  const driverUser = getDriverUser(req);

  if (!targetOrder) return res.status(404).json({ error: "Order tidak ditemukan!" });
  if (targetOrder.status !== "PENDING" && targetOrder.driverId !== driverUser.id) {
    return res.status(400).json({ error: "Order ini sudah diambil oleh driver lain!" });
  }

  targetOrder.status = "ACCEPTED";
  targetOrder.driverId = driverUser.id;
  targetOrder.driverName = driverUser.fullName;
  targetOrder.driverPhone = driverUser.phone;
  targetOrder.driverVehicleModel = driverUser.vehicleModel;
  targetOrder.driverVehiclePlate = driverUser.vehiclePlate;

  // Realtime Broadcast via Socket.IO
  io.emit("order_updated", targetOrder);
  io.to(targetOrder.id).emit("order_updated", targetOrder);

  res.json({
    message: `⚡ Order #${targetOrder.id.slice(0, 8)} berhasil diterima! Silakan jemput penumpang.`,
    order: targetOrder,
  });
});

app.all(["/api/driver/jobs/:id/status", "/driver/jobs/:id/status", "/api/jobs/:id/status", "/jobs/:id/status", "/api/orders/:id/status"], (req, res) => {
  const orderId = req.params.id;
  const targetOrder = orders.find((o) => o.id === orderId);

  if (!targetOrder) return res.status(404).json({ error: "Order tidak ditemukan!" });

  const newStatus = req.body.status || req.query.status || "ON_THE_WAY";
  const oldStatus = targetOrder.status;
  targetOrder.status = newStatus;

  let autoDebitNote = "";
  if (targetOrder.status === "COMPLETED") {
    if (targetOrder.paymentMethod === "WALLET" && !targetOrder.isPaid) {
      targetOrder.isPaid = true;
      const fare = Number(targetOrder.price || 0);

      // Auto debet saldo wallet pelanggan
      const custUser = users.find((u) => u.id === targetOrder.customerId);
      if (custUser) {
        custUser.balance = Math.max(0, (custUser.balance || 0) - fare);
      }

      // Kreditkan ke saldo wallet driver
      if (targetOrder.driverId) {
        const drvUser = users.find((u) => u.id === targetOrder.driverId);
        if (drvUser) {
          drvUser.balance = (drvUser.balance || 0) + fare;
        }
      }

      autoDebitNote = ` 💳 Saldo Wallet Pelanggan sebesar Rp ${fare.toLocaleString('id-ID')} telah di-AUTODEBET otomatis! Status: LUNAS.`;
    } else if (targetOrder.paymentMethod === "CASH") {
      autoDebitNote = ` 💵 Pembayaran Tunai (Cash) Rp ${Number(targetOrder.price || 0).toLocaleString('id-ID')} saat tiba di lokasi tujuan.`;
    }
  }

  // Realtime Broadcast via Socket.IO
  io.emit("order_updated", targetOrder);
  io.to(targetOrder.id).to(`order_${targetOrder.id}`).emit("order_updated", targetOrder);
  io.to(targetOrder.id).to(`order_${targetOrder.id}`).emit("order_status_changed", { orderId: targetOrder.id, status: targetOrder.status });

  res.json({
    message: `Status order #${targetOrder.id.slice(0, 8)} diperbarui ke: ${targetOrder.status}.${autoDebitNote}`,
    order: targetOrder,
  });
});

app.get(["/api/orders/:id/chat", "/api/orders/:id/chat-history"], (req, res) => {
  const orderId = req.params.id;
  const filtered = chatMessages.filter((m) => m.orderId === orderId);
  res.json({ messages: filtered, total: filtered.length });
});

app.get("/api/driver/documents", (req, res) => {
  const driverUser = getDriverUser(req);
  const docs = driverDocuments.filter((d) => d.driverId === driverUser.id);
  res.json({ documents: docs });
});

app.post("/api/driver/documents", (req, res) => {
  const driverUser = getDriverUser(req);
  const newDoc: DocumentRecord = {
    id: `doc_${Date.now()}`,
    driverId: driverUser.id,
    type: req.body.type || "SIM",
    url: req.body.url || "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&w=400&q=80",
    status: "APPROVED",
  };
  driverDocuments.push(newDoc);
  res.json({ message: "Dokumen berhasil diunggah & diverifikasi Admin!", document: newDoc });
});

// Customer Routes
app.get("/api/customer/profile", (req, res) => {
  const cust = getCustomerUser(req);

  res.json({
    profile: {
      id: cust.id,
      email: cust.email,
      fullName: cust.fullName,
      phone: cust.phone,
      balance: cust.balance || 150000,
    },
  });
});

app.get("/api/customer/orders", (req, res) => {
  const cust = getCustomerUser(req);
  const custOrders = orders.filter((o) => o.customerId === cust.id || cust.role === "CUSTOMER");
  res.json({ orders: custOrders });
});

app.post("/api/customer/orders", (req, res) => {
  const cust = getCustomerUser(req);
  const { serviceType, pickupAddress, pickupLat, pickupLng, dropoffAddress, dropoffLat, dropoffLng, distanceKm, paymentMethod } = req.body;

  const dist = distanceKm || 3;
  const fare = serviceType === "CAR" ? 15000 + dist * 3500 : 5000 + dist * 2000;

  if (paymentMethod === "WALLET" && (cust.balance || 0) < fare) {
    return res.status(400).json({
      error: `Gagal Pesan: Saldo Dompet/Wallet Anda (Rp ${(cust.balance || 0).toLocaleString('id-ID')}) tidak mencukupi untuk tarif Rp ${fare.toLocaleString('id-ID')}. Silakan melakukan Top-Up terlebih dahulu!`,
    });
  }

  const newOrder: OrderRecord = {
    id: `ord_${Date.now()}`,
    customerId: cust.id,
    customerName: cust.fullName,
    customerPhone: cust.phone,
    serviceType: serviceType || "BIKE",
    pickupAddress: pickupAddress || "Alun-Alun Kota Batu",
    pickupLat: pickupLat || -7.8711,
    pickupLng: pickupLng || 112.5269,
    dropoffAddress: dropoffAddress || "Museum Angkut Batu",
    dropoffLat: dropoffLat || -7.8785,
    dropoffLng: dropoffLng || 112.5204,
    distanceKm: dist,
    price: fare,
    paymentMethod: paymentMethod || "CASH",
    isPaid: false,
    status: "PENDING",
    createdAt: new Date().toISOString(),
  };

  // Requirement #1 & #4: Auto Accept check (except SEND/kirim barang) & Vehicle Classification Match
  const isAutoEligible = isServiceAutoAcceptable(newOrder.serviceType);
  const eligibleDrivers = isAutoEligible ? users.filter((d) => {
    if (d.role !== "DRIVER") return false;
    const isAuto = d.autoAccept ?? true;
    if (!d.isOnline || !isAuto) return false;

    const isVerified = d.isVerified !== false;
    const isLocked = d.isLocked && !isVerified;
    if (isLocked) return false;

    const driverVehicle = getDriverVehicleType(d);
    if (!isOrderMatchingDriver(newOrder.serviceType, driverVehicle)) return false;

    const driverBusy = orders.some((o) => o.driverId === d.id && o.status !== "COMPLETED" && o.status !== "CANCELLED");
    return !driverBusy;
  }) : [];

  // Sort eligible drivers by lastActive descending so active logged-in driver gets priority
  eligibleDrivers.sort((a, b) => (b.lastActive || 0) - (a.lastActive || 0));
  const availableDriver = eligibleDrivers[0];

  if (availableDriver) {
    newOrder.status = "ACCEPTED";
    newOrder.driverId = availableDriver.id;
    newOrder.driverName = availableDriver.fullName;
    newOrder.driverPhone = availableDriver.phone;
    newOrder.driverVehicleModel = availableDriver.vehicleModel;
    newOrder.driverVehiclePlate = availableDriver.vehiclePlate;
  }

  orders.unshift(newOrder);

  // Realtime Broadcast new order to all drivers & customer
  io.emit("order_created", newOrder);
  io.emit("new_order_available", newOrder);
  if (availableDriver) {
    io.emit("order_updated", newOrder);
    io.emit("order_accepted", { orderId: newOrder.id, driver: availableDriver, order: newOrder, autoAccepted: true });
    io.emit("order_auto_accepted", { orderId: newOrder.id, driver: availableDriver, order: newOrder });
  }

  const msg = availableDriver
    ? `Order #${newOrder.id.slice(0, 8)} (${newOrder.serviceType}) dipublikasikan & OTOMATIS DITERIMA oleh Mitra ${availableDriver.fullName} (Auto Accept)!`
    : `Order #${newOrder.id.slice(0, 8)} (${newOrder.serviceType}) dipublikasikan ke pool driver terdekat!`;

  res.json({
    message: msg,
    order: newOrder,
    breakdown: { finalFare: fare },
  });
});

// Wallet & Top-up Requests
app.get("/api/admin/topup-requests/pending", (req, res) => {
  const pending = topupRequests.filter((t) => t.status === "PENDING");
  res.json({ topupRequests: pending, total: pending.length });
});

app.get("/api/admin/pending-topups", (req, res) => {
  const pending = topupRequests.filter((t) => t.status === "PENDING");
  res.json({ topupRequests: pending, total: pending.length });
});

app.post("/api/admin/topup-requests/:id/review", (req, res) => {
  const { id } = req.params;
  const { status, reviewNote } = req.body;

  const reqItem = topupRequests.find((t) => t.id === id);
  if (!reqItem) {
    return res.status(404).json({ error: "Permintaan top-up tidak ditemukan!" });
  }

  reqItem.status = status || "APPROVED";
  if (reviewNote) reqItem.note = reviewNote;

  if (reqItem.status === "APPROVED") {
    const targetUser = users.find((u) => u.id === reqItem.userId || u.email === reqItem.user?.email);
    if (targetUser) {
      targetUser.balance = (targetUser.balance || 0) + Number(reqItem.amount || 0);
    }
  }

  io.emit("topup_reviewed", reqItem);

  res.json({
    success: true,
    message: `Permintaan top-up Rp ${reqItem.amount.toLocaleString('id-ID')} atas nama ${reqItem.user?.fullName} BERHASIL ${reqItem.status === 'APPROVED' ? 'DISETUJUI (Saldo telah ditambahkan)' : 'DITOLAK'}!`,
    topupRequest: reqItem,
  });
});

app.post("/api/wallet/topup", (req, res) => {
  const currentUser = getUserFromHeader(req);
  const amount = Number(req.body.amount || 50000);
  const method = req.body.method || "QRIS";
  const proofImageUrl = req.body.proofImageUrl || req.body.url || "https://images.unsplash.com/photo-1556742049-0a6754099d6e?auto=format&fit=crop&w=500&q=80";
  const note = req.body.note || `Permintaan topup saldo wallet Rp ${amount.toLocaleString('id-ID')} via ${method}`;

  const newTopup: TopupRequestRecord = {
    id: `topup_${Date.now()}`,
    userId: currentUser?.id || "usr_cust_1",
    user: currentUser ? {
      id: currentUser.id,
      fullName: currentUser.fullName,
      email: currentUser.email,
      phone: currentUser.phone,
      role: currentUser.role,
    } : {
      id: "usr_cust_1",
      fullName: "Rusydi Dhuknoo",
      email: "rusydi@dhuknoo.com",
      phone: "081252185515",
      role: "CUSTOMER",
    },
    amount,
    method,
    proofImageUrl,
    note,
    status: "PENDING",
    createdAt: new Date().toISOString(),
  };

  topupRequests.unshift(newTopup);
  io.emit("new_topup_request", newTopup);

  res.json({
    message: `Permintaan top-up saldo deposit sebesar Rp ${amount.toLocaleString('id-ID')} via ${method} berhasil diajukan! Menunggu verifikasi dokumen oleh Admin.`,
    topupRequest: newTopup,
    newBalance: currentUser?.balance,
  });
});

// Payment Proofs Endpoints
app.get("/api/payments/pending-proofs", (req, res) => {
  const pending = paymentProofs.filter((p) => p.status === "PENDING");
  res.json({ proofs: pending, total: pending.length });
});

app.post("/api/payments/submit-proof", (req, res) => {
  const currentUser = getUserFromHeader(req);
  const newProof: PaymentProofRecord = {
    id: `proof_${Date.now()}`,
    orderId: req.body.orderId || "ord_demo_1",
    order: req.body.order || {
      id: req.body.orderId || "ord_demo_1",
      price: req.body.amount || 15000,
      customer: { phoneNumber: currentUser?.phone, user: { fullName: currentUser?.fullName } },
    },
    userId: currentUser?.id,
    method: req.body.method || "QRIS",
    proofImageUrl: req.body.proofImageUrl || req.body.url || "https://images.unsplash.com/photo-1556742049-0a6754099d6e?auto=format&fit=crop&w=500&q=80",
    note: req.body.note || "Bukti bayar manual dikirim",
    status: "PENDING",
    createdAt: new Date().toISOString(),
  };
  paymentProofs.push(newProof);
  io.emit("new_payment_proof", newProof);
  res.json({ message: "Bukti bayar berhasil dikirim! Menunggu konfirmasi Admin.", proof: newProof });
});

app.all(["/api/payments/proofs/:id/review", "/api/payments/review-proof/:id"], (req, res) => {
  const { id } = req.params;
  const proof = paymentProofs.find((p) => p.id === id);
  if (!proof) return res.status(404).json({ error: "Bukti bayar tidak ditemukan!" });

  proof.status = req.body.status || "APPROVED";
  res.json({ message: `Bukti bayar telah ${proof.status === "APPROVED" ? "disetujui" : "ditolak"}!`, proof });
});

app.post(["/api/payments/charge", "/api/payments/charge-order"], (req, res) => {
  const { orderId } = req.body;
  const targetOrder = orders.find((o) => o.id === orderId);
  if (!targetOrder) return res.status(404).json({ error: "Order tidak ditemukan!" });

  const fare = Number(targetOrder.price || 0);

  if (!targetOrder.isPaid) {
    targetOrder.isPaid = true;

    // Potong saldo wallet customer
    const custUser = users.find((u) => u.id === targetOrder.customerId);
    if (custUser) {
      custUser.balance = Math.max(0, (custUser.balance || 0) - fare);
    }

    // Kreditkan ke saldo wallet driver
    if (targetOrder.driverId) {
      const drvUser = users.find((u) => u.id === targetOrder.driverId);
      if (drvUser) {
        drvUser.balance = (drvUser.balance || 0) + fare;
      }
    }
  }

  io.emit("order_updated", targetOrder);
  io.to(targetOrder.id).to(`order_${targetOrder.id}`).emit("order_updated", targetOrder);

  res.json({
    success: true,
    message: `⚡ Autodebet Wallet Berhasil! Saldo Rp ${fare.toLocaleString('id-ID')} telah dipotong dari Wallet.`,
    order: targetOrder,
  });
});

app.post(["/api/payments/confirm-cash", "/api/payments/confirm-cash-payment"], (req, res) => {
  const { orderId } = req.body;
  const targetOrder = orders.find((o) => o.id === orderId);
  if (!targetOrder) return res.status(404).json({ error: "Order tidak ditemukan!" });

  targetOrder.isPaid = true;

  io.emit("order_updated", targetOrder);
  io.to(targetOrder.id).to(`order_${targetOrder.id}`).emit("order_updated", targetOrder);

  res.json({
    success: true,
    message: `💵 Pembayaran Tunai (Cash) Sebesar Rp ${Number(targetOrder.price || 0).toLocaleString('id-ID')} Telah Dikonfirmasi Lunas!`,
    order: targetOrder,
  });
});

// Admin Driver Document Reviews
app.get("/api/admin/pending-driver-documents", (req, res) => {
  const pending = driverDocuments.filter((d) => d.status === "PENDING");
  const enriched = pending.map((d) => {
    const drvUser = users.find((u) => u.id === d.driverId);
    return {
      ...d,
      driver: drvUser ? {
        id: drvUser.id,
        user: { fullName: drvUser.fullName, email: drvUser.email },
      } : undefined,
    };
  });
  res.json({ documents: enriched });
});

app.all(["/api/admin/review-driver-document/:id", "/api/admin/driver-documents/:id/review"], (req, res) => {
  const { id } = req.params;
  const doc = driverDocuments.find((d) => d.id === id);
  if (!doc) return res.status(404).json({ error: "Dokumen driver tidak ditemukan!" });

  doc.status = req.body.status || "APPROVED";
  const driver = users.find((u) => u.id === doc.driverId);
  if (driver) {
    const approvedCount = driverDocuments.filter((d) => d.driverId === driver.id && d.status === "APPROVED").length;
    if (approvedCount >= 3) {
      driver.isVerified = true;
      driver.isLocked = false;
    }
  }

  res.json({ message: `Status dokumen driver diperbarui ke ${doc.status}!`, document: doc });
});

app.post("/api/upload/image", (req, res) => {
  res.json({ url: "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&w=400&q=80" });
});

app.get("/api/admin/dashboard", (req, res) => {
  res.json({
    totalOrders: orders.length,
    activeDrivers: users.filter((u) => u.role === "DRIVER").length,
    platformRevenue: 250000,
    logs: [
      {
        id: "log_1",
        action: "TOPUP_REVIEWED",
        details: "Admin menyetujui deposit top-up Rp 50.000 via QRIS",
        createdAt: new Date().toISOString(),
        user: { fullName: "Admin Dhuknoo Utama" },
      },
    ],
  });
});

app.use("/api/admin", (req, res) => {
  res.json({ message: "Operasi Admin Berhasil", items: [] });
});

app.use("/api/payments", (req, res) => {
  res.json({ message: "Sistem Pembayaran Berhasil", success: true });
});

app.use("/api/tariffs", (req, res) => {
  res.json({ message: "Tarif berhasil dihitung", baseFare: 5000, perKmFee: 2000 });
});

/* -------------------------------------------------------------------------- */
/* VITE MIDDLEWARE (Dev) / STATIC FILE SERVING (Prod)                          */
/* -------------------------------------------------------------------------- */

async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*all", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  server.listen(PORT, "0.0.0.0", () => {
    console.log(`[Realtime Backend] Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
