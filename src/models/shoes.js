const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const shoesSchema = new Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      minlength: 2, // Minimal panjang nama 2 karakter
    },
    price: {
      type: Number,
      required: true,
      min: 0, // Harga tidak boleh negatif
    },
    size: {
      type: [String], // Array of Strings, karena sepatu bisa punya banyak ukuran (misal: "39", "40", "41")
      required: true,
      // Anda bisa menambahkan enum jika ukuran sepatu terbatas pada daftar tertentu
      // enum: ["38", "39", "40", "41", "42", "43", "44"]
    },
    variant: {
      type: String,
      required: true,
      trim: true,
      // Contoh: "Merah", "Biru", "Hitam", "Putih-Strip-Hijau"
    },
    stock: {
      type: Number,
      required: true,
      min: 0, // Stok tidak boleh negatif
      default: 0, // Default stok adalah 0 jika tidak diberikan
    },
  },
  {
    timestamps: true, // Otomatis menambahkan createdAt dan updatedAt
  }
);

module.exports = mongoose.model("shoes", shoesSchema);
