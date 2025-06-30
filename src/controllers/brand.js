const Brand = require("../models/brand"); // Pastikan path ini benar ke file Brand.js Anda

exports.addBrand = async (req, res, next) => {
  try {
    const { name, description, logoUrl, websiteUrl, countryOfOrigin } =
      req.body;

    // --- Validasi Input dari Request Body ---
    if (!name || typeof name !== "string" || name.trim() === "") {
      return res.status(400).json({
        message:
          "Validation Error: 'name' is required and must be a non-empty string.",
      });
    }

    // Periksa apakah merek dengan nama yang sama sudah ada (case-insensitive)
    const existingBrandByName = await Brand.findOne({
      name: { $regex: new RegExp(`^${name.trim()}$`, "i") }, // Pencarian case-insensitive
    });
    if (existingBrandByName) {
      return res.status(409).json({
        message: `Conflict: Brand with name '${name.trim()}' already exists.`,
      });
    }

    // Instansiasi model Brand baru
    const newBrand = new Brand({
      name: name.trim(), // Pastikan nama di-trim
      description: description ? description.trim() : undefined,
      logoUrl: logoUrl ? logoUrl.trim() : undefined,
      websiteUrl: websiteUrl ? websiteUrl.trim() : undefined,
      countryOfOrigin: countryOfOrigin ? countryOfOrigin.trim() : undefined,
    });

    // Slug akan otomatis dibuat oleh pre-save hook di skema

    // Simpan merek baru ke database
    const savedBrand = await newBrand.save();

    // Kirim respons sukses
    res.status(201).json({
      message: "Brand added successfully!",
      brand: savedBrand,
    });
  } catch (error) {
    console.error("Error adding brand:", error);

    // Penanganan Error Mongoose Validation
    if (error.name === "ValidationError") {
      const messages = Object.values(error.errors).map((err) => err.message);
      return res.status(400).json({
        message: "Database Validation Error",
        errors: messages,
      });
    }

    // Penanganan Duplicate Key Error (misalnya untuk slug atau nama yang unik)
    if (error.code === 11000) {
      const field = Object.keys(error.keyValue)[0];
      const value = error.keyValue[field];
      return res.status(409).json({
        message: `Conflict: '${value}' already exists for field '${field}'.`,
      });
    }

    // Penanganan Error Umum lainnya
    next(error); // Teruskan error ke middleware penanganan error global Anda
  }
};
