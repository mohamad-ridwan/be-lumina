const { z } = require("zod");

const searchShoesSchema = z.object({
  userIntent: z
    .string()
    .describe(
      "Satu kalimat ringkasan niat pengguna. Contoh: 'Mencari sepatu lari Nike, hitam, ukuran 42.'"
    ),
  variantFilters: z
    .object({
      Warna: z.array(z.string()).optional(),
      Ukuran: z.array(z.string()).optional(),
    })
    .optional()
    .describe(
      `Objek filter varian. Gunakan nama warna literal yang terdekat. Contoh: {'Warna': ['hitam'], 'Ukuran': ['42']}`
    ),

  minPrice: z.number().optional().describe("Harga minimum dalam Rupiah."),
  maxPrice: z.number().optional().describe("Harga maksimum dalam Rupiah."),
  brand: z.array(z.string()).optional().describe("Nama merek sepatu."),
  category: z.array(z.string()).optional().describe("Daftar kategori sepatu."),
  label: z.string().optional().describe("Label khusus sepatu."),
  newArrival: z.boolean().optional().describe("Filter untuk model baru."),
  relatedOffers: z
    .array(z.string())
    .optional()
    .describe("Daftar penawaran sepatu."),
  limit: z
    .number()
    .optional()
    .describe("Jumlah maksimal hasil pencarian (max 2)."),
  material: z.array(z.string()).optional().describe("Material utama sepatu."),
  features: z.array(z.string()).optional().describe("Fitur spesifik sepatu."),
  shoeNames: z.array(z.string()).optional().describe("Nama sepatu spesifik."),
  excludeIds: z
    .array(z.string())
    .optional()
    .describe("ID sepatu yang harus dikecualikan."),
});

const searchShoesFuncDeclaration = {
  name: "searchShoes",
  schema: searchShoesSchema,
  description: `Gunakan fungsi ini untuk mencari sepatu berdasarkan kriteria dari pertanyaan pengguna. Ekstrak semua parameter relevan menjadi field yang sesuai, seperti kategori, merek, harga, fitur, dan lainnya.
  
  **Aturan:**
  - Panggil fungsi ini HANYA JIKA pengguna secara eksplisit mencari sepatu.
  - Jangan gunakan ini untuk pertanyaan umum atau non-produk.
  - Tambahkan ID produk ke 'excludeIds' jika produk tersebut sudah dilihat atau tidak relevan.
  - Jumlah hasil maksimal dibatasi 1.`,
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
