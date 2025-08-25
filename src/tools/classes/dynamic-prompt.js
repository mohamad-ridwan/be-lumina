const Category = require("../../models/category");
const Brand = require("../../models/brand");
const Offers = require("../../models/latestOffers");

class DynamicPromptManager {
  constructor() {
    // Compressed core persona
    this.corePersona = `[Persona] "{assistantName}" - asisten sepatu ceria, ramah. Nada: santai, pakai "Kak", emoji wajar (👟✨👍).`;

    this.stagePrompts = {
      greeting: `[Tugas] Tanya singkat kebutuhan sepatu.`,

      gathering_info: `[Tugas] Tanya aktivitas/kategori sepatu. Jika jelas (sepatu lari, casual, dll), lanjut pencarian.
{availableCategories}`,

      searching: `[CRITICAL] HANYA gunakan data dari tool_calls. Jika tool gagal: "Data produk tidak tersedia, coba lagi ya Kak."
[Tugas] Gunakan tool searchShoes dengan kriteria pelanggan.
{availableCategories}
{availableBrands}
{availableOffers}`,

      recommendation: `[Tugas] Gunakan hasil searchShoes. Max 2 produk. Format HTML wajib:
<p style="color:#000;background:transparent;padding:0;">Teks rekomendasi</p><br>
<ol><li><strong>Nama Produk</strong><p style="color:#555;">Deskripsi</p><a href="{link_url_sepatu}">Lihat Detail</a></li></ol><br>`,

      clarification: `[Tugas] Jawab pertanyaan produk dari memori percakapan dulu. Tool hanya jika butuh data baru.`,

      price_sensitive: `[Tugas] WAJIB panggil tool dengan kriteria harga baru.`,
    };
  }

  buildPrompt(stage, context = {}) {
    let prompt = this.corePersona.replace(
      "{assistantName}",
      context.assistantName || "Wawan"
    );
    prompt += "\n" + (this.stagePrompts[stage] || this.stagePrompts.greeting);

    if (["gathering_info", "searching"].includes(stage)) {
      prompt += "\n" + this.buildContextualData(context);
    }

    return this.replacePlaceholders(prompt, context);
  }

  buildContextualData(context) {
    let data = "";
    if (context.categories?.length) {
      data += `\nKategori: ${context.categories
        .map((c) => c.name + (c.isPopular ? "*" : ""))
        .join(", ")}`;
    }
    if (context.brands?.length) {
      data += `\nMerek: ${context.brands.map((b) => b.name).join(", ")}`;
    }
    if (context.offers?.length) {
      data += `\nPromo: ${context.offers.map((o) => o.title).join(", ")}`;
    }
    return data;
  }

  replacePlaceholders(prompt, context) {
    return prompt.replace(/\{(\w+)\}/g, (match, key) => context[key] || match);
  }
}

class ConversationStateManager {
  constructor() {
    this.stages = {
      GREETING: "greeting",
      GATHERING_INFO: "gathering_info",
      SEARCHING: "searching",
      RECOMMENDATION: "recommendation",
      CLARIFICATION: "clarification",
      PRICE_SENSITIVE: "price_sensitive",
    };

    this.priceWords = ["murah", "budget", "harga", "mahal"];
    this.categoryWords = ["lari", "running", "casual", "formal", "olahraga"];
  }

  determineStage(messages, userProfile) {
    const lastMsg = this.getLastUserMessage(messages);
    const hasRecs = this.hasRecommendationsInHistory(messages);

    if (messages.length <= 1) return this.stages.GREETING;
    if (this.isPriceSensitive(lastMsg)) return this.stages.PRICE_SENSITIVE;
    if (hasRecs && this.isAskingForClarification(lastMsg))
      return this.stages.CLARIFICATION;
    if (this.hasSpecificCriteria(lastMsg)) return this.stages.SEARCHING;
    if (hasRecs) return this.stages.RECOMMENDATION;

    return this.stages.GATHERING_INFO;
  }

  isPriceSensitive(msg) {
    const lower = msg.toLowerCase();
    return this.priceWords.some((w) => lower.includes(w));
  }

  hasSpecificCriteria(msg) {
    const lower = msg.toLowerCase();
    return this.categoryWords.some((w) => lower.includes(w));
  }

  isAskingForClarification(msg) {
    const keywords = [
      "ukuran",
      "warna",
      "bahan",
      "ringan",
      "empuk",
      "waterproof",
      "stok",
    ];
    const lower = msg.toLowerCase();
    return keywords.some((w) => lower.includes(w));
  }

  getLastUserMessage(messages) {
    const userMsgs = messages.filter(
      (m) => m._getType && m._getType() === "human"
    );
    return userMsgs.length ? userMsgs[userMsgs.length - 1].content : "";
  }

  hasRecommendationsInHistory(messages) {
    return messages
      .slice(-3)
      .some(
        (m) =>
          m.additional_kwargs?.product_data?.length > 0 ||
          (m.content && m.content.includes("Lihat Detail Produk"))
      );
  }
}

class ContextualDataLoader {
  constructor() {
    this.cache = new Map();
    this.cacheExpiry = 10 * 60 * 1000;
  }

  async loadContextualData(stage) {
    if (this.cache.has(stage)) {
      const cached = this.cache.get(stage);
      if (Date.now() - cached.timestamp < this.cacheExpiry) {
        return cached.data;
      }
    }

    const data = await this.fetchDataByStage(stage);
    this.cache.set(stage, { data, timestamp: Date.now() });
    return data;
  }

  async fetchDataByStage(stage) {
    const data = {};

    try {
      switch (stage) {
        case "gathering_info":
          data.categories = await this.getPopularCategories();
          break;

        case "searching":
        case "recommendation":
        case "price_sensitive":
          if (typeof Category !== "undefined") {
            const [categories, brands, offers] = await Promise.all([
              Category.find().limit(5).lean(),
              Brand.find().limit(5).lean(),
              Offers.find({ isActive: true }).limit(3).lean(),
            ]);
            data.categories = categories;
            data.brands = brands;
            data.offers = offers;
          } else {
            data.categories = await this.getMockCategories();
            data.brands = await this.getMockBrands();
            data.offers = await this.getMockOffers();
          }
          break;
      }
    } catch (error) {
      console.error("Data fetch error:", error);
      data.categories = [];
      data.brands = [];
      data.offers = [];
    }

    return data;
  }

  async getPopularCategories() {
    try {
      if (typeof Category !== "undefined") {
        return await Category.find({ isPopular: true }).limit(3).lean();
      }
      return this.getMockPopularCategories();
    } catch {
      return [];
    }
  }

  async getMockCategories() {
    return [
      { name: "Sepatu Lari", isPopular: true },
      { name: "Sepatu Casual", isPopular: true },
      { name: "Sepatu Formal", isPopular: false },
    ];
  }

  async getMockBrands() {
    return [{ name: "LocalBrand A" }, { name: "LocalBrand B" }];
  }

  async getMockOffers() {
    return [{ title: "Diskon 20%", isActive: true }];
  }

  async getMockPopularCategories() {
    return [
      { name: "Sepatu Lari", isPopular: true },
      { name: "Sepatu Casual", isPopular: true },
    ];
  }
}

class OptimizedInstructionGenerator {
  constructor() {
    this.promptManager = new DynamicPromptManager();
    this.stateManager = new ConversationStateManager();
    this.dataLoader = new ContextualDataLoader();
  }

  async generateInstruction(
    assistantName,
    customerName,
    messages,
    userProfile
  ) {
    const stage = this.stateManager.determineStage(messages, userProfile);
    const contextualData = await this.dataLoader.loadContextualData(stage);

    const context = {
      assistantName: assistantName || "Wawan",
      customerName: customerName ? `Kak ${customerName}` : "Kakak",
      ...contextualData,
    };

    const instruction = this.promptManager.buildPrompt(stage, context);
    const enforcement = this.buildDataEnforcement(stage, messages);

    return instruction + (enforcement ? "\n" + enforcement : "");
  }

  buildDataEnforcement(stage, messages) {
    switch (stage) {
      case "searching":
      case "price_sensitive":
        return "[RULE] WAJIB panggil tool searchShoes. Tunggu hasil sebelum jawab.";
      case "recommendation":
        return "[RULE] Gunakan HANYA data dari tool_calls terakhir.";
      case "clarification":
        return "[RULE] Cek riwayat dulu, tool hanya jika perlu kriteria baru.";
      default:
        return "";
    }
  }
}

class ResponseQualityValidator {
  validateResponse(response, stage, context) {
    const issues = [];

    if (this.containsExternalData(response)) {
      issues.push("Gunakan data internal");
    }

    if (stage === "recommendation" && !this.hasProperHTMLFormat(response)) {
      issues.push("Format HTML salah");
    }

    return {
      isValid: issues.length === 0,
      issues,
      score: this.calculateScore(response, stage),
    };
  }

  containsExternalData(response) {
    const external = ["Nike Air Max", "Adidas Ultraboost", "New Balance 990"];
    const lower = response.toLowerCase();
    return external.some((brand) => lower.includes(brand.toLowerCase()));
  }

  hasProperHTMLFormat(response) {
    return /<p[^>]*>/.test(response) && /<strong>/.test(response);
  }

  calculateScore(response, stage) {
    let score = 100;
    if (this.containsExternalData(response)) score -= 40;
    if (stage === "recommendation" && !this.hasProperHTMLFormat(response))
      score -= 30;
    return Math.max(0, score);
  }
}

module.exports = { OptimizedInstructionGenerator, ResponseQualityValidator };
