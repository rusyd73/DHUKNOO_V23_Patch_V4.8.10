// components/common/ErrorBoundary.tsx
//
// 🆕 PENINGKATAN UX: sebelumnya TIDAK ADA error boundary sama sekali di
// seluruh aplikasi. Artinya kalau ada satu saja error tak tertangkap saat
// render (mis. properti undefined dari response API yang berubah bentuk,
// bug di komponen pihak ketiga, dsb), SELURUH aplikasi React langsung
// crash jadi layar putih kosong -- tidak ada pesan, tidak ada tombol,
// user harus tahu sendiri untuk me-refresh browser. Untuk aplikasi yang
// dipakai driver sedang mengantar order atau customer di tengah transaksi,
// ini sangat merugikan.
//
// Komponen ini menangkap error render di bagian pohon komponen manapun
// yang dibungkusnya, menampilkan UI fallback yang ramah dengan opsi
// "Coba Lagi" (reset boundary, coba render ulang tanpa reload) dan
// "Muat Ulang Aplikasi" (reload penuh, untuk kasus yang reset saja tidak
// cukup). Wajib class component -- React belum punya hook untuk
// componentDidCatch/getDerivedStateFromError.
import { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCw, RotateCcw } from 'lucide-react';

interface Props {
  children: ReactNode;
  // Label opsional supaya pesan error lebih spesifik & log lebih mudah
  // ditelusuri (mis. "Dashboard Driver", "Peta Live Tracking").
  boundaryName?: string;
  // Fallback UI kustom, kalau default tidak cocok untuk konteks tertentu
  // (mis. widget kecil yang tidak boleh menampilkan layar penuh).
  fallback?: (props: { error: Error; reset: () => void }) => ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    // eslint-disable-next-line no-console
    console.error(
      `[ErrorBoundary${this.props.boundaryName ? `: ${this.props.boundaryName}` : ''}]`,
      error,
      errorInfo.componentStack
    );
    // 🆕 Hook untuk observability (lihat item #6 -- monitoring/logging
    // terpusat): kalau window.reportError atau Sentry-like client sudah
    // terpasang, error boundary ini otomatis ikut melaporkan, tanpa perlu
    // mengubah kode di sini lagi nanti.
    try {
      (window as any).__DHUKNOO_REPORT_ERROR__?.(error, {
        boundary: this.props.boundaryName,
        componentStack: errorInfo.componentStack,
      });
    } catch {
      // Jangan sampai reporting error justru melempar error baru.
    }
  }

  reset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError && this.state.error) {
      if (this.props.fallback) {
        return this.props.fallback({ error: this.state.error, reset: this.reset });
      }
      return (
        <div className="min-h-[50vh] w-full flex flex-col items-center justify-center gap-4 p-6 text-center bg-[#06170E]">
          <div className="w-16 h-16 rounded-full bg-red-500/10 border border-red-500/30 flex items-center justify-center">
            <AlertTriangle className="w-8 h-8 text-red-400" />
          </div>
          <div>
            <h2 className="text-white font-black text-lg">
              {this.props.boundaryName ? `Terjadi kesalahan di ${this.props.boundaryName}` : 'Terjadi kesalahan'}
            </h2>
            <p className="text-[#A5C9B8] text-xs mt-1 max-w-sm">
              Mohon maaf, ada masalah teknis yang tidak terduga. Data Anda aman — coba lagi, atau muat ulang
              aplikasi kalau masalah masih berlanjut.
            </p>
          </div>
          <div className="flex gap-3">
            <button
              onClick={this.reset}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-[#00E575] text-[#06170E] text-xs font-bold hover:bg-[#00c765] transition-colors"
            >
              <RotateCcw className="w-4 h-4" /> Coba Lagi
            </button>
            <button
              onClick={() => window.location.reload()}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-[#0D2E1F] border border-[#23583E] text-[#A5C9B8] text-xs font-bold hover:bg-[#123825] transition-colors"
            >
              <RefreshCw className="w-4 h-4" /> Muat Ulang Aplikasi
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export default ErrorBoundary;
