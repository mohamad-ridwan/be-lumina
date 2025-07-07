const LatestOffer = require("../models/latestOffers"); // Pastikan nama model sesuai (LatestOffer, bukan LatestOffers)

exports.add = async (req, res, next) => {
  try {
    // Dapatkan data dari body request
    const { label, title, description, imageUrl, slug } = req.body;

    // Validasi dasar input
    if (!label || !title || !imageUrl) {
      return res.status(400).json({
        success: false,
        message: "Label, title, and imageUrl are required fields.",
      });
    }

    // Buat instance LatestOffer baru
    const newOffer = new LatestOffer({
      label,
      title,
      description, // Description bersifat opsional sesuai skema (tidak required)
      imageUrl,
      slug,
      // slug akan otomatis dibuat oleh pre-save hook
      // isActive akan otomatis default ke true
    });

    // Simpan penawaran baru ke database
    const savedOffer = await newOffer.save();

    res.status(201).json({
      success: true,
      message: "Latest offer added successfully!",
      offer: savedOffer, // Kembalikan data penawaran yang baru disimpan
    });
  } catch (error) {
    // Tangani error, misalnya jika slug tidak unik atau validasi lain gagal
    if (error.code === 11000) {
      // Kode error MongoDB untuk duplikat key (unique fields)
      return res.status(409).json({
        success: false,
        message:
          "Offer with this title (or generated slug) already exists. Please use a unique title.",
        error: error.message,
      });
    }
    if (error.name === "ValidationError") {
      // Error dari validasi Mongoose (minlength, required dll)
      const errors = Object.values(error.errors).map((err) => err.message);
      return res.status(400).json({
        success: false,
        message: "Validation failed.",
        errors: errors,
      });
    }

    console.error("Error adding latest offer:", error);
    res.status(500).json({
      success: false,
      message: "Failed to add latest offer.",
      error: error.message,
    });
  }
};
