const Category = require("../models/category"); // Pastikan path ini benar ke file Category.js Anda

exports.getCategories = async (req, res, next) => {
  try {
    // Ambil parameter limit dari query string
    const { limit } = req.query;
    const fetchLimit = parseInt(limit) || null; // Jika limit tidak valid atau tidak ada, set ke null agar tidak membatasi

    // Hitung total kategori utama (level 0) untuk paginasi yang akurat
    // Penting: Kita hitung total sebelum menerapkan limit pada pengambilan data
    const totalMainCategories = await Category.countDocuments({ level: 0 });

    // Ambil kategori utama dengan atau tanpa limit
    let mainCategoriesQuery = Category.find({ level: 0 });
    if (fetchLimit) {
      mainCategoriesQuery = mainCategoriesQuery.limit(fetchLimit);
    }
    const mainCategories = await mainCategoriesQuery.lean();

    // Ambil semua subkategori (level 1) tanpa limit, karena kita perlu semua untuk mengaitkan
    const subCategories = await Category.find({ level: 1 }).lean();

    // Peta untuk menyimpan kategori utama dan subkategorinya (struktur yang sudah diformat)
    const formattedCategoryMap = new Map();

    // Tahap 1: Inisialisasi kategori utama yang diambil dengan array subCategories kosong
    mainCategories.forEach((cat) => {
      formattedCategoryMap.set(cat._id.toString(), {
        _id: cat._id,
        name: cat.name,
        slug: cat.slug,
        description: cat.description,
        imageUrl: cat.imageUrl,
        subCategories: [], // Inisialisasi array untuk subkategori
      });
    });

    // Tahap 2: Masukkan subkategori ke dalam kategori induknya
    subCategories.forEach((subCat) => {
      // Pastikan parentCategory diubah menjadi string jika itu ObjectId
      const parentId = subCat.parentCategory
        ? subCat.parentCategory.toString()
        : null;
      if (parentId) {
        // Jika ini adalah subkategori dan memiliki parentId
        const parentCategory = formattedCategoryMap.get(parentId);
        if (parentCategory && parentCategory.subCategories) {
          // Buat objek subkategori yang hanya berisi field yang diinginkan
          const subCategoryData = {
            _id: subCat._id,
            name: subCat.name,
            slug: subCat.slug,
            description: subCat.description,
            imageUrl: subCat.imageUrl,
          };
          parentCategory.subCategories.push(subCategoryData);
        } else {
          // Ini bisa terjadi jika subkategori memiliki parent yang tidak termasuk dalam batch mainCategories yang diambil (karena limit)
          // Atau jika parentId mengarah ke non-main category (seharusnya tidak terjadi dengan level:0 filter di atas)
          console.warn(
            `Parent category with ID ${parentId} not found or not a main category for subcategory ${subCat.name}`
          );
        }
      }
    });

    // Tahap 3: Ambil kategori utama yang sudah diformat dari map
    const finalCategories = Array.from(formattedCategoryMap.values());

    res.status(200).json({
      success: true,
      message: "Categories fetched successfully",
      total: totalMainCategories, // Total kategori utama yang tersedia
      limit: fetchLimit, // Limit yang diterapkan (atau null jika tidak ada)
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
