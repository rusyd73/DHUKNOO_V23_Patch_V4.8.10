const PdfPrinter = require('pdfmake') as any;
import {
  TDocumentDefinitions,
  TableCell,
  CustomTableLayout,
} from 'pdfmake/interfaces';

export interface OrderReportItem {
  id: string;
  createdAt: string | Date;
  totalTariff: number;
  status: string;
  customer?: {
    name: string;
  };
  merchant?: {
    name: string;
  };
  payment?: {
    method: string;
  };
}

const fonts = {
  Roboto: {
    normal:
      'node_modules/roboto-font/fonts/Roboto/Roboto-Regular.ttf',
    bold:
      'node_modules/roboto-font/fonts/Roboto/Roboto-Bold.ttf',
    italics:
      'node_modules/roboto-font/fonts/Roboto/Roboto-Italic.ttf',
  },
};

export class PdfGenerator {
  private static printer = new PdfPrinter(fonts);

  static async generateOrderReport(
    data: OrderReportItem[],
  ): Promise<Buffer> {
    let totalTariff = 0;

    const body: TableCell[][] = [];

    // Header
    body.push([
      {
        text: 'No',
        style: 'tableHeader',
        alignment: 'center',
      },
      {
        text: 'Order ID',
        style: 'tableHeader',
      },
      {
        text: 'Tanggal',
        style: 'tableHeader',
      },
      {
        text: 'Customer',
        style: 'tableHeader',
      },
      {
        text: 'Merchant',
        style: 'tableHeader',
      },
      {
        text: 'Tarif',
        style: 'tableHeader',
        alignment: 'right',
      },
      {
        text: 'Status',
        style: 'tableHeader',
        alignment: 'center',
      },
    ]);

    // Body
    data.forEach((item, index) => {
      const tariff = Number(item.totalTariff ?? 0);

      totalTariff += tariff;

      body.push([
        {
          text: String(index + 1),
          alignment: 'center',
        },
        {
          text: item.id,
        },
        {
          text: new Date(item.createdAt).toLocaleString('id-ID'),
        },
        {
          text: item.customer?.name ?? '-',
        },
        {
          text: item.merchant?.name ?? '-',
        },
        {
          text: `Rp ${tariff.toLocaleString('id-ID')}`,
          alignment: 'right',
        },
        {
          text: item.status.toUpperCase(),
          alignment: 'center',
        },
      ]);
    });

    const customTableLayout: CustomTableLayout = {
      fillColor: (row: number) => {
        if (row === 0) {
          return '#1E40AF';
        }

        if (row % 2 === 0) {
          return '#F8FAFC';
        }

        return null;
      },

      hLineWidth: () => 0.5,

      vLineWidth: () => 0.5,

      hLineColor: () => '#CBD5E1',

      vLineColor: () => '#CBD5E1',
    };

    const docDefinition: TDocumentDefinitions = {
      pageSize: 'A4',

      pageOrientation: 'landscape',

      pageMargins: [30, 40, 30, 40],

      defaultStyle: {
        font: 'Roboto',
        fontSize: 9,
      },

      footer: (currentPage: number, pageCount: number) => ({
        columns: [
          {
            text: 'OBAMA Ride Platform',
            alignment: 'left',
            style: 'footer',
          },
          {
            text: `Halaman ${currentPage} / ${pageCount}`,
            alignment: 'right',
            style: 'footer',
          },
        ],

        margin: [30, 8, 30, 0],
      }),

      content: [
        {
          text: 'OBAMA RIDE',
          style: 'title',
        },

        {
          text: 'LAPORAN TRANSAKSI ORDER',
          style: 'subtitle',
        },

        {
          text: `Dicetak : ${new Date().toLocaleString('id-ID')}`,
          style: 'timestamp',
        },

        {
          margin: [0, 20, 0, 20],

          table: {
            headerRows: 1,

            widths: [30, 100, 120, '*', '*', 90, 70],

            body,
          },

          layout: customTableLayout,
        },

        {
          margin: [0, 10, 0, 0],

          table: {
            widths: ['*', 180],

            body: [
              [
                {
                  text: 'TOTAL ORDER',
                  bold: true,
                },

                {
                  text: String(data.length),
                  bold: true,
                  alignment: 'right',
                },
              ],

              [
                {
                  text: 'TOTAL TARIF',
                  bold: true,
                },

                {
                  text: `Rp ${totalTariff.toLocaleString('id-ID')}`,
                  bold: true,
                  alignment: 'right',
                },
              ],
            ],
          },

          layout: 'noBorders',
        },
      ],

      styles: {
        title: {
          fontSize: 22,
          bold: true,
          alignment: 'center',
          color: '#1E40AF',
        },

        subtitle: {
          fontSize: 13,
          bold: true,
          alignment: 'center',
          margin: [0, 8, 0, 5],
        },

        timestamp: {
          fontSize: 9,
          italics: true,
          alignment: 'center',
          color: '#64748B',
          margin: [0, 0, 0, 20],
        },

        tableHeader: {
          fontSize: 10,
          bold: true,
          color: '#FFFFFF',
        },

        footer: {
          fontSize: 8,
          color: '#64748B',
        },
      },
    };

    const pdfDoc =
      this.printer.createPdfKitDocument(docDefinition);

    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];

      pdfDoc.on('data', (chunk: Buffer) => {
        chunks.push(Buffer.from(chunk));
      });

      pdfDoc.on('end', () => {
        resolve(Buffer.concat(chunks));
      });

      pdfDoc.on('error', (err: Error) => {
        reject(err);
      });

      pdfDoc.end();
    });
  }
}