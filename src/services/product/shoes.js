// productsService.js atau file tempat fungsi-fungsi tools AI Anda berada
const { cos_sim: cosineSimilarity } = require("@huggingface/transformers");
const Brand = require("../../models/brand"); // Model Brand
const Category = require("../../models/category"); // Model Category
const Shoe = require("../../models/shoes"); // Sesuaikan path jika berbeda
const LatestOffer = require("../../models/latestOffers");
const mongoose = require("mongoose");
const {
  getEmbedding,
  normalizeTextForSearch,
  checkSemanticMatch,
} = require("../../utils/embeddings");
const { refinementDataResult } = require("../../helpers/iterative-refinement");
const {
  createRegexObjectFromFilters,
  formatVariantFiltersSearchIndex,
  matchVariantsInNameAdvanced,
} = require("../../helpers/general");
// const genAI = require("../gemini");

// async function getEmbedding(text) {
//   try {
//     // Ini adalah placeholder. Di produksi, panggil API Gemini.
//     // Misalnya:
//     // const model = genAI.get  GenerativeModel({ model: "text-embedding-004" });
//     // const result = await model.embedContent(text);
//     // return result.embedding;
//     // const response = await genAI.models.embedContent({
//     //   model: "gemini-embedding-exp-03-07",
//     //   contents: text,
//     // });
//     // return response.embeddings;

//     // Untuk demo, kembalikan array dummy atau gunakan pustaka lain
//     // Jika Anda ingin mengintegrasikan embedding dengan Gemini, pastikan model 'text-embedding-004' tersedia
//     // dan API key Anda memiliki izin yang benar.
//     console.warn(
//       "WARNING: getEmbedding is a placeholder. Implement actual Gemini embedding API call."
//     );
//     const crypto = require("crypto");
//     const hash = crypto.createHash("sha256").update(text).digest("hex");
//     // Simple hash to simulate unique embeddings
//     return Array.from({ length: 1024 }, (_, i) =>
//       parseFloat("0." + hash.slice(i % 60, (i % 60) + 1))
//     ); // Dummy array
//   } catch (error) {
//     console.error("Error generating embedding:", error);
//     return null;
//   }
// }

// function cosineSimilarity(vecA, vecB) {
//   if (!vecA || !vecB || vecA.length !== vecB.length) {
//     return 0;
//   }
//   let dotProduct = 0;
//   let magnitudeA = 0;
//   let magnitudeB = 0;
//   for (let i = 0; i < vecA.length; i++) {
//     dotProduct += vecA[i] * vecB[i];
//     magnitudeA += vecA[i] * vecA[i];
//     magnitudeB += vecB[i] * vecB[i];
//   }
//   magnitudeA = Math.sqrt(magnitudeA);
//   magnitudeB = Math.sqrt(magnitudeB);
//   if (magnitudeA === 0 || magnitudeB === 0) {
//     return 0;
//   }
//   return dotProduct / (magnitudeA * magnitudeB);
// }

function mapColorToEnglishAndIndonesian(colorName) {
  const normalizedColor = normalizeTextForSearch(colorName);
  const colorMap = {
    hitam: ["black", "hitam"],
    putih: ["white", "putih"],
    merah: ["red", "merah"],
    biru: ["blue", "biru"],
    hijau: ["green", "hijau"],
    kuning: ["yellow", "kuning"],
    coklat: ["brown", "coklat"],
    "abu-abu": ["grey", "gray", "abu-abu"],
    ungu: ["purple", "ungu"],
    pink: ["pink"],
    orange: ["orange"],
    emas: ["gold", "emas"],
    perak: ["silver", "perak"],
    // Tambahkan lebih banyak padanan jika diperlukan
  };

  // Jika warna ditemukan di map, kembalikan semua padanannya
  if (colorMap[normalizedColor]) {
    return colorMap[normalizedColor].map((c) => normalizeTextForSearch(c));
  }
  // Jika tidak ditemukan, kembalikan warna aslinya saja
  return [normalizedColor];
}

const checkRefinementMatch = async (data1, data2, threshold) => {
  try {
    const score = await refinementDataResult(data1, data2);
    // Pastikan skor yang dikembalikan adalah angka dan lakukan perbandingan
    return {
      valid: Number(score) >= threshold,
      score: Number(score),
    };
  } catch (error) {
    console.error(
      `Error in checkRefinementMatch for data1: "${data1}", data2: "${data2}":`,
      error
    );
    // Jika terjadi error, anggap tidak cocok untuk keamanan
    return false;
  }
};

const searchShoes = async ({
  userIntent,
  minPrice,
  maxPrice,
  brand,
  category,
  variantFilters = {},
  limit = 5,
  excludeIds = [],
  newArrival,
  relatedOffers,
  isPopular,
}) => {
  console.log("--- START searchShoes ---");
  console.log("Calling searchShoes with parameters:", {
    userIntent,
    minPrice,
    maxPrice,
    brand,
    category,
    variantFilters,
    limit,
    excludeIds,
    newArrival,
    relatedOffers,
    isPopular,
  });

  const userIntentEmbedding = await getEmbedding(userIntent);
  if (!userIntentEmbedding) {
    console.error("ERROR: Failed to generate embedding for query.");
    return { error: "Failed to generate embedding for query." };
  }

  // --- Membangun Query Database Awal ---
  const initialDbQuery = {
    _id: { $nin: excludeIds.map((id) => new mongoose.Types.ObjectId(id)) },
    $text: { $search: userIntent },
  };

  // Menambahkan filter brand jika tersedia
  if (brand) {
    try {
      const brandDoc = await Brand.findOne({
        $text: { $search: brand },
      });
      if (brandDoc) {
        initialDbQuery.brand = brandDoc._id;
        console.log(`Initial DB query - Brand ID added: ${brandDoc._id}`);
      } else {
        console.log(
          `No exact brand found for "${brand}". Will rely on semantic search later.`
        );
      }
    } catch (error) {
      console.error(`Error finding brand "${brand}":`, error);
    }
  }

  const categoryMap = new Map(
    (await Category.find()).map((c) => [
      c._id.toString(),
      { name: c.name, isPopular: c.isPopular, description: c.description },
    ])
  );

  // Menambahkan filter category jika tersedia
  if (category || isPopular) {
    const matchedCategoryIds = new Set();

    if (category) {
      const normalizedQueryCategory = normalizeTextForSearch(category);

      for (const [categoryId, categoryInfo] of categoryMap.entries()) {
        const normalizedCategoryName = normalizeTextForSearch(
          categoryInfo.name
        );

        // Lakukan pencocokan semantik antara query 'category' dengan nama kategori yang ada
        // dan periksa juga isPopular jika ditentukan
        let semantic1 = { name: normalizedQueryCategory };
        let semantic2 = { name: normalizedCategoryName };
        if (isPopular) {
          semantic1.isPopular = true;
          semantic2.isPopular = true;
        }
        const validSemantic = await checkSemanticMatch(
          `(name: ${semantic1.name}${
            semantic1.isPopular ? ", isPopular: true" : ""
          })`,
          `(name : ${semantic2.name})${
            semantic2.isPopular ? ", isPopular: true" : ""
          })`,
          0.7
        );
        if (
          validSemantic &&
          (isPopular === undefined || categoryInfo.isPopular === isPopular)
        ) {
          matchedCategoryIds.add(categoryId);
        }
      }

      if (matchedCategoryIds.size === 0 && isPopular !== undefined) {
        for (const [categoryId, categoryInfo] of categoryMap.entries()) {
          if (categoryInfo.isPopular === isPopular) {
            matchedCategoryIds.add(categoryId);
          }
        }
      }
    } else if (isPopular !== undefined) {
      // Jika 'category' tidak ada, tapi 'isPopular' ditentukan
      for (const [categoryId, categoryInfo] of categoryMap.entries()) {
        if (categoryInfo.isPopular === isPopular) {
          matchedCategoryIds.add(categoryId);
        }
      }
    }

    if (matchedCategoryIds.size > 0) {
      initialDbQuery.category = { $in: Array.from(matchedCategoryIds) };
    }
  }

  // Menambahkan filter harga ke query awal
  if (minPrice !== undefined || maxPrice !== undefined) {
    let defaultPriceQuery = { price: {} };
    let variantPriceQuery = {
      variants: { $elemMatch: { price: {} }, $exists: true },
    };

    if (minPrice !== undefined) {
      defaultPriceQuery.price.$gte = minPrice;
      variantPriceQuery.variants.$elemMatch.price.$gte = minPrice;
    }
    if (maxPrice !== undefined) {
      defaultPriceQuery.price.$lte = maxPrice;
      variantPriceQuery.variants.$elemMatch.price.$lte = maxPrice;
    }

    initialDbQuery.$or = [defaultPriceQuery, variantPriceQuery];
  }

  if (Object.keys(variantFilters)?.length > 0) {
    const variantMatchCriteria = {};

    // Iterasi melalui setiap filter varian
    for (const [key, value] of Object.entries(variantFilters)) {
      // Array untuk menampung semua pola regex
      const regexPatterns = [];

      // 1. Iterasi setiap item dalam array 'value'
      for (const item of value) {
        // 2. Pecah item menjadi kata-kata (token)
        // Misalnya, "putih/hijau" akan menjadi ["putih", "hijau"]
        const tokens = String(item)
          .split(/[\s\/-]/)
          .filter((token) => token.length > 0);

        // 3. Buat pola regex untuk setiap token
        // Gunakan '\b' untuk mencari kecocokan kata, bukan substring
        const regexFromTokens = tokens.map(
          (token) => new RegExp(`\\b${token}\\b`, "i")
        );

        regexPatterns.push(...regexFromTokens);
      }

      // 4. Gabungkan semua pola regex menjadi satu query $in
      variantMatchCriteria[`optionValues.${key}`] = {
        $in: regexPatterns.length > 0 ? regexPatterns : value,
        $exists: true,
      };
    }

    let variantsForInName = [];

    const variants = Object.entries(
      createRegexObjectFromFilters(variantFilters)
    );

    if (variants.length === 2) {
      variantsForInName = [
        {
          name: { $in: variants[0][1] },
        },
        {
          name: { $in: variants[1][1] },
        },
      ];
    } else {
      variantsForInName = [
        {
          name: { $in: variants[0][1] },
        },
      ];
    }

    if (initialDbQuery.$or) {
      initialDbQuery.$or = [
        ...initialDbQuery.$or,
        {
          variants: {
            $elemMatch: variantMatchCriteria,
          },
        },
        ...variantsForInName,
      ];
    } else {
      initialDbQuery.$or = [
        {
          variants: {
            $elemMatch: variantMatchCriteria,
          },
        },
        ...variantsForInName,
      ];
    }
  }

  const candidateShoes = await Shoe.find(
    { ...initialDbQuery },
    { score: { $meta: "textScore" } }
  )
    .sort({ score: { $meta: "textScore" } })
    .limit(limit)
    .lean();

  let finalShoeResults = candidateShoes;
  // if (candidateShoes.length > 0) {
  //   const candidateIds = candidateShoes.map((shoe) => shoe._id);
  //   finalShoeResults = await Shoe.find(
  //     { _id: { $in: candidateIds }, $text: { $search: userIntent } },
  //     { score: { $meta: "textScore" } }
  //   )
  //     .sort({ score: { $meta: "textScore" } })
  //     .lean();
  // }
  console.log("Mongoose initial query:", JSON.stringify(initialDbQuery));
  console.log("GET SHOE DATA : ", finalShoeResults);

  const brandMap = new Map(
    (await Brand.find()).map((b) => [b._id.toString(), b.name])
  );

  const shoesWithScores = [];

  const weights = {
    semantic: 0.6,
    category: 0.15,
    variant: 0.15,
    brand: 0.1,
  };

  for (const shoe of finalShoeResults) {
    // let currentVariantAttributesText = "";
    // if (shoe.variantAttributes && shoe.variantAttributes.length > 0) {
    //   currentVariantAttributesText = shoe.variantAttributes
    //     .map(
    //       (attr) =>
    //         `${normalizeTextForSearch(attr.name)} ${attr.options
    //           .map((opt) => normalizeTextForSearch(opt))
    //           .join(" ")}`
    //     )
    //     .join(" ");
    // }

    // IMPLEMENT ITERATIVE IMPROVEMENT : SELF-REFINEMENT

    if (!shoe?.score_embedding) {
      let variantDescriptionText = "";
      if (shoe.variants && shoe.variants.length > 0) {
        // Array untuk menampung string deskripsi setiap varian
        const allVariantDescriptions = [];

        // 1. Iterasi setiap objek varian
        for (const variant of shoe.variants) {
          const variantParts = [];

          // 2. Iterasi properti dinamis di dalam optionValues
          for (const key in variant.optionValues) {
            if (
              Object.prototype.hasOwnProperty.call(variant.optionValues, key)
            ) {
              const value = variant.optionValues[key];

              // Normalisasi teks untuk key dan value
              const normalizedKey = normalizeTextForSearch(key);
              const normalizedValue = normalizeTextForSearch(value);

              // Tambahkan ke array dalam format 'key: value'
              variantParts.push(`${normalizedKey}: '${normalizedValue}'`);
            }
          }

          // 3. Gabungkan bagian-bagian varian menjadi satu string
          if (variantParts.length > 0) {
            allVariantDescriptions.push(`${variantParts.join(", ")}`);
          }
        }

        // 4. Gabungkan semua deskripsi varian menjadi satu string
        variantDescriptionText = allVariantDescriptions.join(" | ");
      }

      // const combinedTextForScore = normalizeTextForSearch(
      //   `Nama: ${shoe.name}. Deskripsi: ${
      //     shoe.description
      //   }. Brand: ${brandMap.get(
      //     shoe.brand.toString()
      //   )}. Kategori: ${shoe.category
      //     .map((id) => JSON.stringify(categoryMap.get(id.toString())))
      //     .join(
      //       ", "
      //     )}. Varian: ${variantDescriptionText}. Main Price (Jika tidak memiliki varian): ${
      //     shoe.price
      //   }. Main Stock (Jika tidak memiliki varian): ${shoe.stock}`
      // );

      // const combinedTextForScore = `**${shoe.name}**.
      //   **${shoe.description}**.
      //   **brand: ${brandMap.get(shoe.brand.toString())}**.
      //   **${shoe.category
      //     .map(
      //       (id) =>
      //         `kategori: ${categoryMap.get(id.toString()).name}, ${
      //           categoryMap.get(id.toString()).description
      //         }`
      //     )
      //     .join(" | ")}**.
      //     **${variantDescriptionText}**`;

      // console.log("PRODUCT INTENT : ", combinedTextForScore);

      // const productEmbedding = await getEmbedding(combinedTextForScore);

      const productText = `${shoe.name}. ${shoe.description}`;
      const productEmbedding = await getEmbedding(productText);
      const semanticScore = cosineSimilarity(
        userIntentEmbedding,
        productEmbedding
      );

      let categoryScore = 0;

      if (
        category &&
        shoe.category.some((id) =>
          categoryMap
            .get(id.toString())
            .name.toLowerCase()
            .includes(category.toLowerCase())
        )
      ) {
        categoryScore = 1;
      }

      let variantScore = 0;

      if (Object.keys(variantFilters)?.length > 0) {
        const variant_args = Object.entries(variantFilters);

        let variant_name_1 = variant_args[0][0];
        let variant_name_2 = null;
        let variant_value_1 = variant_args[0][1];
        let variant_value_2 = null;
        if (variant_args.length === 2) {
          variant_name_2 = variant_args[1][0];
          variant_value_2 = variant_args[1][1];
        }

        let hasMatchingVariant = null;

        if (shoe.variants.length > 0) {
          hasMatchingVariant = shoe.variants.some((variant) => {
            let has_variant_1_match = null;
            variant_value_1.forEach((variant_arg) => {
              if (
                !has_variant_1_match &&
                variant.optionValues[variant_name_1]
              ) {
                has_variant_1_match = variant.optionValues[variant_name_1]
                  .toLowerCase()
                  .trim()
                  .includes(variant_arg.toLowerCase().trim());
              }
            });
            let has_variant_2_match = null;
            if (variant.optionValues[variant_name_2]) {
              variant_value_2.forEach((variant_arg) => {
                if (
                  !has_variant_2_match &&
                  variant.optionValues[variant_name_2]
                ) {
                  has_variant_2_match = variant.optionValues[variant_name_2]
                    .toLowerCase()
                    .trim()
                    .includes(variant_arg.toLowerCase().trim());
                }
              });
            }
            if (variant.optionValues[variant_name_2]) {
              return has_variant_1_match && has_variant_2_match;
            }
            return has_variant_1_match;
          });
        } else {
          hasMatchingVariant = matchVariantsInNameAdvanced(
            shoe.name,
            variantFilters
          );
        }

        if (hasMatchingVariant) {
          variantScore = 1;
        }
      }

      let brandScore = 0;

      if (
        brand &&
        brandMap
          .get(shoe.brand.toString())
          .toLowerCase()
          .includes(brand.toLowerCase())
      ) {
        brandScore = 1;
      }

      const finalScore =
        semanticScore * weights.semantic +
        categoryScore * weights.category +
        variantScore * weights.variant +
        brandScore * weights.brand;

      shoe.score_embedding = finalScore;
      shoe.debug = {
        semanticScore,
        categoryScore,
        variantScore,
        brandScore,
      };
    }

    if (shoe?.score_embedding) {
      // const similarity = cosineSimilarity(
      //   userIntentEmbedding,
      //   shoe.score_embedding
      // );
      console.log("FINAL SCORE : ", shoe.debug, shoe.score_embedding);
      if (shoe.score_embedding >= 0.4) {
        shoesWithScores.push({ shoe, score_embedding: shoe.score_embedding });
      }
    }
  }

  shoesWithScores.sort((a, b) => b.score_embedding - a.score_embedding);

  const rawProductsForFrontend = [];

  const formattedOutputForGemini = shoesWithScores.map(({ shoe }) => {
    const item = {
      name: shoe.name,
      brand: brandMap.get(shoe.brand.toString()),
      category: JSON.stringify(
        shoe.category.map((id) =>
          JSON.stringify({
            name: categoryMap.get(id.toString()).name,
            isPopular: categoryMap.get(id.toString()).isPopular,
          })
        )
      ),
      description: shoe.description,
      price: shoe.price,
      variants: shoe.variants,
    };
    if (shoe.variants.length === 0) {
      item.stock = shoe.stock;
    }
    return item;
  });

  const rawProductsForFrontendFinal = rawProductsForFrontend;

  if (formattedOutputForGemini.length === 0) {
    console.log("No shoes found matching all criteria.");
    return {
      message:
        "Maaf, kami tidak menemukan sepatu yang sesuai dengan kriteria Anda. Coba kata kunci lain atau perlonggar kriteria pencarian.",
      shoes: [],
      productsForFrontend: [],
    };
  }

  console.log(
    `--- END searchShoes. Found ${formattedOutputForGemini.length} results. ---`
  );
  console.log("format for gemini : ", formattedOutputForGemini);
  return {
    shoes: formattedOutputForGemini,
    productsForFrontend: rawProductsForFrontendFinal,
  };
};

// searchShoes({
//   query: "sepatu untuk lari",
//   minPrice: undefined,
//   maxPrice: 2000000,
//   brand: undefined,
//   category: "Sepatu lari",
//   variantFilters: {},
//   limit: 10,
//   excludeIds: [],
//   newArrival: undefined,
//   relatedOffers: undefined,
//   isPopular: undefined,
// });

module.exports = { searchShoes };
