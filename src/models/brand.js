const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const brandSchema = new Schema(
  {
    name: {
      type: String,
      required: true,
      unique: true, // Nama merek harus unik
      trim: true,
      minlength: 1, // Nama merek tidak boleh kosong
    },
    slug: {
      type: String,
      // required: true, // <--- HAPUS BARIS INI atau ganti ke false
      unique: true, // Slug tetap harus unik
      lowercase: true,
      trim: true,
    },
    description: {
      type: String,
      trim: true,
      maxlength: 500,
    },
    logoUrl: {
      type: String,
      trim: true,
    },
    websiteUrl: {
      type: String,
      trim: true,
    },
    countryOfOrigin: {
      type: String,
      trim: true,
    },
  },
  {
    timestamps: true,
  }
);

// Middleware Mongoose untuk membuat slug sebelum menyimpan (pre-save hook)
brandSchema.pre("save", function (next) {
  if (this.isModified("name") || this.isNew) {
    this.slug = this.name
      .toString()
      .toLowerCase()
      .trim()
      .replace(/\s+/g, "-") // Ganti spasi dengan tanda hubung
      .replace(/[^\w-]+/g, "") // Hapus semua kecuali kata dan tanda hubung
      .replace(/--+/g, "-") // Ganti beberapa tanda hubung dengan satu
      .replace(/^-+/, "") // Hapus tanda hubung di awal string
      .replace(/-+$/, ""); // Hapus tanda hubung di akhir string

    // Fallback jika slug kosong setelah diproses (misal: nama hanya karakter aneh)
    if (!this.slug) {
      this.slug = `brand-${Date.now()}`; // Tambahkan prefix untuk kejelasan
    }
  }
  next();
});

module.exports = mongoose.model("brand", brandSchema);
