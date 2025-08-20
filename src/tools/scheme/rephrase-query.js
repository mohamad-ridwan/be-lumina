const { z } = require("zod");

const rephraseQuerySchema = z.object({
  failedQuery: z
    .string()
    .describe(
      "Query pencarian asli yang gagal. Misalnya, 'sepatu lari Nike warna biru'"
    ),
  newQuerySuggestion: z
    .string()
    .describe(
      "Saran query pencarian baru yang dimodifikasi. Saran ini harus lebih umum atau menghilangkan filter yang mungkin menyebabkan kegagalan. Contoh: 'sepatu lari Nike' atau 'sepatu lari warna biru'"
    ),
  reason: z
    .string()
    .describe(
      "Alasan singkat mengapa pencarian awal gagal. Contoh: 'tidak ada produk dengan kriteria tersebut'"
    ),
});

const rephraseQueryTool = {
  name: "rephraseQuery",
  description: `Gunakan tool ini HANYA JIKA pencarian sepatu awal gagal dan Anda yakin query dapat dimodifikasi untuk mendapatkan hasil.
  Tool ini berfungsi untuk menginformasikan Anda tentang saran perbaikan.
  
  Anda harus mengambil keputusan berdasarkan saran ini untuk melakukan panggilan tool 'searchShoes' lagi dengan parameter yang baru.
  
  Contoh penggunaan:
  - Jika 'sepatu lari Nike warna merah' gagal, panggil tool ini dengan newQuerySuggestion 'sepatu lari Nike' atau 'sepatu lari warna merah' tergantung prioritas.
  - Jika 'sepatu kasual Converse ukuran 45' gagal, panggil dengan newQuerySuggestion 'sepatu kasual Converse'
  
  JANGAN panggil tool ini jika pertanyaan sudah tidak relevan dengan pencarian sepatu.`,
  schema: rephraseQuerySchema,
};

const rephraseQueryTools = {
  rephraseQueryTool,
};

module.exports = rephraseQueryTools;
