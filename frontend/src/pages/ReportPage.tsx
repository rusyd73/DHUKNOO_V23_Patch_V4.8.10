import { useEffect, useState } from "react";
import { joinRoom, onReportReady, type ReportReadyPayload } from '../services/socket';


export const ReportPage = () => {
  const [status, setStatus] = useState('');

  useEffect(() => {
    // 1. (Opsional) Jika backend mewajibkan join room user spesifik untuk keamanan
    // const userId = "ambil_id_user_dari_store";
    // joinRoom(`user_${userId}`).catch(console.error);

    // 2. Pasang listener laporan ready
    const unsubscribe = onReportReady((data: ReportReadyPayload) => {
      setStatus(`Laporan ${data.reportType} selesai! Mengunduh...`);
      
      // Memicu download file otomatis di browser
      const link = document.createElement('a');
      link.href = data.downloadUrl;
      link.setAttribute('download', `laporan-${data.reportType}.${data.format === 'excel' ? 'xlsx' : 'pdf'}`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    });

    // 3. Bersihkan listener saat user meninggalkan halaman laporan
    return () => {
      unsubscribe();
    };
  }, []);

  return (
    <div>
      <p>Status: {status}</p>
    </div>
  );
};
