import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import { AdminRecap } from './admin-recap.service';

const TIMEFRAME_LABEL: Record<string, string> = {
  daily: 'Harian (24 jam terakhir)',
  weekly: 'Mingguan (7 hari terakhir)',
  monthly: 'Bulanan (30 hari terakhir)',
};

function formatRupiah(n: number) {
  return `Rp${Math.round(n).toLocaleString('id-ID')}`;
}

function formatDate(d: Date | string) {
  return new Date(d).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' });
}

/**
 * EXCEL — data LENGKAP, satu sheet per kategori. Excel dipilih sebagai format
 * "data mentah lengkap" karena tidak ada batas halaman/tata-letak seperti PDF —
 * cocok untuk ratusan/ribuan baris transaksi tanpa perlu dipotong.
 */
export async function buildRecapExcel(recap: AdminRecap): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'DHUKNOO Ride Admin Portal';
  workbook.created = new Date();

  // ── Sheet 1: Ringkasan ──────────────────────────────────────────────
  const summarySheet = workbook.addWorksheet('Ringkasan');
  summarySheet.columns = [
    { header: 'Metrik', key: 'metric', width: 40 },
    { header: 'Nilai', key: 'value', width: 30 },
  ];
  summarySheet.addRows([
    { metric: 'Rentang Waktu', value: TIMEFRAME_LABEL[recap.timeframe] || recap.timeframe },
    { metric: 'Tanggal Export', value: formatDate(new Date()) },
    { metric: 'Total Pelanggan', value: recap.summary.totalCustomersCount },
    { metric: 'Total Mitra Driver', value: recap.summary.totalDriversCount },
    { metric: 'Total Transaksi', value: recap.summary.totalTransactionsCount },
    { metric: 'Total Volume Transaksi', value: formatRupiah(recap.summary.totalVolumeValue) },
    { metric: 'Total Revenue Platform', value: formatRupiah(recap.summary.totalPlatformRevenue) },
    { metric: 'Withdrawal Diajukan', value: formatRupiah(recap.withdrawalSummary.totalRequested) },
    { metric: 'Withdrawal Diproses', value: formatRupiah(recap.withdrawalSummary.totalProcessing) },
    { metric: 'Withdrawal Berhasil', value: formatRupiah(recap.withdrawalSummary.totalCompleted) },
    { metric: 'Withdrawal Gagal/Refund', value: formatRupiah(recap.withdrawalSummary.totalFailedRefunded) },
    { metric: 'Total Merchant', value: recap.merchantSummary?.total ?? recap.summary.totalMerchantsCount ?? 0 },
    { metric: 'Merchant Aktif', value: recap.merchantSummary?.active ?? recap.summary.activeMerchantsCount ?? 0 },
    { metric: 'Merchant Tidak Aktif', value: recap.merchantSummary?.inactive ?? recap.summary.inactiveMerchantsCount ?? 0 },
    { metric: 'Akun Pemilik Nonaktif', value: recap.merchantSummary?.ownerInactive ?? recap.summary.ownerInactiveMerchantsCount ?? 0 },
    { metric: 'Merchant Terdaftar dalam Periode', value: recap.merchantSummary?.registeredInTimeframe ?? recap.summary.merchantsRegisteredInTimeframe ?? 0 },
    { metric: '', value: '' },
    { metric: '── Arus Kas per Metode Pembayaran ──', value: '' },
    ...recap.paymentMethodBreakdown.map((b) => ({
      metric: `${b.method} (${b.count} transaksi)`,
      value: formatRupiah(b.totalValue),
    })),
  ]);
  summarySheet.getRow(1).font = { bold: true };

  // ── Sheet 2: Pelanggan ──────────────────────────────────────────────
  const customerSheet = workbook.addWorksheet('Pelanggan');
  customerSheet.columns = [
    { header: 'Nama', key: 'fullName', width: 25 },
    { header: 'Email', key: 'email', width: 28 },
    { header: 'No. HP', key: 'phoneNumber', width: 16 },
    { header: 'Terdaftar', key: 'registeredAt', width: 20 },
    { header: 'Total Order', key: 'totalOrders', width: 12 },
    { header: 'App Terpasang', key: 'isAppInstalled', width: 14 },
  ];
  recap.customers.forEach((c) =>
    customerSheet.addRow({ ...c, registeredAt: formatDate(c.registeredAt), isAppInstalled: c.isAppInstalled ? 'Ya' : 'Tidak' })
  );
  customerSheet.getRow(1).font = { bold: true };

  // ── Sheet 3: Mitra Driver ───────────────────────────────────────────
  const driverSheet = workbook.addWorksheet('Mitra Driver');
  driverSheet.columns = [
    { header: 'Nama', key: 'fullName', width: 25 },
    { header: 'Email', key: 'email', width: 28 },
    { header: 'No. HP', key: 'phoneNumber', width: 16 },
    { header: 'Plat Kendaraan', key: 'vehiclePlate', width: 16 },
    { header: 'Model Kendaraan', key: 'vehicleModel', width: 18 },
    { header: 'Terverifikasi', key: 'isVerified', width: 14 },
    { header: 'Status Online', key: 'isOnline', width: 14 },
    { header: 'Order Selesai', key: 'completedOrdersCount', width: 14 },
    { header: 'Perolehan (Rp)', key: 'perolehan', width: 18 },
    { header: 'Terdaftar', key: 'registeredAt', width: 20 },
  ];
  recap.drivers.forEach((d) =>
    driverSheet.addRow({
      ...d,
      isVerified: d.isVerified ? 'Ya' : 'Tidak',
      isOnline: d.isOnline ? 'Online' : 'Offline',
      registeredAt: formatDate(d.registeredAt),
    })
  );
  driverSheet.getRow(1).font = { bold: true };

  // ── Sheet 4: Merchant ───────────────────────────────────────────────
  const merchantSheet = workbook.addWorksheet('Merchant');
  merchantSheet.columns = [
    { header: 'Nama Merchant', key: 'name', width: 26 },
    { header: 'Pemilik', key: 'ownerName', width: 24 },
    { header: 'Email Pemilik', key: 'ownerEmail', width: 28 },
    { header: 'Kategori', key: 'category', width: 18 },
    { header: 'No. HP', key: 'phone', width: 16 },
    { header: 'Alamat', key: 'address', width: 42 },
    { header: 'Latitude', key: 'latitude', width: 14 },
    { header: 'Longitude', key: 'longitude', width: 14 },
    { header: 'Status Merchant', key: 'status', width: 18 },
    { header: 'Akun Pemilik Aktif', key: 'ownerIsActive', width: 18 },
    { header: 'Produk', key: 'productCount', width: 10 },
    { header: 'Order', key: 'orderCount', width: 10 },
    { header: 'Terdaftar', key: 'registeredAt', width: 20 },
  ];
  (recap.merchants || []).forEach((m) =>
    merchantSheet.addRow({
      ...m,
      status: m.status === 'ACTIVE' ? 'Aktif' : m.status === 'INACTIVE' ? 'Tidak Aktif' : m.status === 'OWNER_INACTIVE' ? 'Pemilik Nonaktif' : 'Tanpa Pemilik',
      ownerIsActive: m.ownerIsActive ? 'Ya' : 'Tidak',
      registeredAt: formatDate(m.registeredAt),
    })
  );
  merchantSheet.getRow(1).font = { bold: true };

  // ── Sheet 5: Transaksi ──────────────────────────────────────────────
  const txSheet = workbook.addWorksheet('Transaksi');
  txSheet.columns = [
    { header: 'ID Order', key: 'id', width: 38 },
    { header: 'Layanan', key: 'serviceType', width: 12 },
    { header: 'Penjemputan', key: 'pickupAddress', width: 30 },
    { header: 'Tujuan', key: 'dropoffAddress', width: 30 },
    { header: 'Customer', key: 'customerName', width: 22 },
    { header: 'No. HP Customer', key: 'customerPhone', width: 16 },
    { header: 'Driver', key: 'driverName', width: 22 },
    { header: 'Plat Driver', key: 'driverPlate', width: 14 },
    { header: 'Metode Bayar', key: 'paymentMethod', width: 14 },
    { header: 'Lunas', key: 'isPaid', width: 10 },
    { header: 'Harga (Rp)', key: 'price', width: 14 },
    { header: 'Diskon (Rp)', key: 'discount', width: 14 },
    { header: 'Status', key: 'status', width: 14 },
    { header: 'Waktu', key: 'createdAt', width: 20 },
  ];
  recap.transactions.forEach((t) => txSheet.addRow({ ...t, isPaid: t.isPaid ? 'Ya' : 'Belum', createdAt: formatDate(t.createdAt) }));
  txSheet.getRow(1).font = { bold: true };

  // ── Sheet 5: Revenue Platform ───────────────────────────────────────
  const revenueSheet = workbook.addWorksheet('Revenue Platform');
  revenueSheet.columns = [
    { header: 'ID Order', key: 'id', width: 38 },
    { header: 'Layanan', key: 'serviceType', width: 12 },
    { header: 'Customer', key: 'customerName', width: 22 },
    { header: 'Driver', key: 'driverName', width: 22 },
    { header: 'Jarak (km)', key: 'distanceKm', width: 12 },
    { header: 'Harga Kotor (Rp)', key: 'grossPrice', width: 16 },
    { header: 'Diskon (Rp)', key: 'discount', width: 14 },
    { header: 'Subtotal Barang (Rp)', key: 'itemsSubtotal', width: 20 },
    { header: 'Ongkos Layanan (Rp)', key: 'deliveryFee', width: 20 },
    { header: 'Harga Bersih (Rp)', key: 'netPrice', width: 16 },
    { header: 'Gross Contribution (Rp)', key: 'grossPlatformContribution', width: 22 },
    { header: 'Pickup Subsidy (Rp)', key: 'pickupSubsidy', width: 18 },
    { header: 'Net Revenue Platform (Rp)', key: 'platformRevenue', width: 22 },
    { header: 'Waktu', key: 'createdAt', width: 20 },
  ];
  recap.platformRevenues.forEach((r) => revenueSheet.addRow({ ...r, createdAt: formatDate(r.createdAt) }));
  revenueSheet.getRow(1).font = { bold: true };

  const withdrawalSheet = workbook.addWorksheet('Withdrawal Mitra');
  withdrawalSheet.columns = [
    { header: 'ID', key: 'id', width: 38 },
    { header: 'Nama Mitra', key: 'userName', width: 24 },
    { header: 'Peran', key: 'role', width: 12 },
    { header: 'Nominal (Rp)', key: 'amount', width: 16 },
    { header: 'Metode', key: 'method', width: 16 },
    { header: 'Bank/E-Wallet', key: 'destinationProvider', width: 18 },
    { header: 'Rekening Tujuan', key: 'destinationAccount', width: 22 },
    { header: 'Nama Rekening', key: 'destinationName', width: 24 },
    { header: 'Status Internal', key: 'status', width: 18 },
    { header: 'Provider Payout', key: 'payoutProvider', width: 16 },
    { header: 'Status Provider', key: 'providerStatus', width: 18 },
    { header: 'Referensi', key: 'payoutReference', width: 38 },
    { header: 'Kode Gagal', key: 'failureCode', width: 22 },
    { header: 'Diajukan', key: 'createdAt', width: 20 },
    { header: 'Selesai', key: 'completedAt', width: 20 },
  ];
  recap.withdrawals.forEach((w) => withdrawalSheet.addRow({ ...w, createdAt: formatDate(w.createdAt), completedAt: w.completedAt ? formatDate(w.completedAt) : '-' }));
  withdrawalSheet.getRow(1).font = { bold: true };

  const arrayBuffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}

/**
 * PDF — laporan RINGKASAN siap cetak (bukan dump data mentah — PDF tidak
 * cocok untuk ratusan baris transaksi tanpa tata-letak manual yang rumit).
 * Berisi KPI utama + tabel top driver berdasarkan perolehan. Untuk data
 * transaksi lengkap, gunakan export Excel.
 */
export function buildRecapPdf(recap: AdminRecap): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 40, size: 'A4' });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // Header
    doc.fontSize(20).fillColor('#06170E').text('DHUKNOO Ride — Laporan Rekapitulasi Platform', { align: 'left' });
    doc.moveDown(0.3);
    doc.fontSize(10).fillColor('#555555').text(`Rentang waktu: ${TIMEFRAME_LABEL[recap.timeframe] || recap.timeframe}`);
    doc.text(`Dicetak pada: ${formatDate(new Date())}`);
    doc.moveDown(1);

    // KPI Summary box
    doc.fontSize(13).fillColor('#06170E').text('Ringkasan', { underline: true });
    doc.moveDown(0.4);
    const kpis: [string, string][] = [
      ['Total Pelanggan', String(recap.summary.totalCustomersCount)],
      ['Total Mitra Driver', String(recap.summary.totalDriversCount)],
      ['Total Transaksi', String(recap.summary.totalTransactionsCount)],
      ['Total Volume Transaksi', formatRupiah(recap.summary.totalVolumeValue)],
      ['Total Revenue Platform', formatRupiah(recap.summary.totalPlatformRevenue)],
      ['Withdrawal Diajukan', formatRupiah(recap.withdrawalSummary.totalRequested)],
      ['Withdrawal Diproses', formatRupiah(recap.withdrawalSummary.totalProcessing)],
      ['Withdrawal Berhasil', formatRupiah(recap.withdrawalSummary.totalCompleted)],
      ['Withdrawal Gagal/Refund', formatRupiah(recap.withdrawalSummary.totalFailedRefunded)],
      ['Total Merchant', String(recap.merchantSummary?.total ?? recap.summary.totalMerchantsCount ?? 0)],
      ['Merchant Aktif', String(recap.merchantSummary?.active ?? recap.summary.activeMerchantsCount ?? 0)],
      ['Merchant Tidak Aktif', String(recap.merchantSummary?.inactive ?? recap.summary.inactiveMerchantsCount ?? 0)],
      ['Pemilik Nonaktif', String(recap.merchantSummary?.ownerInactive ?? recap.summary.ownerInactiveMerchantsCount ?? 0)],
    ];
    doc.fontSize(10).fillColor('#111111');
    kpis.forEach(([label, value]) => {
      doc.text(`${label}: `, { continued: true }).font('Helvetica-Bold').text(value).font('Helvetica');
    });
    doc.moveDown(0.6);

    doc.fontSize(11).fillColor('#06170E').text('Arus Kas per Metode Pembayaran', { underline: true });
    doc.moveDown(0.3);
    doc.fontSize(9).fillColor('#111111');
    recap.paymentMethodBreakdown.forEach((b) => {
      doc.text(`${b.method} (${b.count}x): `, { continued: true }).font('Helvetica-Bold').text(formatRupiah(b.totalValue)).font('Helvetica');
    });
    doc.moveDown(1);

    // Simple table helper (pdfkit has no built-in table layout)
    const drawTable = (title: string, headers: string[], rows: string[][], colWidths: number[]) => {
      doc.fontSize(13).fillColor('#06170E').text(title, { underline: true });
      doc.moveDown(0.4);

      const startX = doc.x;
      let y = doc.y;
      const rowHeight = 18;

      doc.fontSize(9).font('Helvetica-Bold').fillColor('#ffffff');
      doc.rect(startX, y, colWidths.reduce((a, b) => a + b, 0), rowHeight).fill('#06170E');
      let x = startX;
      headers.forEach((h, i) => {
        doc.fillColor('#ffffff').text(h, x + 4, y + 5, { width: colWidths[i] - 8 });
        x += colWidths[i];
      });
      y += rowHeight;

      doc.font('Helvetica').fontSize(8.5);
      rows.forEach((row, rIdx) => {
        if (y > doc.page.height - 60) {
          doc.addPage();
          y = doc.y;
        }
        if (rIdx % 2 === 0) {
          doc.rect(startX, y, colWidths.reduce((a, b) => a + b, 0), rowHeight).fill('#F1F5F1');
        }
        x = startX;
        row.forEach((cell, i) => {
          doc.fillColor('#111111').text(cell, x + 4, y + 5, { width: colWidths[i] - 8, ellipsis: true });
          x += colWidths[i];
        });
        y += rowHeight;
      });

      doc.y = y + 15;
      doc.x = startX;
    };

    const merchantRows = (recap.merchants || []).slice(0, 20);
    drawTable(
      `Merchant Terdaftar (${merchantRows.length} ditampilkan)`,
      ['Merchant', 'Kategori', 'Status', 'Alamat'],
      merchantRows.map((m) => [m.name, m.category, m.status === 'ACTIVE' ? 'Aktif' : m.status === 'INACTIVE' ? 'Tidak Aktif' : m.status === 'OWNER_INACTIVE' ? 'Pemilik Nonaktif' : 'Tanpa Pemilik', m.address]),
      [150, 90, 90, 220]
    );

    // Top 15 driver berdasarkan perolehan
    const topDrivers = [...recap.drivers].sort((a, b) => b.perolehan - a.perolehan).slice(0, 15);
    drawTable(
      'Top 15 Mitra Driver (Berdasarkan Perolehan)',
      ['Nama', 'Plat', 'Order Selesai', 'Perolehan'],
      topDrivers.map((d) => [d.fullName, d.vehiclePlate, String(d.completedOrdersCount), formatRupiah(d.perolehan)]),
      [180, 100, 90, 120]
    );

    doc.addPage();

    // 25 transaksi terbaru
    const recentTx = recap.transactions.slice(0, 25);
    drawTable(
      `${recentTx.length} Transaksi Terbaru (data lengkap ada di export Excel)`,
      ['Customer', 'Driver', 'Layanan', 'Harga', 'Status'],
      recentTx.map((t) => [t.customerName, t.driverName, t.serviceType, formatRupiah(t.price), t.status]),
      [140, 140, 70, 90, 80]
    );

    doc.end();
  });
}
