const { z } = require("zod");

const searchShoesSchema = z.object({
  // Atribut yang diperlukan (required)
  userIntent: z
    .string()
    .describe(
      "Ringkasan niat utama pengguna dalam satu kalimat. Contoh: 'Mencari sepatu lari dari Nike, warna hitam, ukuran 42'"
    ),

  // Perbaikan: variantFilters harus berupa objek dengan nilai array string, seperti yang ditunjukkan di contoh
  variantFilters: z
    .record(z.array(z.string()))
    .optional()
    .describe(
      `Objek untuk memfilter varian seperti warna atau ukuran. 
     Nilai warna mengacu pada pemahaman warna umum di dunia, bukan hanya yang ada di katalog internal.
     Contoh warna umum: hitam, putih, abu-abu, biru, merah, hijau, kuning, oranye, cokelat, beige, pastel.
     Warna lembut atau 'tidak mencolok' biasanya termasuk hitam, krem, abu-abu, biru muda/navy.
     Warna mencolok biasanya termasuk merah terang, kuning neon, oranye terang.
     Gunakan kata warna literal yang terdekat.
     Contoh: {'Warna': ['hitam'], 'Ukuran': ['42'] }`
    ),

  // Atribut yang opsional (optional)
  minPrice: z
    .number()
    .optional()
    .describe("Harga minimum yang diinginkan dalam Rupiah. Contoh: 1500000"),
  maxPrice: z
    .number()
    .optional()
    .describe("Harga maksimum yang diinginkan dalam Rupiah. Contoh: 2000000"),
  brand: z
    .array(z.string())
    .optional()
    .describe("Nama merek sepatu (misal: 'Adidas', 'Nike')."),
  category: z
    .array(z.string())
    .optional()
    .describe("Daftar kategori sepatu (misal: 'Sepatu lari', 'Kasual')."),
  label: z
    .string()
    .optional()
    .describe("Label khusus sepatu (misal: 'limited edition', 'premium')."),
  newArrival: z
    .boolean()
    .optional()
    .describe("Filter untuk sepatu yang merupakan model baru."),
  relatedOffers: z
    .array(z.string())
    .optional()
    .describe(
      "Daftar penawaran sepatu (misal: 'Musim Panas Tiba!', 'Waktunya Untuk Belajar Lagi!')"
    ),
  limit: z
    .number()
    .optional()
    .describe("Jumlah maksimum hasil pencarian, maksimal 15."),
  material: z
    .string()
    .optional()
    .describe(
      "Material utama sepatu (misal: 'kulit', 'kanvas', 'mesh'). Gabungkan menjadi string."
    ),
  shoeNames: z
    .array(z.string())
    .optional()
    .describe("Daftar nama sepatu spesifik yang dicari."),
});

const searchShoesFuncDeclaration = {
  name: "searchShoes",
  schema: searchShoesSchema,
  description: `Gunakan fungsi ini ketika pengguna mencari sepatu berdasarkan berbagai kriteria, termasuk:

*   Jenis kegiatan (misal: 'sepatu lari', 'sepatu basket', 'untuk hiking', 'kasual')
*   Fitur spesifik (misal: 'nyaman', 'tahan air', 'ringan', 'support', 'ada busa empuk', 'sol anti-slip')
*   Gaya (misal: 'retro', 'modern', 'sporty', 'fashionable')
*   Budget atau kisaran harga (misal: 'harga di bawah 1.5 juta', 'antara 800 ribu sampai 2 juta')
*   Merek tertentu (misal: 'dari Adidas', 'Nike', 'Converse')
*   Warna spesifik — AI boleh memetakan istilah umum seperti 'tidak mencolok' menjadi warna literal yang sesuai (misalnya hitam, putih, abu-abu, cokelat, krem)
*   Ketersediaan ukuran (misal: 'ukuran 42', 'tersedia ukuran besar')
*   Kombinasi dari kriteria tersebut

Fungsi ini juga dapat digunakan untuk pertanyaan yang ambigu ('sepatu apa ya yang cocok untuk saya?'). Dalam kasus ini, biarkan logika di backend melakukan pemfilteran cerdas berdasarkan deskripsi produk.

Ekstrak semua parameter yang relevan dari pertanyaan pengguna. Pastikan hasil pencarian tidak duplikasi dan akurat sesuai pertanyaan. Jangan memberikan solusi di luar konteks pertanyaan.

AI juga bisa menemukan produk sesuai jumlah yang di inginkan, namun maksimal nya 15.
AI juga bisa menghasilkan multi argumen apabila makna yang tersirat dari pertanyaan mengandung permintaan yang berbeda (misal: saya mencari sepatu untuk lari dan juga sepatu untuk berkerja).
AI juga bisa menyesuaikan sepatu dengan harga atau budget yang ditentukan pertanyaan.
AI wajib memberikan solusi dan di extract menjadi parameter yang relevan.

AI HARUS MEMANGGIL fungsi ini ketika pengguna mencari sepatu berdasarkan berbagai kriteria.

Jangan gunakan fungsi ini ketika pengguna menanyakan tentang hal yang sebelumnya di dalam percakapan (history)`,
};

const productInfoSchema = z.object({
  model: z
    .string()
    .optional()
    .describe(
      "Gaya atau desain spesifik dari sepatu. Ini bisa berupa jenis sepatu umum (misalnya 'sepatu kets', 'sepatu boots') atau desain khusus dalam jenis tersebut (misalnya 'Air Jordan 1', 'Oxford')."
    ),
  deskripsi: z
    .string()
    .optional()
    .describe(
      "Deskripsi naratif umum tentang produk. JANGAN masukkan nama model, informasi teknis, atau atribut terperinci di sini. Fokus pada cerita atau kegunaan produk secara keseluruhan."
    ),
  spesifikasi: z
    .string()
    .optional()
    .describe(
      "Spesifikasi teknis produk dalam bentuk poin-poin atau ringkasan faktual. Contoh: 'Berat 250 gram, Sol anti-slip.' Fokus pada data dan fitur teknis."
    ),
  keunggulan: z
    .string()
    .optional()
    .describe(
      "Keunggulan atau fitur yang menonjol secara fungsional dan persuasif. Contoh: 'sangat ringan', 'tahan air', 'nyaman untuk lari jarak jauh'."
    ),
  bahan: z
    .string()
    .optional()
    .describe(
      "Material atau bahan utama yang digunakan pada produk. Contoh: 'upper dari mesh', 'sol karet'."
    ),
  fitur: z
    .string()
    .optional()
    .describe(
      "Fitur atau teknologi spesifik yang dimiliki produk, seringkali memiliki nama unik. Contoh: 'teknologi Boost', 'sol Continental', 'teknologi rajutan Flyknit'."
    ),
  penggunaan: z
    .string()
    .optional()
    .describe(
      "Tujuan utama dari sepatu tersebut, seperti 'untuk lari jarak jauh', 'untuk latihan gym', atau 'untuk kegiatan sehari-hari'."
    ),
  targetPengguna: z
    .string()
    .optional()
    .describe(
      "Target pengguna sepatu, misalnya 'Pria', 'Wanita', 'Anak-anak', atau 'Unisex'."
    ),
  tingkatBantalan: z
    .string()
    .optional()
    .describe(
      "Tingkat keempukan atau bantalan pada sol sepatu, misalnya 'Empuk', 'Responsif', atau 'Minimalis'."
    ),
});

const productInfoTool = {
  name: "extractProductInfo",
  schema: productInfoSchema,
  description:
    "Gunakan fungsi ini untuk mengekstrak informasi detail produk seperti deskripsi, spesifikasi, keunggulan, dan bahan dari sebuah teks.",
};

const shoeSchemeTools = {
  searchShoesFuncDeclaration,
  productInfoTool,
};

module.exports = shoeSchemeTools;
