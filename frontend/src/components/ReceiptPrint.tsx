// frontend/src/components/ReceiptPrint.tsx
import React from 'react';

export const printReceipt = (order: any) => {
  const printWindow = window.open('', '_blank');
  if (!printWindow) return;

  printWindow.document.write(`
    <html>
      <head>
        <title>Struk Pembayaran OBAMA - ${order.id}</title>
        <style>
          body { font-family: 'Courier New', Courier, monospace; width: 80mm; padding: 10mm; margin: 0; }
          .center { text-align: center; }
          .line { border-bottom: 1px dashed #000; margin: 5px 0; }
          .bold { font-weight: bold; }
          .flex { display: flex; justify-content: space-between; }
        </style>
      </head>
      <body>
        <div class="center">
          <h2 style="margin:0;">OBAMA RIDE</h2>
          <small>Ojek Batu - Malang Raya</small>
          <p>Kearifan Lokal, Harga Kompetitif</p>
        </div>
        <div class="line"></div>
        <div>ID Order: ${order.id}</div>
        <div>Tanggal : ${new Date(order.timestamp).toLocaleString('id-ID')}</div>
        <div>Driver  : ${order.driverName || '-'}</div>
        <div class="line"></div>
        <div class="bold">Rincian Perjalanan:</div>
        <div>Dari: ${order.pickupName}</div>
        <div>Ke  : ${order.destinationName}</div>
        <div>Jarak: ${order.distanceKm} Km</div>
        <div class="line"></div>
        <div class="flex bold"><span>TOTAL BAYAR</span><span>Rp ${order.finalPrice.toLocaleString('id-ID')}</span></div>
        <div class="line"></div>
        <div class="center">
          <p>Terima Kasih Telah Mencintai<br>Layanan Lokal Malang-Batu!</p>
        </div>
        <script>
          window.onload = function() { window.print(); window.close(); }
        </script>
      </body>
    </html>
  `);
  printWindow.document.close();
};