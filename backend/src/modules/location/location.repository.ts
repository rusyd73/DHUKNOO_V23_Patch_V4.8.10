import { prisma } from '../../config/prisma';

export class LocationRepository {
  updateDriverLocation(userId: string, latitude: number, longitude: number, isOnline?: boolean) {
    return prisma.driverProfile.update({
      where: { userId },
      data: {
        latitude,
        longitude,
        ...(isOnline !== undefined ? { isOnline } : {}),
      },
    });
  }

  findDriverLocation(driverId: string) {
    return prisma.driverProfile.findUnique({
      where: { id: driverId },
      select: { id: true, latitude: true, longitude: true, isOnline: true },
    });
  }

  listOnlineDrivers() {
    return prisma.driverProfile.findMany({
      where: { isOnline: true, latitude: { not: null }, longitude: { not: null } },
      select: { id: true, latitude: true, longitude: true },
    });
  }
}
