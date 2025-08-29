const { z } = require("zod");

const searchShoesSchema = z.object({
  userIntent: z.string(), // Limit intent length
  // Only keep essential filters to reduce schema size
  variantFilters: z
    .object({
      Warna: z.array(z.string()).optional(),
      Ukuran: z.array(z.string()).optional(),
    })
    .optional(),
  minPrice: z.number().optional(),
  maxPrice: z.number().optional(),
  brand: z.array(z.string()).optional(),
  category: z.array(z.string()).optional(),
  limit: z.number().default(1).optional(),
  // Remove rarely used fields: material, features, shoeNames, excludeIds, relatedOffers
});

const searchShoesFuncDeclaration = {
  name: "searchShoes",
  schema: searchShoesSchema,
  description: "Search sepatu berdasarkan kriteria user",
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
