const { z } = require("zod");

const routeConversationSchema = z.object({
  tool_name: z.enum(["searchShoes"]),
  description: z.string().max(20).describe("Intent singkat max 20 karakter"), // Limit description length
});

const routeConversation = {
  name: "routeConversation",
  schema: routeConversationSchema,
  description: "Route user intent: searchShoes jika cari sepatu",
};

module.exports = { routeConversation };
