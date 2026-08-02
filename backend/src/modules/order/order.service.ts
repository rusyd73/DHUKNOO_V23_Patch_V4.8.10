import { OrderStatus } from '@prisma/client';
import { OrderRepository } from './order.repository';
import { PromoService } from '../promo/promo.service';
import { TariffEngineService } from '../tariff/tariff.service';
import { prisma } from '../../config/prisma';
import { DispatchService } from '../dispatch/dispatch.service';
import { DispatchScheduler } from '../dispatch/dispatch.scheduler';
import { DispatchState } from '../dispatch/dispatch.state';
import { AppError, ForbiddenError, NotFoundError } from '../../core/errors/AppError';
import { SocketService } from '../../websocket/socket';
import { AuditLogger } from '../../core/logging/audit.logger';
import { PaymentService } from '../payment/payment.service';
import { logger } from '../../config/logger';

interface CreateOrderInput {
  serviceType: 'BIKE' | 'CAR' | 'SEND';
  distanceKm: number;
  pickupAddress: string;
  pickupLat: number;
  pickupLng: number;
  dropoffAddress: string;
  dropoffLat: number;
  dropoffLng: number;
  zoneName?: string;
  waitMinutes?: number;
  hasToll?: boolean;
  hasParking?: boolean;
  isBadWeather?: boolean;
  isHoliday?: boolean;
  promoCode?: string;
  paymentMethod?: 'WALLET' | 'CASH' | 'QRIS' | 'TRANSFER' | 'EWALLET';
}

// Transisi status yang SAH untuk driver — mencegah lompat status (mis. ACCEPTED
// -> COMPLETED langsung tanpa lewat ON_THE_WAY/ARRIVED). CANCELLED punya jalur
// otorisasi sendiri (customer/driver/admin, dengan window 60 detik untuk
// customer) — divalidasi terpisah di updateStatus(), bukan lewat tabel ini.
const ALLOWED_DRIVER_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  PENDING: [],
  ACCEPTED: [OrderStatus.ON_THE_WAY],
  ON_THE_WAY: [OrderStatus.ARRIVED],
  ARRIVED: [OrderStatus.COMPLETED],
  COMPLETED: [],
  CANCELLED: [],
};

export class OrderService {
  private orderRepo = new OrderRepository();
  private promoService = new PromoService();
  private tariffEngine = new TariffEngineService();
  private dispatchService = new DispatchService();
  private paymentService = new PaymentService();

  async createOrder(userId: string, input: CreateOrderInput) {
    const customerProfile = await this.orderRepo.findCustomerProfileByUserId(userId);
    if (!customerProfile) {
      throw new ForbiddenError('Hanya pengguna terdaftar sebagai CUSTOMER yang bisa membuat order!');
    }

    // CEGAH DUPLICATE ORDER: customer tidak boleh punya order baru selama order
    // sebelumnya belum selesai (masih PENDING/ACCEPTED/ON_THE_WAY/ARRIVED).
    // Sebelumnya tidak ada guard sama sekali di sini — customer bisa terus
    // membuat order baru berkali-kali walau order pertama belum kelar.
    const existingActiveOrder = await prisma.order.findFirst({
      where: {
        customerId: customerProfile.id,
        status: { in: [OrderStatus.PENDING, OrderStatus.ACCEPTED, OrderStatus.ON_THE_WAY, OrderStatus.ARRIVED] },
      },
      select: { id: true, status: true },
    });
    if (existingActiveOrder) {
      throw new AppError(
        `Anda masih punya order yang belum selesai (#${existingActiveOrder.id.slice(0, 8)}, status ${existingActiveOrder.status}). Selesaikan atau batalkan order itu dulu sebelum membuat order baru.`,
        409
      );
    }

    // 1. Hitung subtotal dulu TANPA promo (Tarif Dasar + Pickup + Perjalanan + Tunggu + Tol + Parkir + Cuaca + Hari Libur)
    //    lewat Tariff Engine — harga TIDAK PERNAH dipercaya dari input client demi keamanan (client hanya
    //    mengirim jarak & kondisi perjalanan, bukan nominal rupiah).
    const preDiscount = await this.tariffEngine.calculateFare({
      serviceType: input.serviceType,
      distanceKm: input.distanceKm,
      zoneName: input.zoneName,
      waitMinutes: input.waitMinutes,
      hasToll: input.hasToll,
      hasParking: input.hasParking,
      isBadWeather: input.isBadWeather,
      isHoliday: input.isHoliday,
      promoDiscount: 0,
    });
    const subtotal = preDiscount.finalFare;

    // 2. Kalau ada kode promo, hitung potongannya berdasarkan subtotal itu
    let discount = 0;
    let promoId: string | undefined;
    if (input.promoCode) {
      const promoResult = await this.promoService.validateAndPreview(input.promoCode, subtotal);
      discount = promoResult.discount;
      promoId = promoResult.promo.id;
    }

    // 3. Hitung ULANG breakdown final dengan promo dimasukkan, supaya commissionRate/driverEarning
    //    dihitung dari nilai order YANG BENAR-BENAR DITAGIH (setelah promo), sesuai tier komisi.
    const finalBreakdown = await this.tariffEngine.calculateFare({
      serviceType: input.serviceType,
      distanceKm: input.distanceKm,
      zoneName: input.zoneName,
      waitMinutes: input.waitMinutes,
      hasToll: input.hasToll,
      hasParking: input.hasParking,
      isBadWeather: input.isBadWeather,
      isHoliday: input.isHoliday,
      promoDiscount: discount,
    });

    // 4. Simpan order dengan status PENDING ("mencari driver" — TIDAK ada state
    //    terpisah "SEARCHING_DRIVER" di schema, PENDING sudah merepresentasikan itu).
    const order = await this.orderRepo.create({
      serviceType: input.serviceType,
      status: OrderStatus.PENDING,
      price: subtotal,
      discount,
      ...(promoId ? { promo: { connect: { id: promoId } } } : {}),
      pickupAddress: input.pickupAddress,
      pickupLat: input.pickupLat,
      pickupLng: input.pickupLng,
      dropoffAddress: input.dropoffAddress,
      dropoffLat: input.dropoffLat,
      dropoffLng: input.dropoffLng,
      distanceKm: input.distanceKm,
      paymentMethod: input.paymentMethod || 'WALLET',
      customer: { connect: { id: customerProfile.id } },
    });

    if (promoId) {
      await this.promoService.markUsed(promoId);
    }

    // 5. Simpan breakdown lengkap sebagai jejak audit permanen (tidak berubah walau
    //    PricingRule/TariffVersion diedit Admin di kemudian hari).
    await this.tariffEngine.recordPricingHistory(order.id, finalBreakdown);

    await AuditLogger.log(userId, 'CREATE_ORDER', `Membuat order ${order.serviceType} #${order.id} senilai Rp${order.price}`);

    // 6. Realtime: beri tahu semua driver yang sedang online & memantau pool lowongan,
    //    DAN jalankan Dispatch Engine (penawaran berurutan ke driver terdekat lebih dulu).
    //    Best-effort — kegagalan di sini TIDAK BOLEH membatalkan order yang sudah tersimpan.
    let dispatch;
    try {
      SocketService.emitToDriversPool('new_order_available', {
        orderId: order.id,
        serviceType: order.serviceType,
        pickupAddress: order.pickupAddress,
        dropoffAddress: order.dropoffAddress,
        price: order.price,
      });
      SocketService.emitToAdmins('order_created', { orderId: order.id, serviceType: order.serviceType });

      // AUTO-ACCEPT: dicek DI SINI (bukan cuma di sequential dispatch offer)
      // supaya berlaku untuk SIAPAPUN driver online yang mengaktifkannya —
      // bukan cuma driver yang kebetulan dapat giliran pertama di antrean
      // sequential-offer. Sebelumnya auto-accept hanya diperiksa di dalam
      // DispatchService.offerNextDriver(), yang percuma kalau driver lebih
      // dulu tap manual dari job pool (daftar order PENDING yang tampil ke
      // SEMUA driver online sekaligus, tidak tahu-menahu soal antrean
      // dispatch) — itulah sebabnya auto-accept "tidak berjalan".
      const autoAccepted = await this.tryAutoAcceptOnCreation(order.id, order.serviceType);

      if (!autoAccepted) {
        dispatch = await this.dispatchService.dispatch({ order });
      } else {
        dispatch = { status: 'AUTO_ACCEPTED' as const };
      }
    } catch (err: any) {
      // Dispatch Engine gagal (mis. tidak ada driver online) — order tetap valid,
      // driver tetap bisa mengambilnya manual lewat /api/driver/jobs.
      //
      // PERBAIKAN: sebelumnya error di sini DIBUANG TOTAL TANPA LOG SAMA SEKALI --
      // kalau auto-accept/dispatch gagal karena bug (bukan cuma "tidak ada driver
      // online"), tidak ada jejak sama sekali untuk didiagnosis kenapa "auto accept
      // gagal". Sekarang errornya tetap di-log (tidak melempar ulang, supaya order
      // tetap valid & bisa diambil manual), supaya penyebab asli kegagalan terlihat.
      logger.error(`[AUTO-ACCEPT/DISPATCH] Gagal memproses order ${order.id}: ${err?.message || err}`);
      dispatch = null;
    }

    return { order, breakdown: finalBreakdown, dispatch };
  }

  /**
   * Cari SATU driver online yang: terverifikasi penuh, serviceType cocok,
   * mengaktifkan auto-accept, dan sedang tidak punya order aktif — kalau ada,
   * langsung assign order ini ke dia (atomic lewat claimOrder yang sama
   * dipakai jalur manual, jadi tetap aman dari race condition). Dipanggil
   * SEBELUM Dispatch Engine sequential-offer, supaya auto-accept berlaku ke
   * SIAPAPUN driver online yang mengaktifkannya, bukan cuma yang kebetulan
   * dapat giliran pertama di antrean.
   */
  private async tryAutoAcceptOnCreation(orderId: string, serviceType: string): Promise<boolean> {
    logger.info(`[AUTO-ACCEPT-ON-CREATE] order ${orderId}: mengecek kandidat auto-accept untuk serviceType=${serviceType}...`);
    const candidates = await prisma.driverProfile.findMany({
      where: {
        isOnline: true,
        isVerified: true,
        autoAcceptEnabled: true,
        // PENGECUALIAN: order layanan SEND (kirim barang) TIDAK memakai
        // klasifikasi -- siapa saja driver online (BIKE/CAR/SEND) yang
        // autoAcceptEnabled berhak jadi kandidat auto-accept order SEND.
        ...(serviceType === 'SEND' ? {} : { serviceType: serviceType as any }),
        latitude: { not: null },
        longitude: { not: null },
        // BEKUKAN driver yang punya order CASH COMPLETED tapi belum
        // dikonfirmasi lunas -- tidak boleh dapat order baru sampai
        // mereka konfirmasi uang tunai sudah diterima.
        orders: {
          none: {
            status: 'COMPLETED',
            paymentMethod: 'CASH',
            isPaid: false,
          },
        },
      },
      select: { id: true, userId: true, latitude: true, longitude: true },
    });

    if (candidates.length === 0) {
      logger.info(`[AUTO-ACCEPT-ON-CREATE] order ${orderId} (${serviceType}): 0 kandidat driver (autoAcceptEnabled+online+verified+lat/lng+bebas-freeze) -- lanjut ke Dispatch Engine biasa.`);
      return false;
    }

    // Saring driver yang sedang punya order aktif (tidak boleh dobel job).
    const busyDriverIds = new Set(
      (
        await prisma.order.findMany({
          where: { driverId: { in: candidates.map((c) => c.id) }, status: { in: ['ACCEPTED', 'ON_THE_WAY', 'ARRIVED'] } },
          select: { driverId: true },
        })
      ).map((o) => o.driverId)
    );

    const freeCandidates = candidates.filter((c) => !busyDriverIds.has(c.id));
    if (freeCandidates.length === 0) {
      logger.info(`[AUTO-ACCEPT-ON-CREATE] order ${orderId}: ${candidates.length} kandidat ditemukan tapi SEMUA sedang sibuk (order aktif lain) -- lanjut ke Dispatch Engine biasa.`);
      return false;
    }

    // Pilih yang pertama (cukup untuk fitur opsional ini — tidak perlu
    // hitung jarak presisi seperti Dispatch Engine utama).
    const chosen = freeCandidates[0];

    logger.info(`[AUTO-ACCEPT-ON-CREATE] order ${orderId}: mencoba klaim otomatis untuk driver ${chosen.id} (dari ${freeCandidates.length} kandidat bebas)...`);

    const claim = await this.orderRepo.claimOrder(orderId, chosen.id);
    if (claim.count === 0) {
      logger.warn(`[AUTO-ACCEPT-ON-CREATE] order ${orderId}: claimOrder gagal (count=0) -- race condition, order sudah diambil pihak lain. Lanjut ke Dispatch Engine biasa.`);
      return false; // race — biarkan Dispatch Engine biasa yang lanjut menawarkan
    }

    logger.info(`[AUTO-ACCEPT-ON-CREATE] order ${orderId}: BERHASIL diklaim otomatis oleh driver ${chosen.id}!`);

    await prisma.order.update({ where: { id: orderId }, data: { acceptedAt: new Date() } });

    const updatedOrder = await this.orderRepo.findById(orderId);
    if (updatedOrder) {
      try {
        SocketService.emitToOrder(orderId, 'order_status_changed', {
          orderId,
          status: updatedOrder.status,
          driverId: chosen.id,
        });
        SocketService.emitToUser((updatedOrder as any).customer.userId, 'order_accepted', {
          orderId,
          driverId: chosen.id,
        });
        SocketService.emitToUser(chosen.userId, 'order_accepted', { orderId, autoAccepted: true });
        SocketService.emitToDriversPool('order_taken', { orderId });
        SocketService.emitToAdmins('order_accepted', { orderId });
      } catch {
        // Socket.IO belum siap — abaikan.
      }
    }

    return true;
  }

  async listForUser(userId: string) {
    const customerProfile = await this.orderRepo.findCustomerProfileByUserId(userId);
    if (customerProfile) {
      const orders = await this.orderRepo.listForCustomer(customerProfile.id);
      return { role: 'CUSTOMER' as const, orders };
    }

    const driverProfile = await this.orderRepo.findDriverProfileByUserId(userId);
    if (driverProfile) {
      const orders = await this.orderRepo.listForDriver(driverProfile.id);
      return { role: 'DRIVER' as const, orders };
    }

    throw new NotFoundError('Profil tidak ditemukan!');
  }

  /** Dipakai oleh /api/driver/jobs — order PENDING + order yang sudah ditugaskan ke driver ini. */
  async listAvailableJobsForDriver(userId: string) {
    const driverProfile = await this.orderRepo.findDriverProfileByUserId(userId);
    if (!driverProfile) {
      throw new NotFoundError('Profil driver tidak ditemukan!');
    }
    return this.orderRepo.listAvailableAndAssignedToDriver(driverProfile.id);
  }

  /**
   * Terima order — jalur REST resmi (dipakai juga oleh alias /api/driver/jobs/:id/accept).
   * Atomic lewat `claimOrder` (updateMany dengan guard status:PENDING), jadi aman dari race
   * condition dua driver menerima order yang sama nyaris bersamaan, TANPA perlu driver ini
   * jadi "penerima offer aktif" di Dispatch Engine — order tetap bisa diambil manual kalau
   * dispatch sequential-offer belum/tidak menjangkau driver ini.
   */
  async acceptOrder(userId: string, orderId: string) {
    const driverProfile = await this.orderRepo.findDriverProfileByUserId(userId);
    if (!driverProfile) {
      throw new ForbiddenError('Hanya driver terdaftar yang bisa menerima order!');
    }
    if (!driverProfile.isVerified) {
      throw new ForbiddenError('Akun driver Anda belum diverifikasi Admin!');
    }

    // Gerbang deposit: sama seperti /api/driver/jobs/:id/accept — lihat catatan di sana.
    const driverWallet = await prisma.wallet.findUnique({ where: { userId } });
    const minimumDeposit = await this.tariffEngine.getMinimumDriverDeposit();
    const currentBalance = Number(driverWallet?.balance || 0);

    if (currentBalance < minimumDeposit) {
      throw new AppError(
        `Saldo deposit Anda (Rp${currentBalance.toLocaleString('id-ID')}) belum memenuhi minimum Rp${minimumDeposit.toLocaleString('id-ID')} untuk bisa menerima order. Silakan top up dulu.`,
        403
      );
    }

    // BEKUKAN: driver yang punya order CASH sebelumnya sudah COMPLETED tapi
    // BELUM dikonfirmasi lunas (isPaid masih false) tidak boleh menerima
    // order baru apa pun sampai mereka konfirmasi uang tunai sudah diterima
    // lewat /api/payment/confirm-cash.
    const unconfirmedCash = await prisma.order.findFirst({
      where: { driverId: driverProfile.id, status: 'COMPLETED', paymentMethod: 'CASH', isPaid: false },
      select: { id: true },
    });
    if (unconfirmedCash) {
      throw new ForbiddenError(
        `Anda masih punya pembayaran CASH order #${unconfirmedCash.id} yang belum dikonfirmasi diterima. Konfirmasi dulu sebelum bisa menerima order baru.`
      );
    }

    // KUNCI KLASIFIKASI: driver motor tidak boleh ambil order mobil, dan
    // sebaliknya — dicek terhadap jenis layanan yang didaftarkan driver ini.
    //
    // PENGECUALIAN: order layanan SEND (kirim barang) TIDAK memakai
    // klasifikasi -- driver BIKE maupun CAR yang online boleh langsung
    // menerima order SEND, tanpa perlu serviceType profil mereka SEND.
    const orderToClaim = await prisma.order.findUnique({ where: { id: orderId }, select: { serviceType: true } });
    if (!orderToClaim) {
      throw new NotFoundError('Order tidak ditemukan!');
    }
    if (orderToClaim.serviceType !== 'SEND' && orderToClaim.serviceType !== (driverProfile as any).serviceType) {
      throw new ForbiddenError(
        `Order ini untuk layanan ${orderToClaim.serviceType}, sedangkan akun Anda terdaftar sebagai driver ${(driverProfile as any).serviceType}.`
      );
    }

    const claim = await this.orderRepo.claimOrder(orderId, driverProfile.id);
    if (claim.count === 0) {
      throw new AppError('Order ini sudah diambil driver lain atau tidak tersedia lagi!', 409);
    }

    // Catat waktu accept — dasar hitung window cancel 60 detik customer di updateStatus().
    await prisma.order.update({
      where: { id: orderId },
      data: { acceptedAt: new Date() },
    });

    const updatedOrder = await this.orderRepo.findById(orderId);
    if (!updatedOrder) {
      throw new NotFoundError('Order tidak ditemukan!');
    }

    // Hentikan sequential-offer Dispatch Engine untuk order ini (kalau sedang berjalan) —
    // order sudah diambil lewat jalur manual, tidak perlu terus menawari driver lain.
    // DispatchState turut dibersihkan supaya tidak ada sesi dispatch basi yang nyangkut
    // menunjuk ke driver yang sudah tidak relevan lagi.
    DispatchScheduler.cancel(orderId);
    DispatchState.clear(orderId);

    await AuditLogger.log(userId, 'DRIVER_ACCEPT_ORDER', `Driver menerima order #${orderId}`);

    // Realtime: customer langsung dapat notifikasi "driver diterima" tanpa refresh,
    // dan order dihapus dari pool lowongan driver lain.
    try {
      SocketService.emitToOrder(orderId, 'order_status_changed', {
        orderId,
        status: updatedOrder.status,
        driverId: driverProfile.id,
      });
      SocketService.emitToUser((updatedOrder as any).customer.userId, 'order_accepted', {
        orderId,
        driverId: driverProfile.id,
      });
      SocketService.emitToDriversPool('order_taken', { orderId });
      SocketService.emitToAdmins('order_accepted', { orderId });
    } catch {
      // Socket.IO belum siap — abaikan.
    }

    return updatedOrder;
  }

  /**
   * Mengubah status perjalanan SAJA — tidak pernah menyentuh wallet/pembayaran.
   * Pembayaran hanya boleh terjadi lewat modul Payment (`/api/payment/charge`)
   * yang idempoten & menghitung komisi platform dengan benar.
   *
   * Rule transisi:
   *   Driver : ACCEPTED -> ON_THE_WAY -> ARRIVED -> COMPLETED
   *   Customer/Driver : boleh CANCEL selama belum ARRIVED (driver belum tiba)
   *
   * NOTE: status di atas memakai OrderStatus yang SUNGGUH ADA di schema.prisma.
   * Versi sebelumnya sempat mengetik ARRIVED_PICKUP/IN_PROGRESS — nama status hasil
   * rencana refactor yang tidak pernah dimigrasikan ke database, jadi diselaraskan
   * kembali ke enum asli di sini (lihat juga job.routes.ts, order.repository.ts).
   */
  async updateStatus(userId: string, orderId: string, status: 'ON_THE_WAY' | 'ARRIVED' | 'COMPLETED' | 'CANCELLED') {
    const order = await this.orderRepo.findById(orderId);
    if (!order) {
      throw new NotFoundError('Order tidak ditemukan!');
    }

    const isAssignedDriver = (order as any).driver?.userId === userId;
    const isOwningCustomer = (order as any).customer.userId === userId;

    if (status === 'CANCELLED') {
      if (!isAssignedDriver && !isOwningCustomer) {
        throw new ForbiddenError('Anda tidak berhak membatalkan order ini!');
      }
      if (order.status === 'COMPLETED') {
        throw new AppError('Order yang sudah selesai tidak bisa dibatalkan!', 409);
      }

      // ATURAN: customer hanya boleh cancel GRATIS dalam 60 detik pertama sejak
      // driver menerima order (order.acceptedAt). Driver/Admin tidak kena batas ini.
      if (isOwningCustomer && !isAssignedDriver && (order as any).acceptedAt) {
        const elapsedSeconds = (Date.now() - new Date((order as any).acceptedAt).getTime()) / 1000;
        const CANCEL_WINDOW_SECONDS = 60;
        if (elapsedSeconds > CANCEL_WINDOW_SECONDS) {
          throw new AppError(
            `Waktu pembatalan gratis (${CANCEL_WINDOW_SECONDS} detik setelah driver menerima order) sudah habis. Silakan hubungi driver langsung.`,
            403
          );
        }
      }
    } else {
      // Transisi non-cancel hanya boleh driver yang ditugaskan, dan harus
      // mengikuti urutan yang sah (tidak boleh lompat status).
      if (!isAssignedDriver) {
        throw new ForbiddenError('Hanya driver yang ditugaskan yang bisa mengubah status ini!');
      }
      const allowedNext = ALLOWED_DRIVER_TRANSITIONS[order.status] ?? [];
      if (!allowedNext.includes(status as OrderStatus)) {
        throw new AppError(`Status ${order.status} tidak boleh diubah langsung menjadi ${status}.`, 400);
      }
    }

    // Update ATOMIC — updateMany dengan guard status lama mencegah race condition
    // (mis. driver selesaikan trip & customer cancel di saat yang nyaris bersamaan
    // saling menimpa perubahan satu sama lain).
    const result = await prisma.order.updateMany({
      where: { id: orderId, status: order.status },
      data: { status: status as OrderStatus },
    });

    if (result.count === 0) {
      throw new AppError('Status order sudah berubah oleh proses lain. Silakan muat ulang data.', 409);
    }

    const updatedOrder = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });

    // Kalau order dibatalkan SEBELUM ada driver yang menerima (masih PENDING),
    // hentikan juga Dispatch Engine supaya tidak terus menawari order yang sudah
    // dibatalkan ke driver berikutnya dalam antrean.
    if (status === 'CANCELLED' && order.status === 'PENDING') {
      DispatchScheduler.cancel(orderId);
      DispatchState.clear(orderId);
    }

    await AuditLogger.log(
      userId,
      isOwningCustomer && status === 'CANCELLED' ? 'CUSTOMER_CANCEL_ORDER' : 'ORDER_STATUS_UPDATE',
      `Order #${orderId} status diubah menjadi ${status}`
    );

    // Realtime: setiap perubahan status (ON_THE_WAY / ARRIVED / COMPLETED / CANCELLED)
    // langsung disiarkan ke customer & driver yang terlibat, tanpa perlu refresh manual.
    try {
      const recipients = [(order as any).customer.userId, (order as any).driver?.userId].filter(Boolean) as string[];
      SocketService.emitToOrder(orderId, 'order_status_changed', { orderId, status });
      recipients.forEach((uid) => SocketService.emitToUser(uid, 'order_status_changed', { orderId, status }));

      if (status === 'COMPLETED') {
        SocketService.emitToOrder(orderId, 'order_completed', { orderId });
        recipients.forEach((uid) => SocketService.emitToUser(uid, 'order_completed', { orderId }));
      }
      if (status === 'CANCELLED') {
        SocketService.emitToOrder(orderId, 'order_cancelled', { orderId });
        recipients.forEach((uid) => SocketService.emitToUser(uid, 'order_cancelled', { orderId }));
      }
      SocketService.emitToAdmins('order_status_changed', { orderId, status });
    } catch {
      // Socket.IO belum siap — abaikan.
    }

    // PERBAIKAN: order dengan metode bayar WALLET (saldo) harus AUTO DEBET begitu
    // trip selesai (COMPLETED) — customer TIDAK perlu klik tombol "Bayar Sekarang"
    // manual lagi. Metode lain (CASH/QRIS/TRANSFER/EWALLET) tetap lewat jalur
    // masing-masing (konfirmasi cash oleh driver / upload bukti oleh customer).
    // Kegagalan auto-debet (mis. saldo wallet tidak cukup) TIDAK menggagalkan
    // penyelesaian trip -- order tetap COMPLETED, customer diberi tahu lewat
    // event realtime supaya bisa top-up & bayar manual lewat jalur biasa.
    if (status === 'COMPLETED' && (updatedOrder as any).paymentMethod === 'WALLET' && !(updatedOrder as any).isPaid) {
      try {
        await this.paymentService.chargeOrder(
          (order as any).customer.userId,
          orderId,
          `auto-wallet-${orderId}`
        );
      } catch (err: any) {
        try {
          SocketService.emitToUser((order as any).customer.userId, 'auto_debit_failed', {
            orderId,
            error: err?.message || 'Auto debet saldo wallet gagal. Silakan cek saldo Anda.',
          });
        } catch {
          // Socket.IO belum siap — abaikan.
        }
      }
    }

    return updatedOrder;
  }

  /** Membangun struk HTML perjalanan — tidak mengirim email, aman dipanggil berkali-kali. */
  async buildReceipt(userId: string, orderId: string) {
    const order = await this.orderRepo.findById(orderId);
    if (!order) throw new NotFoundError('Order tidak ditemukan!');

    const isOwningCustomer = (order.customer as any).userId === userId;
    if (!isOwningCustomer) {
      throw new ForbiddenError('Anda hanya bisa melihat struk untuk order milik Anda sendiri!');
    }
    if (!order.isPaid) {
      throw new AppError('Struk hanya tersedia untuk order yang sudah lunas!', 400);
    }

    const { buildReceiptHtml } = await import('./receipt.util');
    const html = buildReceiptHtml(order as any);
    return { order, html };
  }

  /** Membangun & MENGIRIM struk lewat email (best-effort, tidak error kalau SMTP belum disetel). */
  async sendReceipt(userId: string, orderId: string) {
    const { order, html } = await this.buildReceipt(userId, orderId);

    const { MailerService } = await import('../../config/mailer');
    const sent = await MailerService.sendReceiptEmail(
      order.customer.user.email,
      `Struk Perjalanan DHUKNOO #${order.id.slice(0, 8)}`,
      html
    );

    return { sent, receiptHtml: html };
  }

  /**
   * Riwayat chat customer<->driver untuk sebuah order — dipanggil OrderChatBox
   * saat mount, supaya percakapan yang sudah terjadi tidak hilang begitu salah
   * satu pihak refresh/tutup layar (sebelumnya chat murni relay socket, tidak
   * pernah disimpan sama sekali).
   */
  async getChatHistory(userId: string, orderId: string) {
    const order = await this.orderRepo.findById(orderId) as any;
    if (!order) throw new NotFoundError('Order tidak ditemukan!');

    const isOwningCustomer = order.customer?.userId === userId;
    const isAssignedDriver = order.driver?.userId === userId;
    if (!isOwningCustomer && !isAssignedDriver) {
      throw new ForbiddenError('Anda tidak berhak melihat chat order ini!');
    }

    const messages = await prisma.chatMessage.findMany({
      where: { orderId },
      orderBy: { createdAt: 'asc' },
      take: 200, // batas wajar per order — chat per-trip biasanya singkat
    });

    return messages.map((m) => ({
      sender: m.senderId,
      senderRole: m.senderRole,
      message: m.message,
      sentAt: m.createdAt.toISOString(),
    }));
  }
}
