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

  const userIntentEmbedding = await getEmbedding(userIntent);
  if (!userIntentEmbedding) {
    console.error("ERROR: Failed to generate embedding for query.");
    return { error: "Failed to generate embedding for query." };
  }

  // --- Bangun Filter Query Lainnya ---
  const filters = {};

  if (Array.isArray(excludeIds) && excludeIds.length > 0) {
    filters._id = {
      $nin: excludeIds.map((id) => new mongoose.Types.ObjectId(id)),
    };
  }

  if (newArrival !== undefined) {
    filters.newArrival = newArrival;
  }

  if (minPrice !== undefined || maxPrice !== undefined) {
    const priceQuery = {};
    if (minPrice !== undefined) priceQuery.$gte = minPrice;
    if (maxPrice !== undefined) priceQuery.$lte = maxPrice;

    filters.$or = [
      { price: priceQuery, variants: { $exists: false } },
      { "variants.price": priceQuery, variants: { $exists: true } },
    ];
  }

  if (brand) {
    const brandDoc = await Brand.findOne({
      name: { $regex: new RegExp(brand, "i") },
    });
    if (brandDoc) {
      filters.brand = brandDoc._id;
    }
  }

  if (category) {
    const categoryDoc = await Category.findOne({
      name: { $regex: new RegExp(category, "i") },
    });
    if (categoryDoc) {
      filters.category = categoryDoc._id;
    }
  }

  // --- PERBAIKAN LOGIKA: FILTER VARIAN ---
  // Kita akan menggunakan string biasa, bukan RegExp.
  if (variantFilters && Object.keys(variantFilters).length > 0) {
    const variantMatch = { $and: [] };
    for (const [attributeName, attributeValues] of Object.entries(
      variantFilters
    )) {
      if (Array.isArray(attributeValues) && attributeValues.length > 0) {
        // PERBAIKAN DI SINI: Gunakan string biasa, bukan RegExp
        variantMatch.$and.push({
          [`variants.optionValues.${attributeName}`]: { $in: attributeValues },
        });
      }
    }
    if (variantMatch.$and.length > 0) {
      filters.$and = [...(filters.$and || []), variantMatch];
    }
  }

  // --- Gabungkan semua ke dalam agregasi `$vectorSearch` ---
  const pipeline = [
    {
      $vectorSearch: {
        index: "embedding",
        path: "embedding",
        queryVector: userIntentEmbedding,
        numCandidates: 100,
        limit: limit,
        filter: filters,
      },
    },
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
        slug: 1,
      },
    },
    {
      $sort: { score: -1 },
    },
  ];

  const shoes = await Shoe.aggregate(pipeline).exec();

  const formattedOutputForGemini = shoes.map((shoe) => {
    const item = {
      name: shoe.name,
      brand: shoe.brand,
      category: shoe.category,
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
