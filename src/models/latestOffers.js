const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const latestOfferSchema = new Schema(
  {
    label: {
      type: String,
      trim: true,
      maxlength: 50, // Opsional: Batasi panjang label
      required: true, // Label seringkali penting untuk identifikasi singkat
    },
    title: {
      type: String,
      required: true,
      trim: true,
      minlength: 5,
      maxlength: 100, // Judul banner biasanya tidak terlalu panjang
    },
    description: {
      type: String,
      trim: true,
      maxlength: 500, // Deskripsi singkat untuk banner
    },
    imageUrl: {
      type: String,
      trim: true,
      required: true, // Banner pasti butuh gambar
    },
    slug: {
      type: String,
      unique: true, // Slug harus unik untuk navigasi URL
      lowercase: true,
      trim: true,
    },
    isActive: {
      // Untuk mengontrol apakah banner aktif atau tidak tanpa menghapusnya
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true, // Otomatis menambahkan createdAt dan updatedAt
  }
);

// Middleware Mongoose untuk membuat slug sebelum menyimpan (pre-save hook)
latestOfferSchema.pre("save", function (next) {
  if (this.slug) {
    next();
    return;
  }
  if (this.isModified("title") || this.isNew) {
    this.slug = this.title
      .toString()
      .toLowerCase()
      .trim()
      .replace(/\s+/g, "-") // Ganti spasi dengan tanda hubung
      .replace(/[^\w-]+/g, "") // Hapus semua non-word chars
      .replace(/--+/g, "-") // Ganti multiple dashes dengan single dash
      .replace(/^-+/, "") // Hapus dash dari awal
      .replace(/-+$/, ""); // Hapus dash dari akhir

    // Fallback jika slug kosong setelah diproses (misal judul sangat pendek atau non-alphanumeric)
    if (!this.slug) {
      this.slug = `offer-${Date.now()}`;
    }
  }
  next();
});

module.exports = mongoose.model("latestOffers", latestOfferSchema);
