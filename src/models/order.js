const mongoose = require("mongoose");
const { Schema } = mongoose;

const orderSchema = new Schema(
  {
    // Informasi Pengguna
    user: {
      type: Schema.Types.ObjectId,
      ref: "users",
      required: true,
      index: true, // Untuk memudahkan pencarian pesanan berdasarkan pengguna
    },
    // ID Pesanan Unik (untuk referensi eksternal, seperti URL berbagi)
    orderId: {
      type: String,
      unique: true,
      // Contoh: 'ORD-20250711-XYZ123ABC'
    },
    // Informasi Pengiriman (bisa dari profil user atau diisi saat checkout)
    shippingAddress: {
      fullName: { type: String, required: true, trim: true },
      street: { type: String, required: true, trim: true },
      city: { type: String, required: true, trim: true },
      province: { type: String, required: true, trim: true },
      postalCode: { type: String, required: true, trim: true },
      phoneNumber: { type: String, required: true, trim: true },
      email: { type: String, required: true, trim: true, lowercase: true }, // Untuk notifikasi
    },
    // Detail Item Pesanan (disimpan sebagai sub-dokumen agar pesanan utuh saat produk dihapus/berubah)
    items: [
      {
        shoe: {
          type: Schema.Types.ObjectId,
          ref: "shoes", // Referensi ke model sepatu, untuk detail produk saat ini
          required: true,
        },
        selectedVariantId: {
          type: Schema.Types.ObjectId,
          default: null,
        },
        // Snapshot detail produk saat dipesan
        name: { type: String, required: true },
        price: { type: Number, required: true, min: 0 }, // Harga per unit saat pesanan dibuat
        quantity: { type: Number, required: true, min: 1 },
        variant: {
          type: Object,
          default: null,
        },
        // Anda bisa tambahkan snapshot detail varian di sini jika perlu untuk riwayat
        // Misalnya:
        // variantOptionValues: { type: Map, of: String },
        // variantSku: { type: String },
        // imageUrl: { type: String }, // URL gambar varian/produk saat itu
      },
    ],
    // Ringkasan Harga
    subtotal: {
      type: Number,
      required: true,
      min: 0,
    },
    shippingCost: {
      type: Number,
      default: 0, // Jika ada biaya pengiriman (bisa diatur manual untuk demo)
      min: 0,
    },
    totalAmount: {
      type: Number,
      required: true,
      min: 0,
    },
    // Status Pesanan
    status: {
      type: String,
      enum: [
        "pending", // Pesanan diterima, menunggu proses
        "processing", // Sedang diproses (misal: menyiapkan barang)
        "shipped", // Sudah dikirim
        "delivered", // Sudah sampai tujuan
        "cancelled", // Dibatalkan
      ],
      default: "pending",
      required: true,
    },
    // Tanggal dan Waktu
    orderedAt: {
      type: Date,
      default: Date.now,
      required: true,
    },
    // Metode Pembayaran (meskipun tidak ada payment gateway, ini penting untuk rekaman)
    paymentMethod: {
      type: String,
      enum: ["COD", "Bank Transfer (Simulasi)", "Manual"], // Contoh metode simulasi
      default: "Manual",
      required: true,
    },
    // URL publik untuk melihat detail pesanan (sesuai permintaan Anda)
    publicOrderUrl: {
      type: String,
      unique: true,
    },
    // Catatan Internal (Opsional, untuk admin)
    notes: {
      type: String,
      trim: true,
      default: null,
    },
  },
  { timestamps: true } // createdAt dan updatedAt otomatis oleh Mongoose
);

// Middleware untuk membuat orderId unik sebelum penyimpanan
orderSchema.pre("save", async function (next) {
  if (this.isNew) {
    // Membuat ORDER ID yang unik (Anda bisa gunakan library seperti shortid atau custom logic)
    // Contoh sederhana (tidak sekuat UUID atau shortid, tapi cukup untuk demo)
    const datePart = new Date().toISOString().slice(0, 10).replace(/-/g, ""); // YYYYMMDD
    const randomPart = Math.random().toString(36).substring(2, 8).toUpperCase(); // Random string
    this.orderId = `ORD-${datePart}-${randomPart}`;

    // Anda juga bisa membuat publicOrderUrl di sini
    // Asumsikan base URL Anda adalah process.env.FRONTEND_URL
    this.publicOrderUrl = `${
      process.env.FRONTEND_URL || "http://localhost:3008"
    }/order/${this.orderId}`;
  }
  next();
});

module.exports = mongoose.model("order", orderSchema);
