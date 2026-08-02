// frontend/src/hooks/useDriverSocket.ts
import { useEffect, useState, useCallback } from 'react';
import io, { Socket } from 'socket.io-client';
import { getApiBaseUrl } from '@obama/shared-api';

const SOCKET_URL = getApiBaseUrl();

interface Order {
  id: string;
  serviceType: 'BIKE' | 'CAR' | 'SEND';
  status: string;
  price: number;
  pickupAddress: string;
  dropoffAddress: string;
  customer: {
    user: {
      fullName: string;
    }
  };
}

export const useDriverSocket = (driverId: string | null) => {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [orders, setOrders] = useState<Order[]>([]);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    if (!driverId) return;

    const newSocket = io(SOCKET_URL, {
      transports: ['websocket'],
      reconnection: true,
    });

    newSocket.on('connect', () => {
      console.log('✅ Socket connected');
      setIsConnected(true);
      
      newSocket.emit('driver-register', {
        driverId,
        name: 'Driver' // Ambil dari context jika ada
      });
    });

    newSocket.on('disconnect', () => {
      console.log('❌ Socket disconnected');
      setIsConnected(false);
    });

    newSocket.on('new-order', (order: Order) => {
      console.log('📦 New order:', order);
      setOrders(prev => [order, ...prev]);
    });

    newSocket.on('order-accepted', (data) => {
      console.log('✅ Order accepted:', data);
      setOrders(prev => prev.filter(o => o.id !== data.orderId));
    });

    newSocket.on('toggle-success', (data) => {
      console.log('Toggle success:', data);
      setIsReady(data.isReady);
    });

    newSocket.on('error', (data) => {
      console.error('Socket error:', data.message);
    });

    setSocket(newSocket);

    return () => {
      newSocket.disconnect();
    };
  }, [driverId]);

  const toggleReady = useCallback((isReady: boolean) => {
    if (socket && isConnected && driverId) {
      socket.emit('driver-toggle-ready', { driverId, isReady });
    }
  }, [socket, isConnected, driverId]);

  const acceptOrder = useCallback((orderId: string) => {
    if (socket && isConnected && driverId) {
      socket.emit('accept-order', { driverId, orderId });
    }
  }, [socket, isConnected, driverId]);

  const sendChat = useCallback((orderId: string, message: string) => {
    if (socket && isConnected) {
      socket.emit('chat_message', {
        orderId,
        message,
        senderId: driverId || 'unknown',
        senderRole: 'DRIVER'
      });
    }
  }, [socket, isConnected, driverId]);

  const joinOrderRoom = useCallback((orderId: string) => {
    if (socket && isConnected) {
      socket.emit('join-order-room', orderId);
    }
  }, [socket, isConnected]);

  return {
    socket,
    isConnected,
    orders,
    isReady,
    toggleReady,
    acceptOrder,
    sendChat,
    joinOrderRoom,
    setOrders
  };
};