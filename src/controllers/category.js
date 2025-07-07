const Category = require("../models/category"); // Pastikan path ini benar ke file Category.js Anda

exports.getCategories = async (req, res, next) => {
  try {
    const { limit, slug, level } = req.query; // Ambil limit, slug, DAN level dari query string

    let categoryLevel = null;
    if (slug) {
      const parsedLevel = parseInt(level, 10);
      if (parsedLevel === 0 || parsedLevel === 1) {
        categoryLevel = parsedLevel;
      } else {
        return res.status(400).json({
          success: false,
          message: "Invalid 'level' query parameter. Must be 0 or 1.",
        });
      }
    }

    // --- LOGIC UTAMA: FILTER BERDASARKAN SLUG ATAU AMBIL SEMUA DENGAN LIMIT ---
    if (slug) {
      // --- Case: Mengambil Kategori Spesifik berdasarkan SLUG ---
      const queryConditions = { slug: slug };
      // Jika level disediakan di query, tambahkan ke kondisi pencarian
      if (categoryLevel !== null) {
        queryConditions.level = categoryLevel;
      }

      const foundCategory = await Category.findOne(queryConditions).lean();

      if (!foundCategory) {
        // Pesan error lebih spesifik jika level tidak cocok
        let message = `Category with slug '${slug}' not found.`;
        if (categoryLevel !== null) {
          message = `Category with slug '${slug}' and level ${categoryLevel} not found.`;
        }
        return res.status(404).json({
          success: false,
          message: message,
          data: null,
        });
      }

      // Jika level disediakan di query dan tidak cocok dengan level kategori yang ditemukan
      if (categoryLevel !== null && foundCategory.level !== categoryLevel) {
        return res.status(400).json({
          success: false,
          message: `Category with slug '${slug}' found, but its level (${foundCategory.level}) does not match the requested level (${categoryLevel}).`,
        });
      }

      // Inisialisasi objek respons untuk kategori tunggal
      let singleCategoryResponse = {
        _id: foundCategory._id,
        name: foundCategory.name,
        slug: foundCategory.slug,
        description: foundCategory.description,
        imageUrl: foundCategory.imageUrl,
        level: foundCategory.level,
        createdAt: foundCategory.createdAt,
        updatedAt: foundCategory.updatedAt,
      };

      if (foundCategory.level === 0) {
        // Jika ini adalah Kategori Utama (Level 0)
        const collections = await Category.find({
          parentCategory: foundCategory._id,
          level: 1,
        }).lean();

        singleCategoryResponse.collections = collections.map((col) => ({
          _id: col._id,
          name: col.name,
          slug: col.slug,
          description: col.description,
          imageUrl: col.imageUrl,
        }));
      } else if (foundCategory.level === 1) {
        // Jika ini adalah Subkategori (Level 1)
        const parentCategoryData = await Category.findById(
          foundCategory.parentCategory
        ).lean();

        if (parentCategoryData) {
          singleCategoryResponse.parentCategory = {
            _id: parentCategoryData._id,
            name: parentCategoryData.name,
            slug: parentCategoryData.slug,
          };
        } else {
          console.warn(
            `Parent category for subcategory ${foundCategory.name} (ID: ${foundCategory._id}) not found.`
          );
          singleCategoryResponse.parentCategory = null;
        }
      }

      // Kirim respons untuk kategori tunggal
      return res.status(200).json({
        success: true,
        message: "Category fetched successfully.",
        category: singleCategoryResponse,
      });
    } else {
      // --- Case: Mengambil Daftar Kategori (tanpa slug, dengan limit & level opsional) ---
      const fetchLimit = parseInt(limit) || null;

      const listQueryConditions = {};
      // Jika level disediakan di query, terapkan sebagai filter utama
      if (categoryLevel !== null) {
        listQueryConditions.level = categoryLevel;
      } else {
        // Jika level tidak disediakan, default ke level 0 seperti sebelumnya
        listQueryConditions.level = 0;
      }

      const totalCategories = await Category.countDocuments(
        listQueryConditions
      );

      let categoriesQuery = Category.find(listQueryConditions);
      if (fetchLimit) {
        categoriesQuery = categoriesQuery.limit(fetchLimit);
      }
      const foundCategories = await categoriesQuery.lean();

      let formattedCategories = [];

      if (categoryLevel === 0 || categoryLevel === null) {
        // Jika yang diminta level 0 (atau tidak ditentukan, default ke 0)
        // Ambil semua subkategori (level 1) untuk dihubungkan
        const subCategories = await Category.find({ level: 1 }).lean();

        formattedCategories = foundCategories.map((mainCat) => {
          const collections = subCategories.filter(
            (subCat) =>
              subCat.parentCategory &&
              subCat.parentCategory.toString() === mainCat._id.toString()
          );

          return {
            _id: mainCat._id,
            name: mainCat.name,
            slug: mainCat.slug,
            description: mainCat.description,
            imageUrl: mainCat.imageUrl,
            level: mainCat.level, // Tambahkan level ke respons
            collections: collections.map((col) => ({
              _id: col._id,
              name: col.name,
              slug: col.slug,
              description: col.description,
              imageUrl: col.imageUrl,
              level: col.level, // Tambahkan level ke subkategori
            })),
          };
        });
      } else if (categoryLevel === 1) {
        // Jika yang diminta level 1
        formattedCategories = await Promise.all(
          foundCategories.map(async (subCat) => {
            let parentCategoryData = null;
            if (subCat.parentCategory) {
              parentCategoryData = await Category.findById(
                subCat.parentCategory
              ).lean();
            }
            return {
              _id: subCat._id,
              name: subCat.name,
              slug: subCat.slug,
              description: subCat.description,
              imageUrl: subCat.imageUrl,
              level: subCat.level, // Tambahkan level ke respons
              parentCategory: parentCategoryData
                ? {
                    _id: parentCategoryData._id,
                    name: parentCategoryData.name,
                    slug: parentCategoryData.slug,
                  }
                : null,
            };
          })
        );
      }

      res.status(200).json({
        success: true,
        message: "Categories fetched successfully",
        total: totalCategories,
        limit: fetchLimit,
        categories: formattedCategories,
      });
    }
  } catch (error) {
    console.error("Error in getCategories:", error);
    if (error.name === "CastError") {
      return res.status(400).json({
        success: false,
        message: "Invalid ID format.",
        error: error.message,
      });
    }
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
