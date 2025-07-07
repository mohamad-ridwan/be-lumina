const LatestOffer = require("../models/latestOffers"); // Pastikan nama model sesuai (LatestOffer, bukan LatestOffers)

exports.getOffers = async (req, res, next) => {
  try {
    // Ambil nilai 'slug' dari query parameter
    const slug = req.query.slug;

    // Inisialisasi variabel untuk hasil query
    let offers;
    let count;
    let message;

    if (slug) {
      // Jika slug disediakan, cari satu offer berdasarkan slug
      const offer = await LatestOffer.findOne({ slug: slug, isActive: true });

      if (!offer) {
        return res.status(404).json({
          success: false,
          message: `Penawaran dengan slug '${slug}' tidak ditemukan atau tidak aktif.`,
          data: null,
        });
      }

      offers = [offer]; // Bungkus hasil tunggal dalam array agar konsisten dengan format respons
      count = 1;
      message = `Berhasil mengambil penawaran dengan slug '${slug}'.`;
    } else {
      // Jika slug tidak disediakan, gunakan logika limit seperti sebelumnya
      const limit = parseInt(req.query.limit, 10) || 10;
      const queryLimit = limit > 0 ? limit : 10;

      offers = await LatestOffer.find({ isActive: true })
        .sort({ createdAt: -1 }) // Urutkan dari terbaru
        .limit(queryLimit); // Terapkan limit dari query

      count = offers.length;
      message = "Berhasil mengambil data offers.";
    }

    // Kirim respons sukses
    res.status(200).json({
      success: true,
      count: count,
      message: message,
      data: offers,
    });
  } catch (error) {
    // Tangani error jika terjadi
    console.error("Error fetching offers:", error);
    // Periksa jika error adalah CastError (misalnya, jika ID tidak valid jika nanti Anda menambahkan fitur getById)
    if (error.name === "CastError") {
      return res.status(400).json({
        success: false,
        message: "Format parameter tidak valid.",
        error: error.message,
      });
    }
    res.status(500).json({
      success: false,
      message: "Gagal mengambil data penawaran. Terjadi kesalahan server.",
      error: error.message, // Sertakan pesan error untuk debugging (opsional di produksi)
    });
  }
};

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
