const shoesDB = require("../models/shoes"); // Pastikan ini mengarah ke model Mongoose Anda

exports.addShoe = async (req, res, next) => {
  try {
    // 1. Ekstrak data sepatu dari body request
    const { name, price, size, variant, stock } = req.body;

    // 2. Validasi Dasar (Sesuai dengan `required` di skema Mongoose)
    // Mongoose akan melakukan validasi skema yang lebih detail saat .save(),
    // tapi validasi awal di controller ini membantu memberikan feedback cepat ke klien.

    if (!name || typeof name !== "string" || name.trim() === "") {
      return res
        .status(400)
        .json({
          message:
            "Validation Error: 'name' is required and must be a non-empty string.",
        });
    }
    if (typeof price !== "number" || price < 0) {
      return res
        .status(400)
        .json({
          message:
            "Validation Error: 'price' is required and must be a non-negative number.",
        });
    }
    if (!size || !Array.isArray(size) || size.length === 0) {
      return res
        .status(400)
        .json({
          message:
            "Validation Error: 'size' is required and must be a non-empty array of strings.",
        });
    }
    // Opsional: Validasi setiap elemen 'size' adalah string
    if (size.some((s) => typeof s !== "string" || s.trim() === "")) {
      return res
        .status(400)
        .json({
          message: "Validation Error: Each 'size' must be a non-empty string.",
        });
    }
    if (!variant || typeof variant !== "string" || variant.trim() === "") {
      return res
        .status(400)
        .json({
          message:
            "Validation Error: 'variant' is required and must be a non-empty string.",
        });
    }
    if (typeof stock !== "number" || stock < 0) {
      return res
        .status(400)
        .json({
          message:
            "Validation Error: 'stock' is required and must be a non-negative number.",
        });
    }

    // 3. Buat instance model `shoesDB` baru dengan data yang diterima
    const newShoe = new shoesDB({
      name,
      price,
      size,
      variant,
      stock,
    });

    // 4. Simpan sepatu baru ke database
    const savedShoe = await newShoe.save();

    // 5. Kirim respons sukses
    res.status(201).json({
      message: "Shoe added successfully!",
      shoe: savedShoe,
    });
  } catch (error) {
    console.error("Error adding shoe:", error);

    // Penanganan Error Mongoose Validation (jika ada error dari skema Mongoose)
    if (error.name === "ValidationError") {
      const messages = Object.values(error.errors).map((err) => err.message);
      return res.status(400).json({
        message: "Database Validation Error",
        errors: messages,
      });
    }

    // Penanganan Error Umum
    next(error); // Teruskan error ke middleware penanganan error global Anda
  }
};
