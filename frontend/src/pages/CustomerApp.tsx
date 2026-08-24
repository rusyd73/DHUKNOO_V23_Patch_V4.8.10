import React, { useState, useEffect, Suspense } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { socket, joinRoom } from '../services/socket';
import { formatRupiah, calculateHaversineDistance } from '@obama/shared-utils';
import { useAuthStore } from '../store/useAuthStore';
import { CustomerAPI, UploadAPI, OrderAPI, PaymentAPI, LocationAPI } from '../api';
import { OrderChatBox } from '../components/chat/OrderChatBox';
import { TopupModal, QrisCameraScannerModal } from '../components/modals/SharedModals';
import AuthFlow from '../components/auth/AuthFlow';
import { SkeletonList } from '../components/common/Skeleton';
import { QueryErrorState } from '../components/common/QueryErrorState';
import MerchantOrderModal from '../components/customer/MerchantOrderModal';
import { playBellRingSound, warmupAudioContext } from '../utils/audio';
import {
  Camera,
  ChevronDown,
  Clock,
  Copy,
  History,
  Lock,
  MapPin,
  MessageCircle,
  PlusCircle,
  QrCode,
  RefreshCw,
  Send,
  Smartphone,
  Wallet,
  XCircle,
} from 'lucide-react';

// PERBAIKAN PERFORMA: sebelumnya CustomerApp adalah bagian dari app/App.tsx
// monolitik (~5100 baris) yang ikut ter-parse & ter-load browser SETIAP kali
// aplikasi dibuka, walau yang login adalah DRIVER atau ADMIN sekalipun.
// Dipisah ke file sendiri supaya bisa di-lazy-load lewat React.lazy() --
// kode ini sekarang hanya diunduh browser saat benar-benar dibutuhkan
// (role customer terpilih), bukan di initial bundle.

/** Fallback ringan ditampilkan sementara komponen peta (Leaflet, lazy-loaded)
 * sedang diunduh — hanya terjadi sekali per sesi browser (setelah itu ke-cache). */
function MapLoadingFallback() {
  return (
    <div className="h-[220px] rounded-xl border border-[#23583E] bg-[#06170E] flex items-center justify-center">
      <span className="text-[10px] text-[#A5C9B8] animate-pulse">Memuat peta...</span>
    </div>
  );
}

const LocationPicker = React.lazy(() => import('../components/map/LocationPicker'));
const LiveTripMap = React.lazy(() => import('../components/map/LiveTripMap'));


const EXTERNAL_PROOF_METHODS = ['QRIS', 'TRANSFER', 'EWALLET'];
const isExternalPaymentPending = (order: any) =>
  order?.status === 'COMPLETED' &&
  !order?.isPaid &&
  EXTERNAL_PROOF_METHODS.includes(order?.paymentMethod);

interface PortalProps {
  onBack: () => void;
  triggerToast: (m: string) => void;
}

function CustomerApp({ onBack, triggerToast }: PortalProps) {
  const { login, logout, user } = useAuthStore();
  const queryClient = useQueryClient();

  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Booking details form states
  // PERBAIKAN: sebelumnya default-nya "Alun-Alun Kota Wisata Batu" /
  // "Stasiun Malang Kotabaru" (lengkap dengan koordinat asli di bawah) —
  // customer bisa langsung submit order tanpa pernah benar-benar memilih
  // lokasi. Sekarang kosong sampai customer benar-benar mencari/memilih.
  const [pickup, setPickup] = useState('');
  const [dropoff, setDropoff] = useState('');
  const [service, setService] = useState<'BIKE' | 'CAR' | 'SEND'>('BIKE');
  const [sendItemDescription, setSendItemDescription] = useState('');
  const [sendPackageSize, setSendPackageSize] = useState<'SMALL' | 'MEDIUM' | 'LARGE'>('SMALL');
  const [sendWeightKg, setSendWeightKg] = useState('');
  const [sendHandlingNotes, setSendHandlingNotes] = useState('');
  const [sendVehicleRequirement, setSendVehicleRequirement] = useState<'AUTO' | 'BIKE' | 'CAR'>('AUTO');
  // 🆕 (Link Merchant <-> Order): toggle modal belanja dari toko.
  const [showMerchantModal, setShowMerchantModal] = useState(false);
  const [topupAmount, setTopupAmount] = useState('');

  // Fetch real customer profile
  const { data: profileData, isLoading: isProfileLoading, refetch: refetchProfile } = useQuery({
    queryKey: ['customerProfile'],
    queryFn: CustomerAPI.getProfile,
    enabled: !!user,
  });

  // Fetch customer orders
  const { data: ordersData, isLoading: isOrdersLoading, isError: isOrdersError, refetch: refetchOrders } = useQuery({
    queryKey: ['customerOrders'],
    queryFn: CustomerAPI.getOrders,
    enabled: !!user,
  });

  // Modal states & mutations
  const [showQrisScanner, setShowQrisScanner] = useState(false);
  const [isTopupModalOpen, setIsTopupModalOpen] = useState(false);
  // 🆕 AUTO-HIDE (perbaikan): sebelumnya widget Saldo Dompet & Riwayat Order
  // hanya disembunyikan KETIKA ada perjalanan aktif — jadi di kondisi normal
  // (tidak ada perjalanan) keduanya tetap tampil penuh seperti semula. Sesuai
  // masukan, sekarang keduanya collapsed/tersembunyi SECARA DEFAULT (persis
  // seperti panel "Pengaturan Tampilan & Aksesibilitas" di dashboard utama),
  // dan baru terbuka kalau customer sengaja mengetuk headernya. Saat ada
  // perjalanan aktif, keduanya tetap otomatis disembunyikan total (Mode
  // Fokus) tanpa bisa dibuka manual.
  const [showWalletDetails, setShowWalletDetails] = useState(false);
  const [showRideHistory, setShowRideHistory] = useState(false);
  const [showPickupMap, setShowPickupMap] = useState(false);
  const [showDropoffMap, setShowDropoffMap] = useState(false);
  const activeOrderFocusRef = React.useRef<HTMLDivElement | null>(null);
  const focusedOrderIdRef = React.useRef<string | null>(null);

  const cancelOrderMutation = useMutation({
    mutationFn: (orderId: string) => OrderAPI.updateStatus(orderId, 'CANCELLED'),
    onSuccess: () => {
      triggerToast('Pesanan berhasil dibatalkan!');
      queryClient.invalidateQueries({ queryKey: ['customerOrders'] });
    },
    onError: (err: any) => {
      triggerToast(err.response?.data?.error || 'Gagal membatalkan pesanan!');
    },
  });

  const topupMutation = useMutation({
    mutationFn: (amount: number) => CustomerAPI.topupWallet(amount),
    onSuccess: (res: any) => {
      triggerToast(res?.message || 'Permintaan top up berhasil dikirim! Menunggu verifikasi & persetujuan Admin.');
      setTopupAmount('');
      queryClient.invalidateQueries({ queryKey: ['customerProfile'] });
    },
    onError: (err: any) => {
      triggerToast(err.response?.data?.error || 'Gagal mengajukan top up!');
    },
  });

  const orderMutation = useMutation({
    mutationFn: (payload: any) => CustomerAPI.createOrder(payload),
    onSuccess: (res: any) => {
      const finalFare = res?.breakdown?.finalFare;
      const orderNumber = res?.order?.orderNumber || (res?.order?.id ? `DHN-${String(res.order.id).replace(/-/g, '').slice(0, 8).toUpperCase()}` : '');
      triggerToast(
        finalFare !== undefined
          ? `Order ${orderNumber} dipublikasikan! Tarif final: ${formatRupiah(finalFare)}`
          : `${orderNumber ? `Order ${orderNumber}` : 'Order'} berhasil dipublikasikan!`
      );
      // 🆕 FIX: sebelumnya publikasi order (semua layanan, termasuk
      // ride/BIKE/CAR) sama sekali tidak berbunyi apa pun -- hanya toast
      // teks tanpa suara, beda dengan dashboard Merchant yang selalu
      // berbunyi bel untuk order masuk. Sekarang dikasih 1x bunyi bel
      // singkat sebagai konfirmasi audible bahwa order berhasil
      // dipublikasikan & sedang dicarikan driver.
      try {
        playBellRingSound();
      } catch (error) {
        console.error('❌ Gagal memutar bunyi konfirmasi order:', error);
      }
      // Auto clear pencarian alamat setelah sukses membuat order
      setPickup('');
      setDropoff('');
      setPickupCoords(null);
      setDropoffCoords(null);
      setShowPickupMap(false);
      setShowDropoffMap(false);
      setExtraStops([]);
      setRouteResetKey((k) => k + 1);
      queryClient.invalidateQueries({ queryKey: ['customerOrders'] });
    },
    onError: (err: any) => {
      triggerToast(err.response?.data?.error || 'Gagal mempublikasikan order!');
    },
  });

  const handleSwapRoute = () => {
    const tempPickup = pickup;
    const tempDropoff = dropoff;
    setPickup(tempDropoff);
    setDropoff(tempPickup);

    const tempPickupCoords = pickupCoords;
    const tempDropoffCoords = dropoffCoords;
    setPickupCoords(tempDropoffCoords);
    setDropoffCoords(tempPickupCoords);
    triggerToast('↔️ Rute Penjemputan dan Tujuan berhasil ditukar!');
  };

  const handleResetRoute = () => {
    setPickup('');
    setDropoff('');
    setPickupCoords(null);
    setDropoffCoords(null);
    setShowPickupMap(false);
    setShowDropoffMap(false);
    setExtraStops([]);
    setRouteResetKey((k) => k + 1);
    triggerToast('🧹 Pencarian alamat rute berhasil di-reset!');
  };

  // Membayar order yang sudah COMPLETED — ini yang benar-benar memindahkan saldo
  // dari wallet customer ke wallet driver (dipotong komisi platform).
  // idempotencyKey dibuat unik per klik supaya aman diklik ulang tanpa dobel potong saldo.
  const emailReceiptMutation = useMutation({
    mutationFn: (orderId: string) => CustomerAPI.sendReceiptEmail(orderId),
    onSuccess: (res: any) => triggerToast(res.message || 'Struk dikirim!'),
    onError: (err: any) => triggerToast(err.response?.data?.error || 'Gagal mengirim struk ke email!'),
  });

  const payMutation = useMutation({
    mutationFn: (orderId: string) =>
      PaymentAPI.chargeOrder(orderId, `pay-${orderId}-${Date.now()}-${Math.random().toString(36).slice(2)}`),
    onSuccess: (res: any) => {
      triggerToast(res.message || 'Pembayaran berhasil! Saldo sudah dipotong.');
      queryClient.invalidateQueries({ queryKey: ['customerOrders'] });
      queryClient.invalidateQueries({ queryKey: ['customerProfile'] });
    },
    onError: (err: any) => {
      triggerToast(err.response?.data?.error || 'Gagal memproses pembayaran!');
    },
  });

  const [tipAmounts, setTipAmounts] = useState<Record<string, string>>({});
  const tipMutation = useMutation({
    mutationFn: ({ orderId, amount }: { orderId: string; amount: number }) => CustomerAPI.giveDriverTip(orderId, amount),
    onSuccess: (res: any, variables) => {
      triggerToast(res?.message || 'Tips berhasil dikirim kepada driver.');
      setTipAmounts((current) => ({ ...current, [variables.orderId]: '' }));
      queryClient.invalidateQueries({ queryKey: ['customerOrders'] });
      queryClient.invalidateQueries({ queryKey: ['customerProfile'] });
    },
    onError: (err: any) => triggerToast(err.response?.data?.error || 'Gagal mengirim tips.'),
  });

  // Upload bukti bayar manual (QRIS/Transfer/E-Wallet) — belum ada gateway otomatis,
  // jadi customer upload foto bukti transfer/screenshot, lalu Admin meninjau & menyetujui.
  const [proofUploadOrderId, setProofUploadOrderId] = useState<string | null>(null);
  const [proofNote, setProofNote] = useState('');
  const submitProofMutation = useMutation({
    mutationFn: async ({ orderId, method, file }: { orderId: string; method: 'QRIS' | 'TRANSFER' | 'EWALLET'; file: File }) => {
      const uploaded = await UploadAPI.uploadImage(file);
      return PaymentAPI.submitProof(orderId, method, uploaded.url, proofNote || undefined);
    },
    onSuccess: (res: any) => {
      triggerToast(res.message || 'Bukti bayar berhasil diupload! Menunggu peninjauan Admin.');
      setProofUploadOrderId(null);
      setProofNote('');
      queryClient.invalidateQueries({ queryKey: ['customerOrders'] });
    },
    onError: (err: any) => {
      triggerToast(err.response?.data?.error || 'Gagal mengupload bukti bayar!');
    },
  });

  // Titik jemput & tujuan sekarang dipilih SUNGGUHAN oleh customer lewat peta
  // (OpenStreetMap via Leaflet, gratis tanpa API key) — bukan lagi koordinat acak.
  // Jarak dihitung dari titik yang benar-benar dipilih dengan Haversine — harga FINAL
  // tetap dihitung ulang & otoritatif di server lewat Tariff Engine, angka di sini
  // cuma estimasi kasar untuk pratinjau sebelum submit.
  const [pickupCoords, setPickupCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [dropoffCoords, setDropoffCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [deviceCoords, setDeviceCoords] = useState<{ lat: number; lng: number } | null>(null);
  useEffect(() => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (position) => setDeviceCoords({ lat: position.coords.latitude, lng: position.coords.longitude }),
      () => undefined,
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 60000 },
    );
  }, []);
  const availabilityCoords = pickupCoords || deviceCoords;
  const { data: nearbyDriversData, isFetching: isCheckingNearbyDrivers } = useQuery({
    queryKey: ['nearbyDriverAvailability', availabilityCoords?.lat, availabilityCoords?.lng, service, sendVehicleRequirement, sendPackageSize, sendWeightKg],
    queryFn: () => LocationAPI.getNearbyAvailability(
      availabilityCoords!.lat,
      availabilityCoords!.lng,
      service,
      5,
      service === 'SEND' && (sendPackageSize === 'LARGE' || Number(sendWeightKg || 0) > 20) ? 'CAR' : service === 'SEND' ? sendVehicleRequirement : 'AUTO',
    ),
    enabled: !!user && Boolean(availabilityCoords),
    refetchInterval: availabilityCoords ? 15000 : false,
    refetchIntervalInBackground: true,
  });
  // PERBAIKAN: LocationPicker punya kotak pencarian internal sendiri (uncontrolled) —
  // memanggil setPickup('')/setPickupCoords(null) dari parent TIDAK otomatis
  // mengosongkan teks yang sudah diketik di kotak pencariannya. resetKey dipakai
  // sebagai `key` prop supaya React me-remount LocationPicker sepenuhnya saat
  // rute direset (baik lewat tombol "Reset Alamat" maupun otomatis setelah order
  // berhasil dibuat), sehingga kotak pencariannya benar-benar ikut bersih.
  const [routeResetKey, setRouteResetKey] = useState(0);
  const [extraStops, setExtraStops] = useState<Array<{ address: string; coords: { lat: number; lng: number } | null; note: string; key: number }>>([]);
  const addExtraStop = () => {
    if (extraStops.length >= 4) return triggerToast('Maksimal 4 tujuan tambahan.');
    setExtraStops((items) => [...items, { address: '', coords: null, note: '', key: Date.now() + items.length }]);
  };
  const updateExtraStop = (index: number, patch: any) => setExtraStops((items) => items.map((item, i) => i === index ? { ...item, ...patch } : item));
  const removeExtraStop = (index: number) => setExtraStops((items) => items.filter((_, i) => i !== index));
  const [driverCoords, setDriverCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [martPickupNotice, setMartPickupNotice] = useState<{ kind: 'heading' | 'arrived' | 'headingCustomer' | 'arrivedCustomer'; orderNumber?: string; message: string } | null>(null);

  // Active order detection
  const activeOrder = ordersData?.orders?.find(
    (o: any) =>
      ['PENDING', 'ACCEPTED', 'ON_THE_WAY', 'ARRIVED', 'PICKED_UP', 'ARRIVED_CUSTOMER'].includes(o.status) ||
      isExternalPaymentPending(o)
  );

  useEffect(() => {
    if (!activeOrder?.id || focusedOrderIdRef.current === activeOrder.id) return;
    focusedOrderIdRef.current = activeOrder.id;
    window.setTimeout(() => activeOrderFocusRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 150);
  }, [activeOrder?.id]);

  // Durable UI fallback: if the customer opens/reloads the dashboard after
  // the realtime event was emitted, reconstruct the MART pickup notification
  // from the authoritative order status instead of relying on Socket.IO only.
  useEffect(() => {
    if (!activeOrder || activeOrder.serviceType !== 'MART') {
      setMartPickupNotice(null);
      return;
    }
    const orderNumber = activeOrder.orderNumber || `DHN-${String(activeOrder.id).replace(/-/g, '').slice(0, 8).toUpperCase()}`;
    if (activeOrder.status === 'ACCEPTED' || activeOrder.status === 'ON_THE_WAY') {
      setMartPickupNotice({
        kind: 'heading',
        orderNumber,
        message: 'Driver sedang menuju lokasi merchant untuk mengambil pesanan Anda.',
      });
    } else if (activeOrder.status === 'ARRIVED') {
      setMartPickupNotice({
        kind: 'arrived',
        orderNumber,
        message: 'Driver telah tiba di lokasi merchant dan sedang mengambil pesanan Anda.',
      });
    } else if (activeOrder.status === 'PICKED_UP') {
      setMartPickupNotice({
        kind: 'headingCustomer',
        orderNumber,
        message: 'Pesanan sudah diambil driver dan sedang menuju lokasi Anda.',
      });
    } else if (activeOrder.status === 'ARRIVED_CUSTOMER') {
      setMartPickupNotice({
        kind: 'arrivedCustomer',
        orderNumber,
        message: 'Driver telah tiba di lokasi Anda.',
      });
    } else if (activeOrder.status === 'PENDING') {
      setMartPickupNotice(null);
    }
  }, [activeOrder?.id, activeOrder?.status, activeOrder?.serviceType, activeOrder?.orderNumber]);

  // Join active order socket room
  useEffect(() => {
    if (activeOrder) {
      const roomId = `order_${activeOrder.id}`;
      joinRoom(roomId)
        .then(() => {
          console.log(`Customer joined active order room: ${roomId}`);
        })
        .catch((err) => {
          console.error('Customer failed to join room:', err);
        });
    } else {
      setDriverCoords(null);
    }
  }, [activeOrder]);

  // Listen to driver location & order status updates in realtime
  useEffect(() => {
    const handleLocationChanged = (data: { driverId: string; lat: number; lng: number }) => {
      console.log('Location update received:', data);
      setDriverCoords({ lat: data.lat, lng: data.lng });
    };

    const handleOrderAccepted = (data: any) => {
      console.log('Order accepted socket event:', data);
      queryClient.invalidateQueries({ queryKey: ['customerOrders'] });
      // 🆕 FIX: sebelumnya event ini (order diterima driver) tidak berbunyi
      // sama sekali -- hanya toast teks. Untuk layanan ride (BIKE/CAR) ini
      // momen penting yang layak dikasih notifikasi bunyi, sama seperti
      // notifikasi order masuk di dashboard Merchant.
      try {
        playBellRingSound();
      } catch (error) {
        console.error('❌ Gagal memutar bunyi notifikasi order diterima:', error);
      }
      // Backend sekarang mengirim driver.fullName & driver.vehiclePlate
      // (lihat order.service.ts / dispatch.service.ts / job.routes.ts) —
      // field ini memang bisa kosong sesaat kalau relasi driver belum
      // ter-load, jadi tetap ada fallback pesan generik.
      triggerToast(
        data?.driver?.fullName
          ? `🎉 ${data.orderNumber ? `Order ${data.orderNumber}` : 'Orderan'} DITERIMA oleh ${data.driver.fullName}! (${data.driver.vehiclePlate || 'Mitra Driver'})`
          : `🎉 ${data.orderNumber ? `Order ${data.orderNumber}` : 'Orderan Anda'} telah diterima oleh Mitra Driver!`
      );
    };

    const handleMartDriverHeading = (data: any) => {
      queryClient.invalidateQueries({ queryKey: ['customerOrders'] });
      setMartPickupNotice({
        kind: 'heading',
        orderNumber: data?.orderNumber,
        message: data?.message || 'Driver sedang menuju lokasi merchant untuk mengambil pesanan Anda.',
      });
      triggerToast(`🏪 ${data?.orderNumber ? `Order ${data.orderNumber}: ` : ''}Driver menuju merchant.`);
    };

    const handleMartDriverArrived = (data: any) => {
      queryClient.invalidateQueries({ queryKey: ['customerOrders'] });
      setMartPickupNotice({
        kind: 'arrived',
        orderNumber: data?.orderNumber,
        message: data?.message || 'Driver telah tiba di lokasi merchant dan sedang mengambil pesanan Anda.',
      });
      triggerToast(`📍 ${data?.orderNumber ? `Order ${data.orderNumber}: ` : ''}Driver telah tiba di merchant.`);
    };

    const handleMartDriverHeadingCustomer = (data: any) => {
      queryClient.invalidateQueries({ queryKey: ['customerOrders'] });
      setMartPickupNotice({
        kind: 'headingCustomer',
        orderNumber: data?.orderNumber,
        message: data?.message || 'Pesanan sudah diambil driver dan sedang menuju lokasi Anda.',
      });
      triggerToast(`🚚 ${data?.orderNumber ? `Order ${data.orderNumber}: ` : ''}Driver menuju customer.`);
    };

    const handleMartDriverArrivedCustomer = (data: any) => {
      queryClient.invalidateQueries({ queryKey: ['customerOrders'] });
      setMartPickupNotice({
        kind: 'arrivedCustomer',
        orderNumber: data?.orderNumber,
        message: data?.message || 'Driver telah tiba di lokasi Anda.',
      });
      triggerToast(`📍 ${data?.orderNumber ? `Order ${data.orderNumber}: ` : ''}Driver telah tiba di customer.`);
    };

    const handleOrderStopChanged = (payload: any) => {
      queryClient.invalidateQueries({ queryKey: ['customerOrders'] });
      const stop = payload?.stop;
      if (stop) triggerToast(stop.status === 'ARRIVED' ? `📍 Driver tiba di tujuan ${stop.sequence}` : `✅ Tujuan ${stop.sequence} selesai`);
    };
    const handleOrderStatusChanged = (data: any) => {
      console.log('Order status changed socket event:', data);
      queryClient.invalidateQueries({ queryKey: ['customerOrders'] });
      if (data?.status) {
        const isMart = data?.serviceType === 'MART';
        const isSend = data?.serviceType === 'SEND';
        const statusMap: Record<string, string> = {
          ACCEPTED: 'Driver menerima pesanan',
          ON_THE_WAY: isMart ? 'Driver sedang menuju merchant' : isSend ? 'Driver sedang menuju lokasi pengambilan barang' : 'Driver sedang menuju lokasi jemput customer',
          ARRIVED: isMart ? 'Driver telah tiba di lokasi merchant' : isSend ? 'Driver telah tiba di lokasi pengambilan barang' : 'Driver telah tiba di lokasi jemput customer',
          PICKED_UP: isMart ? 'Pesanan diambil, driver menuju customer' : isSend ? 'Barang telah diambil dan sedang menuju penerima' : 'Customer telah dijemput dan perjalanan menuju tujuan',
          ARRIVED_CUSTOMER: isMart ? 'Driver telah tiba di lokasi customer' : isSend ? 'Driver telah tiba di lokasi penerima barang' : 'Driver telah tiba di lokasi tujuan customer',
          ARRIVED_PICKUP: 'Driver telah tiba di lokasi penjemputan',
          IN_PROGRESS: 'Dalam perjalanan menuju lokasi tujuan',
          COMPLETED: 'Order telah selesai',
          CANCELLED: 'Pesanan telah dibatalkan',
        };
        triggerToast(`🔔 Update Perjalanan: ${statusMap[data.status] || data.status}`);
      }
    };

    const handlePaymentProofRequired = (data: any) => {
      queryClient.invalidateQueries({ queryKey: ['customerOrders'] });
      playBellRingSound();
      triggerToast(`💳 ${data?.message || 'Perjalanan sudah tiba di tujuan. Silakan upload bukti bayar agar order dapat diselesaikan.'}`);
    };
    const handlePaymentProofSubmitted = (data: any) => {
      queryClient.invalidateQueries({ queryKey: ['customerOrders'] });
      triggerToast(`⏳ ${data?.message || 'Bukti bayar sedang ditinjau Admin.'}`);
    };
    const handlePaymentProofRejected = (data: any) => {
      queryClient.invalidateQueries({ queryKey: ['customerOrders'] });
      playBellRingSound();
      triggerToast(`⚠️ ${data?.message || 'Bukti bayar ditolak. Silakan upload ulang.'}`);
    };
    const handlePaymentConfirmed = () => {
      queryClient.invalidateQueries({ queryKey: ['customerOrders'] });
      triggerToast('✅ Pembayaran disetujui. Order sekarang benar-benar selesai.');
    };

    socket.on('location_changed', handleLocationChanged);
    socket.on('order_accepted', handleOrderAccepted);
    socket.on('mart_driver_heading_to_merchant', handleMartDriverHeading);
    socket.on('mart_driver_arrived_at_merchant', handleMartDriverArrived);
    socket.on('mart_driver_heading_to_customer', handleMartDriverHeadingCustomer);
    socket.on('mart_driver_arrived_at_customer', handleMartDriverArrivedCustomer);
    socket.on('order_status_changed', handleOrderStatusChanged);
    socket.on('order_stop_changed', handleOrderStopChanged);
    socket.on('payment_proof_required', handlePaymentProofRequired);
    socket.on('payment_proof_submitted', handlePaymentProofSubmitted);
    socket.on('payment_proof_rejected', handlePaymentProofRejected);
    socket.on('payment_confirmed', handlePaymentConfirmed);
    socket.on('order_paid', handlePaymentConfirmed);

    return () => {
      socket.off('location_changed', handleLocationChanged);
      socket.off('order_accepted', handleOrderAccepted);
      socket.off('mart_driver_heading_to_merchant', handleMartDriverHeading);
      socket.off('mart_driver_arrived_at_merchant', handleMartDriverArrived);
      socket.off('mart_driver_heading_to_customer', handleMartDriverHeadingCustomer);
      socket.off('mart_driver_arrived_at_customer', handleMartDriverArrivedCustomer);
      socket.off('order_stop_changed', handleOrderStopChanged);
      socket.off('order_status_changed', handleOrderStatusChanged);
      socket.off('payment_proof_required', handlePaymentProofRequired);
      socket.off('payment_proof_submitted', handlePaymentProofSubmitted);
      socket.off('payment_proof_rejected', handlePaymentProofRejected);
      socket.off('payment_confirmed', handlePaymentConfirmed);
      socket.off('order_paid', handlePaymentConfirmed);
    };
  }, [queryClient, triggerToast]);


  const [paymentMethod, setPaymentMethod] = useState<'WALLET' | 'CASH' | 'QRIS' | 'TRANSFER' | 'EWALLET'>('WALLET');
  const estimatedDistanceKm = (() => {
    if (!pickupCoords || !dropoffCoords) return 0;
    const points = [pickupCoords, dropoffCoords, ...extraStops.map((s) => s.coords).filter(Boolean) as { lat: number; lng: number }[]];
    return points.slice(1).reduce((total, point, index) => total + calculateHaversineDistance(points[index].lat, points[index].lng, point.lat, point.lng), 0);
  })();
  // Estimasi kasar hanya untuk pratinjau UI — bukan harga final (final dihitung server).
  const calculatedPrice =
    service === 'BIKE' ? 5000 + estimatedDistanceKm * 2000 :
    service === 'CAR' ? 15000 + estimatedDistanceKm * 3500 :
    8000 + estimatedDistanceKm * 2500;

  const handleTopup = (e: React.FormEvent) => {
    e.preventDefault();
    const amount = parseInt(topupAmount);
    if (isNaN(amount) || amount <= 0) {
      triggerToast('Nominal top up tidak valid!');
      return;
    }
    topupMutation.mutate(amount);
  };

  // Cetak struk perjalanan — pakai fitur print bawaan browser (Ctrl+P / window.print()),
  // GRATIS dan tidak butuh layanan pihak ketiga apa pun. Kirim struk otomatis lewat email
  // butuh SMTP (lihat backend/src/config/mailer.ts) — untuk versi awal ini, cetak/simpan-PDF
  // manual dari dialog print browser sudah cukup untuk kebutuhan bukti transaksi.
  const printReceipt = (order: any) => {
    const win = window.open('', '_blank', 'width=380,height=600');
    if (!win) return;
    const finalPrice = Number(order.price) - Number(order.discount || 0);
    win.document.write(`
      <html>
        <head>
          <title>Struk DHUKNOO #${order.id.slice(0, 8)}</title>
          <style>
            body { font-family: 'Courier New', monospace; padding: 20px; color: #111; font-size: 12px; }
            h1 { font-size: 16px; text-align: center; margin-bottom: 0; }
            p.sub { text-align: center; font-size: 10px; margin-top: 4px; color: #555; }
            hr { border: none; border-top: 1px dashed #999; margin: 12px 0; }
            .row { display: flex; justify-content: space-between; margin: 4px 0; }
            .total { font-weight: bold; font-size: 14px; }
            .footer { text-align: center; margin-top: 16px; font-size: 10px; color: #555; }
          </style>
        </head>
        <body>
          <h1>DHUKNOO Platform</h1>
          <p class="sub">Ojek Batu - Malang Raya</p>
          <hr />
          <div class="row"><span>No. Order</span><span>#${order.id.slice(0, 8)}</span></div>
          <div class="row"><span>Tanggal</span><span>${new Date(order.createdAt).toLocaleString('id-ID')}</span></div>
          <div class="row"><span>Layanan</span><span>${order.serviceType}</span></div>
          <div class="row"><span>Metode Bayar</span><span>${order.paymentMethod}</span></div>
          <hr />
          <div class="row"><span>Jemput</span><span style="text-align:right;max-width:200px;">${order.pickupAddress}</span></div>
          <div class="row"><span>Tujuan</span><span style="text-align:right;max-width:200px;">${order.dropoffAddress}</span></div>
          <div class="row"><span>Driver</span><span>${order.driver?.user?.fullName || '-'}</span></div>
          <hr />
          <div class="row"><span>Tarif</span><span>${formatRupiah(Number(order.price))}</span></div>
          ${Number(order.discount) > 0 ? `<div class="row"><span>Diskon</span><span>-${formatRupiah(Number(order.discount))}</span></div>` : ''}
          <div class="row total"><span>Total</span><span>${formatRupiah(finalPrice)}</span></div>
          <hr />
          <p class="footer">Terima kasih telah menggunakan DHUKNOO!<br/>Struk ini sah tanpa tanda tangan.</p>
        </body>
      </html>
    `);
    win.document.close();
    win.focus();
    win.print();
  };

  const handleBooking = (e: React.FormEvent) => {
    e.preventDefault();
    if (!pickup || !dropoff) {
      triggerToast('Mohon isi alamat jemput dan tujuan!');
      return;
    }
    if (!pickupCoords || !dropoffCoords) {
      triggerToast('Mohon pilih titik penjemputan DAN tujuan di peta (klik pada peta)!');
      return;
    }
    if (extraStops.some((stop) => !stop.address || !stop.coords)) {
      triggerToast('Lengkapi semua tujuan tambahan atau hapus tujuan yang belum diisi.');
      return;
    }
    if (service === 'SEND') {
      const weight = Number(sendWeightKg);
      if (sendItemDescription.trim().length < 3) return triggerToast('Isi deskripsi barang minimal 3 karakter.');
      if (!Number.isFinite(weight) || weight <= 0) return triggerToast('Isi perkiraan berat barang yang valid.');
      if ((sendPackageSize === 'LARGE' || weight > 20) && sendVehicleRequirement === 'BIKE') {
        return triggerToast('Barang besar atau di atas 20 kg wajib menggunakan mobil.');
      }
    }

    orderMutation.mutate({
      serviceType: service,
      distanceKm: estimatedDistanceKm,
      pickupAddress: pickup,
      pickupLat: pickupCoords.lat,
      pickupLng: pickupCoords.lng,
      dropoffAddress: dropoff,
      dropoffLat: dropoffCoords.lat,
      dropoffLng: dropoffCoords.lng,
      extraStops: extraStops.map((stop) => ({ address: stop.address, lat: stop.coords!.lat, lng: stop.coords!.lng, note: stop.note || undefined })),
      paymentMethod,
      ...(service === 'SEND' ? {
        itemDescription: sendItemDescription.trim(),
        packageSize: sendPackageSize,
        estimatedWeightKg: Number(sendWeightKg),
        handlingNotes: sendHandlingNotes.trim() || undefined,
        vehicleRequirement: sendVehicleRequirement,
      } : {}),
    });
  };

  if (!user) {
    return (
      <AuthFlow 
        role="CUSTOMER" 
        onBack={onBack} 
        onSuccess={(u, t, rt) => login(u, t, rt)} 
        triggerToast={triggerToast} 
      />
    );
  }

  return (
    <div className="w-full max-w-7xl mx-auto px-4 py-8 flex flex-col gap-6 flex-1">
      {/* Title Panel */}
      <div className="sticky top-[70px] z-30 flex items-center justify-between gap-2 bg-[#0D2E1F] px-3 sm:px-4 py-2.5 rounded-2xl border border-[#23583E] shadow-lg shadow-[#06170E]/30">
        <div className="flex items-center gap-2 min-w-0">
          <span className="w-9 h-9 rounded-xl bg-[#FFD700]/15 flex items-center justify-center text-lg shrink-0">👤</span>
          <div className="min-w-0">
            <h2 className="text-sm sm:text-base font-black text-[#FFD700] truncate">Portal Customer</h2>
            <p className="text-[9px] text-white font-bold truncate">{profileData?.fullName || user?.fullName || user?.email || 'Memuat akun...'}</p>
            <p className="hidden sm:block text-[8px] text-[#A5C9B8] truncate">Layanan DHUKNOO</p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <div
            className="h-9 flex items-center gap-1.5 rounded-xl border border-[#00E575]/40 bg-[#00E575]/10 px-2 sm:px-3 text-[#00E575]"
            title="Integrasi genggam OS aktif"
          >
            <Smartphone className="w-4 h-4" />
            <span className="hidden md:inline text-[10px] font-bold">OS Terhubung</span>
          </div>
          <button 
            onClick={() => {
              refetchProfile();
              refetchOrders();
              triggerToast('Sinkronisasi data backend berhasil!');
            }}
            className="flex items-center gap-1.5 bg-[#23583E] hover:bg-[#23583E]/80 text-[#00E575] text-[10px] font-bold px-3 py-2 rounded-xl transition-all"
          >
            <RefreshCw className="w-4 h-4" />
            <span className="hidden sm:inline">Segarkan</span>
          </button>
        </div>
      </div>

      {/* Indikator privat: hanya jumlah driver eligible dan jarak terdekat,
          tanpa membuka identitas maupun koordinat driver. */}
      <div className="flex items-center justify-between gap-3 bg-[#0D2E1F] border border-[#23583E] px-3 py-2.5 rounded-2xl text-[10px]">
        <span className="flex items-center gap-2 text-[#A5C9B8] min-w-0">
          <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${Number(nearbyDriversData?.data?.availableCount || 0) > 0 ? 'bg-[#00E575] animate-pulse' : 'bg-[#FFD700]'}`} />
          <span className="truncate">Driver {service} online di sekitar {pickupCoords ? 'titik jemput' : 'lokasi Anda'}</span>
        </span>
        <span className="font-black text-white shrink-0">
          {!availabilityCoords
            ? 'Aktifkan GPS / pilih jemput'
            : isCheckingNearbyDrivers
              ? 'Memeriksa...'
              : `${Number(nearbyDriversData?.data?.availableCount || 0)} tersedia${nearbyDriversData?.data?.nearestDistanceKm != null ? ` • ±${nearbyDriversData.data.nearestDistanceKm} km` : ''}`}
        </span>
      </div>

      {/* 🎯 MODE FOKUS PERJALANAN AKTIF
          🆕 FIX: sebelumnya banner ini ditaruh di PALING BAWAH grid
          (menggantikan kolom kanan), jadi customer harus scroll melewati
          seluruh kartu perjalanan + chat driver dulu baru terlihat — nyaris
          tidak kebaca. Sekarang dipindah ke PALING ATAS halaman (tepat di
          bawah judul portal, sebelum kartu perjalanan/chat) dan dibuat
          `sticky` supaya tetap terlihat di tengah layar walau discroll. */}
      {activeOrder && (
        <div ref={activeOrderFocusRef} className="bg-[#0D2E1F] border-2 border-[#00E575] shadow-[0_0_25px_-5px_rgba(0,229,117,0.4)] p-4 rounded-3xl flex flex-col items-center gap-1 text-center scroll-mt-24">
          <span className="text-2xl leading-none">🎯</span>
          <span className="text-sm font-black text-[#00E575]">Mode Fokus Perjalanan Aktif</span>
          <p className="text-[11px] text-[#A5C9B8]/80 max-w-md">
            Saldo Dompet & Riwayat Order Perjalanan disembunyikan sementara supaya Anda fokus memantau perjalanan yang sedang berlangsung di bawah ini. Panel akan muncul kembali setelah perjalanan selesai.
          </p>
        </div>
      )}

      {/* Main Layout Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Left Column: Wallet & Bookings
            🎯 MODE FOKUS PERJALANAN: saat ada activeOrder, kolom ini melebar
            penuh (lg:col-span-3) supaya perjalanan yang sedang berlangsung
            jadi pusat perhatian, sementara kolom kanan (riwayat, dsb) auto-hide
            — lihat kondisi di bawah. */}
        <div className={`flex flex-col gap-6 ${activeOrder ? 'lg:col-span-3' : 'lg:col-span-2'}`}>
          {/* Wallet Balance Widget
              🆕 AUTO-HIDE (perbaikan): sekarang collapsed/tersembunyi SECARA
              DEFAULT — hanya header ringkas (saldo + tombol expand) yang
              selalu terlihat. Detail lengkap (ID Dompet, form isi ulang)
              baru muncul kalau customer mengetuk headernya. Saat ada
              perjalanan aktif, seluruh widget ini (termasuk headernya)
              disembunyikan total — bagian dari Mode Fokus Perjalanan. */}
          {!activeOrder && (
          <div className="bg-[#0D2E1F] border border-[#23583E] rounded-3xl relative overflow-hidden">
            <button
              type="button"
              onClick={() => setShowWalletDetails((v) => !v)}
              aria-expanded={showWalletDetails}
              className="w-full flex items-center justify-between gap-3 p-6 text-left cursor-pointer relative z-10"
            >
              <div className="flex items-center gap-2 text-[#00E575] min-w-0">
                <Wallet className="w-5 h-5 shrink-0" />
                <div className="flex flex-col min-w-0">
                  <span className="font-bold text-sm tracking-wider uppercase">Saldo Dompet DHUKNOO</span>
                  <span className="text-lg font-black text-white truncate">
                    {formatRupiah(Number(profileData?.wallet?.balance || 0))}
                  </span>
                </div>
              </div>
              <ChevronDown
                className={`w-4 h-4 shrink-0 text-[#A5C9B8] transition-transform ${showWalletDetails ? 'rotate-180' : ''}`}
              />
            </button>

            {showWalletDetails && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 px-6 pb-6">
              <div className="absolute top-0 right-0 w-32 h-32 bg-[#FFD700]/5 rounded-full transform translate-x-10 -translate-y-10 pointer-events-none"></div>
              
              <div className="flex flex-col justify-between gap-4">
                {/* 🆕 Nama customer — ditampilkan tepat di atas ID Dompet/saldo,
                    mengisi ruang kosong sejajar dengan status saldo di atasnya. */}
                <div>
                  <span className="text-[10px] text-[#A5C9B8] block">Nama: {profileData?.fullName || 'Memuat...'}</span>
                  <span className="text-[10px] text-[#A5C9B8] block">ID Dompet: {profileData?.wallet?.id || 'Memuat...'}</span>
                </div>
                <p className="text-[10px] text-[#A5C9B8]/70">Dapat diisi ulang secara langsung untuk transaksi ojek otonom.</p>
              </div>

              {/* Top-up Form */}
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  setIsTopupModalOpen(true);
                }}
                className="bg-[#06170E] p-4 rounded-2xl border border-[#23583E] flex flex-col gap-3 justify-center"
              >
                <span className="text-xs font-bold text-[#FFD700] flex items-center gap-1">
                  <PlusCircle className="w-4 h-4" /> Isi Ulang Saldo (Pilihan Metode)
                </span>
                <div className="flex flex-col sm:flex-row gap-2 w-full">
                  <input 
                    type="number" 
                    value={topupAmount}
                    onChange={(e) => setTopupAmount(e.target.value)}
                    placeholder="Nominal (Contoh: 50000)" 
                    className="bg-[#0D2E1F] border border-[#23583E] text-white rounded-xl px-3 py-2 text-xs focus:outline-none focus:border-[#FFD700] w-full min-w-0 sm:flex-1"
                  />
                  <button 
                    type="submit"
                    className="bg-[#00E575] text-[#071F14] hover:bg-[#00ff80] px-4 py-2 rounded-xl text-xs font-bold transition-all whitespace-nowrap w-full sm:w-auto min-h-10"
                  >
                    Pilih Bayar
                  </button>
                </div>
                <div className="grid grid-cols-3 gap-2 w-full">
                  {[20000, 50000, 100000].map((amt) => (
                    <button 
                      key={amt}
                      type="button"
                      onClick={() => {
                        setTopupAmount(String(amt));
                        setIsTopupModalOpen(true);
                      }}
                      className="bg-[#0D2E1F]/60 border border-[#23583E]/50 hover:border-[#FFD700] text-white text-[10px] px-2 py-1 rounded-lg flex-1 text-center font-bold"
                    >
                      +{formatRupiah(amt)}
                    </button>
                  ))}
                </div>
              </form>
            </div>
            )}
          </div>
          )}

          {/* Active Order Live Tracking Map
              🆕 FIX: sekarang dibungkus wrapper `max-w-3xl mx-auto` supaya
              kartu ini benar-benar CENTERED secara visual di tengah layar
              (bukan melebar penuh ke tepi kolom), menjadikannya pusat
              perhatian yang jelas -- sesuai permintaan "fokus centered pada
              live tracking GPS". */}
          {activeOrder && (
            <div className="w-full max-w-3xl mx-auto flex flex-col gap-4">
            <div className="bg-[#0D2E1F] border-2 border-[#00E575] p-6 rounded-3xl flex flex-col gap-4">
              <div className="flex justify-between items-center flex-wrap gap-2">
                <span className="text-xs font-black text-[#00E575] uppercase tracking-wider flex items-center gap-1.5 animate-pulse">
                  {isExternalPaymentPending(activeOrder)
                    ? '💳 Perjalanan Tiba Tujuan — Pembayaran Belum Disetujui'
                    : activeOrder.serviceType === 'MART'
                      ? '🏪 Pesanan Belanja Sedang Diproses'
                      : '🏍️ Perjalanan Aktif Sedang Berlangsung'}
                </span>
                <span className="text-[11px] bg-[#06170E] border border-[#FFD700]/40 text-[#FFD700] px-2.5 py-1 rounded-lg font-black">
                  {activeOrder.orderNumber || `DHN-${String(activeOrder.id).replace(/-/g, '').slice(0, 8).toUpperCase()}`}
                </span>
                <span className="text-[10px] bg-[#00E575]/20 text-[#00E575] px-2.5 py-0.5 rounded font-bold uppercase">
                  Status: {isExternalPaymentPending(activeOrder) ? 'MENUNGGU PEMBAYARAN' : activeOrder.status}
                </span>
              </div>

              {/* 🆕 (Link Merchant <-> Order): rincian belanja untuk order MART.
                  Order lain (BIKE/CAR/SEND) tidak punya merchant/orderItems,
                  jadi blok ini otomatis tidak muncul untuk mereka. */}
              {activeOrder.serviceType === 'MART' && activeOrder.merchant && (
                <div className="bg-[#06170E] border border-[#23583E] p-4 rounded-2xl">
                  <p className="text-xs font-bold text-[#FF6B6B] mb-2">🏪 {activeOrder.merchant.name}</p>
                  <div className="flex flex-col gap-1">
                    {(activeOrder.orderItems || []).map((item: any) => (
                      <div key={item.id} className="flex justify-between text-xs text-[#A5C9B8]">
                        <span>{item.quantity}x {item.name}</span>
                        <span>Rp{Number(item.subtotal).toLocaleString('id-ID')}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {activeOrder.serviceType === 'MART' && martPickupNotice && (
                <div className={`p-4 rounded-2xl border ${martPickupNotice.kind === 'arrived' || martPickupNotice.kind === 'arrivedCustomer' ? 'border-[#00E575] bg-[#00E575]/10' : 'border-cyan-400/60 bg-cyan-400/10'}`}>
                  <div className="flex items-center gap-2 text-xs font-black uppercase tracking-wide">
                    <span>{martPickupNotice.kind === 'arrived' || martPickupNotice.kind === 'arrivedCustomer' ? '📍' : '🏍️'}</span>
                    <span>{martPickupNotice.kind === 'arrived' ? 'Driver Tiba di Merchant' : martPickupNotice.kind === 'headingCustomer' ? 'Driver Menuju Customer' : martPickupNotice.kind === 'arrivedCustomer' ? 'Driver Tiba di Customer' : 'Driver Menuju Merchant'}</span>
                    {martPickupNotice.orderNumber && <span className="ml-auto text-[#FFD700]">{martPickupNotice.orderNumber}</span>}
                  </div>
                  <p className="text-[11px] text-[#D6F5E6] mt-2">{martPickupNotice.message}</p>
                </div>
              )}

              {/* 1-Minute Cancellation Section */}
              {['PENDING', 'ACCEPTED'].includes(activeOrder.status) && (
                <div className="bg-[#06170E] border border-amber-500/40 p-4 rounded-2xl flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                  <div className="flex flex-col text-xs">
                    <span className="font-bold text-amber-400 flex items-center gap-1.5">
                      <Clock className="w-4 h-4" /> 
                      {activeOrder.status === 'PENDING' 
                        ? 'Mencari Mitra Driver...' 
                        : (() => {
                            const elapsed = activeOrder.acceptedAt
                              ? Math.floor((now - new Date(activeOrder.acceptedAt).getTime()) / 1000)
                              // PERBAIKAN: kalau acceptedAt tidak ada (order lama sebelum
                              // migrasi, atau field belum ke-load), anggap SUDAH LEWAT batas
                              // waktu (Infinity), BUKAN 0 detik — fallback lama membuat
                              // tombol cancel gratis muncul TERUS walau harusnya sudah lewat.
                              : Infinity;
                            const rem = Math.max(0, 60 - elapsed);
                            return rem > 0 
                              ? `Sisa Waktu Pembatalan Gratis: ${rem} Detik` 
                              : 'Batas waktu cancel gratis 1 menit telah berlalu. Pembatalan hanya dapat dilakukan oleh Driver.';
                          })()}
                    </span>
                    <span className="text-[10px] text-[#A5C9B8]">
                      {activeOrder.status === 'PENDING'
                        ? 'Anda dapat membatalkan pesanan ini bebas biaya.'
                        : 'Pelanggan hanya dapat membatalkan pesanan dalam 1 menit pertama setelah driver menerima order.'}
                    </span>
                  </div>

                  {(() => {
                    const elapsed = activeOrder.acceptedAt
                      ? Math.floor((now - new Date(activeOrder.acceptedAt).getTime()) / 1000)
                      : Infinity;
                    const canCancel = activeOrder.status === 'PENDING' || elapsed < 60;
                    
                    if (!canCancel) return null;

                    return (
                      <button
                        type="button"
                        onClick={() => cancelOrderMutation.mutate(activeOrder.id)}
                        disabled={cancelOrderMutation.isPending}
                        className="bg-red-500 hover:bg-red-400 text-white font-bold text-xs px-4 py-2 rounded-xl transition-all flex items-center gap-1.5 shrink-0 shadow-md"
                      >
                        <XCircle className="w-4 h-4" />
                        {cancelOrderMutation.isPending ? 'Membatalkan...' : 'Batalkan Pesanan (Bebas Biaya)'}
                      </button>
                    );
                  })()}
                </div>
              )}

              {/* Identitas Driver & Realtime Driver Card */}
              {activeOrder.driver ? (
                <div className="bg-[#06170E] p-4 rounded-2xl border-2 border-[#00E575] flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 shadow-lg">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-2xl bg-[#00E575]/20 border border-[#00E575] flex items-center justify-center text-2xl shrink-0 font-bold text-[#00E575]">
                      {activeOrder.serviceType === 'CAR' ? '🚗' : activeOrder.serviceType === 'SEND' ? '📦' : activeOrder.serviceType === 'MART' ? '🏪' : '🏍️'}
                    </div>
                    <div className="flex flex-col">
                      <div className="flex items-center gap-2">
                        <span className="text-white font-black text-sm">
                          {activeOrder.driver.user?.fullName || activeOrder.driver.user?.email || 'Mitra Driver DHUKNOO'}
                        </span>
                        <span className="bg-[#00E575]/20 text-[#00E575] text-[9px] font-black px-2 py-0.5 rounded-full border border-[#00E575]/40">
                          VERIFIKASI
                        </span>
                      </div>
                      <span className="text-xs text-[#FFD700] font-bold mt-0.5 flex items-center gap-1.5">
                        <span>{activeOrder.driver.vehicleModel || 'Kendaraan Driver'}</span>
                        •
                        <span className="text-white bg-black/80 px-2 py-0.5 rounded font-mono font-black border border-[#23583E] text-[10px]">
                          {activeOrder.driver.vehiclePlate || 'N/A'}
                        </span>
                      </span>
                      <span className="text-[10px] text-[#A5C9B8] mt-0.5">
                        Layanan: <strong className="text-white">{activeOrder.serviceType}</strong> | ID: <code className="text-[#00E575]">DRV-{activeOrder.driver.id.slice(0, 8).toUpperCase()}</code>
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 w-full sm:w-auto shrink-0 mt-2 sm:mt-0">
                    <span className="bg-[#00E575]/20 text-[#00E575] font-black text-[10px] px-3 py-1.5 rounded-xl border border-[#00E575]/40 flex items-center gap-1">
                      <MessageCircle className="w-3.5 h-3.5 text-[#00E575]" /> Chat In-App Aktif
                    </span>
                  </div>
                </div>
              ) : (
                <div className="bg-[#06170E] p-4 rounded-2xl border border-[#23583E] flex items-center gap-3">
                  <span className="text-2xl animate-spin">⏳</span>
                  <div>
                    <span className="text-amber-400 font-bold text-xs block">Mencari Driver Terdekat...</span>
                    <span className="text-[10px] text-gray-400">Sistem sedang mendispatch pesanan Anda ke armada terdekat ({activeOrder.serviceType}).</span>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 bg-[#06170E] p-3 rounded-2xl border border-[#23583E] text-xs">
                <div>
                  <span className="text-gray-400 block text-[9px] uppercase font-bold">Titik Jemput:</span>
                  <span className="text-white block truncate font-medium" title={activeOrder.pickupAddress}>{activeOrder.pickupAddress}</span>
                </div>
                <div>
                  <span className="text-gray-400 block text-[9px] uppercase font-bold">Tujuan Perjalanan:</span>
                  <span className="text-white block truncate font-medium" title={activeOrder.dropoffAddress}>{activeOrder.dropoffAddress}</span>
                </div>
              </div>

              {/* Banner Informasi Metode Pembayaran */}
              <div className="bg-[#06170E] p-3 rounded-2xl border border-[#23583E] flex justify-between items-center text-xs">
                <div>
                  <span className="text-[9px] text-gray-400 block font-bold uppercase">Tarif Perjalanan:</span>
                  <span className="text-white font-black text-sm">{formatRupiah(Number(activeOrder.price))}</span>
                </div>
                <div className="text-right flex flex-col items-end">
                  <span className="text-[9px] text-gray-400 block font-bold uppercase mb-0.5">Keterangan Bayar:</span>
                  <span className={`text-[10px] px-2.5 py-1 rounded-lg font-black border ${
                    activeOrder.paymentMethod === 'CASH'
                      ? 'bg-amber-500/10 text-amber-400 border-amber-500/30'
                      : 'bg-[#00E575]/10 text-[#00E575] border-[#00E575]/30'
                  }`}>
                    {activeOrder.paymentMethod === 'CASH'
                      ? '💵 BAYAR TUNAI (Saat Tiba)'
                      : activeOrder.paymentMethod === 'WALLET'
                      ? '⚡ BAYAR NON-TUNAI (Auto Debet Wallet)'
                      : `💳 BAYAR NON-TUNAI (${activeOrder.paymentMethod})`}
                  </span>
                </div>
              </div>

              {isExternalPaymentPending(activeOrder) && (
                <div className="bg-[#FFD700]/10 border-2 border-[#FFD700] p-4 rounded-2xl flex flex-col gap-3">
                  <div>
                    <div className="text-sm font-black text-[#FFD700]">💳 Pembayaran masih menggantung</div>
                    <p className="text-[11px] text-[#D6F5E6] mt-1">
                      Driver sudah tiba di tujuan, tetapi order belum ditutup. Upload bukti bayar {activeOrder.paymentMethod} dan tunggu persetujuan Admin. Dashboard Customer dan Driver tetap terkunci sampai pembayaran disetujui.
                    </p>
                  </div>
                  {activeOrder.paymentProof?.status === 'PENDING_REVIEW' ? (
                    <div className="bg-[#06170E] border border-[#23583E] rounded-xl p-3 text-[11px] font-bold text-[#A5C9B8]">
                      ⏳ Bukti bayar sudah diupload dan sedang ditinjau Admin.
                    </div>
                  ) : (
                    <div className="flex flex-col gap-2">
                      {activeOrder.paymentProof?.status === 'REJECTED' && (
                        <div className="text-[10px] text-red-400 font-bold">
                          ⚠️ Bukti sebelumnya ditolak{activeOrder.paymentProof.reviewNote ? `: ${activeOrder.paymentProof.reviewNote}` : ''}. Silakan upload ulang.
                        </div>
                      )}
                      <input
                        type="text"
                        placeholder="Catatan pembayaran (opsional)"
                        value={proofNote}
                        onChange={(e) => setProofNote(e.target.value)}
                        className="bg-[#06170E] border border-[#23583E] rounded-xl px-3 py-2 text-[11px] text-white placeholder:text-gray-500 focus:outline-none"
                      />
                      <input
                        type="file"
                        accept="image/*"
                        disabled={submitProofMutation.isPending}
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) submitProofMutation.mutate({ orderId: activeOrder.id, method: activeOrder.paymentMethod, file });
                        }}
                        className="text-[10px] text-[#A5C9B8] file:mr-2 file:py-2 file:px-3 file:rounded-xl file:border-0 file:bg-[#FFD700] file:text-[#06170E] file:text-[10px] file:font-black"
                      />
                      <span className="text-[9px] text-[#A5C9B8]">Upload screenshot/foto bukti pembayaran yang jelas. Setelah Admin approve, dashboard otomatis terbuka kembali.</span>
                    </div>
                  )}
                </div>
              )}

              <Suspense fallback={<MapLoadingFallback />}>
                <LiveTripMap
                  orderId={activeOrder.id}
                  pickupCoords={{ lat: Number(activeOrder.pickupLat), lng: Number(activeOrder.pickupLng) }}
                  dropoffCoords={{ lat: Number(activeOrder.dropoffLat), lng: Number(activeOrder.dropoffLng) }}
                  driverCoords={driverCoords}
                  isDriverSide={false}
                  orderStatus={activeOrder.status}
                />
              </Suspense>

              {/* In-App Direct Chat Box Customer <-> Driver */}
              {activeOrder.driver && (
                <OrderChatBox
                  orderId={activeOrder.id}
                  currentUserId={user?.id || ''}
                  currentUserRole="CUSTOMER"
                  otherPartyName={activeOrder.driver.user?.fullName}
                  otherPartyPhone={activeOrder.driver.phoneNumber}
                />
              )}
            </div>

            {/* 🆕 FIX: sebelumnya kartu "Pesan Baru Terkunci Sementara" ini
                besar & berat (ikon 8x8 + heading + paragraf), menambah
                tinggi halaman & menggeser fokus visual menjauh dari live
                tracking map di atasnya. Sekarang dipadatkan jadi satu baris
                ringkas, tetap di dalam wrapper `max-w-3xl mx-auto` yang sama
                supaya tracking map tetap jadi pusat perhatian yang centered. */}
            <div className="bg-[#0D2E1F]/60 border border-[#FFD700]/30 px-4 py-2.5 rounded-2xl flex items-center gap-2.5 text-left">
              <Lock className="w-4 h-4 text-[#FFD700] shrink-0" />
              <p className="text-[11px] text-[#A5C9B8] leading-snug">
                <span className="font-bold text-[#FFD700]">Pesanan baru terkunci</span>{' '}
                {isExternalPaymentPending(activeOrder)
                  ? <>sampai bukti pembayaran <span className="font-bold text-white">{activeOrder.paymentMethod}</span> diupload dan disetujui Admin.</>
                  : <>selama status <span className="font-bold text-white">{activeOrder.status}</span> masih berjalan. Selesaikan/batalkan perjalanan ini dulu di atas.</>}
              </p>
            </div>
            </div>
          )}

          {/* Ride Booking Form — DIKUNCI selama masih ada order aktif yang belum
              selesai. Sebelumnya form ini SELALU tampil & bisa disubmit walau
              activeOrder ada di atasnya — customer bisa pesan order kedua
              sebelum yang pertama kelar (backend sudah menolak di endpoint,
              tapi UI-nya tidak pernah mencegah/memberi tahu SEBELUM submit).
              🆕 FIX: pesan lock lama (kartu besar) sudah dipindah ke dalam
              wrapper centered di atas (dekat live tracking map), jadi di
              sini cukup render form pemesanan normal saat TIDAK ada
              activeOrder saja. */}
          {!activeOrder && (
          <>
          {/* 🆕 (Link Merchant <-> Order): pintu masuk belanja dari toko —
              sebelumnya dashboard customer tidak punya jalan sama sekali
              untuk memesan dari Merchant. Modal ini menangani pilih toko,
              menu, keranjang, alamat antar, sampai checkout. */}
          <button
            type="button"
            onClick={() => setShowMerchantModal(true)}
            className="bg-[#0D2E1F] border border-[#FF6B6B]/40 hover:border-[#FF6B6B] p-5 rounded-3xl flex items-center gap-4 transition-all text-left"
          >
            <div className="w-12 h-12 rounded-2xl bg-[#FF6B6B]/15 flex items-center justify-center text-2xl shrink-0">
              🏪
            </div>
            <div>
              <h3 className="font-black text-base text-white">Belanja dari Toko</h3>
              <p className="text-xs text-[#A5C9B8]">Pesan makanan/barang dari merchant terdekat, diantar oleh driver DHUKNOO.</p>
            </div>
          </button>

          <div className="bg-[#0D2E1F] border border-[#23583E] p-6 rounded-3xl flex flex-col gap-4">
            <div className="flex items-center gap-2 text-[#FFD700]">
              <Send className="w-5 h-5" />
              <h3 className="font-black text-lg">Pesan Layanan DHUKNOO Ride</h3>
            </div>
            
            <form onSubmit={handleBooking} className="flex flex-col gap-4">
              {/* Service Selection */}
              <div className="grid grid-cols-3 gap-2">
                {[
                  { id: 'BIKE', label: 'Ojek Motor', icon: '🏍️' },
                  { id: 'CAR', label: 'Mobil', icon: '🚗' },
                  { id: 'SEND', label: 'Kirim Barang', icon: '📦' }
                ].map((srv) => (
                  <button
                    key={srv.id}
                    type="button"
                    onClick={() => setService(srv.id as any)}
                    className={`py-3 px-2 rounded-xl border flex flex-col items-center gap-1 transition-all ${
                      service === srv.id 
                        ? 'bg-[#FFD700]/10 border-[#FFD700] text-[#FFD700]' 
                        : 'bg-[#06170E] border-[#23583E] text-[#A5C9B8] hover:border-[#FFD700]'
                    }`}
                  >
                    <span className="text-lg">{srv.icon}</span>
                    <span className="text-[10px] font-bold">{srv.label}</span>
                  </button>
                ))}
              </div>

              {service === 'SEND' && (
                <div className="bg-[#06170E] border-2 border-[#FFD700]/50 p-4 rounded-2xl flex flex-col gap-3">
                  <div>
                    <div className="text-xs font-black text-[#FFD700]">📦 Detail Barang Kiriman</div>
                    <div className="text-[9px] text-[#A5C9B8]">Informasi ini dilihat driver sebelum menerima order.</div>
                  </div>
                  <input value={sendItemDescription} onChange={(e) => setSendItemDescription(e.target.value)} maxLength={300} required placeholder="Jenis/deskripsi barang, contoh: dokumen dalam amplop" className="bg-[#0D2E1F] border border-[#23583E] rounded-xl px-3 py-2.5 text-xs text-white" />
                  <div className="grid grid-cols-2 gap-2">
                    <select value={sendPackageSize} onChange={(e) => setSendPackageSize(e.target.value as any)} className="bg-[#0D2E1F] border border-[#23583E] rounded-xl px-3 py-2.5 text-xs text-white">
                      <option value="SMALL">Kecil</option><option value="MEDIUM">Sedang</option><option value="LARGE">Besar</option>
                    </select>
                    <input type="number" min="0.1" max="1000" step="0.1" value={sendWeightKg} onChange={(e) => setSendWeightKg(e.target.value)} required placeholder="Berat (kg)" className="bg-[#0D2E1F] border border-[#23583E] rounded-xl px-3 py-2.5 text-xs text-white" />
                  </div>
                  <select value={sendVehicleRequirement} onChange={(e) => setSendVehicleRequirement(e.target.value as any)} className="bg-[#0D2E1F] border border-[#23583E] rounded-xl px-3 py-2.5 text-xs text-white">
                    <option value="AUTO">Armada otomatis (motor/mobil yang eligible)</option>
                    <option value="BIKE">Khusus motor</option>
                    <option value="CAR">Khusus mobil</option>
                  </select>
                  <textarea value={sendHandlingNotes} onChange={(e) => setSendHandlingNotes(e.target.value)} maxLength={500} rows={2} placeholder="Catatan penanganan (opsional), contoh: jangan dilipat" className="bg-[#0D2E1F] border border-[#23583E] rounded-xl px-3 py-2.5 text-xs text-white resize-none" />
                  {(sendPackageSize === 'LARGE' || Number(sendWeightKg || 0) > 20) && <div className="text-[9px] font-bold text-[#FFD700]">Muatan ini otomatis dialokasikan hanya untuk driver mobil.</div>}
                </div>
              )}

              {/* Pickup and Dropoff Address Inputs & Route Control Actions */}
              <div className="flex flex-col gap-2">
                <div className="flex justify-between items-center text-[10px] text-[#A5C9B8]">
                  <span className="font-bold">Rute Alamat Penjemputan & Tujuan</span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={handleSwapRoute}
                      className="bg-[#23583E] hover:bg-[#00E575] hover:text-[#06170E] text-[#00E575] px-2.5 py-1 rounded-lg font-bold flex items-center gap-1 transition-all"
                    >
                      <RefreshCw className="w-3 h-3" /> Tukar Rute ↔
                    </button>
                    <button
                      type="button"
                      onClick={handleResetRoute}
                      className="bg-red-500/20 hover:bg-red-500/40 text-red-400 px-2.5 py-1 rounded-lg font-bold flex items-center gap-1 transition-all"
                    >
                      <XCircle className="w-3 h-3" /> Reset Alamat
                    </button>
                  </div>
                </div>
              </div>

              {/* Peta pilih titik lokasi (OpenStreetMap, gratis) — SATU-SATUNYA cara pilih
                  lokasi, lewat kotak pencarian bawaan LocationPicker. Sebelumnya ada
                  input teks manual terpisah di sini yang bisa nyimpang dari koordinat
                  asli yang tersimpan (customer ketik alamat baru, tapi koordinat lama
                  yang terkirim) — dihapus supaya tidak ada dua sumber kebenaran. */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="bg-[#06170E] border border-[#23583E] rounded-2xl overflow-hidden">
                  <button type="button" onClick={() => setShowPickupMap((v) => !v)} className="w-full flex items-center justify-between gap-3 p-3 text-left">
                    <span className="flex items-center gap-2 min-w-0"><MapPin className="w-4 h-4 text-[#00E575] shrink-0" /><span className="min-w-0"><span className="block text-[10px] font-black text-white">Titik Penjemputan</span><span className="block text-[9px] text-[#A5C9B8] truncate">{pickup || 'Klik untuk memilih lokasi'}</span></span></span>
                    <ChevronDown className={`w-4 h-4 text-[#A5C9B8] transition-transform ${showPickupMap ? 'rotate-180' : ''}`} />
                  </button>
                  {showPickupMap && <div className="p-3 pt-0"><Suspense fallback={<MapLoadingFallback />}><LocationPicker key={`pickup-${routeResetKey}`} label="Titik Penjemputan" initialCenter={{ lat: -7.8718, lng: 112.5326 }} value={pickupCoords} onChange={setPickupCoords} address={pickup} onAddressChange={setPickup} markerColor="green" /></Suspense></div>}
                </div>
                <div className="bg-[#06170E] border border-[#23583E] rounded-2xl overflow-hidden">
                  <button type="button" onClick={() => setShowDropoffMap((v) => !v)} className="w-full flex items-center justify-between gap-3 p-3 text-left">
                    <span className="flex items-center gap-2 min-w-0"><MapPin className="w-4 h-4 text-red-400 shrink-0" /><span className="min-w-0"><span className="block text-[10px] font-black text-white">Titik Tujuan</span><span className="block text-[9px] text-[#A5C9B8] truncate">{dropoff || 'Klik untuk memilih lokasi'}</span></span></span>
                    <ChevronDown className={`w-4 h-4 text-[#A5C9B8] transition-transform ${showDropoffMap ? 'rotate-180' : ''}`} />
                  </button>
                  {showDropoffMap && <div className="p-3 pt-0"><Suspense fallback={<MapLoadingFallback />}><LocationPicker key={`dropoff-${routeResetKey}`} label="Titik Tujuan" initialCenter={{ lat: -7.9666, lng: 112.6326 }} value={dropoffCoords} onChange={setDropoffCoords} address={dropoff} onAddressChange={setDropoff} markerColor="red" /></Suspense></div>}
                </div>
              </div>

              {pickupCoords && (
                <div className="flex items-center justify-between gap-3 bg-[#06170E] border border-[#23583E] px-3 py-2 rounded-xl text-[10px]">
                  <span className="flex items-center gap-2 text-[#A5C9B8]"><span className={`w-2 h-2 rounded-full ${Number(nearbyDriversData?.data?.availableCount || 0) > 0 ? 'bg-[#00E575] animate-pulse' : 'bg-[#FFD700]'}`} />Driver eligible sekitar titik jemput</span>
                  <span className="font-black text-white">{isCheckingNearbyDrivers ? 'Memeriksa...' : `${Number(nearbyDriversData?.data?.availableCount || 0)} tersedia${nearbyDriversData?.data?.nearestDistanceKm != null ? ` • terdekat ±${nearbyDriversData.data.nearestDistanceKm} km` : ''}`}</span>
                </div>
              )}

              <div className="flex flex-col gap-3 bg-[#06170E] border border-[#23583E] p-3 rounded-2xl">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-xs font-black text-white">Multi-Destinasi</div>
                      <div className="text-[9px] text-[#A5C9B8]">Tambahkan hingga 4 tujuan lanjutan. Urutan kunjungan mengikuti urutan di bawah.</div>
                    </div>
                    <button type="button" onClick={addExtraStop} disabled={extraStops.length >= 4} className="bg-[#00E575] text-[#06170E] px-3 py-2 rounded-xl text-[10px] font-black disabled:opacity-40">
                      <PlusCircle className="w-3 h-3 inline mr-1" /> Tambah Tujuan
                    </button>
                  </div>
                  {extraStops.map((stop, index) => (
                    <div key={stop.key} className="border border-[#23583E] rounded-xl p-3 flex flex-col gap-2">
                      <div className="flex justify-between items-center text-[10px] font-bold text-[#FFD700]">
                        <span>Tujuan {index + 2}</span>
                        <button type="button" onClick={() => removeExtraStop(index)} className="text-red-400">Hapus</button>
                      </div>
                      <Suspense fallback={<MapLoadingFallback />}>
                        <LocationPicker
                          key={`extra-${routeResetKey}-${stop.key}`}
                          label={`Titik Tujuan ${index + 2}`}
                          initialCenter={stop.coords || dropoffCoords || { lat: -7.9666, lng: 112.6326 }}
                          value={stop.coords}
                          onChange={(coords) => updateExtraStop(index, { coords })}
                          address={stop.address}
                          onAddressChange={(address) => updateExtraStop(index, { address })}
                          markerColor="red"
                        />
                      </Suspense>
                      <input value={stop.note} onChange={(e) => updateExtraStop(index, { note: e.target.value })} placeholder="Catatan tujuan (opsional)" className="bg-[#0D2E1F] border border-[#23583E] rounded-lg px-3 py-2 text-[10px] text-white" />
                    </div>
                  ))}
                  {extraStops.length > 0 && <div className="text-[9px] text-[#A5C9B8]">Total tujuan: {extraStops.length + 1}. Estimasi jarak menghitung seluruh etape.</div>}
              </div>

              {/* Price Calculation Board */}
              <div className="bg-[#06170E] p-4 rounded-2xl border border-[#23583E] flex items-center justify-between">
                <div>
                  <span className="text-[10px] text-[#A5C9B8] block">Estimasi Tarif Terkalkulasi</span>
                  <span className="text-xl font-black text-white">{formatRupiah(calculatedPrice)}</span>
                </div>
                <div className="text-right">
                  <span className={`text-[9px] px-2 py-1 rounded-md font-bold uppercase tracking-wide border ${
                    paymentMethod === 'CASH'
                      ? 'bg-amber-500/10 text-amber-400 border-amber-500/30'
                      : 'bg-[#00E575]/10 text-[#00E575] border-[#00E575]/30'
                  }`}>
                    {paymentMethod === 'CASH' ? '💵 BAYAR TUNAI' : `💳 BAYAR NON-TUNAI (${paymentMethod})`}
                  </span>
                </div>
              </div>

              {/* Pemilihan Metode Pembayaran */}
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] font-bold text-[#A5C9B8] uppercase tracking-wide">Metode Pembayaran</label>
                <div className="grid grid-cols-5 gap-1.5">
                  {[
                    { id: 'WALLET', label: 'Wallet' },
                    { id: 'CASH', label: 'Cash' },
                    { id: 'QRIS', label: 'QRIS' },
                    { id: 'TRANSFER', label: 'Transfer' },
                    { id: 'EWALLET', label: 'OVO/GoPay' },
                  ].map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => setPaymentMethod(m.id as any)}
                      className={`py-2 rounded-lg text-[9px] font-bold border transition-all ${
                        paymentMethod === m.id
                          ? 'bg-[#00E575]/10 border-[#00E575] text-[#00E575]'
                          : 'bg-[#06170E] border-[#23583E] text-[#A5C9B8] hover:border-[#00E575]'
                      }`}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
                {paymentMethod === 'QRIS' && (
                  <div className="bg-[#06170E] p-3 rounded-xl border border-[#00E575]/40 flex flex-col gap-2 mt-1">
                    <span className="text-[10px] text-white font-bold flex items-center gap-1 text-[#00E575]">
                      <QrCode className="w-3.5 h-3.5" /> Pembayaran Scan QRIS Langsung
                    </span>
                    <button
                      type="button"
                      onClick={() => setShowQrisScanner(true)}
                      className="bg-[#00E575] hover:bg-[#00ff80] text-[#071F14] font-black py-2 px-3 rounded-lg text-xs flex items-center justify-center gap-1.5 transition-all shadow-md"
                    >
                      <Camera className="w-4 h-4" /> Buka Kamera Pindai QRIS
                    </button>
                  </div>
                )}

                {(paymentMethod === 'TRANSFER' || paymentMethod === 'EWALLET') && (
                  <div className="bg-[#06170E] p-3 rounded-xl border border-[#FFD700]/40 flex flex-col gap-2 mt-1">
                    <div className="flex justify-between items-center text-xs">
                      <span className="text-[10px] text-gray-400 font-bold">Nomor Transfer / OVO / GoPay:</span>
                      <span className="font-mono font-black text-[#FFD700] text-sm">0192837465</span>
                    </div>
                    <span className="text-[9px] text-[#A5C9B8]">Atas Nama: DHUKNOO RIDE Official</span>
                    <button
                      type="button"
                      onClick={() => {
                        navigator.clipboard.writeText('0192837465');
                        triggerToast('Nomor 0192837465 berhasil disalin!');
                      }}
                      className="bg-[#23583E] hover:bg-[#23583E]/80 text-[#FFD700] font-bold py-1.5 px-3 rounded-lg text-[10px] flex items-center justify-center gap-1 border border-[#FFD700]/30 transition-all"
                    >
                      <Copy className="w-3 h-3" /> Salin Nomor 0192837465
                    </button>
                  </div>
                )}

                {paymentMethod === 'CASH' && (
                  <p className="text-[9px] text-[#A5C9B8]/80 leading-relaxed mt-0.5">
                    Bayar tunai langsung ke driver setelah perjalanan selesai.
                  </p>
                )}
              </div>

              <button 
                type="submit"
                disabled={orderMutation.isPending}
                className="bg-[#FFD700] text-[#071F14] hover:bg-[#ffe033] py-3.5 rounded-xl text-sm font-black transition-all transform active:scale-95 shadow-md disabled:opacity-50"
              >
                {orderMutation.isPending ? 'Sedang Memesan...' : 'Konfirmasi & Pesan Perjalanan'}
              </button>
            </form>
          </div>
          </>
          )}
        </div>

        {/* Right Column: Order History & Local OS detection info
            🆕 Auto-hide seluruh kolom ini (termasuk Riwayat Order Perjalanan
            & Saldo Dompet) selama ada perjalanan aktif — bagian dari Mode
            Fokus Perjalanan (lihat placeholder di bawah untuk kondisi
            activeOrder). */}
        {!activeOrder && (
        <div className="flex flex-col gap-6">
          {/* Ride logs/history
              🆕 AUTO-HIDE (perbaikan): daftar riwayat sekarang collapsed
              secara default — hanya header yang selalu terlihat, isi
              lengkap baru muncul kalau customer mengetuk header ini. */}
          <div className="bg-[#0D2E1F] border border-[#23583E] p-5 rounded-3xl flex-1 flex flex-col gap-4">
            <button
              type="button"
              onClick={() => setShowRideHistory((v) => !v)}
              aria-expanded={showRideHistory}
              className="text-xs font-bold text-[#FFD700] uppercase tracking-wider flex items-center justify-between gap-1.5 w-full text-left cursor-pointer"
            >
              <span className="flex items-center gap-1.5">
                <History className="w-4 h-4" /> Riwayat Order Perjalanan
              </span>
              <ChevronDown className={`w-4 h-4 text-[#A5C9B8] transition-transform ${showRideHistory ? 'rotate-180' : ''}`} />
            </button>

            {showRideHistory && (
            <>
            {isOrdersLoading ? (
              <SkeletonList count={3} />
            ) : isOrdersError ? (
              <QueryErrorState message="Gagal memuat riwayat order. Periksa koneksi internet Anda." onRetry={() => refetchOrders()} />
            ) : !ordersData?.orders || ordersData.orders.length === 0 ? (
              <div className="text-xs text-[#A5C9B8]/60 text-center py-8 border border-dashed border-[#23583E] rounded-xl bg-[#06170E]">
                Belum ada perjalanan dipesan di akun ini.
              </div>
            ) : (
              <div className="flex flex-col gap-3 max-h-[350px] overflow-y-auto pr-1">
                {ordersData.orders.map((o: any) => (
                  <div key={o.id} className="bg-[#06170E] border border-[#23583E] p-3.5 rounded-xl flex flex-col gap-2">
                    <div className="flex justify-between items-center text-[10px]">
                      <span className="font-bold text-[#FFD700]">{o.serviceType} / {o.orderNumber || `DHN-${String(o.id).replace(/-/g, '').slice(0, 8).toUpperCase()}`}</span>
                      <span className={`px-2 py-0.5 rounded font-black ${
                        o.status === 'COMPLETED' ? 'bg-[#00E575]/20 text-[#00E575]' :
                        o.status === 'PENDING' ? 'bg-amber-500/20 text-amber-500 animate-pulse' :
                        o.status === 'ACCEPTED' ? 'bg-cyan-500/20 text-cyan-500' : 'bg-red-500/20 text-red-500'
                      }`}>
                        {o.status}
                      </span>
                    </div>

                    <div className="text-xs flex flex-col gap-1">
                      <div className="flex gap-1">
                        <span className="text-gray-400">Jemput:</span>
                        <span className="text-white font-semibold truncate">{o.pickupAddress}</span>
                      </div>
                      <div className="flex gap-1">
                        <span className="text-gray-400">Tujuan:</span>
                        <span className="text-white font-semibold truncate">{o.dropoffAddress}</span>
                      </div>
                    </div>

                    <div className="border-t border-[#23583E]/50 pt-2 flex justify-between items-center text-[10px]">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-[#A5C9B8] font-bold">Tarif: {formatRupiah(Number(o.price))}</span>
                        <span className={`text-[9px] px-1.5 py-0.5 rounded font-black border ${
                          o.paymentMethod === 'CASH'
                            ? 'bg-amber-500/10 text-amber-400 border-amber-500/30'
                            : 'bg-[#00E575]/10 text-[#00E575] border-[#00E575]/30'
                        }`}>
                          {o.paymentMethod === 'CASH' ? '💵 BAYAR TUNAI' : `💳 BAYAR NON-TUNAI (${o.paymentMethod || 'WALLET'})`}
                        </span>
                      </div>
                      <span className="text-gray-400 truncate max-w-[120px]">
                        Mitra: {o.driver?.user?.fullName || 'Mencari driver...'}
                      </span>
                    </div>

                    {/* Auto Debet Wallet — Tidak perlu klik manual 'Bayar Sekarang'. Server
                        sudah langsung memotong saldo begitu trip COMPLETED (lihat
                        OrderService.updateStatus). Banner ini hanya menampilkan HASILNYA:
                        kalau o.isPaid true -> auto-debet sukses; kalau masih false berarti
                        auto-debet gagal (mis. saldo kurang) -- beri opsi coba lagi manual. */}
                    {o.status === 'COMPLETED' && o.paymentMethod === 'WALLET' && o.isPaid && (
                      <div className="mt-1 w-full text-center bg-[#00E575]/10 text-[#00E575] text-[10px] font-bold py-2 rounded-xl border border-[#00E575]/30 flex items-center justify-center gap-1">
                        ⚡ Auto Debet Saldo Wallet Berhasil — Lunas {formatRupiah(Number(o.price) - Number(o.discount || 0))}
                      </div>
                    )}

                    {o.status === 'COMPLETED' && o.paymentMethod === 'WALLET' && !o.isPaid && (
                      <button
                        onClick={() => payMutation.mutate(o.id)}
                        disabled={payMutation.isPending}
                        className="mt-1 w-full bg-[#FFD700] hover:bg-[#FFD700]/80 disabled:opacity-60 text-[#06170E] text-xs font-black py-2.5 rounded-xl transition-all"
                      >
                        {payMutation.isPending
                          ? 'Memproses...'
                          : `⚠️ Auto Debet Gagal (Saldo Kurang) — Coba Lagi ${formatRupiah(Number(o.price) - Number(o.discount || 0))}`}
                      </button>
                    )}

                    {o.status === 'COMPLETED' && !o.isPaid && o.paymentMethod === 'CASH' && (
                      <div className="mt-1 w-full text-center bg-[#FFD700]/10 text-[#FFD700] text-[10px] font-bold py-2 rounded-xl border border-[#FFD700]/30">
                        💵 Bayar tunai {formatRupiah(Number(o.price) - Number(o.discount || 0))} langsung ke driver
                      </div>
                    )}

                    {o.status === 'COMPLETED' && !o.isPaid && ['QRIS', 'TRANSFER', 'EWALLET'].includes(o.paymentMethod) && (
                      <>
                        {!o.paymentProof || o.paymentProof.status === 'REJECTED' ? (
                          proofUploadOrderId === o.id ? (
                            <div className="mt-1 flex flex-col gap-2 bg-[#06170E] border border-[#23583E] p-3 rounded-xl">
                              {o.paymentProof?.status === 'REJECTED' && (
                                <span className="text-[9px] text-red-400">
                                  Bukti sebelumnya ditolak{o.paymentProof.reviewNote ? `: ${o.paymentProof.reviewNote}` : ''}. Upload ulang:
                                </span>
                              )}
                              <input
                                type="file"
                                accept="image/*"
                                onChange={(e) => {
                                  const file = e.target.files?.[0];
                                  if (file) submitProofMutation.mutate({ orderId: o.id, method: o.paymentMethod, file });
                                }}
                                className="text-[9px] text-[#A5C9B8] file:mr-2 file:py-1.5 file:px-2 file:rounded-lg file:border-0 file:bg-[#00E575] file:text-[#06170E] file:text-[9px] file:font-bold"
                              />
                              <input
                                type="text"
                                placeholder="Catatan (opsional)"
                                value={proofNote}
                                onChange={(e) => setProofNote(e.target.value)}
                                className="bg-[#0D2E1F] border border-[#23583E] rounded-lg px-2 py-1.5 text-[10px] text-white placeholder:text-gray-500 focus:outline-none"
                              />
                              {submitProofMutation.isPending && <span className="text-[9px] text-[#A5C9B8]">Mengupload...</span>}
                            </div>
                          ) : (
                            <button
                              onClick={() => setProofUploadOrderId(o.id)}
                              className="mt-1 w-full bg-[#FFD700] hover:bg-[#FFD700]/80 text-[#06170E] text-xs font-black py-2.5 rounded-xl transition-all"
                            >
                              Upload Bukti Bayar {o.paymentMethod} — {formatRupiah(Number(o.price) - Number(o.discount || 0))}
                            </button>
                          )
                        ) : o.paymentProof.status === 'PENDING_REVIEW' ? (
                          <div className="mt-1 w-full text-center bg-[#23583E] text-[#A5C9B8] text-[10px] font-bold py-2 rounded-xl">
                            ⏳ Bukti bayar sedang ditinjau Admin
                          </div>
                        ) : null}
                      </>
                    )}

                    {o.status === 'COMPLETED' && o.isPaid && (
                      <div className="mt-1 flex flex-col gap-1.5">
                        <div className="w-full text-center bg-[#00E575]/10 text-[#00E575] text-[10px] font-bold py-2 rounded-xl">
                          ✓ Sudah Dibayar Lunas
                        </div>
                        {Number(o.tipAmount || 0) > 0 ? (
                          <div className="w-full text-center bg-[#FFD700]/10 text-[#FFD700] text-[10px] font-bold py-2 rounded-xl border border-[#FFD700]/30">
                            🎁 Tips {formatRupiah(Number(o.tipAmount))} sudah dikirim 100% kepada driver
                          </div>
                        ) : o.driver ? (
                          <div className="bg-[#0D2E1F] border border-[#23583E] rounded-xl p-3 flex flex-col gap-2">
                            <div className="text-[10px] font-black text-[#FFD700]">🎁 Berikan Tips kepada Driver</div>
                            <div className="text-[9px] text-[#A5C9B8]">Tips dipotong dari saldo dompet dan masuk 100% ke penghasilan driver tanpa komisi platform.</div>
                            <div className="grid grid-cols-3 gap-1.5">
                              {[5000, 10000, 20000].map((amount) => (
                                <button key={amount} type="button" onClick={() => setTipAmounts((current) => ({ ...current, [o.id]: String(amount) }))} className="bg-[#06170E] border border-[#23583E] text-white rounded-lg py-1.5 text-[9px] font-bold hover:border-[#FFD700]">
                                  {formatRupiah(amount)}
                                </button>
                              ))}
                            </div>
                            <div className="flex gap-2">
                              <input type="number" min="1000" max="500000" step="1000" value={tipAmounts[o.id] || ''} onChange={(e) => setTipAmounts((current) => ({ ...current, [o.id]: e.target.value }))} placeholder="Nominal tips" className="min-w-0 flex-1 bg-[#06170E] border border-[#23583E] rounded-lg px-2 py-2 text-[10px] text-white" />
                              <button type="button" disabled={tipMutation.isPending || Number(tipAmounts[o.id] || 0) < 1000} onClick={() => tipMutation.mutate({ orderId: o.id, amount: Number(tipAmounts[o.id]) })} className="bg-[#FFD700] text-[#06170E] rounded-lg px-3 py-2 text-[10px] font-black disabled:opacity-40">
                                {tipMutation.isPending ? 'Mengirim...' : 'Kirim Tips'}
                              </button>
                            </div>
                          </div>
                        ) : null}
                        <button
                          onClick={() => printReceipt(o)}
                          className="w-full bg-[#06170E] border border-[#23583E] hover:border-[#00E575] text-[#A5C9B8] hover:text-[#00E575] text-[10px] font-bold py-2 rounded-xl transition-all"
                        >
                          🧾 Cetak Struk
                        </button>
                        <button
                          onClick={() => emailReceiptMutation.mutate(o.id)}
                          disabled={emailReceiptMutation.isPending}
                          className="w-full bg-[#06170E] border border-[#23583E] hover:border-[#00E575] text-[#A5C9B8] hover:text-[#00E575] text-[10px] font-bold py-2 rounded-xl transition-all disabled:opacity-50"
                        >
                          {emailReceiptMutation.isPending ? 'Mengirim...' : '📧 Kirim Struk ke Email'}
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
            </>
            )}
          </div>

        </div>
        )}
      </div>

      <TopupModal
        isOpen={isTopupModalOpen}
        onClose={() => setIsTopupModalOpen(false)}
        user={user}
        initialAmount={topupAmount}
        triggerToast={triggerToast}
        onSuccess={() => {
          refetchProfile();
          setTopupAmount('');
        }}
      />

      {showQrisScanner && (
        <QrisCameraScannerModal 
          onClose={() => setShowQrisScanner(false)} 
          triggerToast={triggerToast} 
        />
      )}

      {/* 🆕 (Link Merchant <-> Order) */}
      {showMerchantModal && (
        <MerchantOrderModal
          onClose={() => setShowMerchantModal(false)}
          onCheckoutSuccess={() => queryClient.invalidateQueries({ queryKey: ['customerOrders'] })}
          triggerToast={triggerToast}
        />
      )}

    </div>
  );
}

// 🆕 OPTIMASI PERFORMA: React.memo -- halaman ini hanya berisi SATU
// instance yang di-mount (user hanya bisa jadi satu role dalam satu waktu),
// tapi parent (DhuknooMainAppShell di App.tsx) bisa re-render sering (mis.
// tiap kali toast notifikasi muncul/hilang). Tanpa memo, SELURUH pohon
// CustomerApp (termasuk peta, listener socket, dll) ikut re-render setiap
// kali itu terjadi walau props (onBack/triggerToast, sekarang stabil lewat
// useCallback di App.tsx) tidak benar-benar berubah.
export default React.memo(CustomerApp);
