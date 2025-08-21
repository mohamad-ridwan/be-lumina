const { z } = require("zod");

const rephraseQuerySchema = z.object({
  originalQuery: z
    .string()
    .describe(
      "Query pencarian asli yang gagal. Contoh: 'sepatu lari Nike warna biru'"
    ),
  reason: z
    .string()
    .describe(
      "Alasan singkat mengapa pencarian awal gagal. Contoh: 'tidak ada produk dengan kriteria tersebut'"
    ),
  newQuerySuggestion: z
    .string()
    .optional()
    .describe(
      "Saran query pencarian baru yang dimodifikasi. Saran ini harus lebih umum atau menghilangkan filter yang mungkin menyebabkan kegagalan. Contoh: 'sepatu lari Nike' atau 'sepatu lari warna biru'. Parameter ini tidak wajib jika model yakin sudah tidak ada alternatif."
    ),
});

const rephraseQueryTool = {
  name: "rephraseQuery",
  description: `Gunakan tool ini HANYA JIKA pencarian sepatu sebelumnya gagal. Tool ini berfungsi untuk menganalisis kegagalan dan menyarankan query baru yang lebih mungkin berhasil. Setelah memanggil tool ini, Anda HARUS memutuskan apakah akan memanggil tool 'searchShoes' lagi dengan query baru yang disarankan. JANGAN panggil tool ini jika pertanyaan sudah tidak relevan dengan pencarian sepatu.`,
  schema: rephraseQuerySchema,
};

const rephraseQueryTools = {
  rephraseQueryTool,
};

module.exports = rephraseQueryTools;
