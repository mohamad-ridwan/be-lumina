const Category = require("../models/category"); // Pastikan path ini benar ke file Category.js Anda

exports.getCategories = async (req, res, next) => {
  try {
    const categories = await Category.find({}).lean(); // Ambil semua kategori dari database

    // Peta untuk menyimpan kategori utama dan subkategorinya
    const categoryMap = new Map(); // Key: _id kategori, Value: objek kategori

    // Tahap 1: Inisialisasi kategori utama dan tambahkan parentCategory ke map
    categories.forEach((cat) => {
      // Pastikan parentCategory diubah menjadi string jika itu ObjectId
      cat.parentCategory = cat.parentCategory
        ? cat.parentCategory.toString()
        : null;

      // Jika level 0 (kategori utama), inisialisasi dengan array subCategories kosong
      if (cat.level === 0) {
        categoryMap.set(cat._id.toString(), {
          _id: cat._id,
          name: cat.name,
          slug: cat.slug,
          description: cat.description,
          imageUrl: cat.imageUrl,
          // parentCategory: cat.parentCategory, // Tidak perlu ditampilkan untuk kategori utama
          // level: cat.level, // Tidak perlu ditampilkan
          subCategories: [], // Inisialisasi array untuk subkategori
        });
      } else {
        // Untuk kategori level 1 (subkategori), tambahkan ke map apa adanya dulu
        categoryMap.set(cat._id.toString(), {
          _id: cat._id,
          name: cat.name,
          slug: cat.slug,
          description: cat.description,
          imageUrl: cat.imageUrl,
          parentCategory: cat.parentCategory,
          // level: cat.level, // Tidak perlu ditampilkan
        });
      }
    });

    // Tahap 2: Masukkan subkategori ke dalam kategori induknya
    categoryMap.forEach((cat) => {
      if (cat.parentCategory) {
        // Jika ini adalah subkategori
        const parentId = cat.parentCategory;
        const parentCategory = categoryMap.get(parentId);
        if (parentCategory && parentCategory.subCategories) {
          // Buat objek subkategori yang hanya berisi field yang diinginkan
          const subCategoryData = {
            _id: cat._id,
            name: cat.name,
            slug: cat.slug,
            description: cat.description,
            imageUrl: cat.imageUrl,
            // parentCategory dan level tidak perlu di sini lagi
          };
          parentCategory.subCategories.push(subCategoryData);
        } else {
          console.warn(
            `Parent category with ID ${parentId} not found or not a main category for subcategory ${cat.name}`
          );
        }
      }
    });

    // Tahap 3: Filter hanya kategori utama (level 0) yang memiliki subCategories
    // dan pastikan mereka dikembalikan dalam format array
    const finalCategories = Array.from(categoryMap.values()).filter(
      (cat) => !cat.parentCategory
    );

    res.status(200).json({
      success: true,
      message: "Categories fetched successfully",
      categories: finalCategories, // Mengembalikan array kategori utama dengan subkategori
    });
  } catch (error) {
    console.error("Error in getCategories:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch categories",
      error: error.message,
    });
  }
};

exports.addCategory = async (req, res, next) => {
  try {
    const { name, description, imageUrl, parentCategory } = req.body; // <<< TAMBAHKAN parentCategory DI SINI

    // --- Validasi Input dari Request Body ---
    if (!name || typeof name !== "string" || name.trim() === "") {
      return res.status(400).json({
        message:
          "Validation Error: 'name' is required and must be a non-empty string.",
      });
    }

    // Periksa apakah kategori dengan nama yang sama sudah ada (case-insensitive)
    const existingCategoryByName = await Category.findOne({
      name: { $regex: new RegExp(`^${name.trim()}$`, "i") },
    });
    if (existingCategoryByName) {
      return res.status(409).json({
        message: `Conflict: Category with name '${name}' already exists.`,
      });
    }

    // Instansiasi model Category baru
    const newCategory = new Category({
      name: name.trim(),
      description: description ? description.trim() : undefined,
      imageUrl: imageUrl ? imageUrl.trim() : undefined,
      // --- TAMBAHKAN parentCategory KE INSTANSIASI ---
      // Hanya tambahkan jika parentCategory diberikan di body, jika tidak biarkan undefined/null
      // Mongoose akan menangani `default: null` dan logika `level` di pre-save hook.
      parentCategory: parentCategory || undefined,
    });

    // Slug dan level akan otomatis dibuat/divalidasi oleh pre-save hook di skema

    // Simpan kategori baru ke database
    const savedCategory = await newCategory.save();

    // Kirim respons sukses
    res.status(201).json({
      message: "Category added successfully!",
      category: savedCategory,
    });
  } catch (error) {
    console.error("Error adding category:", error);

    if (error.name === "ValidationError") {
      const messages = Object.values(error.errors).map((err) => err.message);
      // Tangani pesan error spesifik dari validasi level/parentCategory
      if (
        error.message.includes(
          "Sub-categories can only be nested one level deep"
        )
      ) {
        return res.status(400).json({
          message: "Validation Error: " + error.message,
          errors: messages,
        });
      }
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
