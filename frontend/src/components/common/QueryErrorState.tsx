// components/common/QueryErrorState.tsx
//
// 🆕 PENINGKATAN UX: komponen retry standar untuk dipakai di mana pun ada
// `useQuery` yang gagal (isError === true). Sebelumnya kegagalan fetch
// data di sebagian besar halaman tidak punya UI eksplisit -- pengguna
// hanya melihat state kosong/lama tanpa penjelasan atau cara mencoba lagi
// selain refresh browser secara manual.
import { AlertCircle, RotateCcw } from 'lucide-react';

interface QueryErrorStateProps {
  message?: string;
  onRetry: () => void;
  compact?: boolean;
}

export function QueryErrorState({ message, onRetry, compact = false }: QueryErrorStateProps) {
  if (compact) {
    return (
      <div className="flex items-center justify-between gap-3 bg-red-500/10 border border-red-500/30 rounded-xl px-3 py-2 text-xs">
        <span className="text-red-300 flex items-center gap-1.5">
          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
          {message || 'Gagal memuat data.'}
        </span>
        <button
          onClick={onRetry}
          className="flex items-center gap-1 text-[#00E575] font-bold hover:underline shrink-0"
        >
          <RotateCcw className="w-3.5 h-3.5" /> Coba Lagi
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center gap-3 py-8 px-4 text-center border border-dashed border-red-500/30 rounded-xl bg-red-500/5">
      <AlertCircle className="w-8 h-8 text-red-400" />
      <p className="text-xs text-[#A5C9B8] max-w-xs">{message || 'Gagal memuat data. Periksa koneksi internet Anda.'}</p>
      <button
        onClick={onRetry}
        className="flex items-center gap-2 px-4 py-2 rounded-xl bg-[#00E575] text-[#06170E] text-xs font-bold hover:bg-[#00c765] transition-colors"
      >
        <RotateCcw className="w-4 h-4" /> Coba Lagi
      </button>
    </div>
  );
}

export default QueryErrorState;
