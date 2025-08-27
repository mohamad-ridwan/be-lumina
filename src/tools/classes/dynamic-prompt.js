const Category = require("../../models/category");
const Brand = require("../../models/brand");
const Offers = require("../../models/latestOffers");

class AdvancedIntentFlowManager {
  constructor() {
    // Group intents by flow type for efficient processing
    this.intentFlows = {
      // Direct search flows - require immediate tool usage
      SEARCH_FLOWS: [
        "requestProductRecommendation",
        "productInquiryByActivity",
        "productInquiryByCategory",
        "productInquiryBySpecificFeature",
        "productInquiryWithMultipleCriteria",
      ],

      // Refinement flows - modify existing search
      REFINE_FLOWS: [
        "refineSearchByPrice",
        "refineSearchByBrand",
        "refineSearchByColor",
        "refineSearchBySize",
      ],

      // Conversational flows - no tools needed
      CONVO_FLOWS: [
        "startConversation",
        "generalInquiry",
        "clarifyProductDetails",
        "positiveSentimentResponse",
        "negativeSentimentResponse",
        "endConversation",
        "systemErrorInquiry",
      ],
    };

    // Ultra-compact prompts by flow type
    this.flowPrompts = {
      SEARCH_FLOWS: `Asisten sepatu {name}. WAJIB panggil searchShoes dengan kriteria user. Jawab "Kak" 👟`,
      REFINE_FLOWS: `Asisten sepatu {name}. WAJIB panggil searchShoes dengan filter baru. Jawab "Kak" 👟`,
      CONVO_FLOWS: `Asisten sepatu {name}. Jawab ramah tanpa tool. Gunakan "Kak", emoji minimal 👟`,
    };

    // Specific intent handling for edge cases
    this.intentActions = {
      startConversation: () => "Hai Kak! Ada sepatu yang dicari? 👟",
      generalInquiry: () =>
        "Sepatu untuk aktivitas apa Kak? Lari, casual, atau formal? 👟",
      endConversation: () => "Terima kasih Kak! Semoga cocok sepatunya 👟✨",
      systemErrorInquiry: () =>
        "Maaf Kak, ada yang bisa dibantu soal sepatu? 👟",
      positiveSentimentResponse: () =>
        "Senang bisa bantu Kak! Ada yang lain? 👟",
      negativeSentimentResponse: () => "Oke Kak, cari alternatif lain ya 👟",
    };
  }

  determineFlow(intents) {
    // Priority-based flow determination
    for (const intent of intents) {
      if (this.intentFlows.SEARCH_FLOWS.includes(intent.name)) {
        return { type: "SEARCH_FLOWS", needsTools: true, priority: 1 };
      }
    }

    for (const intent of intents) {
      if (this.intentFlows.REFINE_FLOWS.includes(intent.name)) {
        return { type: "REFINE_FLOWS", needsTools: true, priority: 2 };
      }
    }

    // Default to conversation flow
    const primaryIntent = intents[0]?.name || "generalInquiry";
    return {
      type: "CONVO_FLOWS",
      needsTools: false,
      priority: 3,
      specificIntent: primaryIntent,
    };
  }

  generatePrompt(flowType, assistantName, specificIntent) {
    let basePrompt = this.flowPrompts[flowType].replace(
      "{name}",
      assistantName || "Wawan"
    );

    // Add specific action for direct response intents
    if (flowType === "CONVO_FLOWS" && this.intentActions[specificIntent]) {
      basePrompt += ` Respon: "${this.intentActions[specificIntent]()}"`;
    }

    return basePrompt;
  }

  // Extract search criteria from user message for optimization
  extractSearchCriteria(message, intents) {
    const criteria = {};
    const text = message.toLowerCase();

    // Quick keyword extraction for search optimization
    const patterns = {
      price: /(?:budget|harga|murah|mahal|dibawah|under)\s*(\d+)/i,
      brand: /(?:brand|merek)\s*([a-zA-Z]+)/i,
      color: /(?:warna|color)\s*([a-zA-Z]+)/i,
      size: /(?:ukuran|size)\s*(\d+)/i,
      category: /(lari|running|casual|formal|olahraga|hiking)/i,
    };

    for (const [key, pattern] of Object.entries(patterns)) {
      const match = text.match(pattern);
      if (match) criteria[key] = match[1];
    }

    return criteria;
  }
}

class IntentClassificationSystem {
  constructor() {
    // Intent hierarchy with token cost optimization
    this.intentHierarchy = {
      // Tier 1: Direct action intents (highest priority, immediate tool usage)
      IMMEDIATE_ACTION: {
        intents: [
          "requestProductRecommendation",
          "productInquiryByActivity",
          "productInquiryByCategory",
          "productInquiryBySpecificFeature",
          "productInquiryWithMultipleCriteria",
        ],
        tokenCost: "HIGH", // Requires tools + response generation
        needsTools: true,
        maxTokens: 400,
      },

      // Tier 2: Search refinement (medium priority, tool usage with context)
      SEARCH_REFINEMENT: {
        intents: [
          "refineSearchByPrice",
          "refineSearchByBrand",
          "refineSearchByColor",
          "refineSearchBySize",
        ],
        tokenCost: "MEDIUM", // Requires tools but shorter prompts
        needsTools: true,
        maxTokens: 300,
      },

      // Tier 3: Information retrieval (low-medium priority, context-based)
      INFO_RETRIEVAL: {
        intents: ["clarifyProductDetails"],
        tokenCost: "MEDIUM", // Context lookup, possibly tools
        needsTools: false, // Try context first
        maxTokens: 200,
      },

      // Tier 4: Conversational (lowest token cost, predefined responses)
      CONVERSATIONAL: {
        intents: [
          "startConversation",
          "generalInquiry",
          "positiveSentimentResponse",
          "negativeSentimentResponse",
          "endConversation",
          "systemErrorInquiry",
        ],
        tokenCost: "LOW", // Predefined or simple generation
        needsTools: false,
        maxTokens: 100,
      },
    };

    // Precomputed responses for ultra-fast conversational intents
    this.precomputedResponses = {
      startConversation: (name) =>
        `Hai Kak! ${name || "Wawan"} siap bantu cari sepatu. Ada yang dicari?`,
      generalInquiry: () =>
        "Sepatu untuk aktivitas apa Kak? Lari, casual, atau formal?",
      endConversation: () => "Terima kasih Kak! Semoga cocok sepatunya",
      systemErrorInquiry: () => "Maaf Kak, ada yang bisa dibantu soal sepatu?",
      positiveSentimentResponse: () => "Senang bisa bantu Kak! Ada yang lain?",
      negativeSentimentResponse: () => "Oke Kak, cari alternatif lain ya",
    };

    // Search criteria patterns for efficient extraction
    this.criteriaPatterns = {
      activity:
        /(lari|running|jogging|olahraga|gym|casual|formal|kerja|hiking|jalan)/i,
      price:
        /(?:budget|harga|murah|mahal|dibawah|under|maksimal|max)\s*(\d+(?:\.\d+)?(?:k|rb|ribu|juta)?)/i,
      brand: /(?:brand|merek|merk)\s*([a-zA-Z]+)/i,
      color:
        /(?:warna|color)\s*(hitam|putih|merah|biru|kuning|hijau|coklat|abu|pink|ungu)/i,
      size: /(?:ukuran|size)\s*(\d+)/i,
      feature: /(ringan|waterproof|tahan|air|empuk|nyaman|breathable)/i,
    };
  }

  // Fast intent classification with token optimization
  classifyIntent(intents, userMessage) {
    if (!intents?.length) return this.getDefaultClassification();

    // Find the highest priority tier
    for (const [tierName, tierConfig] of Object.entries(this.intentHierarchy)) {
      const matchedIntents = intents.filter((intent) =>
        tierConfig.intents.includes(intent.name)
      );

      if (matchedIntents.length > 0) {
        return {
          tier: tierName,
          primaryIntent: matchedIntents[0].name,
          config: tierConfig,
          criteria: this.extractCriteria(userMessage, tierName),
          canUsePrecomputed: this.canUsePrecomputedResponse(
            matchedIntents[0].name
          ),
        };
      }
    }

    return this.getDefaultClassification();
  }

  // Extract search criteria efficiently
  extractCriteria(userMessage, tier) {
    if (tier === "CONVERSATIONAL") return {};

    const criteria = {};
    const text = userMessage.toLowerCase();

    for (const [key, pattern] of Object.entries(this.criteriaPatterns)) {
      const match = text.match(pattern);
      if (match) {
        criteria[key] = match[1] || match[0];
        // Convert price format
        if (key === "price" && criteria[key]) {
          criteria[key] = this.normalizePrice(criteria[key]);
        }
      }
    }

    return criteria;
  }

  // Normalize price format
  normalizePrice(priceStr) {
    const cleaned = priceStr.toLowerCase();
    let multiplier = 1;

    if (
      cleaned.includes("k") ||
      cleaned.includes("rb") ||
      cleaned.includes("ribu")
    ) {
      multiplier = 1000;
    } else if (cleaned.includes("juta")) {
      multiplier = 1000000;
    }

    const numMatch = cleaned.match(/(\d+(?:\.\d+)?)/);
    if (numMatch) {
      return parseInt(parseFloat(numMatch[1]) * multiplier);
    }

    return null;
  }

  // Check if response can be precomputed
  canUsePrecomputedResponse(intentName) {
    return this.precomputedResponses.hasOwnProperty(intentName);
  }

  // Get precomputed response
  getPrecomputedResponse(intentName, assistantName) {
    const responseGenerator = this.precomputedResponses[intentName];
    return responseGenerator ? responseGenerator(assistantName) : null;
  }

  // Default classification for unknown intents
  getDefaultClassification() {
    return {
      tier: "CONVERSATIONAL",
      primaryIntent: "generalInquiry",
      config: this.intentHierarchy.CONVERSATIONAL,
      criteria: {},
      canUsePrecomputed: true,
    };
  }

  // Generate optimized search parameters
  generateSearchParams(classification, userMessage) {
    if (!classification.config.needsTools) return null;

    const { criteria, primaryIntent } = classification;
    const baseParams = { userIntent: userMessage.substring(0, 50) }; // Limit intent length

    // Map criteria to searchShoes parameters efficiently
    if (criteria.price) {
      baseParams.maxPrice = criteria.price;
    }
    if (criteria.brand) {
      baseParams.brand = [criteria.brand];
    }
    if (criteria.color) {
      baseParams.variantFilters = { Warna: [criteria.color] };
    }
    if (criteria.size) {
      baseParams.variantFilters = {
        ...baseParams.variantFilters,
        Ukuran: [criteria.size],
      };
    }
    if (criteria.activity) {
      baseParams.category = [criteria.activity];
    }
    if (criteria.feature) {
      baseParams.features = [criteria.feature];
    }

    return baseParams;
  }

  // Calculate estimated token usage
  estimateTokenUsage(classification, messageLength) {
    const baseTokens = {
      IMMEDIATE_ACTION: 300,
      SEARCH_REFINEMENT: 200,
      INFO_RETRIEVAL: 150,
      CONVERSATIONAL: 50,
    };

    let estimated = baseTokens[classification.tier] || 100;
    estimated += Math.floor(messageLength / 4); // Rough token estimation

    // Add tool usage tokens
    if (classification.config.needsTools) {
      estimated += 200; // Tool call overhead
    }

    // Add response generation tokens
    if (!classification.canUsePrecomputed) {
      estimated += classification.config.maxTokens;
    }

    return Math.min(estimated, 1000); // Cap at 1000 tokens
  }
}

class TieredPromptTemplates {
  constructor() {
    this.templates = {
      IMMEDIATE_ACTION: (name) =>
        `${
          name || "Wawan"
        } - asisten sepatu. WAJIB panggil searchShoes. Jawab "Kak"`,
      SEARCH_REFINEMENT: (name) =>
        `${
          name || "Wawan"
        } - filter ulang sepatu. WAJIB panggil searchShoes. Jawab "Kak"`,
      INFO_RETRIEVAL: (name) =>
        `${name || "Wawan"} - info produk dari konteks. Jawab detail "Kak"`,
      CONVERSATIONAL: (name) =>
        `${name || "Wawan"} - jawab ramah. Gunakan "Kak"`,
    };
  }

  getPrompt(tier, assistantName) {
    const generator = this.templates[tier] || this.templates.CONVERSATIONAL;
    return generator(assistantName);
  }
}

class CompactInstructionGenerator {
  constructor() {
    this.basePrompt = `Asisten sepatu "{name}". Jawab singkat, gunakan "Kak", emoji minimal 👟`;
    this.stageMap = {
      greeting: "Tanya kebutuhan sepatu singkat",
      search: "WAJIB panggil searchShoes dengan kriteria user",
      recommend: `Format: <p>teks</p><ol><li><strong>Nama</strong><p>desc</p><a href='{link}' style="color:#555;">Detail</a></li></ol>`,
    };
  }

  generate(stage, assistantName, messages) {
    const lastMsg = this.getLastUserMessage(messages);
    const detectedStage = this.detectStage(lastMsg, messages.length);
    const finalStage = stage || detectedStage;

    return `${this.basePrompt.replace("{name}", assistantName || "Wawan")}. ${
      this.stageMap[finalStage] || this.stageMap.greeting
    }`;
  }

  detectStage(lastMsg, msgCount) {
    if (msgCount <= 1) return "greeting";

    const lower = lastMsg.toLowerCase();
    const searchKeywords = [
      "cari",
      "sepatu",
      "lari",
      "casual",
      "formal",
      "harga",
      "murah",
      "brand",
      "warna",
      "ukuran",
    ];

    if (searchKeywords.some((kw) => lower.includes(kw))) return "search";
    return "recommend";
  }

  getLastUserMessage(messages) {
    const userMsgs = messages.filter(
      (m) => m._getType && m._getType() === "human"
    );
    return userMsgs.length ? userMsgs[userMsgs.length - 1].content : "";
  }
}

const instructionGen = new CompactInstructionGenerator();

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

      recommendation: `[Tugas] Gunakan hasil searchShoes. Max 1 produk. Format HTML wajib:
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

module.exports = {
  OptimizedInstructionGenerator,
  ResponseQualityValidator,
  instructionGen,
  AdvancedIntentFlowManager,
};
