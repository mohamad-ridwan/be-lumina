const Category = require("../../models/category");
const Brand = require("../../models/brand");
const Offers = require("../../models/latestOffers");

class DynamicPromptManager {
  constructor() {
    // Core persona and style - ALWAYS included
    this.corePersona = `
**PENTING: Seluruh jawaban Anda, dari kalimat pertama hingga terakhir, HARUS sepenuhnya diwarnai oleh persona '{assistantName}' dan nada bicara yang santai, bersahabat, dan ceria.**

[Persona & Gaya Bahasa]
Anda adalah "{assistantName}" - asisten sepatu yang bersemangat dan berpengetahuan luas.
- **Nada Bicara:** Santai, bersahabat, ceria. Gunakan bahasa gaul tapi sopan: "nggak ada," "pasti dong," "pas banget," "bikin lari makin enteng," "mantap banget," "asyik nih," "jagoan banget," "udah pas banget."
- **Gaya Interaksi:** Mulai dengan sapaan hangat. Gunakan "Tentu saja," "Siap bantu," "Ide bagus!" atau "Wah, asyik banget nih!"
- **Sapaan:** Wajib sapa dengan 'Kak' + nama atau 'Kakak' jika nama tidak ada.
- **Emoji:** Gunakan secara alami (👍, ✨, 👟, 🤔, 🏃‍♀️) tapi jangan berlebihan.

[Format Jawaban HTML - WAJIB]
- Gunakan tag HTML dengan CSS inline: 'color: #000; background: transparent; padding: 0;'
- Teks tidak prioritas: 'color: #555;'
- Kata kunci penting: '<strong>'
- Paragraf pembuka spesifik yang merangkum kriteria pelanggan
- Tambahkan '<br>' setelah paragraf pembuka
- List bernomor (<ol>) untuk multiple rekomendasi, paragraf untuk single
- Setelah list/info produk: tambahkan '<br>'
- Format setiap rekomendasi: Nama (<strong>), paragraf rekomendasi (<p>), Merek (<p><strong>Merek:</strong>), Harga jika ditanya (<p><strong>Harga:</strong>), Link produk (<a href="{link_url_sepatu}" style="color: #007bff; text-decoration: underline;">Lihat Detail Produk</a>)
- Akhiri dengan CTA yang spesifik dan relevan

[KRITICAL: DATA INTERNAL ONLY]
**HANYA gunakan data dari tool_calls. TIDAK BOLEH menggunakan pengetahuan eksternal tentang sepatu, merek, atau produk. Jika tool tidak mengembalikan data, katakan "Mohon maaf, saat ini data produk sedang tidak tersedia. Silakan coba lagi nanti ya Kak."**`;

    this.stagePrompts = {
      greeting: `
[Tugas: Sapaan Awal]
Sapa pelanggan dengan hangat. Tanyakan kebutuhan sepatu mereka secara umum.`,

      gathering_info: `
[Tugas: Pengumpulan Informasi]
Tanyakan aktivitas/kategori sepatu yang dicari. Jika sudah disebutkan, langsung lanjut ke rekomendasi.
{availableCategories}`,

      searching: `
[Tugas: Pencarian Produk]
Gunakan tool searchShoes dengan kriteria yang diberikan pelanggan. WAJIB panggil tool untuk mendapatkan data dari database.
{availableCategories}
{availableBrands}
{availableOffers}`,

      recommendation: `
[Tugas: Memberikan Rekomendasi]
Berikan rekomendasi berdasarkan data dari tool_calls. Ikuti format HTML yang diwajibkan.
- Paragraf pembuka yang spesifik
- Format sesuai jumlah rekomendasi (list vs paragraf)
- Jelaskan mengapa cocok untuk kebutuhan pelanggan
- Akhiri dengan CTA yang mengundang aksi`,

      clarification: `
[Tugas: Klarifikasi Lanjutan]
Jawab pertanyaan spesifik tentang produk yang sudah direkomendasikan. Prioritaskan menggunakan data dari memori percakapan. Panggil tool hanya jika butuh data baru.`,

      price_sensitive: `
[Tugas: Pencarian Berdasarkan Harga]
Pelanggan meminta opsi lebih murah/sesuai budget. WAJIB panggil tool dengan kriteria harga baru. Anggap ini pencarian baru yang mengesampingkan rekomendasi sebelumnya.`,
    };

    this.contextData = {
      availableCategories: "",
      availableBrands: "",
      availableOffers: "",
    };
  }

  buildPrompt(stage, context = {}) {
    let prompt = this.corePersona.replace(
      "{assistantName}",
      context.assistantName || "Wawan"
    );

    // Add stage-specific instructions
    const stagePrompt = this.stagePrompts[stage] || this.stagePrompts.greeting;
    prompt += "\n\n" + stagePrompt;

    // Add contextual data only when needed for specific stages
    if (this.shouldIncludeContext(stage)) {
      prompt += "\n\n" + this.buildContextualData(context);
    }

    // Add conversation rules based on stage
    prompt += "\n\n" + this.getStageSpecificRules(stage, context);

    return this.replacePlaceholders(prompt, context);
  }

  shouldIncludeContext(stage) {
    return ["gathering_info", "searching", "recommendation"].includes(stage);
  }

  buildContextualData(context) {
    let contextData = "";

    if (context.categories && context.categories.length > 0) {
      contextData += `\nKategori Tersedia:\n${context.categories
        .map(
          (cat) =>
            `- ${cat.name}: ${cat.description}${
              cat.isPopular ? " (POPULER)" : ""
            }`
        )
        .join("\n")}`;
    }

    if (context.brands && context.brands.length > 0) {
      contextData += `\n\nMerek Tersedia:\n${context.brands
        .map((brand) => `- ${brand.name}: ${brand.description}`)
        .join("\n")}`;
    }

    if (context.offers && context.offers.length > 0) {
      contextData += `\n\nPenawaran Aktif:\n${context.offers
        .map((offer) => `- ${offer.title}: ${offer.description}`)
        .join("\n")}`;
    }

    return contextData;
  }

  getStageSpecificRules(stage, context) {
    const rules = {
      greeting: `
[Aturan Khusus]
- Mulai dengan sapaan hangat menggunakan nama pelanggan
- Tanyakan kebutuhan secara umum: "Ada yang bisa ${
        context.assistantName || "Wawan"
      } bantu untuk cari sepatu hari ini, ${context.customerName || "Kak"}?"`,

      gathering_info: `
[Aturan Khusus]
- Jika pelanggan menyebutkan kategori jelas (sepatu lari, casual, dll), langsung lanjut ke pencarian
- Prioritaskan kategori POPULER dalam saran
- Jangan tanya terlalu banyak detail di awal`,

      searching: `
[Aturan Khusus]
- WAJIB panggil tool searchShoes dengan kriteria yang ada
- Jangan berikan rekomendasi tanpa data dari tool
- Jika tool gagal, informasikan dengan sopan dan tawarkan cari kriteria lain`,

      recommendation: `
[Aturan Khusus]
- HANYA gunakan data dari tool_calls yang baru saja dipanggil
- Ikuti format HTML secara ketat
- Jelaskan mengapa setiap produk cocok untuk kebutuhan spesifik pelanggan
- Tampilkan harga HANYA jika pelanggan bertanya atau menyebutkan budget
- Link produk WAJIB menggunakan link_url_sepatu yang exact dari database`,

      clarification: `
[Aturan Khusus]  
- Periksa riwayat percakapan dulu sebelum panggil tool
- Jika pertanyaan tentang produk yang baru direkomendasikan, jawab dari memori
- Panggil tool hanya untuk kriteria benar-benar baru`,

      price_sensitive: `
[Aturan Khusus]
- Anggap ini sebagai pencarian BARU dengan fokus harga
- WAJIB panggil tool dengan parameter harga/budget
- Berikan penjelasan singkat kenapa opsi ini lebih terjangkau`,
    };

    return rules[stage] || "";
  }

  replacePlaceholders(prompt, context) {
    return prompt.replace(/\{(\w+)\}/g, (match, key) => {
      return context[key] || match;
    });
  }
}

// ================================
// 2. ENHANCED CONVERSATION STATE MANAGER
// ================================

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

    this.priceKeywords = [
      "murah",
      "lebih murah",
      "terjangkau",
      "budget",
      "harga",
      "mahal",
    ];
    this.categoryKeywords = [
      "sepatu lari",
      "running",
      "casual",
      "formal",
      "olahraga",
      "hiking",
    ];
  }

  determineStage(messages, userProfile) {
    const lastUserMessage = this.getLastUserMessage(messages);
    const hasRecommendations = this.hasRecommendationsInHistory(messages);
    const messageCount = messages.length;

    // First interaction - always greeting
    if (messageCount <= 1) {
      return this.stages.GREETING;
    }

    // Check for price-sensitive requests
    if (this.isPriceSensitive(lastUserMessage)) {
      return this.stages.PRICE_SENSITIVE;
    }

    // Check for clarification about existing recommendations
    if (hasRecommendations && this.isAskingForClarification(lastUserMessage)) {
      return this.stages.CLARIFICATION;
    }

    // Check if user provided clear category/activity
    if (this.hasSpecificCriteria(lastUserMessage)) {
      return this.stages.SEARCHING;
    }

    // If we have recommendations, we're in recommendation stage
    if (hasRecommendations) {
      return this.stages.RECOMMENDATION;
    }

    // Default to gathering info
    return this.stages.GATHERING_INFO;
  }

  isPriceSensitive(message) {
    const lowerMessage = message.toLowerCase();
    return this.priceKeywords.some((keyword) => lowerMessage.includes(keyword));
  }

  hasSpecificCriteria(message) {
    const lowerMessage = message.toLowerCase();
    return this.categoryKeywords.some((keyword) =>
      lowerMessage.includes(keyword)
    );
  }

  isAskingForClarification(message) {
    const clarificationKeywords = [
      "ukuran",
      "size",
      "warna",
      "color",
      "bahan",
      "material",
      "yang ringan",
      "yang empuk",
      "anti air",
      "waterproof",
      "tersedia",
      "available",
      "stok",
    ];
    const lowerMessage = message.toLowerCase();
    return clarificationKeywords.some((keyword) =>
      lowerMessage.includes(keyword)
    );
  }

  getLastUserMessage(messages) {
    const userMessages = messages.filter(
      (m) => m._getType && m._getType() === "human"
    );
    return userMessages.length > 0
      ? userMessages[userMessages.length - 1].content
      : "";
  }

  hasRecommendationsInHistory(messages) {
    // Check last 5 messages for efficiency
    const recentMessages = messages.slice(-5);
    return recentMessages.some(
      (m) =>
        (m.additional_kwargs &&
          m.additional_kwargs.product_data &&
          m.additional_kwargs.product_data.length > 0) ||
        (m.content &&
          typeof m.content === "string" &&
          m.content.includes("Lihat Detail Produk"))
    );
  }
}

// ================================
// 3. SMART DATA LOADING WITH SELECTIVE CONTEXT
// ================================

class ContextualDataLoader {
  constructor() {
    this.cache = new Map();
    this.cacheExpiry = 10 * 60 * 1000; // 10 minutes for product data
  }

  async loadContextualData(stage, criteria = {}) {
    const cacheKey = this.generateCacheKey(stage, criteria);

    if (this.cache.has(cacheKey)) {
      const cached = this.cache.get(cacheKey);
      if (Date.now() - cached.timestamp < this.cacheExpiry) {
        return cached.data;
      }
    }

    const data = await this.fetchDataByStage(stage, criteria);
    this.cache.set(cacheKey, { data, timestamp: Date.now() });
    return data;
  }

  generateCacheKey(stage, criteria) {
    const keyParts = [stage];
    if (criteria.needsCategories) keyParts.push("cats");
    if (criteria.needsBrands) keyParts.push("brands");
    if (criteria.needsOffers) keyParts.push("offers");
    return keyParts.join("_");
  }

  async fetchDataByStage(stage, criteria) {
    const data = {};

    try {
      switch (stage) {
        case "greeting":
          // Minimal data for greeting
          break;

        case "gathering_info":
          // Only popular categories for initial guidance
          data.categories = await this.getPopularCategories();
          break;

        case "searching":
        case "recommendation":
        case "price_sensitive":
          // Full data when actually searching/recommending
          // Note: These would need to be imported/required properly in a real implementation
          if (
            typeof Category !== "undefined" &&
            typeof Brand !== "undefined" &&
            typeof Offers !== "undefined"
          ) {
            const [categories, brands, offers] = await Promise.all([
              Category.find().lean(), // Use lean() for better performance
              Brand.find().lean(),
              Offers.find({ isActive: true }).lean(),
            ]);

            data.categories = categories;
            data.brands = brands;
            data.offers = offers;
          } else {
            // Mock data for demo purposes
            data.categories = await this.getMockCategories();
            data.brands = await this.getMockBrands();
            data.offers = await this.getMockOffers();
          }
          break;

        case "clarification":
          // No additional data needed - use conversation memory
          break;

        default:
          break;
      }
    } catch (error) {
      console.error("Error fetching contextual data:", error);
      // Return empty data on error
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
    } catch (error) {
      console.error("Error getting popular categories:", error);
      return [];
    }
  }

  // Mock data methods for demo/fallback
  async getMockCategories() {
    return [
      {
        name: "Sepatu Lari",
        description: "Untuk jogging dan running",
        isPopular: true,
      },
      {
        name: "Sepatu Casual",
        description: "Untuk penggunaan sehari-hari",
        isPopular: true,
      },
      {
        name: "Sepatu Formal",
        description: "Untuk acara resmi",
        isPopular: false,
      },
    ];
  }

  async getMockBrands() {
    return [
      { name: "LocalBrand A", description: "Merek lokal berkualitas" },
      { name: "LocalBrand B", description: "Sepatu olahraga terbaik" },
    ];
  }

  async getMockOffers() {
    return [
      {
        title: "Diskon 20%",
        description: "Untuk pembelian sepatu lari",
        isActive: true,
      },
    ];
  }

  async getMockPopularCategories() {
    return [
      {
        name: "Sepatu Lari",
        description: "Untuk jogging dan running",
        isPopular: true,
      },
      {
        name: "Sepatu Casual",
        description: "Untuk penggunaan sehari-hari",
        isPopular: true,
      },
    ];
  }

  clearCache() {
    this.cache.clear();
  }
}

// ================================
// 4. ENHANCED INSTRUCTION GENERATOR WITH INTERNAL DATA ENFORCEMENT
// ================================

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
      stage,
      ...contextualData,
      ...this.extractCriteriaFromMessages(messages),
    };

    const instruction = this.promptManager.buildPrompt(stage, context);

    // Add critical enforcement for internal data usage
    const dataEnforcement = this.buildDataEnforcementRules(stage, messages);

    return instruction + "\n\n" + dataEnforcement;
  }

  buildDataEnforcementRules(stage, messages) {
    const hasExistingProducts = this.hasProductsInHistory(messages);

    let rules = `
[CRITICAL: KONTROL DATA INTERNAL]
- HANYA gunakan data sepatu dari tool searchShoes yang dipanggil dalam percakapan ini
- DILARANG menggunakan pengetahuan umum tentang sepatu/merek dari training data
- Jika tidak ada data dari tool, katakan: "Mohon maaf, saat ini data produk sedang tidak tersedia. Silakan coba lagi nanti ya Kak."
- WAJIB panggil tool searchShoes untuk mendapatkan data produk dari database
- Link produk HARUS menggunakan field 'link_url_sepatu' exact dari database tanpa modifikasi`;

    if (hasExistingProducts) {
      rules += `
- Prioritaskan data produk yang sudah ada dalam riwayat percakapan untuk pertanyaan klarifikasi
- Panggil tool baru hanya jika butuh kriteria pencarian yang berbeda`;
    }

    switch (stage) {
      case "searching":
      case "price_sensitive":
        rules += `
- WAJIB panggil tool searchShoes dengan kriteria yang diberikan pelanggan
- Tunggu hasil tool sebelum memberikan rekomendasi`;
        break;

      case "recommendation":
        rules += `
- Gunakan HANYA data dari tool_calls terakhir yang berhasil
- Format sesuai template HTML yang diwajibkan`;
        break;

      case "clarification":
        rules += `
- Cek riwayat percakapan dulu untuk data produk yang sudah direkomendasikan
- Jika data tidak ada dalam riwayat, panggil tool dengan kriteria baru`;
        break;
    }

    return rules;
  }

  hasProductsInHistory(messages) {
    return messages.some(
      (msg) =>
        (msg.additional_kwargs &&
          msg.additional_kwargs.product_data &&
          msg.additional_kwargs.product_data.length > 0) ||
        (msg.tool_calls &&
          msg.tool_calls.some &&
          msg.tool_calls.some((call) => call.name === "searchShoes"))
    );
  }

  extractCriteriaFromMessages(messages) {
    const lastMessage =
      messages.length > 0 ? messages[messages.length - 1].content || "" : "";
    const lowerMessage = lastMessage.toLowerCase();
    const criteria = {};

    // Extract activity/category
    if (lowerMessage.includes("lari") || lowerMessage.includes("running")) {
      criteria.activity = "running";
    } else if (lowerMessage.includes("casual")) {
      criteria.activity = "casual";
    } else if (lowerMessage.includes("formal")) {
      criteria.activity = "formal";
    }

    // Extract price sensitivity
    if (this.stateManager.isPriceSensitive(lastMessage)) {
      criteria.priceFocused = true;
    }

    // Extract size needs
    if (lowerMessage.match(/ukuran|size|\d{2}/)) {
      criteria.needsSize = true;
    }

    // Extract color preferences
    if (lowerMessage.includes("warna") || lowerMessage.includes("color")) {
      criteria.needsColor = true;
    }

    return criteria;
  }
}

class ResponseQualityValidator {
  constructor() {
    this.requiredElements = {
      greeting: ["sapaan", "nama_pelanggan"],
      recommendation: ["format_html", "link_produk", "penjelasan_fitur"],
      clarification: ["referensi_produk_sebelumnya"],
    };
  }

  validateResponse(response, stage, context) {
    const issues = [];

    // Check if response uses external data (common mistake)
    if (this.containsExternalData(response)) {
      issues.push(
        "Response menggunakan data eksternal, bukan dari database internal"
      );
    }

    // Check HTML formatting for recommendation stage
    if (stage === "recommendation" && !this.hasProperHTMLFormat(response)) {
      issues.push("Format HTML tidak sesuai template yang diwajibkan");
    }

    // Check persona consistency
    if (!this.hasProperPersona(response, context.assistantName)) {
      issues.push("Persona dan gaya bahasa tidak konsisten");
    }

    // Check for product links
    if (stage === "recommendation" && !this.hasValidProductLinks(response)) {
      issues.push("Link produk tidak valid atau tidak ada");
    }

    return {
      isValid: issues.length === 0,
      issues: issues,
      score: this.calculateQualityScore(response, stage),
    };
  }

  containsExternalData(response) {
    const externalIndicators = [
      "Nike Air Max",
      "Adidas Ultraboost",
      "New Balance 990",
      "Converse Chuck Taylor",
      "Vans Old Skool",
    ];

    const lowerResponse = response.toLowerCase();
    return externalIndicators.some(
      (indicator) =>
        lowerResponse.includes(indicator.toLowerCase()) &&
        !lowerResponse.includes("data_memory")
    );
  }

  hasProperHTMLFormat(response) {
    const requiredElements = [
      /<p[^>]*>/i, // Paragraph tags
      /<strong>/i, // Bold tags
      /color:\s*#[0-9a-f]{3,6}/i, // CSS color
    ];

    return requiredElements.some((pattern) => pattern.test(response));
  }

  hasProperPersona(response, assistantName) {
    const personaIndicators = [
      assistantName || "Wawan",
      "kak",
      "kakak",
      "pas banget",
      "mantap",
      "asyik",
    ];

    const lowerResponse = response.toLowerCase();
    return personaIndicators.some((indicator) =>
      lowerResponse.includes(indicator.toLowerCase())
    );
  }

  hasValidProductLinks(response) {
    return /href\s*=\s*["'][^"']*["']/i.test(response);
  }

  calculateQualityScore(response, stage) {
    let score = 100;

    if (this.containsExternalData(response)) score -= 40;
    if (stage === "recommendation" && !this.hasProperHTMLFormat(response))
      score -= 30;
    if (!this.hasProperPersona(response, "Wawan")) score -= 20;

    return Math.max(0, score);
  }
}

module.exports = { OptimizedInstructionGenerator, ResponseQualityValidator };
