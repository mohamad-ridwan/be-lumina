const { z } = require("zod");

const rephraseQuery = z.object({
  originalQuery: z.string().describe("Query pencarian asli yang gagal."),
  reason: z
    .string()
    .describe(
      "Alasan mengapa pencarian awal gagal, misalnya 'tidak ada produk dengan kriteria tersebut'."
    ),
  newQuery: z
    .string()
    .describe(
      "Query pencarian baru yang dimodifikasi, disarankan untuk membuatnya lebih umum atau menghapus beberapa filter. Misalnya, jika 'sepatu lari adidas merah' gagal, coba 'sepatu lari adidas'."
    ),
});

const rephraseQueryTool = {
  name: "rephraseQuery",
  description:
    "Modifikasi query pencarian sepatu jika pencarian awal tidak menghasilkan produk. Anda harus menyertakan query baru yang berbeda dan lebih umum.",
  schema: rephraseQuery,
};

const rephraseQueryTools = {
  rephraseQueryTool,
};

module.exports = rephraseQueryTools;
