const mongoose = require("mongoose");
const { Schema } = mongoose;

const cartSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: "users", required: true },
    shoe: { type: Schema.Types.ObjectId, ref: "shoes", required: true },
    selectedVariantId: { type: Schema.Types.ObjectId, default: null },
    name: { type: String, required: true },
    price: { type: Number, required: true, min: 0 },
    quantity: { type: Number, required: true, min: 1, default: 1 },
  },
  { timestamps: true }
);

/*  ⚠️  JANGAN ADA index unique apa pun di sini
    Jika sebelumnya pernah dipasang, hapus via mongo shell:
    db.carts.dropIndexes()
*/

module.exports = mongoose.model("cart", cartSchema);
