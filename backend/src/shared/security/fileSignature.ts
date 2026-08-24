// src/shared/security/fileSignature.ts
//
// 🆕 FIX P1 "Upload security harus disatukan" (audit): SEBELUMNYA kedua
// modul upload (upload.config.ts untuk foto bukti bayar/dokumen driver,
// dan file.routes.ts untuk modul File generik) HANYA memvalidasi
// `file.mimetype` -- field ini diambil MENTAH dari header Content-Type
// yang dikirim CLIENT saat multipart/form-data, BUKAN dari isi file yang
// sebenarnya. Header ini trivial dipalsukan (mis. curl -F
// "image=@shell.php;type=image/jpeg") -- fileFilter multer akan LOLOS
// begitu saja walau isi file sebenarnya bukan gambar sama sekali.
// Modul File generik (file.routes.ts) bahkan TIDAK PUNYA fileFilter/MIME
// allowlist SAMA SEKALI -- menerima file APAPUN tanpa validasi jenis.
//
// Util ini membaca "magic bytes" (file signature) beberapa byte pertama
// dari isi file SUNGGUHAN dan mencocokkannya dengan tanda tangan biner
// yang benar-benar dipakai format file tsb -- validasi berbasis KONTEN,
// bukan berbasis klaim header yang bisa dipalsukan.

export type AllowedFileKind = 'image/jpeg' | 'image/png' | 'image/webp' | 'application/pdf';

// Setiap signature dicek dari offset 0, kecuali WEBP yang punya dua
// bagian (RIFF di offset 0, "WEBP" di offset 8 -- format container RIFF).
const SIGNATURES: Record<AllowedFileKind, { offset: number; bytes: number[] }[]> = {
  'image/jpeg': [{ offset: 0, bytes: [0xff, 0xd8, 0xff] }],
  'image/png': [{ offset: 0, bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] }],
  'image/webp': [
    { offset: 0, bytes: [0x52, 0x49, 0x46, 0x46] }, // "RIFF"
    { offset: 8, bytes: [0x57, 0x45, 0x42, 0x50] }, // "WEBP"
  ],
  'application/pdf': [{ offset: 0, bytes: [0x25, 0x50, 0x44, 0x46] }], // "%PDF"
};

function matchesSignature(buffer: Buffer, kind: AllowedFileKind): boolean {
  const parts = SIGNATURES[kind];
  if (!parts) return false;
  return parts.every((part) => {
    if (buffer.length < part.offset + part.bytes.length) return false;
    for (let i = 0; i < part.bytes.length; i++) {
      if (buffer[part.offset + i] !== part.bytes[i]) return false;
    }
    return true;
  });
}

/**
 * Mengecek apakah isi file SUNGGUHAN (bukan mimetype dari header client)
 * cocok dengan salah satu jenis yang diizinkan. Hanya butuh beberapa byte
 * pertama file (buffer bisa berupa potongan awal saja, tidak perlu file
 * utuh) -- cukup panggil dengan minimal 16 byte pertama.
 */
export function detectFileKind(buffer: Buffer): AllowedFileKind | null {
  for (const kind of Object.keys(SIGNATURES) as AllowedFileKind[]) {
    if (matchesSignature(buffer, kind)) return kind;
  }
  return null;
}

export function isAllowedFileContent(buffer: Buffer, allowedKinds: AllowedFileKind[]): boolean {
  const detected = detectFileKind(buffer);
  return detected !== null && allowedKinds.includes(detected);
}
