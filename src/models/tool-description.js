const mongoose = require("mongoose");

const Schema = mongoose.Schema;

const toolDescription = new Schema(
  {
    // Nama tool (misal: "searchShoes", "clarification")
    name: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    // Deskripsi singkat tool, yang akan di-embed
    description: {
      type: String,
      required: true,
      trim: true,
    },
    // Vektor embedding dari deskripsi
    embedding: {
      type: [Number],
      required: false, // Akan diisi saat proses embedding
    },
  },
  {
    timestamp: true,
  }
);

module.exports = mongoose.model("tool-description", toolDescription);
