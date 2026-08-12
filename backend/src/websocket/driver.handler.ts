// src/websocket/driver.handlers.ts
import { Server as SocketIOServer, Socket } from 'socket.io';
import { PrismaClient } from '@prisma/client';
import { logger } from '../config/logger';
import { RedisService } from '../config/redis';

const prisma = new PrismaClient();
const SOCKET_PREFIX = 'socket:driver:';

/**
 * Handler untuk semua event Socket.IO terkait driver
 * Dipanggil dari socket.ts tanpa mengubah struktur existing
 */
export const setupDriverHandlers = (io: SocketIOServer) => {
  io.on('connection', (socket: Socket) => {
    // ============================================================
    // 1. DRIVER REGISTER - Menghubungkan driver ke socket
    // ============================================================
    socket.on('driver-register', async (data: { driverId: string; name: string }) => {
      try {
        const { driverId, name } = data;

        // Simpan di Redis untuk tracking
        await RedisService.setex(
          `${SOCKET_PREFIX}${driverId}`,
          60 * 60 * 24 * 7,
          socket.id
        );

        // Join room khusus driver
        socket.join(`driver-${driverId}`);
        logger.info(`✅ Driver ${name} (${driverId}) registered`);

        socket.emit('register-success', {
          message: 'Driver registered successfully',
          driverId
        });

        // Kirim order PENDING yang sesuai dengan serviceType driver
        const driver = await prisma.driverProfile.findUnique({
          where: { userId: driverId },
          include: { user: true }
        });

        if (driver && driver.isOnline) {
          const pendingOrders = await prisma.order.findMany({
            where: {
              status: 'PENDING',
              serviceType: driver.serviceType,
            },
            include: {
              customer: {
                include: { user: true }
              }
            },
            orderBy: { createdAt: 'desc' },
            take: 20
          });

          if (pendingOrders.length > 0) {
            logger.info(`📦 Sending ${pendingOrders.length} pending orders to ${name}`);
            pendingOrders.forEach(order => {
              socket.emit('new-order', order);
            });
          }
        }

      } catch (error) {
        logger.error('Driver register error:', error);
        socket.emit('error', { message: 'Failed to register driver' });
      }
    });

    // ============================================================
    // 2. 🔥 TOGGLE READY - FIX UTAMA
    // ============================================================
    socket.on('driver-toggle-ready', async (data: { driverId: string; isReady: boolean }) => {
      try {
        const { driverId, isReady } = data;

        // Update database
        const driver = await prisma.driverProfile.update({
          where: { userId: driverId },
          data: {
            isOnline: isReady,
            autoAcceptEnabled: isReady,
          },
          include: { user: true }
        });

        logger.info(`🔄 Driver ${driver.user.fullName} toggled: ${isReady ? 'ONLINE ✅' : 'OFFLINE ❌'}`);

        // Broadcast ke semua client
        io.emit('driver_status_changed', {
          driverId,
          driverName: driver.user.fullName,
          isOnline: driver.isOnline,
          autoAccept: driver.autoAcceptEnabled,
          serviceType: driver.serviceType
        });

        // Jika ONLINE, kirim order PENDING
        if (isReady) {
          const pendingOrders = await prisma.order.findMany({
            where: {
              status: 'PENDING',
              serviceType: driver.serviceType,
            },
            include: {
              customer: {
                include: { user: true }
              }
            },
            orderBy: { createdAt: 'desc' },
            take: 20
          });

          if (pendingOrders.length > 0) {
            logger.info(`📦 Sending ${pendingOrders.length} orders to ${driver.user.fullName}`);
            pendingOrders.forEach(order => {
              io.to(`driver-${driverId}`).emit('new-order', order);
            });
          } else {
            socket.emit('no-orders', {
              message: `Tidak ada order ${driver.serviceType} yang tersedia`
            });
          }
        }

        socket.emit('toggle-success', {
          message: `Status ${isReady ? 'ONLINE' : 'OFFLINE'}`,
          isReady,
          driverId
        });

      } catch (error) {
        logger.error('Toggle error:', error);
        socket.emit('error', { message: 'Failed to toggle status' });
      }
    });

    // ============================================================
    // 3. PUBLISH ORDER - Dari Admin/Merchant
    // ============================================================
    socket.on('publish-order', async (data: {
      pickup: string;
      destination: string;
      pickupLat?: number;
      pickupLng?: number;
      dropoffLat?: number;
      dropoffLng?: number;
      serviceType?: 'BIKE' | 'CAR' | 'SEND';
      price?: number;
      customerId?: string;
    }) => {
      try {
        // Cari customer default
        let customerId = data.customerId;
        if (!customerId) {
          const defaultCustomer = await prisma.customerProfile.findFirst({
            include: { user: true }
          });
          if (defaultCustomer) {
            customerId = defaultCustomer.id;
          } else {
            // Buat customer temporary
            const user = await prisma.user.create({
              data: {
                email: `temp_${Date.now()}@temp.com`,
                passwordHash: 'temporary',
                fullName: 'Customer Temp',
                role: 'CUSTOMER',
                customerProfile: {
                  create: {
                    phoneNumber: '081234567890'
                  }
                }
              }
            });
            const profile = await prisma.customerProfile.findUnique({
              where: { userId: user.id }
            });
            customerId = profile!.id;
          }
        }

        const serviceType = data.serviceType || 'BIKE';
        const price = data.price || 15000;

        // Buat order
        const newOrder = await prisma.order.create({
          data: {
            serviceType,
            status: 'PENDING',
            price,
            discount: 0,
            isPaid: false,
            paymentMethod: 'WALLET',
            pickupAddress: data.pickup,
            pickupLat: data.pickupLat || -7.8711,
            pickupLng: data.pickupLng || 112.5269,
            dropoffAddress: data.destination,
            dropoffLat: data.dropoffLat || -7.8785,
            dropoffLng: data.dropoffLng || 112.5204,
            distanceKm: 3,
            customerId: customerId,
          },
          include: {
            customer: {
              include: { user: true }
            }
          }
        });

        logger.info(`📤 New order published: ${newOrder.id} (${serviceType})`);

        // Cari driver yang ONLINE & sesuai SERVICE TYPE
        const availableDrivers = await prisma.driverProfile.findMany({
          where: {
            isOnline: true,
            autoAcceptEnabled: true,
            serviceType: serviceType,
          },
          include: { user: true }
        });

        if (availableDrivers.length > 0) {
          logger.info(`🚀 Sending order to ${availableDrivers.length} matching drivers`);

          availableDrivers.forEach(driver => {
            io.to(`driver-${driver.userId}`).emit('new-order', newOrder);
          });

          io.emit('order-published', {
            order: newOrder,
            matchedDrivers: availableDrivers.length,
            drivers: availableDrivers.map(d => d.user.fullName)
          });

          socket.emit('publish-success', {
            message: `Order published to ${availableDrivers.length} drivers`,
            order: newOrder,
            matchedDrivers: availableDrivers.length
          });

        } else {
          logger.warn(`⚠️ No online drivers for service type: ${serviceType}`);
          io.emit('order-waiting', {
            order: newOrder,
            message: `Menunggu driver ${serviceType} siap...`
          });

          socket.emit('publish-success', {
            message: 'Order published, waiting for drivers...',
            order: newOrder,
            matchedDrivers: 0
          });
        }

      } catch (error) {
        logger.error('Publish order error:', error);
        socket.emit('error', { message: 'Failed to publish order' });
      }
    });

    // ============================================================
    // 4. ACCEPT ORDER
    // ============================================================
    socket.on('accept-order', async (data: { driverId: string; orderId: string }) => {
      try {
        const { driverId, orderId } = data;

        const order = await prisma.order.findUnique({
          where: { id: orderId },
          include: { customer: { include: { user: true } } }
        });

        if (!order) {
          socket.emit('error', { message: 'Order not found' });
          return;
        }

        if (order.status !== 'PENDING') {
          socket.emit('error', { message: 'Order already taken' });
          return;
        }

        const driver = await prisma.driverProfile.findUnique({
          where: { userId: driverId },
          include: { user: true }
        });

        if (!driver) {
          socket.emit('error', { message: 'Driver not found' });
          return;
        }

        // Cek klasifikasi
        if (order.serviceType !== driver.serviceType) {
          socket.emit('error', {
            message: `You can only accept ${driver.serviceType} orders. This is ${order.serviceType}`
          });
          return;
        }

        // Accept order
        const updatedOrder = await prisma.order.update({
          where: { id: orderId },
          data: {
            status: 'ACCEPTED',
            driverId: driverId,
            acceptedAt: new Date(),
          },
          include: {
            customer: { include: { user: true } },
            driver: { include: { user: true } }
          }
        });

        // Set driver offline
        await prisma.driverProfile.update({
          where: { userId: driverId },
          data: { isOnline: false, autoAcceptEnabled: false }
        });

        // Broadcast
        io.emit('order_updated', updatedOrder);
        io.emit('order_accepted', {
          orderId: updatedOrder.id,
          driver: {
            id: driver.userId,
            name: driver.user.fullName,
            vehicle: driver.vehicleModel,
            plate: driver.vehiclePlate
          },
          order: updatedOrder
        });

        io.to(`driver-${driverId}`).emit('order-accepted', {
          orderId: updatedOrder.id,
          message: '✅ Order berhasil diterima!',
          order: updatedOrder
        });

        io.to(orderId).emit('driver_assigned', {
          orderId: updatedOrder.id,
          driver: {
            name: driver.user.fullName,
            phone: driver.phoneNumber,
            vehicle: driver.vehicleModel,
            plate: driver.vehiclePlate
          }
        });

        logger.info(`✅ Order ${orderId} accepted by driver ${driver.user.fullName}`);
        socket.emit('accept-success', { orderId, driverId });

      } catch (error) {
        logger.error('Accept order error:', error);
        socket.emit('error', { message: 'Failed to accept order' });
      }
    });

    // ============================================================
    // 5. CHAT MESSAGE
    // ============================================================
    socket.on('chat_message', async (data: {
      orderId: string;
      message: string;
      senderId: string;
      senderRole: 'CUSTOMER' | 'DRIVER' | 'ADMIN' | 'MERCHANT';
    }) => {
      try {
        const chatMessage = await prisma.chatMessage.create({
          data: {
            orderId: data.orderId,
            senderId: data.senderId,
            senderRole: data.senderRole,
            message: data.message,
          }
        });

        io.to(data.orderId).emit('chat_message', {
          ...chatMessage,
          timestamp: chatMessage.createdAt
        });

      } catch (error) {
        logger.error('Chat error:', error);
        socket.emit('error', { message: 'Failed to send message' });
      }
    });

    // ============================================================
    // 6. LOCATION UPDATE
    // ============================================================
    socket.on('location_update', async (data: {
      orderId: string;
      lat: number;
      lng: number;
      driverId: string;
    }) => {
      try {
        await prisma.driverProfile.update({
          where: { userId: data.driverId },
          data: { latitude: data.lat, longitude: data.lng }
        });

        io.to(data.orderId).emit('location_update', {
          orderId: data.orderId,
          lat: data.lat,
          lng: data.lng,
          driverId: data.driverId
        });

      } catch (error) {
        logger.error('Location update error:', error);
      }
    });

    // ============================================================
    // 7. JOIN ORDER ROOM (untuk customer)
    // ============================================================
    socket.on('join-order-room', (orderId: string) => {
      socket.join(orderId);
      socket.emit('room-joined', { orderId });
    });

    // ============================================================
    // 8. DISCONNECT - Cleanup
    // ============================================================
    socket.on('disconnect', async () => {
      logger.info(`[Socket] Client disconnected: ${socket.id}`);

      try {
        // Cari driver dengan socketId ini di Redis
        const keys = await RedisService.keys(`${SOCKET_PREFIX}*`);
        for (const key of keys) {
          const socketId = await RedisService.get(key);
          if (socketId === socket.id) {
            const driverId = key.replace(SOCKET_PREFIX, '');
            await RedisService.del(key);

            await prisma.driverProfile.update({
              where: { userId: driverId },
              data: { isOnline: false }
            });

            logger.info(`🔴 Driver ${driverId} disconnected`);
            break;
          }
        }
      } catch (error) {
        logger.error('Disconnect error:', error);
      }
    });
  });
};