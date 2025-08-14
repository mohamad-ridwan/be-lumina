// controllers/addShoe.js

// Pastikan semua model di-import/require DI SINI dengan urutan yang benar
const Brand = require("../models/brand");
const Category = require("../models/category");
const shoesDB = require("../models/shoes"); // Model Shoes Anda
const LatestOffers = require("../models/latestOffers");
const mongoose = require("mongoose"); // Diperlukan untuk ObjectId.isValid
const { getEmbedding } = require("../utils/embeddings");
const { stripHtml } = require("../helpers/general");
const { HumanMessage } = require("@langchain/core/messages");
const { toolsByName } = require("../tools/langChainTools");
const { extractProductInfo } = require("../tools/function/shoes");
const { langChainModel } = require("../services/ai/gemini.service");

exports.updateSpecs = async (req, res) => {
  const { _id } = req.query;

  try {
    if (!_id) {
      return res.status(400).json({ error: "ID sepatu tidak boleh kosong." });
    }

    // 1. Ambil data sepatu dari database dengan populasi brand dan category
    const shoe = await shoesDB
      .findById(_id)
      .populate("brand")
      .populate("category");
    if (!shoe) {
      return res
        .status(404)
        .json({ error: `Sepatu dengan ID ${_id} tidak ditemukan.` });
    }

    // 2. Siapkan input tambahan untuk AI
    const cleanedDescription = stripHtml(shoe.description);
    const compactedDescription = cleanedDescription.replace(/\s+/g, " ").trim();
    const shoeName = shoe.name;
    const shoeBrand = shoe.brand ? shoe.brand.name : "Tidak Diketahui";
    const shoeCategory = shoe.category
      ? shoe.category.map((cat) => cat.name).join(", ")
      : "Tidak Diketahui";

    // 3. Masukkan semua informasi ke dalam prompt AI
    const prompt = new HumanMessage(`
    Ekstrak informasi produk dari data berikut:

      - Nama Produk: ${shoeName}
      - Merek: ${shoeBrand}
      - Kategori: ${shoeCategory}
      - Deskripsi: ${compactedDescription}
    `);

    // 4. Panggil model AI dengan tool binding
    const modelTools = langChainModel.bindTools([
      toolsByName.extractProductInfo,
    ]);
    const messages = [prompt];
    const aiMessage = await modelTools.invoke(messages);

    // 5. Proses tool call dari AI
    let updatedShoeData = null;
    for (const toolCall of aiMessage.tool_calls) {
      // Dapatkan argumen yang sudah diekstrak oleh AI dari tool call
      const extractedData = toolCall.args;
      console.log("Data yang diekstrak oleh AI:", extractedData);

      // Gunakan fungsi update database Anda
      updatedShoeData = await extractProductInfo(_id, extractedData);
    }

    // 6. Berikan respons sukses ke klien
    return res.status(200).json({
      message: "Spesifikasi sepatu berhasil diperbarui.",
      updatedShoe: updatedShoeData,
    });
  } catch (error) {
    console.error("Gagal memperbarui spesifikasi sepatu:", error);
    return res.status(500).json({
      error: "Terjadi kesalahan internal saat memperbarui spesifikasi.",
      details: error.message,
    });
  }
};

exports.updateManyShoeVariants = async (req, res) => {
  try {
    const { products } = req.body; // Ambil array products dari body

    // 1. Validasi Input
    if (!products || !Array.isArray(products) || products.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Array 'products' tidak valid atau kosong.",
      });
    }

    // 2. Siapkan Operasi Pembaruan Massal
    const bulkOperations = products.map((product) => {
      // Pastikan setiap objek produk memiliki _id dan variants
      if (!product._id || !product.variants) {
        throw new Error(
          "Setiap objek produk harus memiliki '_id' dan 'variants'."
        );
      }
      return {
        updateOne: {
          filter: { _id: product._id },
          update: { $set: { variants: product.variants } },
        },
      };
    });

    // 3. Jalankan Operasi Pembaruan Massal
    const updateResult = await shoesDB.bulkWrite(bulkOperations);

    // 4. Tangani Hasil Pembaruan
    if (updateResult.modifiedCount === 0) {
      return res.status(404).json({
        success: false,
        message: "Tidak ada sepatu yang ditemukan atau diperbarui.",
        data: updateResult,
      });
    }

    // 5. Kirim Respons Sukses
    return res.status(200).json({
      success: true,
      message: `${updateResult.modifiedCount} sepatu berhasil diperbarui.`,
      data: updateResult,
    });
  } catch (error) {
    console.error("Error saat memperbarui varian sepatu:", error);
    return res.status(500).json({
      success: false,
      message:
        error.message || "Terjadi kesalahan server saat memproses permintaan.",
    });
  }
};

const updateSingleShoeEmbedding = async (shoeId) => {
  const shoe = await shoesDB
    .findById(shoeId)
    .populate("brand", "name")
    .populate("category", "name")
    .populate("relatedOffers", "title");

  if (!shoe) {
    console.warn(`Peringatan: Sepatu dengan ID ${shoeId} tidak ditemukan.`);
    return null;
  }

  // --- Ambil info brand & kategori ---
  const brandName = shoe.brand ? shoe.brand.name : "";
  const categoryNames = Array.isArray(shoe.category)
    ? shoe.category.map((cat) => cat.name).join(", ")
    : "";
  const offerTitles = shoe.relatedOffers
    ? shoe.relatedOffers.map((offer) => offer.title).join(", ")
    : "";

  // --- Ringkas varian ---
  let variantInfo = "";
  if (Array.isArray(shoe.variants) && shoe.variants.length > 0) {
    const uniqueOptionValues = new Map();

    for (const variant of shoe.variants) {
      const optionValuesArray = !Array.isArray(variant.optionValues)
        ? Object.entries(variant.optionValues || {}).map(([key, value]) => ({
            key,
            value,
          }))
        : variant.optionValues;

      for (const option of optionValuesArray) {
        if (!uniqueOptionValues.has(option.key)) {
          uniqueOptionValues.set(option.key, new Set());
        }
        uniqueOptionValues.get(option.key).add(option.value);
      }
    }

    const variantParts = [];
    for (const [key, values] of uniqueOptionValues.entries()) {
      variantParts.push(`${key}: ${Array.from(values).join(", ")}`);
    }

    if (variantParts.length > 0) {
      variantInfo = variantParts.join(", ") + ".";
    }
  }

  // --- Gabungkan specs ---
  let specsText = "";
  if (Array.isArray(shoe.specs) && shoe.specs.length > 0) {
    specsText = shoe.specs
      .map((s) => `${capitalizeFirstLetter(s.type)}: ${s.text}`)
      .join(" | ");
  }

  // --- Buat teks final untuk embedding ---
  let textToEmbed = `Nama: ${
    shoe.name
  } | Brand: ${brandName} | Kategori: ${categoryNames} | Penawaran: ${offerTitles}${
    variantInfo ? ` | Varian: ${variantInfo}` : ""
  } | ${specsText}
  `
    .replace(/\s+/g, " ")
    .trim();

  console.log(`[ID: ${shoeId}] TEXT TO EMBED: `, textToEmbed);

  // --- Generate embedding ---
  const newEmbedding = await getEmbedding(textToEmbed);
  if (!newEmbedding) {
    console.error(`Gagal membuat embedding baru untuk sepatu ID: ${shoeId}`);
    return null;
  }

  shoe.embedding = newEmbedding;
  await shoe.save();

  return shoeId;
};

// Helper: Kapitalisasi huruf pertama
function capitalizeFirstLetter(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

// --- Fungsi utama untuk API endpoint ---
exports.updateManyShoesEmbedding = async (req, res, next) => {
  try {
    const { ids } = req.body; // Menerima array ID dari body

    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({
        message:
          "Validation Error: 'ids' harus berupa array yang tidak kosong.",
      });
    }

    const invalidIds = ids.filter((id) => !mongoose.Types.ObjectId.isValid(id));
    if (invalidIds.length > 0) {
      return res.status(400).json({
        message: `Validation Error: Beberapa ID tidak valid: ${invalidIds.join(
          ", "
        )}`,
      });
    }

    console.log(`Memulai pembaruan embedding untuk ${ids.length} sepatu...`);
    const successfulUpdates = [];
    const failedUpdates = [];

    // Gunakan Promise.all untuk menjalankan pembaruan secara paralel
    const updatePromises = ids.map((id) =>
      updateSingleShoeEmbedding(id).then((result) => {
        if (result) {
          successfulUpdates.push(result);
        } else {
          failedUpdates.push(id);
        }
      })
    );

    await Promise.all(updatePromises);

    console.log(
      `Pembaruan selesai. Berhasil: ${successfulUpdates.length}, Gagal: ${failedUpdates.length}`
    );

    res.status(200).json({
      message: `Pembaruan embedding selesai. Berhasil: ${successfulUpdates.length}, Gagal: ${failedUpdates.length}.`,
      successfulUpdates,
      failedUpdates,
    });
  } catch (error) {
    console.error("Kesalahan saat memperbarui embedding banyak sepatu:", error);
    next(error);
  }
};

exports.getShoe = async (req, res, next) => {
  try {
    // Ambil ID atau slug dari parameter URL (misal: /shoes/:id atau /shoes/:slug)
    const { id, slug, category: categoryIdFromParams } = req.params;
    // Ambil newArrival, limit, offersId, page, sort, DAN search dari query string (req.query)
    const { newArrival, limit, offerId, page, sort, search } = req.query; // Tambahkan search di sini

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

      // --- LOGIKA SEARCH BARU ---
      // Ini diterapkan jika TIDAK ada ID, slug, offerId, atau categoryIdFromParams
      // dan akan digabungkan dengan newArrival jika ada.
      if (search) {
        const searchRegex = new RegExp(search, "i"); // 'i' untuk case-insensitive
        // Gunakan $or untuk mencari di beberapa field (name ATAU description)
        const brand_id = await Brand.findOne({ name: { $regex: searchRegex } });
        query.$or = [
          { name: { $regex: searchRegex } },
          { description: { $regex: searchRegex } },
        ];
        if (brand_id) {
          query.$or.push({ brand: { _id: brand_id._id } });
        }
      }
    }

    let shoes;
    let totalCount;
    let totalPages = 1; // Default totalPages untuk kasus single shoe

    // Logika pengambilan data sepatu
    if (id || slug) {
      // Case 1: Mengambil satu sepatu spesifik berdasarkan ID atau Slug
      // Query parameter search, page, limit, sort DIABAIKAN di sini
      // karena kita mencari satu item spesifik.
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
      // Case 2: Mengambil daftar sepatu (dengan filter, pagination, dan SORTING)
      totalCount = await shoesDB.countDocuments(query); // Hitung total dokumen yang cocok
      totalPages = Math.ceil(totalCount / fetchLimit); // Hitung total halaman

      let dbQuery = shoesDB.find(query);

      // --- LOGIKA SORTING ---
      let sortCriteria = {}; // Objek untuk menyimpan kriteria sorting

      if (sort) {
        switch (sort.toLowerCase()) {
          case "termurah":
            sortCriteria = { price: 1 };
            break;
          case "termahal":
            sortCriteria = { price: -1 };
            break;
          case "terbaru":
            sortCriteria = { createdAt: -1 };
            break;
          default:
            sortCriteria = { createdAt: -1 };
            console.warn(
              `Invalid sort parameter: ${sort}. Defaulting to 'terbaru'.`
            );
            break;
        }
      } else {
        sortCriteria = { createdAt: -1 }; // Default ke terbaru
      }

      dbQuery = dbQuery.sort(sortCriteria); // Terapkan kriteria sorting ke query

      shoes = await dbQuery
        .skip(skip) // Terapkan skip untuk pagination
        .limit(fetchLimit) // Terapkan limit untuk pagination
        .populate("brand", "name")
        .populate("category", "name slug parentCategory level")
        .lean();
    }

    // --- Proses Pemformatan Hasil untuk Setiap Sepatu ---
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
            level: mainCat.level,
            subCategories: children.map((child) => ({
              _id: child._id,
              name: child.name,
              slug: child.slug,
              level: child.level,
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
              level: subCat.level,
            });
          }
        });
      }

      // --- LOGIKA VARIAN YANG DIPERBARUI ---
      if (shoe.variants && Array.isArray(shoe.variants)) {
        shoe.variants = shoe.variants.map((variant) => {
          if (variant.optionValues && Array.isArray(variant.optionValues)) {
            // Gunakan `reduce` untuk mengubah array menjadi objek
            variant.optionValues = variant.optionValues.reduce((obj, item) => {
              obj[item.key] = item.value;
              return obj;
            }, {});
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

    let responseData = {
      success: true,
      message: "Shoes fetched successfully.",
      total: totalCount,
      limit: fetchLimit,
      currentPage: currentPage,
      totalPages: totalPages,
      shoes: formattedShoes,
    };

    // Tambahkan kembali sort ke respons jika ada
    if (
      sort &&
      ["termurah", "termahal", "terbaru"].includes(sort.toLowerCase())
    ) {
      responseData.sort = sort.toLowerCase();
    }
    // Tambahkan search query ke respons jika ada
    if (search) {
      responseData.search = search;
    }

    res.status(200).json(responseData);
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
      relatedOffers,
      isRefundable,
      refundPercentage,
    } = req.body;

    // --- Validasi Dasar (Kode yang sudah ada) ---
    // ... (kode validasi yang sudah ada) ...
    if (!name || typeof name !== "string" || name.trim() === "") {
      return res.status(400).json({
        message:
          "Validation Error: 'name' is required and must be a non-empty string.",
      });
    }

    if (relatedOffers !== undefined) {
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
      if (relatedOffers.length > 0) {
        const existingOffers = await LatestOffers.find({
          _id: { $in: relatedOffers },
        });
        if (existingOffers.length !== relatedOffers.length) {
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

    // --- LOGIKA BARU UNTUK MENGHASILKAN EMBEDDING ---

    // 1. Dapatkan semua data teks yang relevan dari database.
    const populatedBrand = await Brand.findById(brand);
    const populatedCategories = await Category.find({ _id: { $in: category } });
    const populatedOffers = await LatestOffers.find({
      _id: { $in: relatedOffers || [] },
    });

    // 2. Kumpulkan informasi varian ke dalam satu string
    let variantInfo = "";
    const hasVariants = variantAttributes && variantAttributes.length > 0;
    if (hasVariants && variants && variants.length > 0) {
      // Buat deskripsi ringkas untuk setiap kombinasi varian
      const variantDescriptions = variants.map((v) => {
        // Gabungkan semua nilai opsi, contoh: "Warna: Putih, Ukuran: 40"
        const optionDetails = Object.entries(v.optionValues)
          .map(([key, value]) => `${key}: ${value}`)
          .join(", ");
        return `Varian: ${optionDetails}. Harga: ${v.price}. Stok: ${v.stock}.`;
      });
      variantInfo = variantDescriptions.join(" ");
    }

    // 3. Gabungkan semua teks dari berbagai field menjadi satu string.
    const brandName = populatedBrand ? populatedBrand.name : "";
    const categoryNames = populatedCategories.map((cat) => cat.name).join(", ");
    const offerTitles = populatedOffers.map((offer) => offer.title).join(", ");
    const cleanedDescription = stripHtml(description); // Hapus tag HTML

    const textToEmbed = `
      Nama: ${name}.
      Brand: ${brandName}.
      Kategori: ${categoryNames}.
      Penawaran: ${offerTitles}.
      Deskripsi: ${cleanedDescription}.
      Varian: ${variantInfo}.
    `;

    // 4. Hasilkan embedding menggunakan fungsi `getEmbedding`.
    const embedding = await getEmbedding(textToEmbed);
    if (!embedding) {
      console.error("Failed to generate embedding for the shoe.");
      return res.status(500).json({
        message: "Internal Server Error: Failed to generate embedding.",
      });
    }

    // --- Siapkan objek data untuk model Mongoose, termasuk embedding ---
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
      relatedOffers: relatedOffers || [],
      isRefundable: isRefundable,
      refundPercentage: refundPercentage,
      embedding: embedding, // <<< Tambahkan embedding ke data produk
    };

    // --- Logika Validasi Kondisional (Kode yang sudah ada) ---
    // ... (sisa logika validasi dan penugasan varian) ...
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
      if (typeof stock !== "number" || stock < 0) {
        return res.status(400).json({
          message:
            "Validation Error: 'stock' is required and must be a non-negative number when no variant attributes are provided.",
        });
      }
      Object.assign(shoeData, { stock });
    }
    // --- Akhir dari Logika Validasi Kondisional ---

    const newShoe = new shoesDB(shoeData);
    const savedShoe = await newShoe.save();

    const populatedShoe = await shoesDB
      .findById(savedShoe._id)
      .populate("brand", "name slug logoUrl")
      .populate("category", "name slug")
      .populate("relatedOffers", "title slug imageUrl");

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
