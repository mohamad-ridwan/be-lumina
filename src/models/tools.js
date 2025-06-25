const mongoose = require("mongoose");

const Schema = mongoose.Schema;

const tools = new Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      unique: true, // Opsional: Pastikan nama fungsi unik di dalam array atau koleksi
    },
    description: {
      type: String,
      required: true,
      trim: true,
    },
    parameters: {
      // 'parameters' sendiri adalah objek, mengikuti spesifikasi OpenAPI/JSON Schema
      type: Object, // Menggunakan Object karena strukturnya dinamis
      required: true,
      // Anda bisa menambahkan validasi kustom di sini jika perlu,
      // misalnya memastikan 'type' adalah 'OBJECT' dan ada 'properties'
    },
  },
  {
    timestamp: true,
  }
);

module.exports = mongoose.model("tools", tools);
