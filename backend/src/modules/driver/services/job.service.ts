import { prisma } from '../../../config/prisma';
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
      throw new AppError('Account not active', 403);
    }

    if (!driver.isVerified) {
      throw new AppError('Driver not verified', 403);
    }

    if (!driver.isOnline) {
      throw new AppError('Driver is offline', 403);
    }

    // 2. Dapatkan minimum deposit
    const minimumDeposit = await this.tariffEngine.getMinimumDriverDeposit();

    // 3. Cek saldo driver
    const wallet = await prisma.wallet.findUnique({
      where: { userId: driverId },
    });
    const balance = Number(wallet?.balance || 0);

    if (balance < minimumDeposit) {
      throw new AppError(
        `Saldo tidak mencukupi (Rp${balance.toLocaleString('id-ID')} < Rp${minimumDeposit.toLocaleString('id-ID')})`,
        403
      );
    }

    // 4. Ambil order PENDING yang ELIGIBLE
    const isSendOrMart = driver.serviceType === 'SEND' || driver.serviceType === 'MART';

    // 🆕 FIX KRITIS "Ledger SQL schema" (pola yang sama menjalar ke sini
    // juga): query raw sebelumnya pakai nama tabel/kolom snake_case
    // ("orders", "o.service_type", "o.pickup_address", dst) yang SAMA
    // SEKALI TIDAK ADA di database -- Prisma di proyek ini TIDAK PERNAH
    // pakai @@map/@map (dicek di schema.prisma), jadi nama tabel & kolom
    // sungguhan persis PascalCase/camelCase yang dideklarasikan di
    // schema ("Order", "serviceType", "pickupAddress", dst), wajib
    // di-quote karena mixed-case. Query ini SELALU throw
    // 'relation "orders" does not exist' setiap dipanggil -- ARTINYA
    // DRIVER TIDAK PERNAH BISA MELIHAT DAFTAR JOB LEWAT ENDPOINT INI
    // SAMA SEKALI sejak awal. Diperbaiki dengan quote yang benar.
    const query = `
      SELECT 
        o.id,
        o."serviceType" as "serviceType",
        o."pickupAddress" as "pickupAddress",
        o."dropoffAddress" as "dropoffAddress",
        o."pickupLat" as "pickupLat",
        o."pickupLng" as "pickupLng",
        o."dropoffLat" as "dropoffLat",
        o."dropoffLng" as "dropoffLng",
        o."distanceKm" as "distanceKm",
        o.price,
        o.discount,
        o."createdAt" as "createdAt",
        (
          6371 * acos(
            cos(radians(${driver.latitude || 0})) * 
            cos(radians(o."pickupLat")) * 
            cos(radians(o."pickupLng") - radians(${driver.longitude || 0})) + 
            sin(radians(${driver.latitude || 0})) * 
            sin(radians(o."pickupLat"))
          )
        ) as distance_from_driver
      FROM "Order" o
      WHERE 
        o.status = 'PENDING'
        AND o."isPaid" = false
        AND o."createdAt" > NOW() - INTERVAL '30 minutes'
        ${isSendOrMart ? '' : `AND o."serviceType" = '${driver.serviceType}'`}
        AND (
          6371 * acos(
            cos(radians(${driver.latitude || 0})) * 
            cos(radians(o."pickupLat")) * 
            cos(radians(o."pickupLng") - radians(${driver.longitude || 0})) + 
            sin(radians(${driver.latitude || 0})) * 
            sin(radians(o."pickupLat"))
          )
        ) <= 5
      ORDER BY distance_from_driver ASC
      LIMIT ${limit}
      OFFSET ${offset}
    `;

    const jobs = await prisma.$queryRawUnsafe(query) as any[];

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

    // 6. Total count
    // 6. Total count (fix nama tabel/kolom sama seperti query di atas)
    const countQuery = `
      SELECT COUNT(*) as total
      FROM "Order" o
      WHERE 
        o.status = 'PENDING'
        AND o."isPaid" = false
        AND o."createdAt" > NOW() - INTERVAL '30 minutes'
        ${isSendOrMart ? '' : `AND o."serviceType" = '${driver.serviceType}'`}
        AND (
          6371 * acos(
            cos(radians(${driver.latitude || 0})) * 
            cos(radians(o."pickupLat")) * 
            cos(radians(o."pickupLng") - radians(${driver.longitude || 0})) + 
            sin(radians(${driver.latitude || 0})) * 
            sin(radians(o."pickupLat"))
          )
        ) <= 5
    `;

    const countResult = await prisma.$queryRawUnsafe(countQuery) as any[];
    const total = countResult[0]?.total || 0;

    return {
      driverId: driver.id,
      serviceType: driver.serviceType,
      minimumDeposit,
      balance,
      jobs: eligibleJobs,
      total,
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