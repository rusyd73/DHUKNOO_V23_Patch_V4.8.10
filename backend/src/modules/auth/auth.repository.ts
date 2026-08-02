import { User, Role } from '@prisma/client';
import { prisma } from '../../config/prisma';

export class AuthRepository {
  async findByEmail(email: string): Promise<any | null> {
    return prisma.user.findUnique({
      where: { email },
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
    vehiclePlate?: string;
    vehicleModel?: string;
    driverServiceType?: 'BIKE' | 'CAR' | 'SEND';
    merchantName?: string;
    merchantCategory?: string;
    merchantAddress?: string;
    merchantLatitude?: number;
    merchantLongitude?: number;
  }): Promise<User> {
    return prisma.$transaction(async (tx) => {
      // 1. Create central user
      const user = await tx.user.create({
        data: {
          email: data.email,
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
}
