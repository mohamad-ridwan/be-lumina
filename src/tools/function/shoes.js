const mongoose = require("mongoose");
const Brand = require("../../models/brand");
const Category = require("../../models/category");
const Shoe = require("../../models/shoes");
// const { getEmbedding } = require("../../utils/embeddings");
const LatestOffers = require("../../models/latestOffers");
const { stripHtml } = require("../../helpers/general");
const { getQueryVector } = require("../../services/embeddings/jina.service");

const searchShoes = async ({
  userIntent,
  shoeNames,
  minPrice,
  maxPrice,
  material,
  brand,
  category,
  variantFilters = {},
  limit = 5,
  excludeIds = [],
  newArrival,
  relatedOffers,
}) => {
  console.log("--- START searchShoes (Atlas Vector Search) ---");
  console.log("Calling searchShoes with parameters:", {
    userIntent,
    shoeNames,
    minPrice,
    maxPrice,
    material,
    brand,
    category,
    variantFilters,
    limit,
    excludeIds,
    newArrival,
    relatedOffers,
  });

  let userIntentToEmbed = "";

  if (userIntent) {
    userIntentToEmbed += `Deskripsi: ${userIntent}. `;
  }
  if (material) {
    userIntentToEmbed += `Material: ${material}. `;
  }
  if (brand) {
    userIntentToEmbed += `Brand: ${brand}. `;
  }
  if (category) {
    userIntentToEmbed += `Kategori: ${category.join(", ")}. `;
  }
  // Perbaikan untuk menambahkan filter varian
  if (variantFilters && Object.keys(variantFilters).length > 0) {
    // Buat array untuk menampung string deskripsi varian
    const variantDescriptionParts = [];

    // Iterasi setiap atribut varian (misal: "Warna", "Ukuran")
    for (const [attributeName, attributeValues] of Object.entries(
      variantFilters
    )) {
      if (Array.isArray(attributeValues) && attributeValues.length > 0) {
        // Gabungkan nama atribut dan nilainya
        // Contoh: "Warna: hitam"
        variantDescriptionParts.push(
          `${attributeName}: ${attributeValues.join(", ")}`
        );
      }
    }

    // Jika ada bagian varian yang berhasil dibuat, tambahkan ke string utama
    if (variantDescriptionParts.length > 0) {
      userIntentToEmbed += `Attribut Varian: ${variantDescriptionParts.join(
        ", "
      )}.`;
    }
  }

  // const userIntentEmbedding = await getEmbedding(userIntent);
  const userIntentEmbedding = await getQueryVector(userIntent);
  console.log("user intent embedd length :", userIntentEmbedding.length);
  if (!userIntentEmbedding) {
    console.error("ERROR: Failed to generate embedding for query.");
    return { error: "Failed to generate embedding for query." };
  }

  let vectorSearchFilterObject = {};

  // --- Tahap 1: Bangun Filter Query untuk Vector Search (filter sederhana) ---
  const vectorSearchFilters = [];
  const postVectorSearchFilters = { $and: [] };

  if (Array.isArray(excludeIds) && excludeIds.length > 0) {
    vectorSearchFilters.push({
      _id: { $nin: excludeIds.map((id) => new mongoose.Types.ObjectId(id)) },
    });
  }

  // if (brand) {
  //   const brandDoc = await Brand.findOne({
  //     name: { $regex: new RegExp(brand, "i") },
  //   });
  //   if (brandDoc) {
  //     vectorSearchFilters.push({ brand: { $eq: brandDoc._id } });
  //   }
  // }
  if (brand && Array.isArray(brand) && brand.length > 0) {
    // Buat array untuk menampung semua ID kategori yang cocok
    const matchedBrandIds = [];

    // Cari semua dokumen kategori yang namanya cocok dengan salah satu kategori di array input
    const brandDocs = await Brand.find({
      name: {
        // Gunakan $in dengan array regex untuk pencarian yang fleksibel dan efisien
        $in: brand.map((brandName) => new RegExp(brandName, "i")),
      },
    });

    // Kumpulkan ID dari dokumen yang ditemukan
    for (const doc of brandDocs) {
      matchedBrandIds.push(doc._id);
    }

    // Jika ada ID yang cocok, tambahkan ke filter
    if (matchedBrandIds.length > 0) {
      vectorSearchFilterObject.brand = {
        $in: matchedBrandIds,
      };
    }
  }
  if (newArrival === true) {
    vectorSearchFilterObject.newArrival = newArrival;
  }

  // if (category) {
  //   const categoryDoc = await Category.findOne({
  //     name: { $regex: new RegExp(category, "i") },
  //   });
  //   if (categoryDoc) {
  //     vectorSearchFilters.push({ category: { $eq: categoryDoc._id } });
  //   }
  // }
  if (category && Array.isArray(category) && category.length > 0) {
    // Buat array untuk menampung semua ID kategori yang cocok
    const matchedCategoryIds = [];

    // Cari semua dokumen kategori yang namanya cocok dengan salah satu kategori di array input
    const categoryDocs = await Category.find({
      name: {
        // Gunakan $in dengan array regex untuk pencarian yang fleksibel dan efisien
        $in: category.map((catName) => new RegExp(catName, "i")),
      },
    });

    // Kumpulkan ID dari dokumen yang ditemukan
    for (const doc of categoryDocs) {
      matchedCategoryIds.push(doc._id);
    }

    // Jika ada ID yang cocok, tambahkan ke filter
    if (matchedCategoryIds.length > 0) {
      vectorSearchFilterObject.category = {
        $in: matchedCategoryIds,
      };
    }
  }
  if (
    relatedOffers &&
    Array.isArray(relatedOffers) &&
    relatedOffers.length > 0
  ) {
    // Buat array untuk menampung semua ID kategori yang cocok
    const matchedOffersIds = [];

    // Cari semua dokumen kategori yang namanya cocok dengan salah satu kategori di array input
    const offersDocs = await LatestOffers.find({
      title: {
        // Gunakan $in dengan array regex untuk pencarian yang fleksibel dan efisien
        $in: relatedOffers.map((offersName) => new RegExp(offersName, "i")),
      },
    });

    // Kumpulkan ID dari dokumen yang ditemukan
    for (const doc of offersDocs) {
      matchedOffersIds.push(doc._id);
    }

    // Jika ada ID yang cocok, tambahkan ke filter
    // if (matchedOffersIds.length > 0) {
    //   vectorSearchFilterObject.relatedOffers = {
    //     $in: matchedOffersIds,
    //   };
    // }
    if (matchedOffersIds.length > 0) {
      postVectorSearchFilters.$and.push({
        $or: [{ relatedOffers: { $in: matchedOffersIds } }],
      });
    }
  }

  // Masukkan filter harga dasar (price di level atas)
  if (minPrice !== undefined || maxPrice !== undefined) {
    const priceQuery = {};
    if (minPrice !== undefined) priceQuery.$gte = minPrice;
    if (maxPrice !== undefined) priceQuery.$lte = maxPrice;
    vectorSearchFilters.push({ price: priceQuery });
  }

  if (vectorSearchFilters.length > 0) {
    vectorSearchFilterObject = {
      ...vectorSearchFilterObject,
      $and: vectorSearchFilters,
    };
  }

  // --- Tahap 2: Bangun Kriteria Filter untuk Tahap Aggregation lanjutan ($match) ---

  // Filter harga yang lebih kompleks (price di variants)
  if (minPrice !== undefined || maxPrice !== undefined) {
    const priceQuery = {};
    if (minPrice !== undefined) priceQuery.$gte = minPrice;
    if (maxPrice !== undefined) priceQuery.$lte = maxPrice;

    // Perbaikan: gunakan $or untuk mencari harga di root atau di variants
    postVectorSearchFilters.$and.push({
      $or: [{ price: priceQuery }, { "variants.price": priceQuery }],
    });
  }

  function escapeRegex(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  // Separator rentang yang umum dipakai (hyphen, en dash, em dash, s/d, to, ~, dst)
  const RANGE_SEP = "(?:-|–|—|~|s\\/?d|s\\.d\\.|to)";

  // Regex string untuk menangkap rentang angka (mis. "39-45", "39 s/d 45", "39–45")
  const RANGE_REGEX = new RegExp(
    `(\\d+(?:\\.\\d+)?)\\s*${RANGE_SEP}\\s*(\\d+(?:\\.\\d+)?)`,
    "gi"
  );

  /**
   * Membangun klausa filter untuk 1 atribut varian.
   * - attributeName: "Ukuran" | "Warna" | dst.
   * - attributeValues: array string, mis. ["42"] atau ["hitam"]
   */
  function buildVariantFilterClause(attributeName, attributeValues) {
    const regexList = attributeValues.map(
      (v) => new RegExp(`\\b${escapeRegex(v)}\\b`, "i")
    );

    // Default: cocokkan di variants.optionValues ATAU di name (string langsung)
    const baseOr = [
      {
        "variants.optionValues": {
          $elemMatch: {
            key: attributeName,
            value: { $in: regexList },
          },
        },
      },
      { name: { $in: regexList } },
    ];

    // Jika atribut berupa angka (contoh: Ukuran), tambahkan cek rentang di name
    const numericValues = attributeValues
      .map((v) => parseFloat(String(v).replace(",", ".")))
      .filter((n) => !Number.isNaN(n));

    const rangeOr = numericValues.map((num) => ({
      $expr: {
        // Match semua rentang angka dalam 'name', lalu cek apakah 'num' berada di salah satu rentang
        $let: {
          vars: {
            matches: { $regexFindAll: { input: "$name", regex: RANGE_REGEX } },
          },
          in: {
            $anyElementTrue: {
              $map: {
                input: "$$matches",
                as: "m",
                in: {
                  $let: {
                    vars: {
                      start: {
                        $toDouble: { $arrayElemAt: ["$$m.captures", 0] },
                      },
                      end: { $toDouble: { $arrayElemAt: ["$$m.captures", 1] } },
                    },
                    in: {
                      $and: [
                        { $lte: ["$$start", num] },
                        { $gte: ["$$end", num] },
                      ],
                    },
                  },
                },
              },
            },
          },
        },
      },
    }));

    return { $or: rangeOr.length ? baseOr.concat(rangeOr) : baseOr };
  }

  // Filter varian menggunakan $elemMatch
  if (variantFilters && Object.keys(variantFilters).length > 0) {
    // 1. Iterasi setiap filter varian dari input
    for (const [attributeName, attributeValues] of Object.entries(
      variantFilters
    )) {
      if (Array.isArray(attributeValues) && attributeValues.length > 0) {
        // Dorong ke $and utama sebagai satu klausa per atribut
        postVectorSearchFilters.$and.push(
          buildVariantFilterClause(attributeName, attributeValues)
        );
        // 2. Buat objek kriteria untuk setiap attributeName
        // const regexList = attributeValues.map(
        //   (val) => new RegExp(`\\b${val}\\b`, "i")
        // );

        // postVectorSearchFilters.$and.push({
        //   $or: [
        //     // Cek di variants.optionValues
        //     {
        //       "variants.optionValues": {
        //         $elemMatch: {
        //           key: attributeName,
        //           value: { $in: regexList },
        //         },
        //       },
        //     },
        //     // Cek di name
        //     {
        //       name: { $in: regexList },
        //     },
        //   ],
        // });
      }
    }
  }

  // --- Gabungkan semua ke dalam agregasi pipeline ---
  const pipeline = [
    {
      $vectorSearch: {
        index: "embedding",
        path: "embedding",
        queryVector: userIntentEmbedding,
        numCandidates: 50,
        limit: limit,
        filter: vectorSearchFilterObject,
      },
    },
    postVectorSearchFilters.$and.length > 0
      ? {
          $match: postVectorSearchFilters,
        }
      : null,
    // {
    //   $match: {
    //     // $and: [
    //     //   {
    //     //     "variants.optionValues": {
    //     //       $elemMatch: {
    //     //         key: "Ukuran",
    //     //         value: {
    //     //           // $in: attributeValues.map((val) => new RegExp(val, "i")),
    //     //           $in: ["39", "40"].map((val) => new RegExp(val, "i")),
    //     //         },
    //     //       },
    //     //     },
    //     //   },
    //     //   {
    //     //     "variants.optionValues": {
    //     //       $elemMatch: {
    //     //         key: "Warna",
    //     //         value: {
    //     //           // $in: attributeValues.map((val) => new RegExp(val, "i")),
    //     //           $in: ["PUTIH/abu-abu", "HITAM", "UNGU"].map(
    //     //             (val) => new RegExp(val, "i")
    //     //           ),
    //     //         },
    //     //       },
    //     //     },
    //     //   },
    //     // ],
    //   },
    // },
    {
      $lookup: {
        from: "brands",
        localField: "brand",
        foreignField: "_id",
        as: "brand",
      },
    },
    {
      $unwind: "$brand",
    },
    {
      $lookup: {
        from: "categories",
        localField: "category",
        foreignField: "_id",
        as: "category",
      },
    },
    {
      $unwind: { path: "$category", preserveNullAndEmptyArrays: true },
    },
    {
      $project: {
        _id: 1,
        score: { $meta: "vectorSearchScore" },
        name: 1,
        brand: "$brand.name",
        category: "$category.name",
        description: 1,
        price: 1,
        variants: 1,
        stock: 1,
      },
    },
    {
      $group: {
        _id: "$_id",
        score: { $first: "$score" },
        name: { $first: "$name" },
        brand: { $first: "$brand" },
        category: { $push: "$category" },
        description: { $first: "$description" },
        price: { $first: "$price" },
        variants: { $first: "$variants" },
        stock: { $first: "$stock" },
      },
    },
    {
      $sort: { score: -1 },
    },
    {
      $limit: limit,
    },
  ].filter(Boolean); // Hapus stage null jika tidak ada filter lanjutan

  console.log(
    "Final vectorSearchFilterObject:",
    JSON.stringify(vectorSearchFilterObject, null, 2)
  );
  console.log(
    "POST VECTOR : ",
    JSON.stringify(postVectorSearchFilters, null, 2)
  );

  // const testShoe = await Shoe.find({
  //   $and: [
  //     {
  //       category: {
  //         $eq: "686173dc094fec4a4b64e516",
  //       },
  //     },
  //     {
  //       "variants.optionValues": {
  //         $elemMatch: {
  //           key: "Warna",
  //           value: {
  //             $in: ["Hitam"].map((val) => new RegExp(val, "i")),
  //           },
  //         },
  //       },
  //     },
  //     {
  //       "variants.optionValues": {
  //         $elemMatch: {
  //           key: "Ukuran",
  //           value: {
  //             $in: ["42"].map((val) => new RegExp(val, "i")),
  //           },
  //         },
  //       },
  //     },
  //   ],
  // });

  // console.log(`TEST SHOE ${testShoe.length} :`);

  const shoes = await Shoe.aggregate(pipeline).exec();
  console.log(`GET ${shoes.length} SHOES : `);

  const searchResults = shoes.map((shoe) => {
    const cleanedDescription = stripHtml(shoe.description);
    const compactedDescription = cleanedDescription.replace(/\s+/g, " ").trim();
    const formattedVariants = [];
    if (shoe.variants && shoe.variants.length > 0) {
      for (const variant of shoe.variants) {
        const variantObject = {};

        // Pastikan optionValues adalah array
        if (Array.isArray(variant.optionValues)) {
          // Iterasi setiap objek di array optionValues
          for (const option of variant.optionValues) {
            // Tambahkan pasangan key-value ke objek varian
            variantObject[option.key] = option.value;
          }
        }

        // Tambahkan detail varian lainnya
        if (variant.price) variantObject.price = variant.price;
        if (variant.stock) variantObject.stock = variant.stock;
        if (variant.sku) variantObject.sku = variant.sku;
        if (variant.imageUrl) variantObject.imageUrl = variant.imageUrl;
        formattedVariants.push(variantObject);
      }
    }
    const item = {
      _id: shoe._id,
      name: shoe.name,
      brand: shoe.brand,
      category: shoe.category,
      description: compactedDescription,
      price: shoe.price,
      variants: formattedVariants,
      score: shoe.score,
    };
    if (shoe.variants && shoe.variants.length === 0) {
      item.stock = shoe.stock;
    }
    return item;
  });

  if (searchResults.length === 0) {
    return {
      content:
        "Maaf, kami tidak menemukan sepatu yang sesuai dengan kriteria Anda. Mungkin stok sedang tidak tersedia atau barangnya baru saja terjual habis.",
      shoes: [],
    };
  }

  console.log(
    `--- END searchShoes. Found ${searchResults.length} results. ---`,
    userIntent,
    searchResults
  );

  //   return {
  //     shoes: formattedOutputForGemini,
  //     productsForFrontend: [],
  //   };

  const formattedOutputForGemini = searchResults
    .map((shoe) => {
      const formattedVariants = shoe.variants
        .map((v) =>
          Object.entries(v)
            .map(([key, value]) => `${key}: ${value}`)
            .join(", ")
        )
        .join("; ");

      return `
- Nama: ${shoe.name}
- Merek: ${shoe.brand}
- Kategori: ${shoe.category.join(", ")}
- Harga: Rp ${shoe.price.toLocaleString("id-ID")}
- Deskripsi: ${shoe.description}
- Varian Tersedia: ${formattedVariants}
`;
    })
    .join("\n---\n"); // Gabungkan setiap item dengan pemisah yang jelas

  const content = `Hasil pencarian sepatu:
  
${formattedOutputForGemini}`;

  return {
    shoes: searchResults,
    content: content,
  };
};

// searchShoes({
//   // userIntent: `Mencari sepatu casual, yang nyaman dan tahan basah`,
//   userIntent: `nyari sepatu Basket, rekomendasi yang ga gampang kena noda & lembab`,
//   shoeNames: undefined,
//   minPrice: undefined,
//   maxPrice: undefined,
//   material: "anti noda, anti lembab",
//   brand: undefined,
//   category: ["Basket"],
//   variantFilters: { Ukuran: ["39", "40"], Warna: ["Putih"] },
//   limit: 5,
//   excludeIds: [],
//   newArrival: undefined,
//   relatedOffers: undefined,
//   isPopular: undefined,
// });

const extractProductInfo = async (_id, newSpecsData) => {
  try {
    // 1. Validasi input _id
    if (!_id) {
      throw new Error("ID sepatu tidak boleh kosong.");
    }

    // 2. Buat objek untuk pembaruan
    const updateFields = {};

    // 4. Buat array 'specs' baru dari field lainnya
    const newSpecsArray = [];

    // Map setiap field dari tool ke dalam format { type, text }
    if (newSpecsData.deskripsi) {
      newSpecsArray.push({ type: "deskripsi", text: newSpecsData.deskripsi });
    }
    if (newSpecsData.model) {
      newSpecsArray.push({ type: "model", text: newSpecsData.model });
    }
    if (newSpecsData.spesifikasi) {
      newSpecsArray.push({
        type: "spesifikasi",
        text: newSpecsData.spesifikasi,
      });
    }
    if (newSpecsData.keunggulan) {
      newSpecsArray.push({ type: "keunggulan", text: newSpecsData.keunggulan });
    }
    if (newSpecsData.bahan) {
      newSpecsArray.push({ type: "bahan", text: newSpecsData.bahan });
    }
    if (newSpecsData.fitur) {
      newSpecsArray.push({ type: "fitur", text: newSpecsData.fitur });
    }
    if (newSpecsData.penggunaan) {
      newSpecsArray.push({ type: "penggunaan", text: newSpecsData.penggunaan });
    }
    if (newSpecsData.targetPengguna) {
      newSpecsArray.push({
        type: "targetPengguna",
        text: newSpecsData.targetPengguna,
      });
    }
    if (newSpecsData.tingkatBantalan) {
      newSpecsArray.push({
        type: "tingkatBantalan",
        text: newSpecsData.tingkatBantalan,
      });
    }

    // 5. Tambahkan array specs ke objek pembaruan jika ada data
    if (newSpecsArray.length > 0) {
      updateFields.specs = newSpecsArray;
    }

    // 6. Perbarui dokumen sepatu dengan semua field yang baru
    //    Cari berdasarkan ID dan perbarui dengan objek 'updateFields'
    const updatedShoe = await Shoe.findByIdAndUpdate(_id, updateFields, {
      new: true,
      runValidators: true,
    });

    if (!updatedShoe) {
      throw new Error(`Sepatu dengan ID ${_id} tidak ditemukan.`);
    }

    return updatedShoe;
  } catch (error) {
    console.error("Gagal memperbarui spesifikasi sepatu:", error.message);
    throw error;
  }
};

const shoeFunctionTools = {
  searchShoes,
  extractProductInfo,
};

module.exports = shoeFunctionTools;
