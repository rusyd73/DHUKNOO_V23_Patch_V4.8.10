import { User, Role } from '@prisma/client';
import { prisma } from '../../config/prisma';

export class AuthRepository {
  // ✅ PERBAIKAN 1: Normalize email helper
  private normalizeEmail(email: string): string {
    if (!email) return '';
    return email.toLowerCase().trim();
  }

  // ✅ PERBAIKAN 2: Case insensitive search dengan Prisma
  async findByEmail(email: string): Promise<any | null> {
    const normalizedEmail = this.normalizeEmail(email);
    
    // ✅ Cara 1: Pakai findUnique dengan lower (jika database support)
    // PostgreSQL: LOWER() works
    // MySQL: LOWER() works
    // SQLite: LOWER() works
    return prisma.user.findFirst({
      where: {
        email: {
          equals: normalizedEmail,
          mode: 'insensitive', // ✅ Prisma 5.0+ support case insensitive
        },
      },
      include: {
        customerProfile: true,
        driverProfile: true,
        wallet: true,
      },
    });
    
    // ✅ Cara 2: Alternatif jika Prisma version < 5.0
    // return prisma.$queryRaw`
    //   SELECT * FROM users 
    //   WHERE LOWER(email) = ${normalizedEmail}
    //   LIMIT 1
    // `;
  }

  // ✅ PERBAIKAN 3: Find by ID (tidak perlu normalize)
  async findById(id: string): Promise<any | null> {
    return prisma.user.findUnique({
      where: { id },
      include: {
        customerProfile: true,
        driverProfile: true,
        wallet: true,
      },
    });
  }

  // ✅ PERBAIKAN 4: Create user dengan email normalized
  async createUser(data: {
    email: string;
    passwordHash: string;
    fullName: string;
    role: Role;
    vehiclePlate?: string;
    vehicleModel?: string;
    driverServiceType?: 'BIKE' | 'CAR' | 'SEND';
    merchantName?: string;
    merchantCategory?: string;
    merchantAddress?: string;
    merchantLatitude?: number;
    merchantLongitude?: number;
  }): Promise<User> {
    // ✅ Normalize email sebelum disimpan
    const normalizedEmail = this.normalizeEmail(data.email);
    
    return prisma.$transaction(async (tx) => {
      // 1. Create central user with normalized email
      const user = await tx.user.create({
        data: {
          email: normalizedEmail, // ← Pakai email yang sudah dinormalisasi
          passwordHash: data.passwordHash,
          fullName: data.fullName,
          role: data.role,
        },
      });

      // 2. Create local wallet
      await tx.wallet.create({
        data: {
          userId: user.id,
          balance: 0.00,
        },
      });

      // 3. Create role profiles
      if (data.role === Role.CUSTOMER) {
        await tx.customerProfile.create({
          data: {
            userId: user.id,
            isAppInstalled: true,
          },
        });
      } else if (data.role === Role.DRIVER) {
        await tx.driverProfile.create({
          data: {
            userId: user.id,
            vehiclePlate: data.vehiclePlate || 'N 1000 BAT',
            vehicleModel: data.vehicleModel || 'Honda Vario',
            serviceType: (data.driverServiceType as any) || 'BIKE',
            isOnline: false,
            isVerified: false,
          },
        });
      } else if (data.role === Role.MERCHANT) {
        await tx.merchant.create({
          data: {
            ownerId: user.id,
            name: data.merchantName!,
            category: data.merchantCategory!,
            address: data.merchantAddress!,
            latitude: data.merchantLatitude!,
            longitude: data.merchantLongitude!,
            isOpen: true,
          },
        });
      }

      return user;
    });
  }

  // 🆕 PERBAIKAN #1 (Lupa/Reset Password): cari user berdasarkan email ATAU
  // nomor HP (nomor HP disimpan di CustomerProfile.phoneNumber /
  // DriverProfile.phoneNumber — User sendiri tidak punya kolom telepon).
  async findByEmailOrPhone(identifier: string): Promise<any | null> {
    const trimmed = (identifier || '').trim();
    if (!trimmed) return null;

    // Kalau mengandung "@", perlakukan sebagai email langsung.
    if (trimmed.includes('@')) {
      return this.findByEmail(trimmed);
    }

    // Selain itu, coba cocokkan sebagai nomor HP (normalisasi 08xx <-> 62xx
    // supaya "081234" dan "6281234" dianggap nomor yang sama).
    const digitsOnly = trimmed.replace(/[^\d]/g, '');
    const alt = digitsOnly.startsWith('0')
      ? `62${digitsOnly.slice(1)}`
      : digitsOnly.startsWith('62')
      ? `0${digitsOnly.slice(2)}`
      : digitsOnly;

    const candidates = Array.from(new Set([digitsOnly, alt]));

    return prisma.user.findFirst({
      where: {
        OR: [
          { customerProfile: { phoneNumber: { in: candidates } } },
          { driverProfile: { phoneNumber: { in: candidates } } },
        ],
      },
      include: {
        customerProfile: true,
        driverProfile: true,
        wallet: true,
      },
    });
  }

  // 🆕 PERBAIKAN #1: simpan hash kode reset password + waktu kedaluwarsa.
  async setResetPasswordToken(userId: string, tokenHash: string, expiresAt: Date): Promise<void> {
    await prisma.user.update({
      where: { id: userId },
      data: {
        resetPasswordTokenHash: tokenHash,
        resetPasswordExpires: expiresAt,
      },
    });
  }

  // 🆕 PERBAIKAN #1: ambil semua user yang PUNYA kode reset aktif & belum
  // kedaluwarsa — dipakai untuk mencocokkan kode yang diinput user (kode
  // di-hash, jadi tidak bisa dicari langsung lewat WHERE).
  async findUsersWithActiveResetToken(): Promise<any[]> {
    return prisma.user.findMany({
      where: {
        resetPasswordTokenHash: { not: null },
        resetPasswordExpires: { gt: new Date() },
      },
    });
  }

  // 🆕 PERBAIKAN #1: set password baru & bersihkan token reset (sekali pakai).
  async resetPassword(userId: string, newPasswordHash: string): Promise<void> {
    await prisma.user.update({
      where: { id: userId },
      data: {
        passwordHash: newPasswordHash,
        resetPasswordTokenHash: null,
        resetPasswordExpires: null,
        refreshToken: null, // paksa semua sesi lama logout demi keamanan
      },
    });
  }

  // ✅ PERBAIKAN 5: Update refresh token (tidak perlu diubah)
  async updateRefreshToken(userId: string, token: string | null): Promise<User> {
    return prisma.user.update({
      where: { id: userId },
      data: { refreshToken: token },
    });
  }

  // ✅ PERBAIKAN 6: Update password (tidak perlu diubah)
  async updateAdminPassword(userId: string, newPasswordHash: string): Promise<User> {
    return prisma.user.update({
      where: { id: userId },
      data: { passwordHash: newPasswordHash },
    });
  }

  // ✅ PERBAIKAN 7: Find verified drivers (tidak perlu diubah)
  async findVerifiedDrivers(): Promise<any[]> {
    return prisma.driverProfile.findMany({
      where: { isVerified: true },
      include: {
        user: {
          select: { email: true, fullName: true },
        },
      },
    });
  }

  // ✅ PERBAIKAN 8: Verify driver (tidak perlu diubah)
  async verifyDriver(driverProfileId: string, isVerified: boolean): Promise<any> {
    return prisma.driverProfile.update({
      where: { id: driverProfileId },
      data: { isVerified },
    });
  }

  // ✅ PERBAIKAN 9: Method tambahan untuk debug
  async findAllUsers(): Promise<any[]> {
    return prisma.user.findMany({
      select: {
        id: true,
        email: true,
        fullName: true,
        role: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 10, // Ambil 10 user terakhir
    });
  }

  // 🆕 PERBAIKAN #3: nonaktifkan (soft-remove) akun user atas keputusan admin.
  // Refresh token dihapus supaya sesi yang sedang aktif tidak bisa dipakai
  // untuk refresh access token baru lagi (access token lama akan tetap
  // ditolak lewat pengecekan isActive di authenticateToken middleware).
  async deactivateUser(userId: string, adminId: string, reason?: string): Promise<User> {
    return prisma.user.update({
      where: { id: userId },
      data: {
        isActive: false,
        refreshToken: null,
        deactivatedAt: new Date(),
        deactivatedBy: adminId,
        deactivationReason: reason || null,
      },
    });
  }

  // 🆕 PERBAIKAN #3: aktifkan kembali akun user atas permintaan user (approved admin).
  async reactivateUser(userId: string): Promise<User> {
    return prisma.user.update({
      where: { id: userId },
      data: {
        isActive: true,
        deactivatedAt: null,
        deactivatedBy: null,
        deactivationReason: null,
      },
    });
  }

  // ✅ PERBAIKAN 10: Fix duplicate emails (migrasi data)
  async normalizeAllEmails(): Promise<number> {
    const users = await prisma.user.findMany({
      select: { id: true, email: true },
    });

    let updated = 0;
    for (const user of users) {
      const normalized = this.normalizeEmail(user.email);
      if (user.email !== normalized) {
        // ✅ Cek apakah sudah ada email yang sama
        const existing = await prisma.user.findFirst({
          where: {
            email: normalized,
            NOT: { id: user.id },
          },
        });

        if (existing) {
          // ❌ Jika sudah ada, hapus atau merge data
          console.warn(`⚠️ Duplicate email found: ${user.email} and ${existing.email}`);
          // Hapus user duplicate
          await prisma.user.delete({ where: { id: user.id } });
        } else {
          // ✅ Update ke normalized
          await prisma.user.update({
            where: { id: user.id },
            data: { email: normalized },
          });
          updated++;
        }
      }
    }
    return updated;
  }
}