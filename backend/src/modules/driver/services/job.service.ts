import { prisma } from '../../../config/prisma';
import { Prisma } from '@prisma/client';
import { AppError, NotFoundError } from '../../../core/errors/AppError';
import { TariffEngineService } from '../../tariff/tariff.service';
import { DriverEligibilityService } from './driver-eligibility.service';
import { logger } from '../../../config/logger';

export class JobService {
  private tariffEngine = new TariffEngineService();
  private eligibilityService = new DriverEligibilityService();

  // ============================================================
  // 🔒 GET ELIGIBLE JOBS
  // ============================================================
  async getEligibleJobs(driverId: string, limit: number, offset: number) {
    // 1. Ambil data driver
    const driver = await prisma.driverProfile.findUnique({
      where: { userId: driverId },
      include: { user: true },
    });

    if (!driver) {
      throw new NotFoundError('Driver not found');
    }

    if (!driver.user?.isActive) {
      throw new AppError('Account not active', 403, true, 'DRIVER_ACCOUNT_INACTIVE');
    }

    if (!driver.isVerified) {
      throw new AppError('Driver not verified', 403, true, 'DRIVER_NOT_VERIFIED');
    }

    // P0 DRIVER TRIP LIFECYCLE: assigned orders must always be recoverable.
    const activeOrders = await prisma.order.findMany({
      where: { driverId: driver.id, status: { in: ['ACCEPTED', 'ON_THE_WAY', 'ARRIVED', 'PICKED_UP', 'ARRIVED_CUSTOMER'] } },
      include: {
        customer: { select: { id: true, phoneNumber: true, user: { select: { fullName: true, email: true } } } },
        driver: { include: { user: { select: { fullName: true } } } },
        merchant: { select: { id: true, name: true, address: true } },
        orderItems: true,
      },
      orderBy: { acceptedAt: 'desc' },
    });
    const activeJobs = activeOrders.map((order: any) => ({ ...order }));
    if (activeJobs.length > 0) {
      logger.info(`[P0] Restored ${activeJobs.length} active order(s) for driver ${driver.id}`);
    }

    // Completed CASH orders that still need driver confirmation must remain
    // visible after the active trip disappears from the lifecycle.
    const outstandingCashOrders = await prisma.order.findMany({
      where: { driverId: driver.id, status: 'COMPLETED', paymentMethod: 'CASH', isPaid: false },
      include: {
        customer: { select: { id: true, phoneNumber: true, user: { select: { fullName: true, email: true } } } },
        driver: { include: { user: { select: { fullName: true } } } },
        merchant: { select: { id: true, name: true, address: true } },
        orderItems: true,
      },
      orderBy: { updatedAt: 'desc' },
      take: 20,
    });

    // 🆕 FIX P0 "Availability state machine" (audit driver-jobs): kode
    // error stabil 'DRIVER_OFFLINE' -- lihat komentar lengkap di
    // AppError.ts dan job.routes.ts (consumer-nya).
    if (!driver.isOnline && activeJobs.length === 0) {
      throw new AppError('Driver is offline', 403, true, 'DRIVER_OFFLINE');
    }

    // 2. Dapatkan minimum deposit
    const minimumDeposit = await this.tariffEngine.getMinimumDriverDeposit();

    // 3. Cek saldo driver
    const wallet = await prisma.wallet.findUnique({
      where: { userId: driverId },
    });
    const balance = Number(wallet?.balance || 0);

    // Saldo minimum hanya menghalangi order BARU. Jangan mengunci driver
    // dari menyelesaikan order yang sudah menjadi tanggung jawabnya.
    if (balance < minimumDeposit && activeJobs.length === 0) {
      throw new AppError(
        `Saldo tidak mencukupi (Rp${balance.toLocaleString('id-ID')} < Rp${minimumDeposit.toLocaleString('id-ID')})`,
        403,
        true,
        'DRIVER_INSUFFICIENT_BALANCE'
      );
    }

    // 4. Ambil order PENDING yang ELIGIBLE.
    //
    // V4 hardening: jangan gunakan $queryRaw untuk hot-path /jobs. Versi
    // sebelumnya masih bisa mengalami drift antara PostgreSQL enum ServiceType
    // dan parameter text serta BIGINT COUNT(*) yang kemudian pecah di
    // Express JSON.stringify. Prisma query + kalkulasi jarak di aplikasi
    // menghilangkan dua sumber regresi tersebut sekaligus.
    const isSendOrMart = driver.serviceType === 'SEND' || driver.serviceType === 'MART';
    const pendingWhere: Prisma.OrderWhereInput = {
      status: 'PENDING',
      isPaid: false,
      createdAt: { gt: new Date(Date.now() - 30 * 60 * 1000) },
      ...(isSendOrMart ? {} : { serviceType: driver.serviceType }),
    };

    // Ambil kandidat terbaru secukupnya, lalu hitung jarak Haversine dan
    // urutkan berdasarkan jarak. Endpoint ini tetap dibatasi sehingga tidak
    // melakukan full-table scan pada kondisi normal.
    const pendingCandidates = await prisma.order.findMany({
      where: pendingWhere,
      select: {
        id: true,
        serviceType: true,
        pickupAddress: true,
        dropoffAddress: true,
        pickupLat: true,
        pickupLng: true,
        dropoffLat: true,
        dropoffLng: true,
        distanceKm: true,
        price: true,
        discount: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
      take: Math.max(100, limit + offset + 50),
    });

    const toRadians = (value: number) => (value * Math.PI) / 180;
    const driverLat = Number(driver.latitude ?? 0);
    const driverLng = Number(driver.longitude ?? 0);
    const hasDriverLocation = Number.isFinite(driverLat) && Number.isFinite(driverLng)
      && (driver.latitude !== null && driver.longitude !== null);

    const haversineKm = (lat1: number, lng1: number, lat2: number, lng2: number) => {
      const earthRadiusKm = 6371;
      const dLat = toRadians(lat2 - lat1);
      const dLng = toRadians(lng2 - lng1);
      const a = Math.sin(dLat / 2) ** 2
        + Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLng / 2) ** 2;
      return earthRadiusKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)));
    };

    const eligibleDistanceJobs = pendingCandidates
      .map((job) => ({
        job,
        distanceFromDriver: hasDriverLocation
          ? haversineKm(driverLat, driverLng, Number(job.pickupLat), Number(job.pickupLng))
          : Number.POSITIVE_INFINITY,
      }))
      .filter(({ distanceFromDriver }) => distanceFromDriver <= 5)
      .sort((a, b) => a.distanceFromDriver - b.distanceFromDriver);

    const pageJobs = eligibleDistanceJobs.slice(offset, offset + limit);
    const jobs = pageJobs.map(({ job, distanceFromDriver }) => ({
      ...job,
      distance_from_driver: distanceFromDriver,
    }));

    // 5. Filter ulang dengan Eligibility Service
    const eligibleJobs: any[] = [];
    for (const job of jobs) {
      const eligibility = await this.eligibilityService.check({
        driverId: driver.id,
        order: {
          serviceType: job.serviceType,
          pickupLat: job.pickupLat,
          pickupLng: job.pickupLng,
        },
        options: {
          minimumDeposit,
          maxDistanceKm: 5,
          maxDailyOrders: 20,
          checkLocationFreshness: false,
        },
      });

      if (eligibility.isEligible) {
        eligibleJobs.push({
          id: job.id,
          serviceType: job.serviceType,
          pickupAddress: job.pickupAddress,
          dropoffAddress: job.dropoffAddress,
          pickupLat: job.pickupLat,
          pickupLng: job.pickupLng,
          dropoffLat: job.dropoffLat,
          dropoffLng: job.dropoffLng,
          distanceKm: job.distanceKm,
          distanceFromDriver: Math.round(job.distance_from_driver * 1000),
          price: job.price,
          discount: job.discount,
          createdAt: job.createdAt,
        });
      }
    }

    // 6. Total count dihitung dari kandidat yang sama — tanpa BIGINT raw SQL.
    const total = eligibleDistanceJobs.length;

    return {
      driverId: driver.id,
      serviceType: driver.serviceType,
      minimumDeposit,
      balance,
      jobs: [...activeJobs, ...eligibleJobs, ...outstandingCashOrders],
      activeJobs,
      total: Number(total) + activeJobs.length + outstandingCashOrders.length,
    };
  }

  // ============================================================
  // 🔒 GET JOB DETAIL - HANYA JIKA ELIGIBLE ATAU ASSIGNED
  // ============================================================
  async getJobDetail(driverId: string, orderId: string) {
    // 1. Ambil order dengan include customer dan driver
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: {
        customer: {
          include: {
            user: {
              select: {
                fullName: true,
                email: true,
                // phone ada di CustomerProfile, bukan User
              },
            },
          },
        },
        driver: {
          include: {
            user: {
              select: {
                fullName: true,
              },
            },
          },
        },
      },
    });

    if (!order) {
      throw new NotFoundError('Order tidak ditemukan');
    }

    // 2. Cek apakah driver adalah assigned driver
    const isAssigned = order.driverId === driverId;

    // 3. Jika bukan assigned, cek eligibility
    if (!isAssigned) {
      if (order.status !== 'PENDING') {
        throw new AppError('Order sudah tidak tersedia', 409);
      }

      const driver = await prisma.driverProfile.findUnique({
        where: { userId: driverId },
      });

      if (!driver) {
        throw new NotFoundError('Driver not found');
      }

      const minimumDeposit = await this.tariffEngine.getMinimumDriverDeposit();

      const eligibility = await this.eligibilityService.check({
        driverId: driver.id,
        order: {
          serviceType: order.serviceType,
          pickupLat: order.pickupLat,
          pickupLng: order.pickupLng,
        },
        options: {
          minimumDeposit,
          maxDistanceKm: 5,
          maxDailyOrders: 20,
        },
      });

      if (!eligibility.isEligible) {
        throw new AppError(
          `Order tidak eligible: ${eligibility.reasons.join(', ')}`,
          403
        );
      }

      // Ambil phone dari customer profile
      const customerPhone = await prisma.customerProfile.findUnique({
        where: { userId: order.customer.userId },
        select: { phoneNumber: true },
      });

      return {
        id: order.id,
        serviceType: order.serviceType,
        pickupAddress: order.pickupAddress,
        dropoffAddress: order.dropoffAddress,
        pickupLat: order.pickupLat,
        pickupLng: order.pickupLng,
        dropoffLat: order.dropoffLat,
        dropoffLng: order.dropoffLng,
        distanceKm: order.distanceKm,
        price: order.price,
        discount: order.discount,
        status: order.status,
        createdAt: order.createdAt,
        customer: {
          fullName: order.customer.user.fullName,
          phone: customerPhone?.phoneNumber || null,
        },
        driver: order.driver ? {
          fullName: order.driver.user?.fullName,
          vehicleModel: order.driver.vehicleModel,
          vehiclePlate: order.driver.vehiclePlate,
        } : null,
      };
    }

    // 4. Jika assigned driver, kirim detail lengkap (termasuk email)
    const customerPhone = await prisma.customerProfile.findUnique({
      where: { userId: order.customer.userId },
      select: { phoneNumber: true },
    });

    return {
      id: order.id,
      serviceType: order.serviceType,
      pickupAddress: order.pickupAddress,
      dropoffAddress: order.dropoffAddress,
      pickupLat: order.pickupLat,
      pickupLng: order.pickupLng,
      dropoffLat: order.dropoffLat,
      dropoffLng: order.dropoffLng,
      distanceKm: order.distanceKm,
      price: order.price,
      discount: order.discount,
      status: order.status,
      createdAt: order.createdAt,
      customer: {
        fullName: order.customer.user.fullName,
        phone: customerPhone?.phoneNumber || null,
        email: order.customer.user.email,
      },
      driver: order.driver ? {
        fullName: order.driver.user?.fullName,
        vehicleModel: order.driver.vehicleModel,
        vehiclePlate: order.driver.vehiclePlate,
      } : null,
    };
  }
}