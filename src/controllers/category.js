const Category = require("../models/category"); // Pastikan path ini benar ke file Category.js Anda

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
