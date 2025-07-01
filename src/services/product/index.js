// productsService.js atau file tempat fungsi-fungsi tools AI Anda berada
const { pipeline } = require("@huggingface/transformers");
const Brand = require("../../models/brand"); // Model Brand
const Category = require("../../models/category"); // Model Category
const Shoe = require("../../models/shoes"); // Sesuaikan path jika berbeda
const mongoose = require("mongoose");
// const genAI = require("../gemini");

let extractor = null;

async function initializeEmbeddingPipeline() {
  if (!extractor) {
    console.log(
      "Menginisialisasi pipeline embedding dengan @huggingface/transformers..."
    );
    // Pilih model yang cocok untuk text embedding.
    // 'Xenova/all-MiniLM-L6-v2' adalah salah satu model Sentence-Transformers yang sangat efektif
    // dan relatif ringan. Anda bisa mencari model 'feature-extraction' lain di Hugging Face Hub.
    extractor = await pipeline(
      "feature-extraction",
      "mixedbread-ai/mxbai-embed-large-v1"
    );
    console.log("Pipeline embedding siap digunakan.");
  }
}

async function getEmbedding(text) {
  try {
    // Pastikan pipeline sudah diinisialisasi
    if (!extractor) {
      await initializeEmbeddingPipeline();
    }

    // Jalankan inferensi untuk mendapatkan embedding
    // 'pooling: mean' umumnya digunakan untuk mendapatkan embedding kalimat/dokumen
    // 'normalize: true' disarankan untuk perbandingan kemiripan menggunakan cosine similarity
    const output = await extractor(text, { pooling: "mean", normalize: true });

    // Output dari pipeline adalah objek dengan properti 'data' yang berisi Float32Array.
    // Ubah ke array JavaScript biasa agar lebih mudah diolah jika diperlukan.
    return Array.from(output.data);
  } catch (error) {
    console.error(
      "Error generating embedding with @huggingface/transformers:",
      error
    );
    return null;
  }
}

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

function cosineSimilarity(vecA, vecB) {
  if (!vecA || !vecB || vecA.length !== vecB.length) {
    return 0;
  }
  let dotProduct = 0;
  let magnitudeA = 0;
  let magnitudeB = 0;
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    magnitudeA += vecA[i] * vecA[i];
    magnitudeB += vecB[i] * vecB[i];
  }
  magnitudeA = Math.sqrt(magnitudeA);
  magnitudeB = Math.sqrt(magnitudeB);
  if (magnitudeA === 0 || magnitudeB === 0) {
    return 0;
  }
  return dotProduct / (magnitudeA * magnitudeB);
}

async function checkSemanticMatch(
  textOrEmbedding1,
  textOrEmbedding2,
  threshold = 0.6
) {
  let embedding1;
  let embedding2;

  // Determine if input is text or embedding
  if (Array.isArray(textOrEmbedding1)) {
    embedding1 = textOrEmbedding1;
  } else {
    embedding1 = await getEmbedding(textOrEmbedding1);
  }

  if (Array.isArray(textOrEmbedding2)) {
    embedding2 = textOrEmbedding2;
  } else {
    embedding2 = await getEmbedding(textOrEmbedding2);
  }

  if (!embedding1 || !embedding2) {
    // console.warn("WARNING: Could not generate embeddings for semantic match check.");
    return false; // Cannot perform semantic match without embeddings
  }

  const similarity = cosineSimilarity(embedding1, embedding2);
  // console.log(`  Semantic Match Check: "${textOrEmbedding1}" vs "${textOrEmbedding2}" -> Similarity: ${similarity.toFixed(4)} (Threshold: ${threshold})`);
  return similarity >= threshold;
}

function normalizeTextForSearch(text) {
  if (text === null || text === undefined) return ""; // Handle null/undefined input
  return String(text)
    .toLowerCase()
    .replace(/\s+/g, " ") // Ganti multiple spaces dengan single space
    .trim(); // Hapus spasi di awal/akhir
}

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

const searchShoes = async ({
  query,
  minPrice,
  maxPrice,
  brand,
  category,
  variantFilters = {},
  limit = 10,
  excludeIds = [],
}) => {
  console.log("--- START searchShoes ---");
  console.log("Calling searchShoes with parameters:", {
    query,
    minPrice,
    maxPrice,
    brand,
    category,
    variantFilters,
    limit,
    excludeIds,
  });

  const queryEmbedding = await getEmbedding(query);
  if (!queryEmbedding) {
    console.error("ERROR: Failed to generate embedding for query.");
    return { error: "Failed to generate embedding for query." };
  }

  // --- START Perbaikan: Membangun Query Database Awal ---
  const initialDbQuery = {
    _id: { $nin: excludeIds.map((id) => new mongoose.Types.ObjectId(id)) },
  };

  // Menambahkan filter brand jika tersedia
  if (brand) {
    // Karena brand di DB adalah ObjectId, kita perlu mencari ID brand berdasarkan nama.
    // Ini akan menjadi pencarian non-semantik yang kuat di awal.
    try {
      const brandDoc = await Brand.findOne({
        name: { $regex: new RegExp(brand, "i") },
      });
      if (brandDoc) {
        initialDbQuery.brand = brandDoc._id;
        console.log(`Initial DB query - Brand ID added: ${brandDoc._id}`);
      } else {
        console.log(
          `No exact brand found for "${brand}". Will rely on semantic search later.`
        );
        // Jika brand tidak ditemukan secara eksak, jangan tambahkan ke initialDbQuery.
        // Biarkan semantic search di Fase 1 menanganinya.
      }
    } catch (error) {
      console.error(`Error finding brand "${brand}":`, error);
    }
  }

  // Menambahkan filter category jika tersedia
  if (category) {
    // Sama seperti brand, kita perlu mencari ID kategori berdasarkan nama.
    try {
      const categoryDoc = await Category.findOne({
        name: { $regex: new RegExp(category, "i") },
      });
      if (categoryDoc) {
        initialDbQuery.category = categoryDoc._id;
        console.log(`Initial DB query - Category ID added: ${categoryDoc._id}`);
      } else {
        console.log(
          `No exact category found for "${category}". Will rely on semantic search later.`
        );
        // Jika kategori tidak ditemukan secara eksak, biarkan semantic search di Fase 1 menanganinya.
      }
    } catch (error) {
      console.error(`Error finding category "${category}":`, error);
    }
  }

  // Menambahkan filter harga ke query awal jika minPrice atau maxPrice ada
  // Ini hanya akan bekerja jika harga disimpan langsung di model Shoe (bukan di varian)
  // Jika harga hanya ada di varian, filter ini perlu diterapkan pada level varian
  // seperti yang sudah Anda lakukan di Fase 2.
  // Untuk tujuan ini, saya asumsikan ada 'price' langsung di model Shoe sebagai fallback/single product price.
  if (minPrice !== undefined || maxPrice !== undefined) {
    initialDbQuery.$or = [
      {
        // Untuk produk tanpa varian (harga di level shoe)
        $and: [
          { variants: { $exists: false } }, // Atau variants: { $size: 0 }
          minPrice !== undefined ? { price: { $gte: minPrice } } : {},
          maxPrice !== undefined ? { price: { $lte: maxPrice } } : {},
        ],
      },
      {
        // Untuk produk dengan varian (cek harga di sub-dokumen varian)
        $and: [
          { "variants.price": { $exists: true } },
          minPrice !== undefined
            ? { "variants.price": { $gte: minPrice } }
            : {},
          maxPrice !== undefined
            ? { "variants.price": { $lte: maxPrice } }
            : {},
        ],
      },
    ];
  }

  console.log("Mongoose initial query:", JSON.stringify(initialDbQuery));
  const allShoes = await Shoe.find(initialDbQuery).lean();
  // --- END Perbaikan: Membangun Query Database Awal ---

  const brandMap = new Map(
    (await Brand.find()).map((b) => [b._id.toString(), b.name])
  );
  const categoryMap = new Map(
    (await Category.find()).map((c) => [c._id.toString(), c.name])
  );

  const shoesWithScores = [];

  for (const shoe of allShoes) {
    let currentVariantAttributesText = "";
    if (shoe.variantAttributes && shoe.variantAttributes.length > 0) {
      currentVariantAttributesText = shoe.variantAttributes
        .map(
          (attr) =>
            `${normalizeTextForSearch(attr.name)} ${attr.options
              .map((opt) => normalizeTextForSearch(opt))
              .join(" ")}`
        )
        .join(" ");
    }

    // Generate embedding if it doesn't exist
    if (!shoe.description_embedding) {
      let variantDescriptionText = "";
      if (shoe.variants && shoe.variants.length > 0) {
        const allOptionValues = new Set();
        for (const variant of shoe.variants) {
          for (const key in variant.optionValues) {
            allOptionValues.add(variant.optionValues[key]);
          }
        }
        variantDescriptionText = Array.from(allOptionValues)
          .map((v) => normalizeTextForSearch(v))
          .join(", ");
      }

      const combinedTextForEmbedding = normalizeTextForSearch(
        `Nama: ${shoe.name}. Deskripsi: ${
          shoe.description
        }. Brand: ${brandMap.get(
          shoe.brand.toString()
        )}. Kategori: ${shoe.category
          .map((id) => categoryMap.get(id.toString()))
          .join(
            ", "
          )}. Varian: ${variantDescriptionText}. Atribut Varian: ${currentVariantAttributesText}`
      );

      shoe.description_embedding = await getEmbedding(combinedTextForEmbedding);
    }

    if (shoe.description_embedding) {
      const similarity = cosineSimilarity(
        queryEmbedding,
        shoe.description_embedding
      );
      shoesWithScores.push({ shoe, similarity });
    }
  }

  // Sort by semantic similarity (highest first)
  shoesWithScores.sort((a, b) => b.similarity - a.similarity);

  const filteredResults = [];
  const rawProductsForFrontend = [];

  let count = 0;
  for (const item of shoesWithScores) {
    if (count >= limit) break;

    const shoe = item.shoe;
    console.log(`\n--- Processing Shoe: ${shoe.name} (ID: ${shoe._id}) ---`);
    console.log(`Semantic Similarity Score: ${item.similarity.toFixed(4)}`);

    let productPassesAllFilters = true;

    let finalMinPrice = Infinity;
    let finalMaxPrice = 0;
    let finalTotalStock = 0;
    let finalAvailableVariants = [];

    // --- FASE 1: Filter Brand dan Kategori Terstruktur (Diperkuat dengan Semantic Matching) ---
    // Brand dan Category kini sebagian besar sudah difilter di query awal.
    // Bagian ini sekarang berfungsi sebagai semantic refinement.
    console.log("Phase 1: Brand and Category Filter (Semantic Refinement)");
    if (brand) {
      const brandName = brandMap.get(shoe.brand.toString());
      const isBrandMatch = await checkSemanticMatch(brand, brandName, 0.85);
      if (!isBrandMatch) {
        console.log(
          `  FAIL: Brand "${brandName}" does not semantically match query brand "${brand}" (threshold 0.85).`
        );
        productPassesAllFilters = false;
      } else {
        console.log(
          `  SUCCESS: Brand "${brandName}" semantically matches query brand "${brand}" (threshold 0.85).`
        );
      }
    }

    if (productPassesAllFilters && category) {
      const categoryNames = shoe.category.map((id) =>
        categoryMap.get(id.toString())
      );
      let isCategoryMatch = false;
      for (const catName of categoryNames) {
        if (await checkSemanticMatch(category, catName, 0.75)) {
          isCategoryMatch = true;
          break;
        }
      }
      if (!isCategoryMatch) {
        console.log(
          `  FAIL: Categories "${categoryNames.join(
            ", "
          )}" do not semantically match query category "${category}" (threshold 0.75).`
        );
        productPassesAllFilters = false;
      } else {
        console.log(
          `  SUCCESS: Categories "${categoryNames.join(
            ", "
          )}" semantically match query category "${category}" (threshold 0.75).`
        );
      }
    }

    if (!productPassesAllFilters) {
      console.log(`  Shoe "${shoe.name}" failed Phase 1.`);
      continue;
    }
    console.log(`  Shoe "${shoe.name}" PASSED Phase 1.`);

    // --- FASE 2: APLIKASIKAN FILTER HARGA DAN STOK PADA VARIAN / PRODUK UTAMA ---
    // Filter harga di sini akan tetap ada karena initialDbQuery.$or mungkin tidak selalu optimal
    // dan kita butuh memfilter varian secara spesifik.
    console.log("Phase 2: Price and Stock Filter");
    if (shoe.variants && shoe.variants.length > 0) {
      const variantsMeetingBaseCriteria = [];
      for (const variant of shoe.variants) {
        let variantMeetsPriceAndStock = true;
        if (minPrice !== undefined && variant.price < minPrice) {
          variantMeetsPriceAndStock = false;
        }
        if (maxPrice !== undefined && variant.price > maxPrice) {
          variantMeetsPriceAndStock = false;
        }
        if (!variantMeetsPriceAndStock || variant.stock <= 0) {
          continue;
        }
        variantsMeetingBaseCriteria.push(variant);
      }

      if (variantsMeetingBaseCriteria.length === 0) {
        productPassesAllFilters = false;
        console.log(`  FAIL: No variants meet base price/stock criteria.`);
      } else {
        for (const variant of variantsMeetingBaseCriteria) {
          finalMinPrice = Math.min(finalMinPrice, variant.price);
          finalMaxPrice = Math.max(finalMaxPrice, variant.price);
          finalTotalStock += variant.stock;
        }
        finalAvailableVariants = variantsMeetingBaseCriteria;
        console.log(
          `  Passed. Initial total stock: ${finalTotalStock}, Min Price: ${finalMinPrice}, Max Price: ${finalMaxPrice}`
        );
      }
    } else {
      if (shoe.stock <= 0) {
        productPassesAllFilters = false;
        console.log(`  FAIL: Product stock is 0.`);
      } else {
        if (minPrice !== undefined && shoe.price < minPrice) {
          productPassesAllFilters = false;
          console.log(
            `  FAIL: Product price (${shoe.price}) below minPrice (${minPrice}).`
          );
        }
        if (
          productPassesAllFilters &&
          maxPrice !== undefined &&
          shoe.price > maxPrice
        ) {
          productPassesAllFilters = false;
          console.log(
            `  FAIL: Product price (${shoe.price}) above maxPrice (${maxPrice}).`
          );
        }
        if (productPassesAllFilters) {
          finalMinPrice = shoe.price;
          finalMaxPrice = shoe.price;
          finalTotalStock = shoe.stock;
          console.log(
            `  Passed. Total stock: ${finalTotalStock}, Price: ${finalMinPrice}`
          );
        }
      }
    }

    if (!productPassesAllFilters) {
      console.log(`  Shoe "${shoe.name}" failed Phase 2.`);
      continue;
    }
    console.log(`  Shoe "${shoe.name}" PASSED Phase 2.`);

    // --- FASE 3: APLIKASIKAN `variantFilters` YANG BERSIFAT TERSTRUKTUR (misal: Ukuran, Warna) ---
    console.log("Phase 3: Structured Variant Filters");

    // NEW LOGIC: If variantFilters are provided, and the shoe has no variants, it fails this phase.
    if (
      Object.keys(variantFilters).length > 0 &&
      (!shoe.variants || shoe.variants.length === 0)
    ) {
      productPassesAllFilters = false;
      console.log(
        `  FAIL: Shoe "${shoe.name}" has no variants but variantFilters were provided. Skipping.`
      );
      continue; // Skip to next shoe if it fails here
    }

    if (shoe.variants && shoe.variants.length > 0) {
      const attributeFiltersToApply = {};
      console.log(
        `  Shoe's variantAttributes: ${JSON.stringify(shoe.variantAttributes)}`
      );
      console.log(
        `  Incoming variantFilters: ${JSON.stringify(variantFilters)}`
      );

      for (const filterKey in variantFilters) {
        const normalizedFilterKey = normalizeTextForSearch(filterKey);
        const matchedAttributeDefinition = shoe.variantAttributes?.find(
          (attr) => normalizeTextForSearch(attr.name) === normalizedFilterKey
        );
        if (matchedAttributeDefinition) {
          attributeFiltersToApply[filterKey] = variantFilters[filterKey];
          console.log(
            `  Mapped incoming filterKey "${filterKey}" to structured attribute "${matchedAttributeDefinition.name}".`
          );
        } else {
          console.log(
            `  FilterKey "${filterKey}" from variantFilters does NOT match any structured variantAttributes for this shoe.`
          );
          // If a filterKey from variantFilters doesn't match any of the shoe's
          // defined variantAttributes, this shoe should typically fail this filter.
          // Unless you want to treat it as a soft filter (semantic only in Phase 4).
          // For strict filtering, uncomment the line below:
          // productPassesAllFilters = false;
          // break; // Exit this loop as product already failed
        }
      }

      if (Object.keys(attributeFiltersToApply).length > 0) {
        console.log(
          "  Applying structured attribute filters:",
          attributeFiltersToApply
        );
        const initialVariantsCount = finalAvailableVariants.length;

        for (const filterKey in attributeFiltersToApply) {
          const filterValue = attributeFiltersToApply[filterKey];
          let expectedValuesForFilter = Array.isArray(filterValue)
            ? filterValue.map((val) => normalizeTextForSearch(val))
            : [normalizeTextForSearch(filterValue)];

          if (normalizeTextForSearch(filterKey) === "warna") {
            const translatedValues = new Set();
            expectedValuesForFilter.forEach((val) => {
              mapColorToEnglishAndIndonesian(val).forEach((tVal) =>
                translatedValues.add(tVal)
              );
            });
            expectedValuesForFilter = Array.from(translatedValues);
            console.log(
              `  Color filter "${filterKey}" expanded to translated values: ${JSON.stringify(
                expectedValuesForFilter
              )}`
            );
          }

          const matchedAttributeDefinition = shoe.variantAttributes.find(
            (attr) =>
              normalizeTextForSearch(attr.name) ===
              normalizeTextForSearch(filterKey)
          );

          if (!matchedAttributeDefinition) {
            console.warn(
              `  WARNING: Matched attribute definition not found for filterKey "${filterKey}" during filtering loop.`
            );
            // If the filter key from query (e.g., "ukuran") doesn't exist in shoe's variantAttributes,
            // it means this shoe cannot fulfill that structured filter.
            productPassesAllFilters = false;
            break; // Break from this loop as product failed
          }

          // --- BUG FIX: Handle async predicate in filter/some correctly ---
          const variantMatchesPromises = finalAvailableVariants.map(
            async (variant) => {
              const actualOptionValue =
                variant.optionValues[matchedAttributeDefinition.name];
              const normalizedActualOptionValue =
                normalizeTextForSearch(actualOptionValue);

              console.log(
                `    Checking variant: ${JSON.stringify(variant.optionValues)}`
              );
              console.log(
                `      Attribute name: "${matchedAttributeDefinition.name}", Actual value: "${actualOptionValue}" (normalized: "${normalizedActualOptionValue}")`
              );
              console.log(
                `      Expected values for "${filterKey}" (including translations): ${JSON.stringify(
                  expectedValuesForFilter
                )}`
              );

              // Create an array of promises for each expected value match check
              const individualValueMatchPromises = expectedValuesForFilter.map(
                async (expected) => {
                  return await checkSemanticMatch(
                    normalizedActualOptionValue,
                    expected,
                    0.8 // Increased threshold for specific variant values
                  );
                }
              );

              // Await all individual match checks and then use .some()
              const resolvedIndividualMatches = await Promise.all(
                individualValueMatchPromises
              );
              const valueMatches = resolvedIndividualMatches.some(
                (result) => result === true
              );

              if (valueMatches) {
                console.log(
                  `      SUCCESS: Value "${normalizedActualOptionValue}" matches one of "${expectedValuesForFilter.join(
                    ", "
                  )}".`
                );
              } else {
                console.log(
                  `      FAIL: Value "${normalizedActualOptionValue}" does NOT match any of "${expectedValuesForFilter.join(
                    ", "
                  )}".`
                );
              }
              return valueMatches ? variant : null; // Return the variant if it matches, otherwise null
            }
          );

          // Filter out nulls after all promises are resolved
          finalAvailableVariants = (
            await Promise.all(variantMatchesPromises)
          ).filter(Boolean);

          if (finalAvailableVariants.length === 0) {
            productPassesAllFilters = false;
            console.log(
              `  FAIL: No variants left after filtering by structured attribute "${filterKey}" with values "${filterValue}".`
            );
            break;
          } else {
            finalMinPrice = Infinity;
            finalMaxPrice = 0;
            finalTotalStock = 0;
            for (const variant of finalAvailableVariants) {
              finalMinPrice = Math.min(finalMinPrice, variant.price);
              finalMaxPrice = Math.max(finalMaxPrice, variant.price);
              finalTotalStock += variant.stock;
            }
            console.log(
              `  SUCCESS: Matched structured attribute "${filterKey}". ${finalAvailableVariants.length} variants remaining. Current total stock: ${finalTotalStock}`
            );
          }
        }
        if (
          productPassesAllFilters &&
          finalAvailableVariants.length === 0 &&
          initialVariantsCount > 0
        ) {
          productPassesAllFilters = false;
          console.log(
            `  FAIL: All variants filtered out despite initial variants.`
          );
        }
      } else {
        console.log(
          "  No structured variant filters to apply for this product."
        );
      }
    } else {
      // This else block handles shoes with no `variants` array or an empty `variants` array
      // This section is now technically redundant due to the new check at the start of Phase 3,
      // but keeping the log for clarity if that check is removed later.
      if (Object.keys(variantFilters).length > 0) {
        console.log(
          `  FAIL: Product "${shoe.name}" has no variants but variantFilters were provided.`
        );
        productPassesAllFilters = false;
      } else {
        console.log(
          "  Product has no variants, and no variantFilters were provided. Skipping structured variant filter phase."
        );
      }
    }

    if (!productPassesAllFilters) {
      console.log(`  Shoe "${shoe.name}" failed Phase 3.`);
      continue;
    }
    console.log(`  Shoe "${shoe.name}" PASSED Phase 3.`);

    // --- FASE 4: APLIKASIKAN SEMUA PARAMETER SEBAGAI FILTER TEKSTUAL DI DESKRIPSI PRODUK ---
    console.log("Phase 4: Comprehensive Textual Filter (Semantic Approach)");

    let currentVariantAttributesText = "";
    if (shoe.variantAttributes && shoe.variantAttributes.length > 0) {
      currentVariantAttributesText = shoe.variantAttributes
        .map(
          (attr) =>
            `${normalizeTextForSearch(attr.name)} ${attr.options
              .map((opt) => normalizeTextForSearch(opt))
              .join(" ")}`
        )
        .join(" ");
    }
    let variantOptionValuesText = "";
    if (shoe.variants && shoe.variants.length > 0) {
      variantOptionValuesText = shoe.variants
        .map((v) =>
          Object.values(v.optionValues)
            .map((val) => normalizeTextForSearch(val))
            .join(" ")
        )
        .join(" ");
    }
    const currentSearchableText = normalizeTextForSearch(
      `${shoe.name || ""} ${shoe.description || ""} ${
        brandMap.get(shoe.brand.toString()) || ""
      } ${shoe.category
        .map((id) => categoryMap.get(id.toString()) || "")
        .join(" ")} ${variantOptionValuesText} ${currentVariantAttributesText}`
    );

    const shoeSearchableTextEmbedding = await getEmbedding(
      currentSearchableText
    );
    if (!shoeSearchableTextEmbedding) {
      console.warn(
        `  WARNING: Could not generate embedding for searchable text of shoe "${shoe.name}". Skipping semantic filter.`
      );
      productPassesAllFilters = false;
    }

    if (productPassesAllFilters && query) {
      const isQueryTextMatch = await checkSemanticMatch(
        queryEmbedding,
        shoeSearchableTextEmbedding,
        0.6
      );
      if (!isQueryTextMatch) {
        console.log(
          `  FAIL: Overall query "${query}" does not semantically match shoe's searchable text (threshold 0.6).`
        );
        productPassesAllFilters = false;
      } else {
        console.log(
          `  SUCCESS: Overall query "${query}" semantically matches shoe's searchable text (threshold 0.6).`
        );
      }
    }

    if (!productPassesAllFilters) {
      console.log(`  Shoe "${shoe.name}" failed Phase 4 (Textual Filter).`);
    } else {
      console.log(`  Shoe "${shoe.name}" PASSED Phase 4.`);
    }

    if (!productPassesAllFilters) {
      continue;
    }

    // --- FASE 5: VERIFIKASI AKHIR STOK (setelah semua filter diterapkan) ---
    console.log("Phase 5: Final Stock Verification");
    if (finalTotalStock === 0) {
      productPassesAllFilters = false;
      console.log(`  FAIL: Final total stock is 0 after all filters.`);
    }

    if (!productPassesAllFilters) {
      console.log(`  Shoe "${shoe.name}" failed Phase 5.`);
      continue;
    }
    console.log(`  Shoe "${shoe.name}" PASSED Phase 5.`);

    // --- JIKA SEMUA FILTER LOLOS, TAMBAHKAN PRODUK KE HASIL ---
    console.log(`Shoe "${shoe.name}" PASSED ALL FILTERS. Adding to results.`);
    shoe.display_price =
      finalMinPrice === finalMaxPrice
        ? `Rp ${finalMinPrice.toLocaleString("id-ID")}`
        : `Rp ${finalMinPrice.toLocaleString(
            "id-ID"
          )} - Rp ${finalMaxPrice.toLocaleString("id-ID")}`;
    shoe.total_stock = finalTotalStock;
    if (shoe.variants && shoe.variants.length > 0) {
      shoe.available_variants = finalAvailableVariants;
    } else {
      if (finalMinPrice === Infinity) {
        shoe.display_price = `Rp ${shoe.price.toLocaleString("id-ID")}`;
        shoe.total_stock = shoe.stock;
      }
    }

    rawProductsForFrontend.push(shoe);
    filteredResults.push(shoe);
    count++;
  }

  const finalResultsForGemini = filteredResults;
  const rawProductsForFrontendFinal = rawProductsForFrontend;

  const formattedOutputForGemini = finalResultsForGemini.map((shoe) => {
    const item = {
      name: shoe.name,
      brand: brandMap.get(shoe.brand.toString()),
      category: shoe.category.map((id) => categoryMap.get(id.toString())),
      image: shoe.image,
      description: shoe.description,
      price_info: shoe.display_price,
    };

    if (shoe.variants && shoe.variants.length > 0) {
      item.info_variants = JSON.stringify(shoe.variants);
      item.variants = shoe.available_variants
        ? shoe.available_variants.map((v) => ({
            optionValues: v.optionValues,
            price: v.price,
            stock: v.stock,
            sku: v.sku,
            imageUrl: v.imageUrl,
          }))
        : [];
      item.total_stock = shoe.total_stock;
    } else {
      item.total_stock = shoe.total_stock;
    }
    return item;
  });

  if (formattedOutputForGemini.length === 0) {
    console.log("No shoes found matching all criteria.");
    return {
      message:
        "Maaf, kami tidak menemukan sepatu yang sesuai dengan kriteria Anda. Coba kata kunci lain atau perlonggar kriteria pencarian.",
      productsForFrontend: [],
    };
  }

  console.log(
    `--- END searchShoes. Found ${formattedOutputForGemini.length} results. ---`
  );
  return {
    shoes: formattedOutputForGemini,
    productsForFrontend: rawProductsForFrontendFinal,
  };
};

// Map fungsi ke objek agar mudah dipanggil oleh AI
const availableFunctions = {
  searchShoes,
};

module.exports = { availableFunctions };
