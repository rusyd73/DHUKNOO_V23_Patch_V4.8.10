export const SwaggerSpecification = {
  openapi: '3.0.0',
  info: {
    title: 'DHUKNOO Ride API Docs',
    version: '1.0.0',
    description: 'Dokumentasi lengkap API platform Ojek Batu - Malang Raya (DHUKNOO). Dilengkapi dengan autentikasi berbasis Bearer JWT Token, kontrol akses berbasis peran (RBAC), monitoring kesehatan, serta background jobs.',
  },
  servers: [
    {
      url: 'http://localhost:3000',
      description: 'Server Lokal (Development)',
    },
  ],
  components: {
    securitySchemes: {
      BearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'Masukkan access token JWT Anda dalam format Bearer <token>.',
      },
    },
    schemas: {
      RegisterInput: {
        type: 'object',
        required: ['email', 'password', 'fullName', 'role'],
        properties: {
          email: { type: 'string', format: 'email', example: 'pembeli@gmail.com' },
          password: { type: 'string', minLength: 4, example: 'pembeli123' },
          fullName: { type: 'string', example: 'Budi Santoso' },
          role: { type: 'string', enum: ['CUSTOMER', 'DRIVER', 'ADMIN', 'MERCHANT'], example: 'CUSTOMER' },
          vehiclePlate: { type: 'string', example: 'N 1234 BAT', description: 'Wajib jika role = DRIVER' },
          vehicleModel: { type: 'string', example: 'Honda Vario', description: 'Wajib jika role = DRIVER' },
          merchantName: { type: 'string', example: 'Warung Bakso Pak Karto', description: 'Wajib jika role = MERCHANT' },
          merchantCategory: { type: 'string', example: 'Kuliner', description: 'Wajib jika role = MERCHANT' },
          merchantAddress: { type: 'string', example: 'Jl. Diponegoro No. 12, Batu', description: 'Wajib jika role = MERCHANT' },
          merchantLatitude: { type: 'number', example: -7.8703, description: 'Wajib jika role = MERCHANT' },
          merchantLongitude: { type: 'number', example: 112.5281, description: 'Wajib jika role = MERCHANT' },
        },
      },
      LoginInput: {
        type: 'object',
        required: ['email', 'password'],
        properties: {
          email: { type: 'string', format: 'email', example: 'pembeli@gmail.com' },
          password: { type: 'string', example: 'pembeli123' },
        },
      },
      ChangePasswordInput: {
        type: 'object',
        required: ['oldPassword', 'newPassword'],
        properties: {
          oldPassword: { type: 'string', example: 'pembeli123' },
          newPassword: { type: 'string', minLength: 4, example: 'pembeliberu' },
        },
      },
      CreateOrderInput: {
        type: 'object',
        required: ['serviceType', 'price', 'pickupAddress', 'pickupLat', 'pickupLng', 'dropoffAddress', 'dropoffLat', 'dropoffLng'],
        properties: {
          serviceType: { type: 'string', enum: ['BIKE', 'CAR', 'SEND'], example: 'BIKE' },
          price: { type: 'number', example: 15000 },
          pickupAddress: { type: 'string', example: 'Alun-alun Kota Batu' },
          pickupLat: { type: 'number', example: -7.8712 },
          pickupLng: { type: 'number', example: 112.5268 },
          dropoffAddress: { type: 'string', example: 'Museum Angkut Batu' },
          dropoffLat: { type: 'number', example: -7.8794 },
          dropoffLng: { type: 'number', example: 112.5218 },
          promoCode: { type: 'string', example: 'DHUKNOO10' },
        },
      },
      UpdateOrderStatusInput: {
        type: 'object',
        required: ['status'],
        properties: {
          status: { type: 'string', enum: ['ON_THE_WAY', 'ARRIVED', 'COMPLETED', 'CANCELLED'], example: 'ON_THE_WAY' },
        },
      },
      TopupInput: {
        type: 'object',
        required: ['amount'],
        properties: {
          amount: { type: 'number', example: 50000 },
        },
      },
      ChargeOrderInput: {
        type: 'object',
        required: ['orderId', 'idempotencyKey'],
        properties: {
          orderId: { type: 'string', format: 'uuid' },
          idempotencyKey: { type: 'string', example: 'a1b2c3d4-unique-per-attempt' },
        },
      },
      ValidatePromoInput: {
        type: 'object',
        required: ['code', 'orderPrice'],
        properties: {
          code: { type: 'string', example: 'DHUKNOO10' },
          orderPrice: { type: 'number', example: 20000 },
        },
      },
      CreatePromoInput: {
        type: 'object',
        required: ['code', 'type', 'value'],
        properties: {
          code: { type: 'string', example: 'DHUKNOO10' },
          type: { type: 'string', enum: ['PERCENTAGE', 'FIXED'], example: 'PERCENTAGE' },
          value: { type: 'number', example: 10 },
          maxDiscount: { type: 'number', example: 5000 },
          minOrderPrice: { type: 'number', example: 10000 },
          quota: { type: 'integer', example: 100 },
          expiresAt: { type: 'string', format: 'date-time' },
        },
      },
      CreateReviewInput: {
        type: 'object',
        required: ['orderId', 'rating'],
        properties: {
          orderId: { type: 'string', format: 'uuid' },
          rating: { type: 'integer', minimum: 1, maximum: 5, example: 5 },
          comment: { type: 'string', example: 'Driver ramah dan tepat waktu!' },
        },
      },
      UpdateLocationInput: {
        type: 'object',
        required: ['latitude', 'longitude'],
        properties: {
          latitude: { type: 'number', example: -7.8712 },
          longitude: { type: 'number', example: 112.5268 },
          isOnline: { type: 'boolean', example: true },
        },
      },
      CreateMerchantInput: {
        type: 'object',
        required: ['name', 'category', 'address', 'latitude', 'longitude'],
        properties: {
          name: { type: 'string', example: 'Warung Bakso Pak Karto' },
          category: { type: 'string', example: 'Kuliner' },
          address: { type: 'string', example: 'Jl. Diponegoro No. 12, Batu' },
          latitude: { type: 'number', example: -7.8703 },
          longitude: { type: 'number', example: 112.5281 },
          phone: { type: 'string', example: '+628111222333' },
          imageUrl: { type: 'string', format: 'uri' },
        },
      },
      UpdateMerchantInput: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          category: { type: 'string' },
          address: { type: 'string' },
          latitude: { type: 'number' },
          longitude: { type: 'number' },
          phone: { type: 'string' },
          imageUrl: { type: 'string', format: 'uri' },
          isOpen: { type: 'boolean' },
        },
      },
      AddMenuItemInput: {
        type: 'object',
        required: ['name', 'price'],
        properties: {
          name: { type: 'string', example: 'Bakso Urat Spesial' },
          description: { type: 'string', example: 'Bakso urat besar + mie + pangsit' },
          price: { type: 'number', example: 18000 },
          imageUrl: { type: 'string', format: 'uri' },
        },
      },
      UpdateMenuItemInput: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          description: { type: 'string' },
          price: { type: 'number' },
          imageUrl: { type: 'string', format: 'uri' },
          isAvailable: { type: 'boolean' },
        },
      },
    },
  },
  paths: {
    '/': {
      get: {
        summary: 'Pesan selamat datang (Welcome)',
        responses: {
          200: {
            description: 'Berhasil menyapa.',
          },
        },
      },
    },
    '/health': {
      get: {
        summary: 'Mengecek kesehatan sistem harian (Database, Redis, System)',
        responses: {
          200: {
            description: 'Sistem berjalan sehat (UP)',
          },
          503: {
            description: 'Sistem mengalami degradasi (DOWN)',
          },
        },
      },
    },
    '/metrics': {
      get: {
        summary: 'Metrik format Prometheus scrapable text',
        responses: {
          200: {
            description: 'Data metrik Prometheus',
          },
        },
      },
    },
    '/api/auth/register': {
      post: {
        summary: 'Mendaftarkan akun baru (Customer / Driver / Admin)',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/RegisterInput' },
            },
          },
        },
        responses: {
          201: {
            description: 'Registrasi berhasil.',
          },
          400: {
            description: 'Email sudah terdaftar atau input salah.',
          },
        },
      },
    },
    '/api/auth/login': {
      post: {
        summary: 'Melakukan login otentikasi JWT',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/LoginInput' },
            },
          },
        },
        responses: {
          200: {
            description: 'Login berhasil, mengembalikan token JWT.',
          },
          401: {
            description: 'Kredensial tidak cocok.',
          },
        },
      },
    },
    '/api/auth/refresh': {
      post: {
        summary: 'Memperbarui access token JWT menggunakan refresh token',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['refreshToken'],
                properties: {
                  refreshToken: { type: 'string' },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Access token berhasil diperbarui.',
          },
          403: {
            description: 'Refresh token tidak valid.',
          },
        },
      },
    },
    '/api/auth/profile': {
      get: {
        summary: 'Melihat profile pengguna yang sedang login',
        security: [{ BearerAuth: [] }],
        responses: {
          200: {
            description: 'Berhasil mengambil informasi profil.',
          },
          401: {
            description: 'Token tidak valid atau kedaluwarsa.',
          },
        },
      },
    },
    '/api/auth/change-password': {
      post: {
        summary: 'Mengganti sandi keamanan akun',
        security: [{ BearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/ChangePasswordInput' },
            },
          },
        },
        responses: {
          200: {
            description: 'Password berhasil diubah.',
          },
          400: {
            description: 'Sandi lama salah atau sandi baru terlalu pendek.',
          },
        },
      },
    },
    '/api/admin/dashboard': {
      get: {
        summary: 'Dashboard administratif khusus role ADMIN',
        security: [{ BearerAuth: [] }],
        responses: {
          200: {
            description: 'Berhasil mengakses halaman admin.',
          },
          403: {
            description: 'Peran Anda bukan ADMIN.',
          },
        },
      },
    },
    '/api/driver/jobs': {
      get: {
        summary: 'Melihat penawaran kerja khusus role DRIVER',
        security: [{ BearerAuth: [] }],
        responses: {
          200: {
            description: 'Daftar penjemputan ojek aktif.',
          },
          403: {
            description: 'Peran Anda bukan DRIVER.',
          },
        },
      },
    },
    '/api/order': {
      post: {
        summary: 'Membuat order perjalanan baru (khusus CUSTOMER)',
        security: [{ BearerAuth: [] }],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/CreateOrderInput' } } },
        },
        responses: {
          201: { description: 'Order berhasil dibuat.' },
          403: { description: 'Hanya CUSTOMER yang bisa membuat order.' },
        },
      },
      get: {
        summary: 'Melihat riwayat order (CUSTOMER melihat ordernya, DRIVER melihat order yang ditugaskan)',
        security: [{ BearerAuth: [] }],
        responses: {
          200: { description: 'Daftar order berhasil diambil.' },
        },
      },
    },
    '/api/order/{id}/accept': {
      patch: {
        summary: 'Driver menerima order yang masih PENDING',
        security: [{ BearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: {
          200: { description: 'Order berhasil diterima driver.' },
          403: { description: 'Hanya DRIVER yang bisa menerima order.' },
          409: { description: 'Order sudah diambil driver lain / tidak tersedia.' },
        },
      },
    },
    '/api/order/{id}/status': {
      patch: {
        summary: 'Mengubah status perjalanan order (driver yang ditugaskan, atau CANCELLED oleh customer/driver)',
        security: [{ BearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/UpdateOrderStatusInput' } } },
        },
        responses: {
          200: { description: 'Status order berhasil diperbarui.' },
          403: { description: 'Tidak berhak mengubah status order ini.' },
          409: { description: 'Transisi status tidak diizinkan (mis. order sudah COMPLETED).' },
        },
      },
    },
    '/api/wallet/balance': {
      get: {
        summary: 'Melihat saldo wallet milik user yang sedang login',
        security: [{ BearerAuth: [] }],
        responses: { 200: { description: 'Saldo wallet berhasil diambil.' } },
      },
    },
    '/api/wallet/transactions': {
      get: {
        summary: 'Melihat riwayat transaksi (ledger) wallet milik user yang sedang login',
        security: [{ BearerAuth: [] }],
        parameters: [
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 50 } },
          { name: 'offset', in: 'query', schema: { type: 'integer', default: 0 } },
        ],
        responses: { 200: { description: 'Riwayat transaksi berhasil diambil.' } },
      },
    },
    '/api/wallet/topup': {
      post: {
        summary: 'Menambah saldo wallet (simulasi top-up)',
        security: [{ BearerAuth: [] }],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/TopupInput' } } },
        },
        responses: { 200: { description: 'Top-up berhasil.' } },
      },
    },
    '/api/payment/charge': {
      post: {
        summary: 'Membayar order yang sudah COMPLETED menggunakan saldo wallet (khusus CUSTOMER, idempoten)',
        description: 'Memotong saldo wallet customer sebesar (harga - diskon), lalu mengkreditkan pendapatan ke wallet driver dikurangi komisi platform. Kirim `idempotencyKey` unik per percobaan agar retry jaringan tidak memotong saldo dua kali.',
        security: [{ BearerAuth: [] }],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/ChargeOrderInput' } } },
        },
        responses: {
          200: { description: 'Pembayaran berhasil diproses (atau sudah pernah diproses sebelumnya untuk idempotencyKey yang sama).' },
          400: { description: 'Order belum COMPLETED / belum ada driver.' },
          403: { description: 'Order bukan milik user ini.' },
          409: { description: 'Order sudah dibayar sebelumnya.' },
        },
      },
    },
    '/api/promo': {
      get: {
        summary: 'Melihat daftar kode promo yang sedang aktif',
        security: [{ BearerAuth: [] }],
        responses: { 200: { description: 'Daftar promo aktif berhasil diambil.' } },
      },
      post: {
        summary: 'Membuat kode promo baru (khusus ADMIN)',
        security: [{ BearerAuth: [] }],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/CreatePromoInput' } } },
        },
        responses: {
          201: { description: 'Promo berhasil dibuat.' },
          403: { description: 'Hanya ADMIN yang bisa membuat promo.' },
        },
      },
    },
    '/api/promo/validate': {
      post: {
        summary: 'Memvalidasi kode promo terhadap harga order dan menghitung potongannya',
        security: [{ BearerAuth: [] }],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/ValidatePromoInput' } } },
        },
        responses: {
          200: { description: 'Kode promo valid, mengembalikan besaran diskon.' },
          400: { description: 'Kode promo kedaluwarsa / kuota habis / order di bawah minimum.' },
          404: { description: 'Kode promo tidak ditemukan.' },
        },
      },
    },
    '/api/review': {
      post: {
        summary: 'Memberi ulasan & rating untuk driver pada order yang sudah COMPLETED (khusus CUSTOMER)',
        security: [{ BearerAuth: [] }],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/CreateReviewInput' } } },
        },
        responses: {
          201: { description: 'Ulasan berhasil dikirim.' },
          400: { description: 'Order belum COMPLETED.' },
          409: { description: 'Order ini sudah pernah diberi ulasan.' },
        },
      },
    },
    '/api/review/driver/{driverId}': {
      get: {
        summary: 'Melihat seluruh ulasan & rata-rata rating seorang driver',
        security: [{ BearerAuth: [] }],
        parameters: [{ name: 'driverId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: { 200: { description: 'Daftar ulasan & rata-rata rating berhasil diambil.' } },
      },
    },
    '/api/location/driver': {
      patch: {
        summary: 'Driver memperbarui posisi GPS-nya sendiri (disiarkan real-time via Socket.IO)',
        security: [{ BearerAuth: [] }],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/UpdateLocationInput' } } },
        },
        responses: {
          200: { description: 'Lokasi berhasil diperbarui.' },
          403: { description: 'Hanya DRIVER yang bisa memperbarui lokasi ini.' },
        },
      },
    },
    '/api/location/driver/{driverId}': {
      get: {
        summary: 'Melihat posisi terkini seorang driver (mis. untuk memantau order aktif)',
        security: [{ BearerAuth: [] }],
        parameters: [{ name: 'driverId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: { 200: { description: 'Lokasi driver berhasil diambil.' } },
      },
    },
    '/api/location/drivers/online': {
      get: {
        summary: 'Melihat seluruh driver yang sedang online (khusus ADMIN, mis. untuk dashboard peta)',
        security: [{ BearerAuth: [] }],
        responses: {
          200: { description: 'Daftar driver online berhasil diambil.' },
          403: { description: 'Hanya ADMIN yang bisa mengakses endpoint ini.' },
        },
      },
    },
    '/api/notification': {
      get: {
        summary: 'Melihat riwayat notifikasi/aktivitas milik user yang sedang login',
        security: [{ BearerAuth: [] }],
        parameters: [
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 30 } },
          { name: 'offset', in: 'query', schema: { type: 'integer', default: 0 } },
        ],
        responses: { 200: { description: 'Notifikasi berhasil diambil.' } },
      },
    },
    '/api/merchant': {
      get: {
        summary: 'Melihat daftar merchant kuliner/belanja sekitar Malang-Batu',
        security: [{ BearerAuth: [] }],
        parameters: [
          { name: 'category', in: 'query', schema: { type: 'string' }, example: 'Kuliner' },
          { name: 'isOpen', in: 'query', schema: { type: 'boolean' } },
        ],
        responses: { 200: { description: 'Daftar merchant berhasil diambil.' } },
      },
      post: {
        summary: 'Membuat merchant baru (khusus ADMIN)',
        security: [{ BearerAuth: [] }],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/CreateMerchantInput' } } },
        },
        responses: {
          201: { description: 'Merchant berhasil dibuat.' },
          403: { description: 'Hanya ADMIN yang bisa membuat merchant.' },
        },
      },
    },
    '/api/merchant/me': {
      get: {
        summary: 'Melihat data toko milik akun MERCHANT yang sedang login',
        security: [{ BearerAuth: [] }],
        responses: {
          200: { description: 'Data toko berhasil diambil.' },
          403: { description: 'Hanya role MERCHANT yang bisa mengakses endpoint ini.' },
          404: { description: 'Akun ini belum memiliki toko terdaftar.' },
        },
      },
    },
    '/api/merchant/{id}': {
      get: {
        summary: 'Melihat detail merchant beserta daftar menunya',
        security: [{ BearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: {
          200: { description: 'Detail merchant berhasil diambil.' },
          404: { description: 'Merchant tidak ditemukan.' },
        },
      },
      patch: {
        summary: 'Memperbarui data merchant (ADMIN untuk semua toko, atau MERCHANT untuk tokonya sendiri)',
        security: [{ BearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/UpdateMerchantInput' } } },
        },
        responses: {
          200: { description: 'Merchant berhasil diperbarui.' },
          403: { description: 'Hanya ADMIN yang bisa memperbarui merchant.' },
          404: { description: 'Merchant tidak ditemukan.' },
        },
      },
    },
    '/api/merchant/{id}/menu': {
      post: {
        summary: 'Menambahkan menu/produk baru ke merchant (khusus ADMIN)',
        security: [{ BearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/AddMenuItemInput' } } },
        },
        responses: {
          201: { description: 'Menu berhasil ditambahkan.' },
          403: { description: 'Hanya ADMIN yang bisa menambah menu.' },
          404: { description: 'Merchant tidak ditemukan.' },
        },
      },
    },
    '/api/merchant/menu/{itemId}': {
      patch: {
        summary: 'Memperbarui menu/produk milik merchant (khusus ADMIN)',
        security: [{ BearerAuth: [] }],
        parameters: [{ name: 'itemId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/UpdateMenuItemInput' } } },
        },
        responses: {
          200: { description: 'Menu berhasil diperbarui.' },
          403: { description: 'Hanya ADMIN yang bisa memperbarui menu.' },
          404: { description: 'Menu item tidak ditemukan.' },
        },
      },
    },
    '/api/upload/image': {
      post: {
        summary: 'Upload gambar (bukti bayar / dokumen driver) — multipart/form-data, field "image"',
        security: [{ BearerAuth: [] }],
        requestBody: {
          required: true,
          content: { 'multipart/form-data': { schema: { type: 'object', properties: { image: { type: 'string', format: 'binary' } } } } },
        },
        responses: { 201: { description: 'Upload berhasil, mengembalikan { url }.' } },
      },
    },
    '/api/payment/confirm-cash': {
      post: {
        summary: 'Driver konfirmasi cash sudah diterima dari customer (order paymentMethod=CASH)',
        security: [{ BearerAuth: [] }],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object', required: ['orderId'], properties: { orderId: { type: 'string', format: 'uuid' } } } } },
        },
        responses: {
          200: { description: 'Cash dikonfirmasi, komisi platform dipotong dari deposit driver.' },
          403: { description: 'Saldo deposit driver tidak cukup untuk menutup komisi.' },
        },
      },
    },
    '/api/payment/proof': {
      post: {
        summary: 'Customer upload bukti bayar manual (QRIS/Transfer/E-Wallet)',
        security: [{ BearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['orderId', 'method', 'proofImageUrl'],
                properties: {
                  orderId: { type: 'string', format: 'uuid' },
                  method: { type: 'string', enum: ['QRIS', 'TRANSFER', 'EWALLET'] },
                  proofImageUrl: { type: 'string' },
                  note: { type: 'string' },
                },
              },
            },
          },
        },
        responses: { 201: { description: 'Bukti bayar berhasil diupload, menunggu peninjauan Admin.' } },
      },
    },
    '/api/payment/proof/pending': {
      get: {
        summary: 'Daftar bukti bayar yang menunggu ditinjau (khusus ADMIN)',
        security: [{ BearerAuth: [] }],
        responses: { 200: { description: 'Daftar bukti bayar pending.' } },
      },
    },
    '/api/payment/proof/{proofId}/review': {
      patch: {
        summary: 'Admin menyetujui/menolak bukti bayar manual',
        security: [{ BearerAuth: [] }],
        parameters: [{ name: 'proofId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['status'],
                properties: { status: { type: 'string', enum: ['APPROVED', 'REJECTED'] }, reviewNote: { type: 'string' } },
              },
            },
          },
        },
        responses: { 200: { description: 'Bukti bayar ditinjau; kalau APPROVED, pendapatan driver dikreditkan.' } },
      },
    },
    '/api/driver/documents': {
      post: {
        summary: 'Driver upload dokumen verifikasi (KTP+selfie / STNK) — pakai URL dari /api/upload/image',
        security: [{ BearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['type', 'imageUrl'],
                properties: { type: { type: 'string', enum: ['KTP_SELFIE', 'STNK'] }, imageUrl: { type: 'string' } },
              },
            },
          },
        },
        responses: { 201: { description: 'Dokumen berhasil diupload, menunggu peninjauan Admin.' } },
      },
    },
    '/api/driver/documents/me': {
      get: {
        summary: 'Driver melihat status dokumen verifikasinya sendiri',
        security: [{ BearerAuth: [] }],
        responses: { 200: { description: 'Daftar dokumen & status verifikasi driver.' } },
      },
    },
    '/api/admin/driver-documents/pending': {
      get: {
        summary: 'Daftar dokumen driver yang menunggu ditinjau (khusus ADMIN)',
        security: [{ BearerAuth: [] }],
        responses: { 200: { description: 'Daftar dokumen pending.' } },
      },
    },
    '/api/admin/driver-documents/{documentId}/review': {
      patch: {
        summary: 'Admin menyetujui/menolak dokumen verifikasi driver',
        security: [{ BearerAuth: [] }],
        parameters: [{ name: 'documentId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['status'],
                properties: { status: { type: 'string', enum: ['APPROVED', 'REJECTED'] }, reviewNote: { type: 'string' } },
              },
            },
          },
        },
        responses: { 200: { description: 'Dokumen ditinjau.' } },
      },
    },
  },
};
