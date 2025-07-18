const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const shoesSchema = new Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      minlength: 2,
    },
    brand: {
      type: Schema.Types.ObjectId,
      ref: "brand",
      required: true,
    },
    label: {
      type: String,
    },
    newArrival: {
      type: Boolean,
    },
    description: {
      type: String,
      required: true, // Deskripsi sangat penting untuk AI
      trim: true,
      minlength: 20, // Minimal panjang deskripsi untuk memastikan detail yang cukup
      maxlength: 2000, // Maksimal panjang deskripsi
    },
    category: {
      type: [Schema.Types.ObjectId],
      ref: "categories",
      required: true,
      validate: {
        validator: function (v) {
          return Array.isArray(v) && v.length > 0;
        },
        message: "A shoe must belong to at least one category.",
      },
    },
    // --- Perbaikan untuk Slug ---
    slug: {
      type: String,
      // required: true, // <--- HAPUS BARIS INI atau ganti ke false
      unique: true,
      lowercase: true,
      trim: true,
    },
    image: {
      type: String,
    },

    // --- Conditional Fields Based on Variant Presence ---
    price: {
      type: Number,
      min: 0,
      validate: {
        validator: function (v) {
          return this.variantAttributes && this.variantAttributes.length > 0
            ? true
            : typeof v === "number" && v >= 0;
        },
        message: (props) =>
          `'price' is required and must be a non-negative number when no variant attributes are provided.`,
        type: "required",
      },
    },
    stock: {
      type: Number,
      min: 0,
      default: 0,
      validate: {
        validator: function (v) {
          return this.variantAttributes && this.variantAttributes.length > 0
            ? true
            : typeof v === "number" && v >= 0;
        },
        message: (props) =>
          `'stock' is required and must be a non-negative number when no variant attributes are provided.`,
        type: "required",
      },
    },
    variantAttributes: {
      type: [
        {
          name: { type: String, required: true },
          options: { type: [String], required: true },
        },
      ],
      validate: {
        validator: function (v) {
          return !v || v.length <= 2;
        },
        message: "A product can have at most 2 variant attributes.",
      },
    },
    variants: {
      type: [
        {
          optionValues: { type: Map, of: String, required: true },
          price: { type: Number, required: true, min: 0 },
          stock: { type: Number, required: true, min: 0, default: 0 },
          sku: { type: String, unique: true, sparse: true },
          imageUrl: { type: String },
        },
      ],
      validate: {
        validator: function (v) {
          if (this.variantAttributes && this.variantAttributes.length > 0) {
            return Array.isArray(v) && v.length > 0;
          }
          return true;
        },
        message: (props) =>
          `'variants' are required and must be a non-empty array of variant objects when 'variantAttributes' are provided.`,
        type: "required",
      },
    },
    relatedOffers: {
      type: [Schema.Types.ObjectId],
      ref: "latestOffers",
      default: [],
    },
    isRefundable: { type: Boolean },
    refundPercentage: {
      type: Number,
      min: 0,
      max: 100,
    },
  },
  {
    timestamps: true,
  }
);

// Middleware Mongoose untuk membuat slug sebelum menyimpan (pre-save hook)
shoesSchema.pre("save", function (next) {
  if (this.isModified("name") || this.isNew) {
    this.slug = this.name
      .toString()
      .toLowerCase()
      .trim()
      .replace(/\s+/g, "-")
      .replace(/[^\w-]+/g, "")
      .replace(/--+/g, "-")
      .replace(/^-+/, "")
      .replace(/-+$/, "");

    // Fallback jika slug kosong setelah diproses
    if (!this.slug) {
      this.slug = `shoe-${Date.now()}`;
    }
  }
  next();
});

module.exports = mongoose.model("shoes", shoesSchema);
