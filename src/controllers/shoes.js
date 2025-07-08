// controllers/addShoe.js

// Pastikan semua model di-import/require DI SINI dengan urutan yang benar
const Brand = require("../models/brand");
const Category = require("../models/category");
const shoesDB = require("../models/shoes"); // Model Shoes Anda
const LatestOffers = require("../models/latestOffers");
const mongoose = require("mongoose"); // Diperlukan untuk ObjectId.isValid

exports.getShoe = async (req, res, next) => {
  try {
    // Ambil ID atau slug dari parameter URL (misal: /shoes/:id atau /shoes/:slug)
    const { id, slug, category: categoryIdFromParams } = req.params;
    // Ambil newArrival, limit, offersId, DAN page dari query string (req.query)
    const { newArrival, limit, offerId, page } = req.query; // Tambahkan page di sini

    let query = {};
    let fetchLimit = parseInt(limit) || 10; // Default limit 10
    let currentPage = parseInt(page) || 1; // Default page 1
    if (currentPage < 1) currentPage = 1; // Pastikan halaman tidak kurang dari 1

    let skip = (currentPage - 1) * fetchLimit;

    // --- Logika Penentuan Query Utama ---
    // PRIORITAS: ID atau slug (untuk satu sepatu spesifik)
    if (id) {
      if (!mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({
          success: false,
          message: "Invalid Shoe ID format.",
        });
      }
      query._id = id;
    } else if (slug) {
      query.slug = slug;
    } else if (offerId) {
      // --- Logika Khusus: Filter berdasarkan offersId saja ---
      if (!mongoose.Types.ObjectId.isValid(offerId)) {
        return res.status(400).json({
          success: false,
          message: "Invalid Offer ID format for filtering shoes.",
        });
      }
      query.relatedOffers = new mongoose.Types.ObjectId(offerId);
    } else if (categoryIdFromParams) {
      // --- Logika Khusus: Filter berdasarkan categoryId dari params ---
      if (!mongoose.Types.ObjectId.isValid(categoryIdFromParams)) {
        return res.status(400).json({
          success: false,
          message: "Invalid Category ID format in parameters.",
        });
      }
      query.category = new mongoose.Types.ObjectId(categoryIdFromParams);
    } else {
      // --- Logika Umum: Filter berdasarkan newArrival ---
      if (newArrival !== undefined) {
        query.newArrival = newArrival === "true";
      }
    }

    let shoes;
    let totalCount;
    let totalPages = 1; // Default totalPages untuk kasus single shoe

    // Logika pengambilan data sepatu
    if (id || slug) {
      // Case 1: Mengambil satu sepatu spesifik berdasarkan ID atau Slug
      shoes = await shoesDB
        .findOne(query)
        .populate("brand", "name")
        .populate("category", "name slug parentCategory level")
        .lean();

      if (!shoes) {
        return res.status(404).json({
          success: false,
          message: "Shoe not found.",
        });
      }
      totalCount = 1;
      shoes = [shoes]; // Bungkus dalam array agar konsisten
      // current page dan total pages tetap 1 untuk single item
    } else {
      // Case 2: Mengambil daftar sepatu (dengan filter dan PAGINATION)
      totalCount = await shoesDB.countDocuments(query); // Hitung total dokumen yang cocok
      totalPages = Math.ceil(totalCount / fetchLimit); // Hitung total halaman

      let dbQuery = shoesDB.find(query);

      // Sorting logic
      if (offerId) {
        dbQuery = dbQuery.sort({ name: 1 });
      } else if (newArrival !== undefined) {
        dbQuery = dbQuery.sort({ createdAt: -1 });
      } else {
        dbQuery = dbQuery.sort({ name: 1 });
      }

      shoes = await dbQuery
        .skip(skip) // Terapkan skip untuk pagination
        .limit(fetchLimit) // Terapkan limit untuk pagination
        .populate("brand", "name")
        .populate("category", "name slug parentCategory level")
        .lean();
    }

    // --- Proses Pemformatan Hasil untuk Setiap Sepatu (tetap sama) ---
    const formattedShoes = shoes.map((shoe) => {
      let formattedCategories = [];
      let mainCategories = [];
      let subCategories = [];

      if (shoe.category && Array.isArray(shoe.category)) {
        shoe.category.forEach((cat) => {
          if (cat.level === 0) {
            mainCategories.push(cat);
          } else if (cat.level === 1) {
            subCategories.push(cat);
          }
        });

        formattedCategories = mainCategories.map((mainCat) => {
          const children = subCategories.filter(
            (subCat) =>
              subCat.parentCategory &&
              subCat.parentCategory.toString() === mainCat._id.toString()
          );
          return {
            _id: mainCat._id,
            name: mainCat.name,
            slug: mainCat.slug,
            subCategories: children.map((child) => ({
              _id: child._id,
              name: child.name,
              slug: child.slug,
            })),
          };
        });

        subCategories.forEach((subCat) => {
          if (
            !mainCategories.some(
              (mainCat) =>
                mainCat._id.toString() === subCat.parentCategory?.toString()
            )
          ) {
            formattedCategories.push({
              _id: subCat._id,
              name: subCat.name,
              slug: subCat.slug,
            });
          }
        });
      }

      if (shoe.variants && Array.isArray(shoe.variants)) {
        shoe.variants = shoe.variants.map((variant) => {
          if (variant.optionValues instanceof Map) {
            return {
              ...variant,
              optionValues: Object.fromEntries(variant.optionValues),
            };
          }
          return variant;
        });
      }

      return {
        _id: shoe._id,
        name: shoe.name,
        brand: shoe.brand ? shoe.brand.name : "Unknown Brand",
        label: shoe.label,
        newArrival: shoe.newArrival,
        description: shoe.description,
        category: formattedCategories,
        slug: shoe.slug,
        image: shoe.image,
        price: shoe.price,
        stock: shoe.stock,
        variantAttributes: shoe.variantAttributes,
        variants: shoe.variants,
        relatedOffers: shoe.relatedOffers || [],
        createdAt: shoe.createdAt,
        updatedAt: shoe.updatedAt,
      };
    });

    res.status(200).json({
      success: true,
      message: "Shoes fetched successfully.",
      total: totalCount, // Total sepatu yang cocok (tanpa pagination)
      limit: fetchLimit, // Limit per halaman
      currentPage: currentPage, // Halaman saat ini
      totalPages: totalPages, // Total halaman yang tersedia
      shoes: formattedShoes, // Hasil sepatu yang sudah diformat dan dipaginasi
    });
  } catch (error) {
    console.error("Error in getShoe:", error);
    if (error.name === "CastError") {
      return res.status(400).json({
        success: false,
        message: "Invalid ID format in query or parameters.",
        error: error.message,
      });
    }
    res.status(500).json({
      success: false,
      message: "Failed to fetch shoes.",
      error: error.message,
    });
  }
};

exports.addShoe = async (req, res, next) => {
  try {
    const {
      name,
      brand,
      category,
      image,
      price,
      stock,
      variantAttributes,
      description,
      variants,
      label,
      newArrival,
      relatedOffers, // <<< Tangkap field ini dari request body
    } = req.body;

    // --- Validasi Dasar (Selalu Wajib) ---
    if (!name || typeof name !== "string" || name.trim() === "") {
      return res.status(400).json({
        message:
          "Validation Error: 'name' is required and must be a non-empty string.",
      });
    }

    // Validasi untuk relatedOffers
    if (relatedOffers !== undefined) {
      // Hanya validasi jika field ini ada di request
      if (!Array.isArray(relatedOffers)) {
        return res.status(400).json({
          message:
            "Validation Error: 'relatedOffers' must be an array of offer IDs.",
        });
      }
      for (const offerId of relatedOffers) {
        if (!mongoose.Types.ObjectId.isValid(offerId)) {
          return res.status(400).json({
            message: `Validation Error: Invalid Latest Offer ID '${offerId}'.`,
          });
        }
      }
      // Opsional: Cek apakah semua LatestOffer ID yang diberikan benar-benar ada di database
      // Ini bisa overhead jika relatedOffers banyak, tapi menjamin integritas data
      if (relatedOffers.length > 0) {
        const existingOffers = await LatestOffers.find({
          _id: { $in: relatedOffers },
        });
        if (existingOffers.length !== relatedOffers.length) {
          // Temukan ID yang tidak valid untuk pesan error yang lebih spesifik
          const foundIds = existingOffers.map((offer) => offer._id.toString());
          const invalidIds = relatedOffers.filter(
            (id) => !foundIds.includes(id)
          );
          return res.status(400).json({
            message: `Validation Error: One or more provided Latest Offer IDs do not exist: ${invalidIds.join(
              ", "
            )}.`,
          });
        }
      }
    }

    if (
      (label && typeof label !== "string") ||
      (label && label.trim() === "")
    ) {
      return res.status(400).json({
        message:
          "Validation Error: 'label' is must be a non-empty string if provided.",
      });
    }

    if (typeof newArrival !== "undefined" && typeof newArrival !== "boolean") {
      return res.status(400).json({
        message: "Validation Error: 'newArrival' must be a boolean type.",
      });
    }

    if (
      !description ||
      typeof description !== "string" ||
      description.trim().length < 20
    ) {
      return res.status(400).json({
        message:
          "Validation Error: 'description' is required and must be at least 20 characters long.",
      });
    }

    if (typeof price !== "number" || price < 0) {
      return res.status(400).json({
        message:
          "Validation Error: 'price' is required and must be a non-negative number.",
      });
    }

    if (!category || !Array.isArray(category) || category.length === 0) {
      return res.status(400).json({
        message:
          "Validation Error: 'category' is required and must be a non-empty array of category IDs.",
      });
    }
    for (const catId of category) {
      if (!mongoose.Types.ObjectId.isValid(catId)) {
        return res.status(400).json({
          message: `Validation Error: Invalid category ID '${catId}'.`,
        });
      }
    }
    const existingCategories = await Category.find({ _id: { $in: category } });
    if (existingCategories.length !== category.length) {
      return res.status(400).json({
        message:
          "Validation Error: One or more provided category IDs do not exist.",
      });
    }

    if (!brand || typeof brand !== "string" || brand.trim() === "") {
      return res.status(400).json({
        message:
          "Validation Error: 'brand' is required and must be a brand ID string.",
      });
    }
    if (!mongoose.Types.ObjectId.isValid(brand)) {
      return res.status(400).json({
        message: `Validation Error: Invalid brand ID '${brand}'.`,
      });
    }
    const existingBrand = await Brand.findById(brand);
    if (!existingBrand) {
      return res.status(400).json({
        message: `Validation Error: Brand with ID '${brand}' does not exist.`,
      });
    }

    // --- Hitung SLUG di sini, SEBELUM membuat instance model ---
    const generatedSlug = name
      .toString()
      .toLowerCase()
      .trim()
      .replace(/\s+/g, "-")
      .replace(/[^\w-]+/g, "")
      .replace(/--+/g, "-")
      .replace(/^-+/, "")
      .replace(/-+$/, "");

    let finalSlug = generatedSlug || `shoe-${Date.now()}`;

    const existingShoeWithSlug = await shoesDB.findOne({ slug: finalSlug });
    if (existingShoeWithSlug) {
      finalSlug = `${finalSlug}-${Date.now()}`;
    }

    // --- Siapkan objek data untuk model Mongoose ---
    const shoeData = {
      name: name.trim(),
      description: description.trim(),
      brand: brand,
      category: category,
      slug: finalSlug,
      image: image ? image.trim() : undefined,
      price: price,
      label: label,
      newArrival: newArrival,
      relatedOffers: relatedOffers || [], // <<< Tambahkan relatedOffers ke shoeData. Gunakan array kosong jika tidak ada di request.
    };

    // --- Logika Validasi Kondisional Berdasarkan Keberadaan Varian ---
    const hasVariants = variantAttributes && variantAttributes.length > 0;

    if (hasVariants) {
      if (!Array.isArray(variantAttributes) || variantAttributes.length === 0) {
        return res.status(400).json({
          message:
            "Validation Error: 'variantAttributes' must be a non-empty array if variants are used.",
        });
      }
      if (variantAttributes.length > 2) {
        return res.status(400).json({
          message:
            "Validation Error: A product can have at most 2 variant attributes.",
        });
      }
      for (const attr of variantAttributes) {
        if (
          !attr.name ||
          typeof attr.name !== "string" ||
          attr.name.trim() === ""
        ) {
          return res.status(400).json({
            message:
              "Validation Error: Each variant attribute must have a non-empty 'name'.",
          });
        }
        if (!Array.isArray(attr.options) || attr.options.length === 0) {
          return res.status(400).json({
            message: `Validation Error: Options for attribute '${attr.name}' must be a non-empty array.`,
          });
        }
        if (
          attr.options.some(
            (opt) => typeof opt !== "string" || opt.trim() === ""
          )
        ) {
          return res.status(400).json({
            message: `Validation Error: Each option for attribute '${attr.name}' must be a non-empty string.`,
          });
        }
      }

      if (!Array.isArray(variants) || variants.length === 0) {
        return res.status(400).json({
          message:
            "Validation Error: 'variants' must be a non-empty array if 'variantAttributes' are provided.",
        });
      }

      const formattedVariants = [];
      for (const v of variants) {
        if (
          !v.optionValues ||
          typeof v.price !== "number" ||
          v.price < 0 ||
          typeof v.stock !== "number" ||
          v.stock < 0
        ) {
          return res.status(400).json({
            message:
              "Validation Error: Each variant must have valid 'optionValues', 'price' (non-negative), and 'stock' (non-negative).",
          });
        }

        const optionValuesMap = new Map(Object.entries(v.optionValues));

        for (const attr of variantAttributes) {
          if (
            !optionValuesMap.has(attr.name) ||
            !attr.options.includes(optionValuesMap.get(attr.name))
          ) {
            return res.status(400).json({
              message: `Validation Error: Variant option for '${
                attr.name
              }' is missing or invalid. Provided: ${JSON.stringify(
                v.optionValues
              )}`,
            });
          }
        }
        if (optionValuesMap.size !== variantAttributes.length) {
          return res.status(400).json({
            message: `Validation Error: Mismatch in number of option values for a variant. Expected ${variantAttributes.length}, got ${optionValuesMap.size}.`,
          });
        }

        formattedVariants.push({
          ...v,
          optionValues: optionValuesMap,
          sku: v.sku ? v.sku.trim() : undefined,
          imageUrl: v.imageUrl ? v.imageUrl.trim() : undefined,
        });
      }
      Object.assign(shoeData, {
        variantAttributes,
        variants: formattedVariants,
      });
    } else {
      // --- Skenario: Produk Tanpa Varian ---
      if (typeof stock !== "number" || stock < 0) {
        return res.status(400).json({
          message:
            "Validation Error: 'stock' is required and must be a non-negative number when no variant attributes are provided.",
        });
      }
      Object.assign(shoeData, { stock });
    }

    const newShoe = new shoesDB(shoeData);
    const savedShoe = await newShoe.save();

    // Populate relatedOffers juga saat mengembalikan sepatu yang disimpan
    const populatedShoe = await shoesDB
      .findById(savedShoe._id)
      .populate("brand", "name slug logoUrl")
      .populate("category", "name slug")
      .populate("relatedOffers", "title slug imageUrl"); // <<< POPULATE relatedOffers

    res.status(201).json({
      message: "Shoe added successfully!",
      shoe: populatedShoe,
    });
  } catch (error) {
    console.error("Error adding shoe:", error);

    if (error.name === "ValidationError") {
      const messages = Object.values(error.errors).map((err) => err.message);
      return res.status(400).json({
        message: "Database Validation Error",
        errors: messages,
      });
    }
    if (error.code === 11000) {
      const field = Object.keys(error.keyValue)[0];
      const value = error.keyValue[field];
      return res.status(409).json({
        message: `Conflict: '${value}' already exists for field '${field}'.`,
      });
    }

    next(error);
  }
};
