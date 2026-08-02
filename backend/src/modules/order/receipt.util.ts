/**
 * Membangun struk HTML dari data order lengkap (dengan customer/driver/pricingHistory
 * ter-include). Dipakai baik untuk dikirim lewat email maupun untuk endpoint yang
 * dipanggil frontend untuk ditampilkan & di-print langsung dari browser.
 */
export function buildReceiptHtml(order: {
  id: string;
  serviceType: string;
  price: any;
  discount: any;
  paymentMethod: string;
  distanceKm: number;
  pickupAddress: string;
  dropoffAddress: string;
  createdAt: string | Date;
  customer: { user: { fullName: string; email: string } };
  driver?: { user: { fullName: string; email: string }; vehiclePlate: string; vehicleModel: string } | null;
  pricingHistory?: { breakdown: any } | null;
}) {
  const formatRp = (n: number) =>
    'Rp' + Number(n).toLocaleString('id-ID', { minimumFractionDigits: 0, maximumFractionDigits: 0 });

  const breakdown = order.pricingHistory?.breakdown || {};
  const finalPrice = Number(order.price) - Number(order.discount);
  const date = new Date(order.createdAt).toLocaleString('id-ID', {
    dateStyle: 'long',
    timeStyle: 'short',
  });

  const rows = [
    ['Tarif Dasar', breakdown.baseFare],
    ['Biaya Pickup', breakdown.pickupFee],
    ['Biaya Perjalanan', breakdown.distanceFee],
    ['Biaya Tunggu', breakdown.waitingFee],
    ['Tol', breakdown.tollFee],
    ['Parkir', breakdown.parkingFee],
    ['Cuaca', breakdown.weatherSurcharge],
    ['Hari Libur', breakdown.holidaySurcharge],
  ].filter(([, v]) => v !== undefined && Number(v) > 0);

  const rowsHtml = rows.map(([label, v]) => `
    <tr>
      <td style="padding:4px 0;color:#555;">${label}</td>
      <td style="padding:4px 0;text-align:right;">${formatRp(Number(v))}</td>
    </tr>`).join('');

  return `
  <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px; border: 1px solid #23583E; border-radius: 12px;">
    <div style="text-align:center; margin-bottom: 16px;">
      <h2 style="color:#0D2E1F; margin:0;">🍎 DHUKNOO Platform</h2>
      <p style="color:#888; font-size:12px; margin:4px 0 0;">Ojek Batu - Malang Raya</p>
    </div>
    <hr style="border:none;border-top:1px dashed #ccc;" />
    <p style="font-size:12px;color:#555;">No. Order: <b>${order.id}</b><br/>Tanggal: ${date}</p>
    <table style="width:100%;font-size:13px;margin-top:8px;">
      <tr><td style="padding:4px 0;color:#555;">Customer</td><td style="text-align:right;">${order.customer.user.fullName}</td></tr>
      <tr><td style="padding:4px 0;color:#555;">Driver</td><td style="text-align:right;">${order.driver?.user.fullName || '-'} (${order.driver?.vehiclePlate || '-'})</td></tr>
      <tr><td style="padding:4px 0;color:#555;">Layanan</td><td style="text-align:right;">${order.serviceType}</td></tr>
      <tr><td style="padding:4px 0;color:#555;">Jarak</td><td style="text-align:right;">${Number(order.distanceKm).toFixed(1)} km</td></tr>
      <tr><td style="padding:4px 0;color:#555;">Metode Bayar</td><td style="text-align:right;">${order.paymentMethod}</td></tr>
    </table>
    <hr style="border:none;border-top:1px dashed #ccc;margin:12px 0;" />
    <p style="font-size:12px;color:#555;margin-bottom:4px;">Dari: ${order.pickupAddress}</p>
    <p style="font-size:12px;color:#555;margin-bottom:12px;">Ke: ${order.dropoffAddress}</p>
    <hr style="border:none;border-top:1px dashed #ccc;margin:12px 0;" />
    <table style="width:100%;font-size:13px;">
      ${rowsHtml}
      ${Number(order.discount) > 0 ? `<tr><td style="padding:4px 0;color:#00A651;">Diskon Promo</td><td style="text-align:right;color:#00A651;">-${formatRp(Number(order.discount))}</td></tr>` : ''}
    </table>
    <hr style="border:none;border-top:1px solid #23583E;margin:12px 0;" />
    <table style="width:100%;font-size:15px;font-weight:bold;">
      <tr><td>Total Bayar</td><td style="text-align:right;">${formatRp(finalPrice)}</td></tr>
    </table>
    <p style="text-align:center;color:#888;font-size:11px;margin-top:24px;">Terima kasih telah menggunakan DHUKNOO Platform 🍎</p>
  </div>`;
}
