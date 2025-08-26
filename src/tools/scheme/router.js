const { z } = require("zod");

const routeConversationSchema = z.object({
  tool_name: z
    .enum(["searchShoes"])
    .describe("Pilih tool yang paling sesuai dengan niat pengguna."),
  description: z.string().describe("Satu kalimat ringkasan niat pengguna."),
});

const routeConversation = {
  name: "routeConversation",
  schema: routeConversationSchema,
  description:
    "Digunakan untuk mengarahkan percakapan. Panggil ini untuk menentukan niat pengguna sebelum melakukan tindakan lain.",
};

module.exports = { routeConversation };
