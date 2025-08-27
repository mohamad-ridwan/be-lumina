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
  minPrice,
  maxPrice,
  brand,
  category,
  variantFilters = {},
  limit = 1,
}) => {
  console.log("searchShoes:", {
    userIntent,
    brand,
    category,
    limit,
    variantFilters,
  });

  const userIntentEmbedding = await getQueryVector(userIntent);
  if (!userIntentEmbedding) {
    return { error: "Failed to generate embedding", shoes: [] };
  }

  let vectorSearchFilter = {};
  const postFilters = { $and: [] };

  // Simplified brand filtering
  if (brand?.length) {
    try {
      const brandDocs = await Brand.find({
        name: { $in: brand.map((b) => new RegExp(b, "i")) },
      })
        .limit(10)
        .lean(); // Add limit to reduce query size

      if (brandDocs.length) {
        vectorSearchFilter.brand = { $in: brandDocs.map((b) => b._id) };
      }
    } catch (err) {
      console.error("Brand filter error:", err);
    }
  }

  // Simplified category filtering
  if (category?.length) {
    try {
      const categoryDocs = await Category.find({
        name: { $in: category.map((c) => new RegExp(c, "i")) },
      })
        .limit(10)
        .lean(); // Add limit

      if (categoryDocs.length) {
        vectorSearchFilter.category = { $in: categoryDocs.map((c) => c._id) };
      }
    } catch (err) {
      console.error("Category filter error:", err);
    }
  }

  // Simplified price filtering
  if (minPrice !== undefined || maxPrice !== undefined) {
    const priceQuery = {};
    if (minPrice !== undefined) priceQuery.$gte = minPrice;
    if (maxPrice !== undefined) priceQuery.$lte = maxPrice;
    postFilters.$and.push({
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
        postFilters.$and.push(
          buildVariantFilterClause(attributeName, attributeValues)
        );
      }
    }
  }

  console.log("VECTOR SEARCH FILTER: ", vectorSearchFilter);

  // Streamlined aggregation pipeline
  const pipeline = [
    {
      $vectorSearch: {
        index: "embedding",
        path: "embedding",
        queryVector: userIntentEmbedding,
        numCandidates: 50, // Reduced from 50
        limit,
        filter: vectorSearchFilter,
      },
    },
    postFilters.$and.length > 0 ? { $match: postFilters } : null,
    {
      $lookup: {
        from: "brands",
        localField: "brand",
        foreignField: "_id",
        as: "brand",
        pipeline: [{ $project: { name: 1 } }], // Only get name field
      },
    },
    { $unwind: "$brand" },
    {
      $lookup: {
        from: "categories",
        localField: "category",
        foreignField: "_id",
        as: "category",
      },
    },
    { $unwind: { path: "$category", preserveNullAndEmptyArrays: true } },
    {
      $project: {
        _id: 1,
        score: { $meta: "vectorSearchScore" },
        name: 1,
        brand: "$brand.name",
        category: "$category.name",
        slug: 1,
        description: 1,
        price: 1,
        variants: 1,
        stock: 1,
        specs: 1,
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
        slug: { $first: "$slug" },
        specs: { $first: "$specs" },
      },
    },
    { $sort: { score: -1 } },
    { $limit: limit },
  ].filter(Boolean);

  const shoes = await Shoe.aggregate(pipeline).exec();
  console.log(`Found ${shoes.length} shoes`);

  const searchResults = shoes.map((shoe) => {
    // Simplified description processing
    const cleanDesc = shoe.description
      ? shoe.description
          .replace(/<[^>]*>/g, "")
          .replace(/\s+/g, " ")
          .trim()
      : "";

    // Simplified variants formatting
    const formattedVariants =
      shoe.variants
        .filter((v) => v.stock)
        .map((v) => {
          // Limit variants
          const variantObj = {};
          v.optionValues?.forEach((opt) => {
            variantObj[opt.key] = opt.value;
          });
          if (v.price) variantObj.price = v.price;
          return variantObj;
        }) || [];

    return {
      _id: shoe._id,
      name: shoe.name,
      brand: shoe.brand,
      category: shoe.category,
      description: cleanDesc.substring(0, 100), // Truncate description
      specs: shoe.specs || [], // Limit specs
      price: shoe.price,
      variants: formattedVariants,
      slug_sepatu: shoe.slug,
      score: shoe.score,
      stock: shoe.variants?.length === 0 ? shoe.stock : undefined,
    };
  });

  if (searchResults.length === 0) {
    return { content: "Tidak ada hasil sepatu ditemukan", shoes: [] };
  }

  // Simplified output formatting for LLM
  const formattedOutput = searchResults
    .map((shoe) => {
      const essentialSpecs = shoe.specs.filter((spec) =>
        ["bahan", "fitur"].includes(spec.type?.toLowerCase())
      );

      const specs = essentialSpecs
        .map((s) => `${s.type}: ${s.text}`)
        .join(" | ");
      const variants = shoe.variants
        .map(
          (
            v // Show only first variant
          ) =>
            Object.entries(v)
              .map(([k, val]) => `${k}: ${val}`)
              .join(", ")
        )
        .join("; ");

      return `${shoe.name} | ${shoe.brand}${
        shoe.price ? ` | Rp ${shoe.price.toLocaleString("id-ID")}` : ""
      }${specs ? ` | ${specs}` : ""}${variants ? ` | ${variants}` : ""}`;
    })
    .join("\n");

  console.log("FORMATTED SHOE : ", formattedOutput);

  return {
    shoes: [],
    content: `Sepatu ditemukan:\n${formattedOutput}`,
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
