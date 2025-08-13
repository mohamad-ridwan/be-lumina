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
      "Objek untuk memfilter varian seperti warna atau ukuran. Contoh: {'Warna': ['hitam'], 'Ukuran': ['42'] }"
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
    .string()
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
    .string()
    .optional()
    .describe("Nama penawaran khusus atau diskon yang terkait."),
  limit: z
    .number()
    .optional()
    .describe("Jumlah maksimum hasil pencarian, maksimal 15."),
  isPopular: z
    .boolean()
    .optional()
    .describe("Filter untuk sepatu yang memiliki kategori populer."),
  material: z
    .string()
    .optional()
    .describe("Material utama sepatu (misal: 'kulit', 'kanvas', 'mesh')."),
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
*   Warna spesifik (misal: 'warna hitam', 'merah cerah')
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

const shoeSchemeTools = {
  searchShoesFuncDeclaration,
};

module.exports = shoeSchemeTools;
