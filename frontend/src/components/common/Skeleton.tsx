// components/common/Skeleton.tsx
//
// 🆕 PENINGKATAN UX: sebelumnya loading state di seluruh app cuma berupa
// teks/spinner berkedip ("Memuat peta...", dsb) -- tidak ada satu pun
// skeleton placeholder yang meniru bentuk konten aslinya. Skeleton yang
// meniru layout asli membuat transisi loading->konten terasa jauh lebih
// mulus (tidak ada "lompatan" tata letak) dan perceived performance lebih
// baik walau waktu tunggu sebenarnya sama.
export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded-lg bg-[#23583E]/40 ${className}`} />;
}

// Placeholder untuk satu baris kartu order/list (avatar/ikon + 2 baris teks).
export function SkeletonListItem() {
  return (
    <div className="bg-[#06170E] border border-[#23583E] p-3 rounded-xl flex items-center gap-3">
      <Skeleton className="w-10 h-10 rounded-full shrink-0" />
      <div className="flex-1 flex flex-col gap-2">
        <Skeleton className="h-3 w-2/3" />
        <Skeleton className="h-2.5 w-1/3" />
      </div>
      <Skeleton className="h-6 w-16 rounded-md shrink-0" />
    </div>
  );
}

// Beberapa SkeletonListItem sekaligus, dipakai untuk daftar order/riwayat/dst.
export function SkeletonList({ count = 4 }: { count?: number }) {
  return (
    <div className="flex flex-col gap-3">
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonListItem key={i} />
      ))}
    </div>
  );
}

// Placeholder kartu statistik/KPI (dashboard admin/merchant).
export function SkeletonStatCard() {
  return (
    <div className="bg-[#0D2E1F] border border-[#23583E] p-4 rounded-2xl flex flex-col gap-3">
      <Skeleton className="h-2.5 w-1/2" />
      <Skeleton className="h-7 w-2/3" />
    </div>
  );
}

export function SkeletonStatGrid({ count = 4 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonStatCard key={i} />
      ))}
    </div>
  );
}
