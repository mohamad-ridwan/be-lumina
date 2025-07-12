const mongoose = require("mongoose");
const Cart = require("../models/cart"); // Pastikan path ini benar ke model Cart Anda
const Shoe = require("../models/shoes"); // Pastikan path ini benar ke model Shoe Anda
const Order = require("../models/order"); // Pastikan path ini benar ke model Order Anda

// Helper function to calculate total prices from cart items
// This can be reused if needed for other places, or kept inline for simplicity
const calculateOrderTotals = (cartItems) => {
  let subtotal = 0;
  cartItems.forEach((item) => {
    subtotal += item.price * item.quantity;
  });
  // Untuk demo, shippingCost bisa fixed atau 0. Di aplikasi nyata, ini dari kalkulasi
  const shippingCost = 0; // Anda bisa atur ini dari config atau input
  const totalAmount = subtotal + shippingCost;
  return { subtotal, shippingCost, totalAmount };
};

exports.createOrder = async (req, res, next) => {
  try {
    const { userId } = req.query; // Mengambil userId dari query parameter
    // Informasi pengiriman dari body request saat checkout
    const {
      shippingAddress,
      paymentMethod = "Manual", // Default ke 'Manual' jika tidak disediakan
      notes = null,
    } = req.body;

    // 1. Validasi Input Dasar
    if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({
        success: false,
        message: "Valid User ID is required in query parameters.",
      });
    }

    // Validasi informasi alamat pengiriman
    if (
      !shippingAddress ||
      !shippingAddress.fullName ||
      !shippingAddress.street ||
      !shippingAddress.city ||
      !shippingAddress.province ||
      !shippingAddress.postalCode ||
      !shippingAddress.phoneNumber ||
      !shippingAddress.email
    ) {
      return res.status(400).json({
        success: false,
        message:
          "All shipping address fields (fullName, street, city, province, postalCode, phoneNumber, email) are required.",
      });
    }

    // Validasi format email sederhana
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(shippingAddress.email)) {
      return res.status(400).json({
        success: false,
        message: "Invalid email format in shipping address.",
      });
    }

    // Validasi paymentMethod
    const allowedPaymentMethods = ["COD", "Bank Transfer (Simulasi)", "Manual"];
    if (!allowedPaymentMethods.includes(paymentMethod)) {
      return res.status(400).json({
        success: false,
        message: `Invalid payment method. Allowed: ${allowedPaymentMethods.join(
          ", "
        )}.`,
      });
    }

    // 2. Ambil semua item dari Keranjang Pengguna
    const cartItems = await Cart.find({
      user: new mongoose.Types.ObjectId(userId),
    })
      .populate({
        path: "shoe",
        model: "shoes", // Pastikan nama model Anda 'Shoe' (kapital) atau sesuai
        select:
          "name price stock variants.optionValues variants.price variants.stock variants.sku variants.imageUrl variants._id",
      })
      .lean();

    if (!cartItems || cartItems.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Your cart is empty. Cannot create an order.",
      });
    }

    // 3. Validasi Stok untuk setiap item di keranjang
    const orderItems = [];
    let stockErrors = [];

    for (const item of cartItems) {
      const shoe = item.shoe;

      if (!shoe) {
        stockErrors.push(`Product with ID ${item.shoe._id} not found.`);
        continue;
      }

      let itemStock = 0;
      let actualPrice = item.price; // Gunakan harga dari snapshot di cart
      let itemSnapshotName = item.name; // Gunakan nama dari snapshot di cart

      // Tentukan stok dan harga berdasarkan varian atau produk utama
      if (item.selectedVariantId && shoe.variants && shoe.variants.length > 0) {
        const selectedVariant = shoe.variants.find(
          (v) => v._id && v._id.equals(item.selectedVariantId)
        );
        if (!selectedVariant) {
          stockErrors.push(
            `Variant with ID ${item.selectedVariantId} for shoe ${item.name} not found.`
          );
          continue;
        }
        itemStock = selectedVariant.stock;
        // Opsional: perbarui harga dari varian jika Anda ingin harga terbaru dari produk,
        // tapi skema cart Anda sudah menyimpan harga snapshot.
        // actualPrice = selectedVariant.price;
        // variantOptionValues = selectedVariant.optionValues; // Simpan snapshot varian
        // variantSku = selectedVariant.sku; // Simpan snapshot varian
      } else {
        itemStock = shoe.stock;
        // actualPrice = shoe.price;
      }

      if (item.quantity > itemStock) {
        stockErrors.push(
          `Insufficient stock for "${itemSnapshotName}" (ID: ${item.shoe._id}${
            item.selectedVariantId
              ? " - Variant: " + item.selectedVariantId
              : ""
          }). Ordered: ${item.quantity}, Available: ${itemStock}.`
        );
      }

      // Siapkan item untuk objek Order
      orderItems.push({
        shoe: item.shoe._id,
        selectedVariantId: item.selectedVariantId,
        name: itemSnapshotName,
        price: actualPrice,
        quantity: item.quantity,
        // Jika Anda ingin menyimpan snapshot detail varian, tambahkan di sini:
        // variantOptionValues: item.variantOptionValues,
        // variantSku: item.variantSku,
        // imageUrl: item.image, // Menggunakan image dari cart item yang sudah ada
      });
    }

    if (stockErrors.length > 0) {
      return res.status(400).json({
        success: false,
        message: "Cannot create order due to stock issues.",
        errors: stockErrors,
      });
    }

    // 4. Hitung Total Harga
    const { subtotal, shippingCost, totalAmount } =
      calculateOrderTotals(orderItems);

    // 5. Buat Objek Pesanan Baru
    const newOrder = new Order({
      user: new mongoose.Types.ObjectId(userId),
      shippingAddress: shippingAddress,
      items: orderItems,
      subtotal: subtotal,
      shippingCost: shippingCost,
      totalAmount: totalAmount,
      paymentMethod: paymentMethod,
      notes: notes,
      // orderId dan publicOrderUrl akan di-generate oleh middleware pre('save')
    });

    // 6. Simpan Pesanan ke Database
    const savedOrder = await newOrder.save();

    // 7. Kurangi Stok Produk (opsional untuk demo, tapi disarankan)
    // Untuk demo sederhana, ini bisa diabaikan atau disimulasikan.
    // Untuk aplikasi nyata, Anda harus melakukan ini dalam transaksi untuk keandalan.
    for (const item of cartItems) {
      const shoe = await Shoe.findById(item.shoe._id); // Re-fetch untuk update
      if (!shoe) continue;

      if (item.selectedVariantId) {
        const variant = shoe.variants.id(item.selectedVariantId);
        if (variant) {
          variant.stock -= item.quantity;
        }
      } else {
        shoe.stock -= item.quantity;
      }
      await shoe.save(); // Simpan perubahan stok
    }

    // 8. Kosongkan Keranjang Belanja Pengguna
    await Cart.deleteMany({ user: new mongoose.Types.ObjectId(userId) });

    // 9. Kirim Respons Sukses
    res.status(201).json({
      success: true,
      message: "Order created successfully.",
      order: {
        _id: savedOrder._id,
        orderId: savedOrder.orderId,
        publicOrderUrl: savedOrder.publicOrderUrl,
        totalAmount: savedOrder.totalAmount,
        status: savedOrder.status,
        orderedAt: savedOrder.orderedAt,
        // Anda bisa menambahkan detail lain yang relevan untuk respons awal
        // seperti daftar item atau alamat pengiriman jika frontend membutuhkannya
        // tanpa harus melakukan request GET baru ke publicOrderUrl.
        // Misalnya: items: savedOrder.items
      },
      // Optional: Redirect frontend or provide full cart data if needed for immediate UI update
      // cartItems: [], // Keranjang harus kosong sekarang
      // currentCartTotalUniqueItems: 0,
      // cartTotalPrice: 0,
    });
  } catch (error) {
    console.error("Error creating order:", error);
    if (error.name === "CastError") {
      return res.status(400).json({
        success: false,
        message: "Invalid ID format in request.",
        error: error.message,
      });
    }
    res.status(500).json({
      success: false,
      message: "Failed to create order.",
      error: error.message,
    });
  }
};
