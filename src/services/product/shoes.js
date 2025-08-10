const Brand = require("../../models/brand");
const Category = require("../../models/category");
const Shoe = require("../../models/shoes");
const mongoose = require("mongoose");
const { getEmbedding } = require("../../utils/embeddings");
const LatestOffer = require("../../models/latestOffers");

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
  isPopular,
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
    isPopular,
  });

  let userIntentToEmbed = "";

  if (userIntent && material) {
    userIntentToEmbed += `Deskripsi: ${userIntent}, Material ${material}. `;
  } else {
    userIntentToEmbed += `Deskripsi: ${userIntent}. `;
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

  console.log("USER INTENT TEXT TO EMBED : ", userIntentToEmbed);

  const userIntentEmbedding = await getEmbedding(
    "sepatu kasual, tahan air, sol karet, warna hitam, ukuran 42"
  );
  if (!userIntentEmbedding) {
    console.error("ERROR: Failed to generate embedding for query.");
    return { error: "Failed to generate embedding for query." };
  }

  // --- Tahap 1: Bangun Filter Query untuk Vector Search (filter sederhana) ---
  const vectorSearchFilters = [];

  if (Array.isArray(excludeIds) && excludeIds.length > 0) {
    vectorSearchFilters.push({
      _id: { $nin: excludeIds.map((id) => new mongoose.Types.ObjectId(id)) },
    });
  }

  if (brand) {
    const brandDoc = await Brand.findOne({
      name: { $regex: new RegExp(brand, "i") },
    });
    if (brandDoc) {
      vectorSearchFilters.push({ brand: { $eq: brandDoc._id } });
    }
  }

  if (category) {
    const categoryDoc = await Category.findOne({
      name: { $regex: new RegExp(category, "i") },
    });
    if (categoryDoc) {
      vectorSearchFilters.push({ category: { $eq: categoryDoc._id } });
    }
  }

  // Masukkan filter harga dasar (price di level atas)
  if (minPrice !== undefined || maxPrice !== undefined) {
    const priceQuery = {};
    if (minPrice !== undefined) priceQuery.$gte = minPrice;
    if (maxPrice !== undefined) priceQuery.$lte = maxPrice;
    vectorSearchFilters.push({ price: priceQuery });
  }

  let vectorSearchFilterObject = {};
  if (vectorSearchFilters.length > 0) {
    vectorSearchFilterObject = { $and: vectorSearchFilters };
  }

  // --- Tahap 2: Bangun Kriteria Filter untuk Tahap Aggregation lanjutan ($match) ---
  const postVectorSearchFilters = { $and: [] };

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
  // Filter varian menggunakan $elemMatch
  if (variantFilters && Object.keys(variantFilters).length > 0) {
    // 1. Iterasi setiap filter varian dari input
    for (const [attributeName, attributeValues] of Object.entries(
      variantFilters
    )) {
      if (Array.isArray(attributeValues) && attributeValues.length > 0) {
        // 2. Buat objek kriteria untuk setiap attributeName
        postVectorSearchFilters.$and.push({
          "variants.optionValues": {
            $elemMatch: {
              key: attributeName,
              value: { $in: attributeValues },
            },
          },
        });
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
        numCandidates: 200,
        limit: limit,
        filter: vectorSearchFilterObject,
      },
    },
    postVectorSearchFilters.length > 0
      ? { $match: postVectorSearchFilters }
      : null,
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

  const shoes = await Shoe.aggregate(pipeline).exec();
  console.log(`GET ${shoes.length} SHOES : `, shoes);

  const formattedOutputForGemini = shoes.map((shoe) => {
    const item = {
      name: shoe.name,
      brand: shoe.brand,
      category: shoe.category.filter(Boolean),
      description: shoe.description,
      price: shoe.price,
      variants: shoe.variants,
    };
    if (shoe.variants && shoe.variants.length === 0) {
      item.stock = shoe.stock;
    }
    return item;
  });

  if (formattedOutputForGemini.length === 0) {
    return {
      message:
        "Maaf, kami tidak menemukan sepatu yang sesuai dengan kriteria Anda. Coba kata kunci lain atau perlonggar kriteria pencarian.",
      shoes: [],
    };
  }

  console.log(
    `--- END searchShoes. Found ${formattedOutputForGemini.length} results. ---`
  );

  return {
    shoes: formattedOutputForGemini,
    productsForFrontend: [],
  };
};

module.exports = { searchShoes };
