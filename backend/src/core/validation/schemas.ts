import { z } from 'zod';

export const registerSchema = z
  .object({
    email: z.string().email('Format email tidak valid!'),
    password: z.string().min(4, 'Sandi minimal harus 4 karakter!'),
    fullName: z.string().min(3, 'Nama lengkap minimal harus 3 karakter!'),
    phone: z.string().min(8, 'Nomor HP / WhatsApp minimal harus 8 digit!').optional(),
    // 🆕 AUDIT KEAMANAN KRITIS: 'ADMIN' DIHAPUS dari daftar role yang boleh
    // didaftarkan lewat endpoint publik ini (/api/auth/register, TANPA
    // autentikasi). Sebelumnya siapa pun bisa mengirim { role: "ADMIN" } dan
    // langsung mendapat akun administrator penuh -- akses approve
    // pembayaran, verifikasi driver, ubah tarif, dst -- tanpa otorisasi
    // apa pun. Akun admin sekarang HANYA bisa dibuat lewat: (1) seed
    // database awal (prisma/seed.ts, operasi server-side terkontrol), atau
    // (2) admin yang sudah ada memakai endpoint POST /api/admin/create-admin
    // (lihat admin.routes.ts, dilindungi authenticateToken+authorizeRoles).
    role: z.enum(['CUSTOMER', 'DRIVER', 'MERCHANT'], {
      errorMap: () => ({ message: 'Role harus CUSTOMER, DRIVER, atau MERCHANT!' }),
    }),
    vehiclePlate: z.string().optional(),
    vehicleModel: z.string().optional(),
    driverServiceType: z.enum(['BIKE', 'CAR', 'SEND']).optional(),
    // Wajib diisi hanya jika role === MERCHANT (didaftarkan sekaligus buka toko)
    merchantName: z.string().min(3, 'Nama toko minimal 3 karakter!').optional(),
    merchantCategory: z.string().min(1, 'Kategori toko wajib diisi!').optional(),
    merchantAddress: z.string().min(3, 'Alamat toko minimal 3 karakter!').optional(),
    merchantLatitude: z.number().min(-90).max(90).optional(),
    merchantLongitude: z.number().min(-180).max(180).optional(),
  })
  .refine(
    (data) =>
      data.role !== 'MERCHANT' ||
      (data.merchantName && data.merchantCategory && data.merchantAddress &&
        data.merchantLatitude !== undefined && data.merchantLongitude !== undefined),
    {
      message:
        'Registrasi role MERCHANT wajib menyertakan merchantName, merchantCategory, merchantAddress, merchantLatitude, dan merchantLongitude!',
      path: ['merchantName'],
    }
  );

// 🆕 FIX "Phone registration": sebelumnya `email` WAJIB & harus format
// email valid (z.string().email()) -- SATU-SATUNYA cara login, padahal
// backend (auth.service.ts loginUser) sudah dibuat mendukung login via
// nomor HP juga (findByEmailOrPhone). Request login berbasis nomor HP
// akan DITOLAK DI SINI (validateBody) sebelum sempat sampai ke
// controller/service manapun. Sekarang menerima email ATAU phone ATAU
// emailOrPhone, sama seperti requestPasswordResetSchema di bawah.
export const loginSchema = z
  .object({
    email: z.string().optional(),
    phone: z.string().optional(),
    emailOrPhone: z.string().optional(),
    password: z.string().min(1, 'Password wajib diisi!'),
  })
  .refine((data) => !!(data.email || data.phone || data.emailOrPhone), {
    message: 'Email atau nomor HP wajib diisi!',
    path: ['email'],
  });

// 🆕 Dipakai POST /api/admin/create-admin — satu-satunya jalur lain (selain
// seed database) untuk membuat akun ADMIN baru, dan HANYA bisa dipanggil
// oleh admin yang sudah login (authenticateToken + authorizeRoles('ADMIN')
// di admin.routes.ts).
export const createAdminSchema = z.object({
  email: z.string().email('Format email tidak valid!'),
  password: z.string().min(8, 'Password admin minimal 8 karakter!'),
  fullName: z.string().min(3, 'Nama lengkap minimal harus 3 karakter!'),
  phone: z.string().min(8, 'Nomor HP / WhatsApp minimal harus 8 digit!').optional(),
});

// 🆕 Dipakai POST /api/admin/wallet/credit — jalur SATU-SATUNYA yang sah
// bagi admin untuk menambah saldo user lain secara langsung tanpa lewat
// antrean TopupRequest (mis. kompensasi kesalahan sistem, refund manual).
// targetUserId WAJIB diisi & TIDAK BOLEH menyasar diri sendiri (dicek di
// route handler) -- mencegah pola self-dealing yang sebelumnya ada di
// endpoint /api/wallet/topup untuk role ADMIN.
export const adminWalletCreditSchema = z.object({
  targetUserId: z.string().uuid('targetUserId harus UUID yang valid!'),
  amount: z.number().positive('Nominal harus lebih dari 0!').max(50_000_000, 'Nominal maksimal Rp50.000.000 per transaksi!'),
  reason: z.string().min(5, 'Alasan wajib diisi, minimal 5 karakter (untuk audit)!'),
  // 🆕 FIX P0 IDEMPOTENCY: wajib diisi CLIENT (bukan digenerate server dari
  // Date.now()/crypto.randomUUID() seperti versi sebelumnya -- key acak
  // BERUBAH tiap panggilan, jadi @unique constraint di Transaction TIDAK
  // PERNAH kena collision, dan double-klik tombol atau retry jaringan dari
  // dashboard admin bisa MENGKREDIT DUA KALI tanpa terdeteksi sama sekali.
  // Client (dashboard admin) WAJIB generate satu UUID/nonce per "niat
  // transaksi" dan kirim ulang key YANG SAMA persis kalau request
  // di-retry (mis. karena timeout tapi sebenarnya sudah diproses server).
  // Sekarang WAJIB (bukan .optional()) -- operasi finansial yang bisa
  // diretry harus selalu punya idempotency key dari sumbernya, tidak
  // boleh diam-diam "aman sendiri" lewat fallback server-side.
  idempotencyKey: z.string().min(8, 'idempotencyKey wajib disertakan agar kredit wallet tidak diproses dua kali!').max(200),
});

export const changePasswordSchema = z.object({
  oldPassword: z.string().min(1, 'Password lama wajib diisi!'),
  newPassword: z.string().min(4, 'Password baru minimal harus 4 karakter!'),
});

// 🆕 PERBAIKAN #1 (Lupa/Reset Password)
export const requestPasswordResetSchema = z
  .object({
    email: z.string().optional(),
    phone: z.string().optional(),
    emailOrPhone: z.string().optional(),
  })
  .refine((data) => !!(data.email || data.phone || data.emailOrPhone), {
    message: 'Email atau Nomor HP wajib diisi!',
  });

export const confirmPasswordResetSchema = z.object({
  token: z.string().min(1, 'Kode reset wajib diisi!'),
  newPassword: z.string().min(4, 'Password baru minimal harus 4 karakter!'),
});

export const createOrderSchema = z.object({
  serviceType: z.enum(['BIKE', 'CAR', 'SEND', 'MART'], {
    errorMap: () => ({ message: 'Tipe layanan harus BIKE, CAR, SEND, atau MART!' }),
  }),
  // CATATAN: harga TIDAK diterima dari client sama sekali (celah keamanan kalau diizinkan —
  // client bisa kirim harga sembarangan). Harga SELALU dihitung server lewat Tariff Engine
  // dari jarak & kondisi perjalanan di bawah ini.
  distanceKm: z.number().min(0, 'Jarak tidak boleh negatif!').max(500, 'Jarak maksimal 500 km!'),
  pickupAddress: z.string().min(3, 'Alamat penjemputan minimal 3 karakter!'),
  pickupLat: z.number(),
  pickupLng: z.number(),
  dropoffAddress: z.string().min(3, 'Alamat tujuan minimal 3 karakter!'),
  dropoffLat: z.number(),
  dropoffLng: z.number(),
  zoneName: z.string().optional(),
  waitMinutes: z.number().min(0).optional(),
  hasToll: z.boolean().optional(),
  hasParking: z.boolean().optional(),
  isBadWeather: z.boolean().optional(),
  isHoliday: z.boolean().optional(),
  promoCode: z.string().optional(),
  paymentMethod: z.enum(['WALLET', 'CASH', 'QRIS', 'TRANSFER', 'EWALLET']).default('WALLET'),
});

export const updateOrderStatusSchema = z.object({
  status: z.enum(['ON_THE_WAY', 'ARRIVED', 'PICKED_UP', 'ARRIVED_CUSTOMER', 'COMPLETED', 'CANCELLED'], {
    errorMap: () => ({ message: 'Status tidak valid untuk lifecycle driver.' }),
  }),
});

// 🆕 (Link Merchant <-> Order): checkout keranjang belanja dari satu toko.
export const merchantCheckoutSchema = z.object({
  merchantId: z.string().min(1, 'merchantId wajib diisi!'),
  items: z
    .array(
      z.object({
        productId: z.string().min(1),
        quantity: z.number().int().min(1, 'Jumlah minimal 1!'),
      })
    )
    .min(1, 'Keranjang belanja tidak boleh kosong!'),
  dropoffAddress: z.string().min(3, 'Alamat pengantaran minimal 3 karakter!'),
  dropoffLat: z.number(),
  dropoffLng: z.number(),
  paymentMethod: z.enum(['WALLET', 'CASH', 'QRIS', 'TRANSFER', 'EWALLET']).default('WALLET'),
  notes: z.string().optional(),
});

// ── Wallet ──────────────────────────────────────────────────────────────
export const topupSchema = z.object({
  amount: z.number().min(5000, 'Nominal top-up minimal Rp 5.000!').max(10_000_000, 'Nominal top-up maksimal Rp10.000.000 per transaksi!'),
  // PERBAIKAN: skema ini sebelumnya HANYA mendefinisikan `amount`. Karena
  // Zod secara default membuang (strip) semua field yang tidak didefinisikan
  // di shape, `method`/`proofImageUrl`/`note` yang dikirim frontend selalu
  // hilang sebelum sampai ke controller -- akibatnya WalletController.topup()
  // selalu jatuh ke default 'TRANSFER' apa pun metode yang sebenarnya dipilih
  // user (CASH/QRIS/EWALLET/dst), sehingga keterangan di Dashboard Admin
  // SELALU tertulis TRANSFER walau top-up-nya sebenarnya CASH.
  method: z.enum(['QRIS', 'TRANSFER', 'EWALLET', 'CASH', 'PAYMENT_LINK']).optional(),
  proofImageUrl: z.string().optional(),
  note: z.string().optional(),
});

// ── Payment ─────────────────────────────────────────────────────────────
export const chargeOrderSchema = z.object({
  orderId: z.string().uuid('orderId harus berupa UUID yang valid!'),
  idempotencyKey: z.string().min(8, 'idempotencyKey wajib disertakan agar pembayaran tidak diproses dua kali!'),
});

// ── Promo ───────────────────────────────────────────────────────────────
export const validatePromoSchema = z.object({
  code: z.string().min(1, 'Kode promo wajib diisi!'),
  orderPrice: z.number().min(0, 'orderPrice tidak boleh negatif!'),
});

export const createPromoSchema = z.object({
  code: z.string().min(3, 'Kode promo minimal 3 karakter!').toUpperCase(),
  type: z.enum(['PERCENTAGE', 'FIXED']),
  value: z.number().positive('Nilai promo harus lebih besar dari 0!'),
  maxDiscount: z.number().positive().optional(),
  minOrderPrice: z.number().min(0).optional(),
  quota: z.number().int().min(0).optional(),
  expiresAt: z.string().datetime().optional(),
});

// ── Review ──────────────────────────────────────────────────────────────
export const createReviewSchema = z.object({
  orderId: z.string().uuid('orderId harus berupa UUID yang valid!'),
  rating: z.number().int().min(1, 'Rating minimal 1.').max(5, 'Rating maksimal 5.'),
  comment: z.string().max(500, 'Komentar maksimal 500 karakter!').optional(),
});

// ── Location ────────────────────────────────────────────────────────────
export const updateLocationSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  isOnline: z.boolean().optional(),
});

// ── Map Engine ───────────────────────────────────────────────────────────

export const searchAddressSchema = z.object({
  query: z.string().min(3),
});

export const reverseGeocodeSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
});

const coordinateSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
});

export const calculateDistanceSchema = z.object({
  origin: coordinateSchema,
  destination: coordinateSchema,
});

export const estimateEtaSchema = calculateDistanceSchema.extend({
  vehicleType: z.enum(["BIKE", "CAR"]).default("BIKE"),
});

export const routePolylineSchema = calculateDistanceSchema;

export const nearestDriverSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  radiusKm: z.number().min(1).max(50).default(5),
  limit: z.number().min(1).max(20).default(10),
});

export const geofenceSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  polygon: z.array(
    z.object({
      latitude: z.number(),
      longitude: z.number(),
    })
  ).min(3),
});

// ── Merchant ────────────────────────────────────────────────────────────
export const createMerchantSchema = z.object({
  name: z.string().min(3, 'Nama merchant minimal 3 karakter!'),
  category: z.string().min(1, 'Kategori wajib diisi!'),
  address: z.string().min(3, 'Alamat minimal 3 karakter!'),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  phone: z.string().optional(),
  imageUrl: z.string().url('imageUrl harus berupa URL yang valid!').optional(),
});

export const updateMerchantSchema = z.object({
  name: z.string().min(3).optional(),
  category: z.string().min(1).optional(),
  address: z.string().min(3).optional(),
  // latitude/longitude sengaja TIDAK termasuk update schema: lokasi merchant
  // adalah master pickup point dan hanya ditetapkan saat registrasi.
  phone: z.string().optional(),
  imageUrl: z.string().url().optional(),
  isOpen: z.boolean().optional(),
});

export const addMenuItemSchema = z.object({
  name: z.string().min(1, 'Nama menu wajib diisi!'),
  description: z.string().optional(),
  price: z.number().min(0, 'Harga tidak boleh negatif!'),
  imageUrl: z.string().url('imageUrl harus berupa URL yang valid!').optional(),
});

// 🆕 SEBELUMNYA TIDAK PERNAH DIPAKAI: merchant.routes.ts punya 22 endpoint
// dan SATU PUN tidak divalidasi Zod, termasuk endpoint yang menulis data
// (registrasi toko baru, tambah produk, ubah harga) -- payload apa pun
// (harga negatif, koordinat di luar jangkauan, field kosong) lolos begitu
// saja ke service layer.
export const registerMerchantSchema = z.object({
  name: z.string().min(3, 'Nama merchant minimal 3 karakter!'),
  category: z.string().min(1, 'Kategori wajib diisi!'),
  address: z.string().min(3, 'Alamat minimal 3 karakter!'),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  phone: z.string().optional(),
  ownerEmail: z.string().email('Email owner tidak valid!'),
  ownerPassword: z.string().min(6, 'Password owner minimal 6 karakter!'),
  ownerFullName: z.string().min(3, 'Nama owner minimal 3 karakter!'),
  ownerPhone: z.string().optional(),
  isOpen: z.boolean().optional(),
});

// 🆕 Dipakai admin.create — sama seperti registerMerchantSchema tapi field
// owner boleh datang lewat alias email/password/fullName/phone (lihat
// MerchantController.create yang me-remap-nya sebelum memanggil service).
export const createMerchantByAdminSchema = registerMerchantSchema
  .omit({ ownerEmail: true, ownerPassword: true, ownerFullName: true, ownerPhone: true })
  .extend({
    email: z.string().email().optional(),
    ownerEmail: z.string().email().optional(),
    password: z.string().min(6).optional(),
    ownerPassword: z.string().min(6).optional(),
    fullName: z.string().min(3).optional(),
    ownerFullName: z.string().min(3).optional(),
    phone: z.string().optional(),
    ownerPhone: z.string().optional(),
  })
  .refine((v) => v.email || v.ownerEmail, { message: 'Email owner wajib diisi!', path: ['ownerEmail'] })
  .refine((v) => v.password || v.ownerPassword, { message: 'Password owner wajib diisi!', path: ['ownerPassword'] })
  .refine((v) => v.fullName || v.ownerFullName, { message: 'Nama owner wajib diisi!', path: ['ownerFullName'] });

export const updateMenuItemSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  price: z.number().min(0).optional(),
  imageUrl: z.string().url().optional(),
  isAvailable: z.boolean().optional(),
});

export const bulkAddMenuItemsSchema = z.object({
  products: z.array(addMenuItemSchema).min(1, 'Minimal 1 produk wajib diisi!').max(200, 'Maksimal 200 produk sekaligus!'),
});

// ── Tariff Engine (Admin) ──────────────────────────────────────────────
export const createPricingZoneSchema = z.object({
  name: z.string().min(2, 'Nama zona minimal 2 karakter!'),
});

export const createPricingRuleSchema = z.object({
  zoneId: z.string().uuid().optional(),
  serviceType: z.enum(['BIKE', 'CAR', 'SEND', 'MART']),
  baseFare: z.number().min(0, 'Tarif dasar tidak boleh negatif!'),
  pickupFee: z.number().min(0).optional(),
  perKmFee: z.number().min(0, 'Biaya per-km tidak boleh negatif!'),
  perMinuteWaitFee: z.number().min(0).optional(),
});

export const updatePricingRuleSchema = z.object({
  baseFare: z.number().min(0).optional(),
  pickupFee: z.number().min(0).optional(),
  perKmFee: z.number().min(0).optional(),
  perMinuteWaitFee: z.number().min(0).optional(),
  isActive: z.boolean().optional(),
});

export const createRegionalPolicySchema = z.object({
  zoneId: z.string().uuid('zoneId harus UUID yang valid!'),
  tollFee: z.number().min(0).optional(),
  parkingFee: z.number().min(0).optional(),
  weatherSurcharge: z.number().min(0).optional(),
  holidaySurcharge: z.number().min(0).optional(),
});

export const updateRegionalPolicySchema = z.object({
  tollFee: z.number().min(0).optional(),
  parkingFee: z.number().min(0).optional(),
  weatherSurcharge: z.number().min(0).optional(),
  holidaySurcharge: z.number().min(0).optional(),
  isActive: z.boolean().optional(),
});

const commissionTierSchema = z.object({
  maxOrderValue: z.number().min(0).nullable(), // null = tier terakhir/tanpa batas atas
  rate: z.number().min(0).max(1, 'Rate harus antara 0 dan 1 (mis. 0.08 untuk 8%)'),
});

export const createTariffVersionSchema = z.object({
  versionName: z.string().min(3, 'Nama versi minimal 3 karakter!'),
  description: z.string().optional(),
  commissionTiers: z.array(commissionTierSchema).min(1, 'Minimal 1 tier komisi!'),
});

export const previewFareSchema = z.object({
  serviceType: z.enum(['BIKE', 'CAR', 'SEND', 'MART']),
  distanceKm: z.number().min(0),
  zoneName: z.string().optional(),
  waitMinutes: z.number().min(0).optional(),
  hasToll: z.boolean().optional(),
  hasParking: z.boolean().optional(),
  isBadWeather: z.boolean().optional(),
  isHoliday: z.boolean().optional(),
});

export const updateConfigSchema = z.object({
  value: z.string().min(1, 'Value tidak boleh kosong!'),
  description: z.string().optional(),
});

// ── Cash payment (driver confirms cash received) ──────────────────────────
export const confirmCashSchema = z.object({
  orderId: z.string().uuid('orderId harus berupa UUID yang valid!'),
});

// ── Manual payment proof (QRIS/Transfer/E-Wallet, sebelum ada gateway) ────
export const submitPaymentProofSchema = z.object({
  orderId: z.string().uuid('orderId harus berupa UUID yang valid!'),
  method: z.enum(['QRIS', 'TRANSFER', 'EWALLET']),
  proofImageUrl: z.string().min(1, 'Bukti pembayaran wajib diupload!'),
  note: z.string().max(300).optional(),
});

export const reviewPaymentProofSchema = z.object({
  status: z.enum(['APPROVED', 'REJECTED']),
  reviewNote: z.string().max(300).optional(),
});

// ── Driver document verification (KTP+selfie, STNK, SIM) ───────────────────────
export const uploadDriverDocumentSchema = z.object({
  type: z.enum(['KTP_SELFIE', 'STNK', 'SIM']),
  imageUrl: z.string().min(1, 'Foto dokumen wajib diupload!'),
});

export const reviewDriverDocumentSchema = z.object({
  status: z.enum(['APPROVED', 'REJECTED']),
  reviewNote: z.string().max(300).optional(),
});

// ── Async Report Generation (GET /api/report/:type?format=pdf|excel) ──────
export const reportQuerySchema = z.object({
  format: z.enum(['pdf', 'excel']).default('excel'),
  timeframe: z.enum(['daily', 'weekly', 'monthly']).default('daily'),
});
