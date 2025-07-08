const Category = require("../models/category"); // Pastikan path ini benar ke file Category.js Anda

exports.getCategories = async (req, res, next) => {
  try {
    const { limit, slug, level, isPopular } = req.query; // Ambil isPopular dari query string

    let categoryLevel = null;
    // Pindahkan validasi level ke awal agar bisa digunakan oleh kedua branch (slug dan non-slug)
    if (level !== undefined) {
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

    // Konversi isPopular dari string ke boolean
    let filterByIsPopular = null;
    if (isPopular !== undefined) {
      if (isPopular === "true") {
        filterByIsPopular = true;
      } else if (isPopular === "false") {
        filterByIsPopular = false; // Jika Anda ingin memfilter yang isPopular: false juga
      } else {
        return res.status(400).json({
          success: false,
          message:
            "Invalid 'isPopular' query parameter. Must be 'true' or 'false'.",
        });
      }
    }

    // --- LOGIC UTAMA: FILTER BERDASARKAN SLUG ATAU AMBIL SEMUA DENGAN LIMIT ---
    if (slug) {
      // --- Case: Mengambil Kategori Spesifik berdasarkan SLUG ---
      // Perhatian: Jika 'isPopular=true' digunakan dengan 'slug', ini akan mencari
      // kategori spesifik DENGAN status popularitas tersebut. Ini TIDAK akan mengembalikan
      // semua kategori populer dalam satu array seperti permintaan Anda untuk daftar.
      // Jika tujuan Anda adalah 'slug' hanya untuk mencari satu item, dan
      // 'isPopular' hanya untuk daftar, maka logika ini sudah tepat.
      // Jika Anda ingin 'isPopular' selalu mem-flatten hasilnya, bahkan dengan slug,
      // maka logikanya perlu dirancang ulang secara lebih kompleks.
      // Untuk saat ini, asumsikan 'slug' akan mencari satu item spesifik.
      const queryConditions = { slug: slug };
      if (categoryLevel !== null) {
        queryConditions.level = categoryLevel;
      }
      if (filterByIsPopular !== null) {
        // Hanya terapkan filter isPopular jika tidak null
        queryConditions.isPopular = filterByIsPopular;
      }

      const foundCategory = await Category.findOne(queryConditions).lean();

      if (!foundCategory) {
        let message = `Category with slug '${slug}' not found.`;
        if (categoryLevel !== null) {
          message = `Category with slug '${slug}' and level ${categoryLevel} not found.`;
        }
        if (filterByIsPopular !== null) {
          message += ` (isPopular: ${filterByIsPopular})`;
        }
        return res.status(404).json({
          success: false,
          message: message,
          data: null,
        });
      }

      if (categoryLevel !== null && foundCategory.level !== categoryLevel) {
        return res.status(400).json({
          success: false,
          message: `Category with slug '${slug}' found, but its level (${foundCategory.level}) does not match the requested level (${categoryLevel}).`,
        });
      }
      if (
        filterByIsPopular !== null &&
        foundCategory.isPopular !== filterByIsPopular
      ) {
        return res.status(400).json({
          success: false,
          message: `Category with slug '${slug}' found, but its 'isPopular' status (${foundCategory.isPopular}) does not match the requested status (${filterByIsPopular}).`,
        });
      }

      let singleCategoryResponse = {
        _id: foundCategory._id,
        name: foundCategory.name,
        slug: foundCategory.slug,
        description: foundCategory.description,
        imageUrl: foundCategory.imageUrl,
        level: foundCategory.level,
        isPopular: foundCategory.isPopular,
        createdAt: foundCategory.createdAt,
        updatedAt: foundCategory.updatedAt,
      };

      if (foundCategory.level === 0) {
        // Ketika mencari berdasarkan slug, kita masih ingin subkategori di dalamnya
        // Namun, filter isPopular di sini hanya berlaku untuk kategori utama.
        // Jika Anda ingin hanya subkategori populer di sini, Anda perlu menambahkan filter isPopular di sini juga.
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
          isPopular: col.isPopular,
        }));
      } else if (foundCategory.level === 1) {
        const parentCategoryData = await Category.findById(
          foundCategory.parentCategory
        ).lean();

        if (parentCategoryData) {
          singleCategoryResponse.parentCategory = {
            _id: parentCategoryData._id,
            name: parentCategoryData.name,
            slug: parentCategoryData.slug,
            isPopular: parentCategoryData.isPopular,
          };
        } else {
          console.warn(
            `Parent category for subcategory ${foundCategory.name} (ID: ${foundCategory._id}) not found.`
          );
          singleCategoryResponse.parentCategory = null;
        }
      }

      return res.status(200).json({
        success: true,
        message: "Category fetched successfully.",
        category: singleCategoryResponse,
      });
    } else {
      // --- Case: Mengambil Daftar Kategori (tanpa slug, dengan limit & level opsional) ---
      const fetchLimit = parseInt(limit) || null;
      let listQueryConditions = {}; // Gunakan let agar bisa diubah

      // --- LOGIKA BARU UNTUK isPopular ---
      if (filterByIsPopular === true) {
        // Jika isPopular=true diminta
        listQueryConditions = { isPopular: true }; // Hanya filter kategori yang populer
        // Tidak perlu memfilter berdasarkan level di sini, karena kita ingin semua level populer
        // Jika level juga disertakan, maka itu akan menjadi filter tambahan
        if (categoryLevel !== null) {
          // Jika level juga diminta bersama isPopular=true
          listQueryConditions.level = categoryLevel;
        }
      } else {
        // Jika isPopular tidak diminta, atau isPopular=false
        // Pertahankan logika filtering level yang sudah ada
        if (categoryLevel !== null) {
          listQueryConditions.level = categoryLevel;
        } else {
          listQueryConditions.level = 0; // Default ke level 0 jika level tidak disediakan
        }
        // Tambahkan filter isPopular=false jika itu yang diminta secara eksplisit
        if (filterByIsPopular === false) {
          listQueryConditions.isPopular = false;
        }
      }

      const totalCategories = await Category.countDocuments(
        listQueryConditions
      );

      let categoriesQuery = Category.find(listQueryConditions);
      if (fetchLimit) {
        categoriesQuery = categoriesQuery.limit(fetchLimit);
      }
      // Tambahkan sort agar hasil selalu konsisten, misalnya berdasarkan nama
      categoriesQuery = categoriesQuery.sort({ name: 1 });

      const foundCategories = await categoriesQuery.lean();

      // Memformat kategori menjadi satu array datar
      let formattedCategories = foundCategories.map((cat) => ({
        _id: cat._id,
        name: cat.name,
        slug: cat.slug,
        description: cat.description,
        imageUrl: cat.imageUrl,
        level: cat.level,
        isPopular: cat.isPopular,
        // collections atau parentCategory tidak disertakan jika filterByIsPopular adalah true,
        // karena tujuannya adalah array datar dari kategori populer
        // Jika tidak ada filter isPopular, atau isPopular=false, Anda mungkin ingin tetap ada collections/parentCategory.
        // Untuk menyederhanakan, saya akan menghapus field ini jika filterByIsPopular true.
        // Pertimbangkan apakah Anda masih ingin parentCategory/collections muncul di sini jika isPopular=false.
        ...(filterByIsPopular === true
          ? {}
          : {
              // Jika isPopular=true, jangan sertakan collections/parentCategory
              parentCategory: cat.parentCategory
                ? {
                    _id: cat.parentCategory,
                    name: "Parent Name (if populated)",
                  }
                : null, // Anda mungkin perlu populate di sini jika ingin nama parent
            }),
      }));

      // --- Perbaikan untuk respons parentCategory jika level 1 diminta tanpa isPopular=true ---
      // Jika categoryLevel === 1 dan filterByIsPopular TIDAK true, maka kita perlu populate parentCategory
      if (categoryLevel === 1 && filterByIsPopular !== true) {
        formattedCategories = await Promise.all(
          formattedCategories.map(async (cat) => {
            if (cat.parentCategory && cat.parentCategory._id) {
              // Cek apakah parentCategory ada dan punya _id
              const parentData = await Category.findById(
                cat.parentCategory._id
              ).lean();
              if (parentData) {
                cat.parentCategory = {
                  _id: parentData._id,
                  name: parentData.name,
                  slug: parentData.slug,
                  isPopular: parentData.isPopular,
                };
              }
            }
            return cat;
          })
        );
      } else if (categoryLevel === 0 && filterByIsPopular !== true) {
        // Jika level 0 diminta tanpa filter isPopular, kita perlu menambahkan collections
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
            level: mainCat.level,
            isPopular: mainCat.isPopular,
            collections: collections.map((col) => ({
              _id: col._id,
              name: col.name,
              slug: col.slug,
              description: col.description,
              imageUrl: col.imageUrl,
              level: col.level,
              isPopular: col.isPopular,
            })),
          };
        });
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
    const { name, description, imageUrl, parentCategory, isPopular } = req.body; // <<< TAMBAHKAN parentCategory DI SINI

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
      isPopular: isPopular,
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
