// controllers/addShoe.js

// Pastikan semua model di-import/require DI SINI dengan urutan yang benar
const Brand = require("../models/brand");
const Category = require("../models/category");
const shoesDB = require("../models/shoes"); // Model Shoes Anda
const mongoose = require("mongoose"); // Diperlukan untuk ObjectId.isValid

exports.addShoe = async (req, res, next) => {
  try {
    const {
      name,
      brand,
      category,
      image,
      price, // <<< Tetap dibutuhkan
      stock, // <<< Akan divalidasi kondisional
      variantAttributes,
      description,
      variants,
    } = req.body;

    // --- Validasi Dasar (Selalu Wajib) ---
    if (!name || typeof name !== "string" || name.trim() === "") {
      return res.status(400).json({
        message:
          "Validation Error: 'name' is required and must be a non-empty string.",
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

    // <<< PERUBAHAN DI SINI: Validasi 'price' selalu wajib
    if (typeof price !== "number" || price < 0) {
      return res.status(400).json({
        message:
          "Validation Error: 'price' is required and must be a non-negative number.",
      });
    }
    // >>> AKHIR PERUBAHAN

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

    // Fallback jika slug kosong setelah diproses (jika nama hanya karakter aneh)
    let finalSlug = generatedSlug || `shoe-${Date.now()}`;

    // Cek apakah slug yang dihasilkan sudah ada di database untuk mencegah duplikasi unik
    const existingShoeWithSlug = await shoesDB.findOne({ slug: finalSlug });
    if (existingShoeWithSlug) {
      // Jika ada konflik slug, tambahkan timestamp atau random string
      finalSlug = `${finalSlug}-${Date.now()}`; // Atau gunakan counter
    }

    // --- Siapkan objek data untuk model Mongoose ---
    const shoeData = {
      name: name.trim(),
      description: description.trim(),
      brand: brand,
      category: category,
      slug: finalSlug, // <-- SLUG DITAMBAHKAN DI SINI
      image: image ? image.trim() : undefined,
      price: price, // <<< Harga selalu disertakan
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

        // Validasi bahwa semua attributeName dari variantAttributes ada di optionValues
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
        // Validasi jumlah optionValues harus sama dengan jumlah variantAttributes
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
      // Validasi 'price' sudah dipindahkan ke atas, jadi tidak perlu di sini lagi.

      // Validasi 'stock' tetap di sini karena ini field kondisional di skema
      if (typeof stock !== "number" || stock < 0) {
        return res.status(400).json({
          message:
            "Validation Error: 'stock' is required and must be a non-negative number when no variant attributes are provided.",
        });
      }
      Object.assign(shoeData, { stock }); // Hanya tambahkan stock
    }

    const newShoe = new shoesDB(shoeData);
    const savedShoe = await newShoe.save();

    const populatedShoe = await shoesDB
      .findById(savedShoe._id)
      .populate("brand", "name slug logoUrl")
      .populate("category", "name slug");

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
