const { z } = require("zod");

const routeConversationSchema = z.object({
  tool_name: z
    .enum(["searchShoes", "clarification", "endConversation"])
    .describe(
      "Nama tool yang harus dijalankan. Pilih 'searchShoes' jika pengguna ingin mencari sepatu. Pilih 'clarification' jika pertanyaan membutuhkan klarifikasi lebih lanjut. Pilih 'endConversation' jika percakapan sudah selesai dan tidak perlu alat lain."
    ),
  description: z
    .string()
    .describe(
      "Deskripsi singkat tentang niat pengguna. Misal: 'pengguna ingin mencari sepatu lari', 'pengguna menanyakan ketersediaan produk', 'pengguna mengucapkan terima kasih'."
    ),
});

const clarificationSchema = z.object({
  userIntent: z
    .string()
    .describe(
      "Satu kalimat ringkasan tentang niat pengguna yang membutuhkan klarifikasi."
    ),
});

const endConversationSchema = z.object({
  userIntent: z
    .string()
    .describe(
      "Satu kalimat ringkasan tentang niat pengguna yang mengakhiri percakapan."
    ),
});

const routeConversation = {
  name: "routeConversation",
  schema: routeConversationSchema,
  description:
    "Tool ini digunakan untuk menentukan arah percakapan. LLM harus memanggil tool ini terlebih dahulu sebelum mengambil tindakan lain. Tools ini akan menerima input berupa niat pengguna dan mengembalikan nama tool yang harus dijalankan. Setelah tool ini dipanggil, LLM akan mengembalikan output berupa tool call dan LangGraph akan melanjutkan ke node selanjutnya.",
};

const clarificationTool = {
  name: "clarification",
  schema: clarificationSchema,
  description:
    "Gunakan tool ini ketika pertanyaan pengguna tidak cukup spesifik untuk mencari sepatu. LLM harus menjawab langsung tanpa memanggil tool pencarian. Contoh: 'sepatu yang bagus', 'sepatu yang ringan banget', atau pertanyaan yang tidak berhubungan dengan produk.",
};

const endConversationTool = {
  name: "endConversation",
  schema: endConversationSchema,
  description:
    "Gunakan tool ini ketika pengguna mengucapkan salam perpisahan, terima kasih, atau mengakhiri percakapan secara langsung. LLM harus memberikan respons penutup yang sesuai.",
};

module.exports = { routeConversation, clarificationTool, endConversationTool };
