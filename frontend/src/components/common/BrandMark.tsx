// DHUKNOO brand mark — identitas visual 2026.
// Shape diambil dari logo resmi yang disetujui; warna mengikuti currentColor
// sehingga tetap adaptif untuk mode gelap/terang tanpa menggandakan komponen.
export function BrandMark({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`inline-block ${className || ''}`}
      style={{
        backgroundColor: 'currentColor',
        WebkitMaskImage: 'url(/brand/dhuknoo-mark-lime.png)',
        maskImage: 'url(/brand/dhuknoo-mark-lime.png)',
        WebkitMaskRepeat: 'no-repeat',
        maskRepeat: 'no-repeat',
        WebkitMaskPosition: 'center',
        maskPosition: 'center',
        WebkitMaskSize: 'contain',
        maskSize: 'contain',
      }}
    />
  );
}

export default BrandMark;
