import { User, Role } from '@prisma/client';
import { prisma } from '../../config/prisma';

export class AuthRepository {
  private normalizeEmail(email: string): string {
    if (!email) return '';
    return email.toLowerCase().trim();
  }

  async findByEmail(email: string): Promise<any | null> {
    const normalizedEmail = this.normalizeEmail(email);
    return prisma.user.findFirst({
      where: {
        email: {
          equals: normalizedEmail,
          mode: 'insensitive',
        },
      },
      include: {
        customerProfile: true,
        driverProfile: true,
        wallet: true,
      },
    });
  }

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

  async createUser(data: {
    email: string;
    passwordHash: string;
    fullName: string;
    role: Role;
    phone?: string;
    vehiclePlate?: string;
    vehicleModel?: string;
    driverServiceType?: 'BIKE' | 'CAR' | 'SEND';
    merchantName?: string;
    merchantCategory?: string;
    merchantAddress?: string;
    merchantLatitude?: number;
    merchantLongitude?: number;
  }): Promise<User> {
    const normalizedEmail = this.normalizeEmail(data.email);

    return prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email: normalizedEmail,
          passwordHash: data.passwordHash,
          fullName: data.fullName,
          role: data.role,
        },
      });

      await tx.wallet.create({
        data: {
          userId: user.id,
          balance: 0.00,
        },
      });

      if (data.role === Role.CUSTOMER) {
        await tx.customerProfile.create({
          data: {
            userId: user.id,
            isAppInstalled: true,
            // 🆕 FIX "Phone registration": sebelumnya nomor HP yang diisi
            // saat registrasi TIDAK PERNAH ditulis ke sini sama sekali --
            // registerSchema menerima & memvalidasi field `phone`, tapi
            // createUser() (fungsi ini) tidak punya parameter `phone` di
            // signature-nya, jadi nilainya dibuang begitu saja. Akibatnya
            // kolom phoneNumber SELALU NULL untuk semua user, dan fitur
            // login-by-phone (findByEmailOrPhone di bawah, dipakai
            // loginUser()) TIDAK PERNAH BISA menemukan siapa pun lewat
            // nomor HP -- selalu "user tidak ditemukan" walau user
            // memang mengisi nomor HP yang benar saat daftar.
            phoneNumber: data.phone || null,
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
            // 🆕 FIX "Phone registration" (sama seperti CustomerProfile
            // di atas) -- driver juga tidak pernah punya phoneNumber
            // tersimpan sebelumnya.
            phoneNumber: data.phone || null,
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

  async findByEmailOrPhone(identifier: string): Promise<any | null> {
    const trimmed = (identifier || '').trim();
    if (!trimmed) return null;

    if (trimmed.includes('@')) {
      return this.findByEmail(trimmed);
    }

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

  async setResetPasswordToken(userId: string, tokenHash: string | null, expiresAt: Date | null) {
    await prisma.user.update({
      where: { id: userId },
      data: {
        resetPasswordTokenHash: tokenHash,
        resetPasswordExpires: expiresAt,
      },
    });
  }

  async findUsersWithActiveResetToken(): Promise<any[]> {
    return prisma.user.findMany({
      where: {
        resetPasswordTokenHash: { not: null },
        resetPasswordExpires: { gt: new Date() },
      },
    });
  }

  async resetPassword(userId: string, newPasswordHash: string): Promise<void> {
    await prisma.user.update({
      where: { id: userId },
      data: {
        passwordHash: newPasswordHash,
        resetPasswordTokenHash: null,
        resetPasswordExpires: null,
        refreshToken: null,
      },
    });
  }

  async updateRefreshToken(userId: string, token: string | null): Promise<User> {
    return prisma.user.update({
      where: { id: userId },
      data: { refreshToken: token },
    });
  }

  async updateAdminPassword(userId: string, newPasswordHash: string): Promise<User> {
    return prisma.user.update({
      where: { id: userId },
      data: { passwordHash: newPasswordHash },
    });
  }

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

  async verifyDriver(driverProfileId: string, isVerified: boolean): Promise<any> {
    return prisma.driverProfile.update({
      where: { id: driverProfileId },
      data: { isVerified },
    });
  }

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
      take: 10,
    });
  }

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

  async normalizeAllEmails(): Promise<number> {
    const users = await prisma.user.findMany({
      select: { id: true, email: true },
    });

    let updated = 0;
    for (const user of users) {
      const normalized = this.normalizeEmail(user.email);
      if (user.email !== normalized) {
        const existing = await prisma.user.findFirst({
          where: {
            email: normalized,
            NOT: { id: user.id },
          },
        });

        if (existing) {
          console.warn(`⚠️ Duplicate email found: ${user.email} and ${existing.email}`);
          await prisma.user.delete({ where: { id: user.id } });
        } else {
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