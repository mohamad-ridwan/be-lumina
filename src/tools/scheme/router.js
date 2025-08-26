const { z } = require("zod");

const routeConversationSchema = z.object({
  tool_name: z
    .enum(["searchShoes"])
    .describe("Pilih tool yang paling sesuai dengan niat pengguna."),
  description: z.string().describe("Satu kalimat ringkasan niat pengguna."),
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
    "Digunakan untuk mengarahkan percakapan. Panggil ini untuk menentukan niat pengguna sebelum melakukan tindakan lain.",
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
