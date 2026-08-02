/**
 * SKRIP SEKALI-JALAN: perbaiki URL upload lama yang tersimpan sebagai path
 * relatif ("/uploads/xxx.jpg") menjadi URL lengkap (mis. "http://localhost:3000
 * /uploads/xxx.jpg"). Ini akibat bug lama di upload.routes.ts yang sudah
 * diperbaiki — tapi perbaikan itu HANYA berlaku untuk upload baru. Dokumen/
 * bukti bayar/bukti top-up yang di-upload SEBELUM perbaikan itu masih
 * tersimpan dengan path relatif dan tetap gagal di-preview sampai dijalankan
 * skrip ini sekali.
 *
 * Cara pakai (dari folder backend/):
 *   npx ts-node scripts/fix-legacy-upload-urls.ts http://localhost:3000
 *
 * Ganti "http://localhost:3000" dengan base URL backend Anda yang sebenarnya
 * (di production, pakai domain aslinya, mis. https://api.dhuknoo.id).
 *
 * Aman dijalankan berkali-kali (idempotent) — hanya mengubah baris yang MASIH
 * berupa path relatif (diawali "/uploads/"), baris yang sudah URL lengkap
 * (diawali "http") dilewati begitu saja.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function fixRelativeUrls(baseUrl: string) {
  const normalizedBase = baseUrl.replace(/\/$/, '');

  const results = {
    driverDocuments: 0,
    paymentProofs: 0,
    topupRequests: 0,
  };

  // ── DriverDocument.imageUrl ──────────────────────────────────────────
  const documents = await prisma.driverDocument.findMany({
    where: { imageUrl: { startsWith: '/uploads/' } },
    select: { id: true, imageUrl: true },
  });
  for (const doc of documents) {
    await prisma.driverDocument.update({
      where: { id: doc.id },
      data: { imageUrl: `${normalizedBase}${doc.imageUrl}` },
    });
    results.driverDocuments++;
  }

  // ── PaymentProof.proofImageUrl ───────────────────────────────────────
  const proofs = await prisma.paymentProof.findMany({
    where: { proofImageUrl: { startsWith: '/uploads/' } },
    select: { id: true, proofImageUrl: true },
  });
  for (const proof of proofs) {
    await prisma.paymentProof.update({
      where: { id: proof.id },
      data: { proofImageUrl: `${normalizedBase}${proof.proofImageUrl}` },
    });
    results.paymentProofs++;
  }

  // ── TopupRequest.proofImageUrl ───────────────────────────────────────
  const topups = await prisma.topupRequest.findMany({
    where: { proofImageUrl: { startsWith: '/uploads/' } },
    select: { id: true, proofImageUrl: true },
  });
  for (const topup of topups) {
    await prisma.topupRequest.update({
      where: { id: topup.id },
      data: { proofImageUrl: `${normalizedBase}${topup.proofImageUrl}` },
    });
    results.topupRequests++;
  }

  return results;
}

async function main() {
  const baseUrl = process.argv[2];
  if (!baseUrl) {
    console.error('Penggunaan: npx ts-node scripts/fix-legacy-upload-urls.ts <base-url-backend>');
    console.error('Contoh:    npx ts-node scripts/fix-legacy-upload-urls.ts http://localhost:3000');
    process.exit(1);
  }

  console.log(`Memperbaiki URL relatif lama, prefix: ${baseUrl}`);
  const results = await fixRelativeUrls(baseUrl);
  console.log('Selesai. Baris yang diperbaiki:');
  console.log(`  - DriverDocument.imageUrl   : ${results.driverDocuments}`);
  console.log(`  - PaymentProof.proofImageUrl: ${results.paymentProofs}`);
  console.log(`  - TopupRequest.proofImageUrl: ${results.topupRequests}`);
}

main()
  .catch((err) => {
    console.error('Skrip gagal:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
