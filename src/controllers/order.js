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
          "name price stock image variants.optionValues variants.price variants.stock variants.sku variants.imageUrl variants._id", // Menambahkan 'image' dari shoe dan detail varian
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
      let itemImageUrl = shoe.image; // Default ke gambar produk utama
      let variantDetails = null; // Objek untuk menyimpan detail varian jika ada

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
        itemImageUrl = selectedVariant.imageUrl || shoe.image; // Gunakan gambar varian jika ada, fallback ke gambar produk utama
        actualPrice = selectedVariant.price; // Gunakan harga varian terbaru saat ini

        // Simpan semua detail varian yang relevan
        variantDetails = {
          _id: selectedVariant._id,
          sku: selectedVariant.sku,
          imageUrl: selectedVariant.imageUrl,
          optionValues: selectedVariant.optionValues,
          price: selectedVariant.price, // Harga varian
        };
      } else {
        itemStock = shoe.stock;
        actualPrice = shoe.price; // Gunakan harga produk utama terbaru saat ini
      }

      // Validasi stok
      if (item.quantity > itemStock) {
        stockErrors.push(
          `Insufficient stock for "${itemSnapshotName}" (ID: ${item.shoe._id}${
            item.selectedVariantId
              ? " - Variant: " + item.selectedVariantId
              : ""
          }). Ordered: ${item.quantity}, Available: ${itemStock}.`
        );
      }

      let createOrderItem = {
        shoe: item.shoe._id,
        selectedVariantId: item.selectedVariantId,
        name: itemSnapshotName, // Nama produk
        price: actualPrice, // Harga snapshot (harga varian atau produk utama)
        quantity: item.quantity, // Kuantitas yang dipesan
        imageUrl: itemImageUrl,
      };

      if (Object.keys(variantDetails).length > 0) {
        createOrderItem.variant = {
          // Masukkan detail varian ke dalam sub-objek 'variant'
          _id: variantDetails._id,
          sku: variantDetails.sku,
          imageUrl: variantDetails.imageUrl,
          optionValues: variantDetails.optionValues,
          price: variantDetails.price,
        };
      }

      // Siapkan item untuk objek Order
      orderItems.push(createOrderItem);
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
      items: orderItems, // Menggunakan orderItems yang sudah diformat dengan detail varian
      subtotal: subtotal,
      shippingCost: shippingCost,
      totalAmount: totalAmount,
      status: "pending", // Status awal
      paymentMethod: paymentMethod,
      notes: notes,
      // orderId dan publicOrderUrl akan di-generate oleh middleware pre('save')
    });

    // 6. Simpan Pesanan ke Database
    const savedOrder = await newOrder.save();

    // 7. Kurangi Stok Produk
    // Penting: Dalam produksi, ini harus dalam transaksi untuk atomicity!
    for (const item of cartItems) {
      const shoe = await Shoe.findById(item.shoe._id);
      if (!shoe) continue; // Produk mungkin sudah dihapus, lewati

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
        shippingAddress: savedOrder.shippingAddress, // Sertakan alamat pengiriman
        items: savedOrder.items, // Sertakan detail item yang disimpan
        paymentMethod: savedOrder.paymentMethod, // Sertakan metode pembayaran
        notes: savedOrder.notes, // Sertakan catatan
      },
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
