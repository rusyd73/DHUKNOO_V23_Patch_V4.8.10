import ExcelJS from 'exceljs';

export interface OrderReportItem {
  id: string;
  createdAt: string | Date;
  totalTariff: number;
  status: string;
  customer?: { name: string };
  merchant?: { name: string };
  payment?: { method: string };
}

export class ExcelGenerator {
  static async generateOrderReport(data: OrderReportItem[]): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();

    workbook.creator = 'OBAMA Ride';
    workbook.company = 'OBAMA Ride';
    workbook.subject = 'Laporan Transaksi';
    workbook.title = 'Laporan Order';
    workbook.created = new Date();

    const ws = workbook.addWorksheet('Laporan Order', {
      views: [{ state: 'frozen', ySplit: 4 }],
    });

    const titleAlignment: Partial<ExcelJS.Alignment> = { horizontal: 'center', vertical: 'middle' };

    ws.mergeCells('A1:H1');
    const row1 = ws.getCell('A1');
    row1.value = 'OBAMA RIDE';
    row1.font = { size: 18, bold: true, color: { argb: '1E40AF' } };
    row1.alignment = titleAlignment as ExcelJS.Alignment;

    ws.mergeCells('A2:H2');
    const row2 = ws.getCell('A2');
    row2.value = 'LAPORAN RIWAYAT TRANSAKSI';
    row2.font = { size: 12, bold: true };
    row2.alignment = titleAlignment as ExcelJS.Alignment;

    ws.mergeCells('A3:H3');
    const row3 = ws.getCell('A3');
    row3.value = `Dicetak pada: ${new Date().toLocaleString('id-ID')}`;
    row3.font = { size: 10, italic: true };
    row3.alignment = titleAlignment as ExcelJS.Alignment;

    ws.getRow(1).height = 25;
    ws.getRow(2).height = 20;

    ws.columns = [
      { header: 'No', key: 'no', width: 6 },
      { header: 'Order ID', key: 'id', width: 15 },
      { header: 'Tanggal', key: 'createdAt', width: 22 },
      { header: 'Customer', key: 'customer', width: 25 },
      { header: 'Merchant', key: 'merchant', width: 25 },
      { header: 'Tarif', key: 'tariff', width: 18 },
      { header: 'Status', key: 'status', width: 15 },
      { header: 'Pembayaran', key: 'payment', width: 15 },
    ];

    const tableHeader = ws.getRow(4);
    tableHeader.height = 25;
    tableHeader.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    tableHeader.alignment = { vertical: 'middle', horizontal: 'center' };
    tableHeader.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: '1E40AF' },
    };

    let totalTariffSum = 0;

    data.forEach((item, index) => {
      const tariff = Number(item.totalTariff ?? 0);
      totalTariffSum += tariff;

      ws.addRow({
        no: index + 1,
        id: item.id,
        createdAt: new Date(item.createdAt).toLocaleString('id-ID'),
        customer: item.customer?.name ?? '-',
        merchant: item.merchant?.name ?? '-',
        tariff: tariff,
        status: item.status,
        payment: item.payment?.method ?? '-',
      });
    });

    ws.getColumn('tariff').numFmt = '"Rp"#,##0';
    ws.getColumn('no').alignment = { horizontal: 'center' };
    ws.getColumn('status').alignment = { horizontal: 'center' };
    ws.getColumn('payment').alignment = { horizontal: 'center' };

    ws.eachRow((row, rowNumber) => {
      if (rowNumber >= 4) {
        row.eachCell((cell) => {
          cell.border = {
            top: { style: 'thin', color: { argb: 'CBD5E1' } },
            left: { style: 'thin', color: { argb: 'CBD5E1' } },
            bottom: { style: 'thin', color: { argb: 'CBD5E1' } },
            right: { style: 'thin', color: { argb: 'CBD5E1' } },
          };
        });
      }
    });

    ws.addRow([]);
    
    const totalRow = ws.addRow({
      merchant: 'TOTAL TRANSAKSI',
      tariff: totalTariffSum,
    });

    totalRow.height = 22;
    totalRow.font = { bold: true };
    totalRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'F1F5F9' },
    };
    
    totalRow.eachCell((cell) => {
      cell.border = {
        top: { style: 'thin', color: { argb: '94A3B8' } },
        bottom: { style: 'double', color: { argb: '475569' } },
      };
    });

    ws.autoFilter = { from: 'A4', to: 'H4' };

    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
  }
}
