const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const categorySchema = new Schema(
  {
    name: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      minlength: 2,
    },
    slug: {
      type: String,
      unique: true,
      lowercase: true,
      trim: true,
    },
    description: {
      type: String,
      trim: true,
    },
    imageUrl: {
      type: String,
      trim: true,
    },
    parentCategory: {
      type: String,
      ref: "categories", // Pastikan ini konsisten dengan nama model di module.exports
      default: null,
    },
    level: {
      type: Number,
      default: 0,
      min: 0,
      max: 1,
    },
    isPopular: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  }
);

categorySchema.pre("save", async function (next) {
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

    if (!this.slug) {
      this.slug = Date.now().toString();
    }

    if (this.parentCategory) {
      try {
        console.log(
          "Attempting to find parentCategory with ID:",
          this.parentCategory
        ); // DEBUGGING LINE 1
        console.log("Type of parentCategory:", typeof this.parentCategory); // DEBUGGING LINE 2

        // Gunakan findById langsung tanpa toString(), atau findOne
        const parent = await mongoose
          .model("categories")
          .findOne({ _id: this.parentCategory });
        // Atau jika Anda prefer findOne:
        // const parent = await mongoose.model("category").findOne({ _id: this.parentCategory });

        if (!parent) {
          console.error(
            "DEBUG: Parent category not found for ID:",
            this.parentCategory
          ); // DEBUGGING LINE 3
          return next(new Error("Parent category not found."));
        }

        console.log(
          "DEBUG: Found parent category:",
          parent.name,
          "with level:",
          parent.level
        ); // DEBUGGING LINE 4

        if (parent.level === 0) {
          this.level = 1;
        } else {
          return next(
            new Error(
              "Sub-categories can only be nested one level deep. Parent category must be a top-level category."
            )
          );
        }
      } catch (err) {
        console.error(
          "DEBUG: Error during parent category lookup:",
          err.message
        ); // DEBUGGING LINE 5
        // Menambahkan validasi jika ID tidak valid ObjectId
        if (err.name === "CastError" && err.path === "_id") {
          return next(
            new Error(
              `Invalid parent category ID format: ${this.parentCategory}`
            )
          );
        }
        return next(err);
      }
    } else {
      this.level = 0;
    }
  }
  next();
});

module.exports = mongoose.model("categories", categorySchema);
