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

exports.getOrdersByUserId = async (req, res, next) => {
  try {
    const { userId, status, page = 1, limit = 10 } = req.query; // Ambil userId, status, page, dan limit dari query

    // 1. Validasi Input
    if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({
        success: false,
        message: "Valid User ID is required in query parameters.",
      });
    }

    // Siapkan kriteria query
    let query = { user: new mongoose.Types.ObjectId(userId) };

    // Tambahkan filter status jika disediakan dan valid
    const allowedStatuses = [
      "pending",
      "processing",
      "shipped",
      "delivered",
      "cancelled",
    ];
    if (
      status &&
      typeof status === "string" &&
      allowedStatuses.includes(status.toLowerCase())
    ) {
      query.status = status.toLowerCase();
    } else if (status) {
      // Jika status disediakan tapi tidak valid
      return res.status(400).json({
        success: false,
        message: `Invalid status provided. Allowed statuses are: ${allowedStatuses.join(
          ", "
        )}.`,
      });
    }

    // Konversi page dan limit ke angka
    const pageNum = parseInt(page, 10);
    const limitNum = parseInt(limit, 10);

    if (isNaN(pageNum) || pageNum < 1) {
      return res.status(400).json({
        success: false,
        message: "Invalid page number. Page must be a positive integer.",
      });
    }

    if (isNaN(limitNum) || limitNum < 1 || limitNum > 100) {
      // Batasi limit maksimal
      return res.status(400).json({
        success: false,
        message: "Invalid limit number. Limit must be between 1 and 100.",
      });
    }

    const skip = (pageNum - 1) * limitNum;

    // 2. Ambil Pesanan dengan Paginasi
    const orders = await Order.find(query)
      .sort({ orderedAt: -1 }) // Urutkan dari yang terbaru
      .skip(skip)
      .limit(limitNum)
      .lean(); // Gunakan .lean() untuk performa lebih baik karena kita tidak akan memodifikasi dokumen

    // 3. Hitung Total Pesanan (untuk paginasi)
    const totalOrders = await Order.countDocuments(query);
    const totalPages = Math.ceil(totalOrders / limitNum);

    // 4. Format Respons Pesanan
    const formattedOrders = orders.map((order) => ({
      _id: order._id,
      orderId: order.orderId,
      publicOrderUrl: order.publicOrderUrl,
      totalAmount: order.totalAmount,
      subtotal: order.subtotal,
      shippingCost: order.shippingCost,
      status: order.status,
      orderedAt: order.orderedAt,
      shippingAddress: order.shippingAddress,
      items: order.items, // Array items dengan snapshot data produk/varian
      paymentMethod: order.paymentMethod,
      notes: order.notes,
      createdAt: order.createdAt,
      updatedAt: order.updatedAt,
    }));

    // 5. Kirim Respons dengan Data Paginasi
    res.status(200).json({
      success: true,
      message:
        formattedOrders.length > 0
          ? "Orders retrieved successfully."
          : "No orders found for this user.",
      data: formattedOrders, // Array pesanan
      pagination: {
        totalItems: totalOrders,
        totalPages: totalPages,
        currentPage: pageNum,
        itemsPerPage: limitNum,
        hasNextPage: pageNum < totalPages,
        hasPrevPage: pageNum > 1,
      },
    });
  } catch (error) {
    console.error("Error getting user orders:", error);
    if (error.name === "CastError") {
      return res.status(400).json({
        success: false,
        message: "Invalid ID format in request.",
        error: error.message,
      });
    }
    res.status(500).json({
      success: false,
      message: "Failed to retrieve user orders.",
      error: error.message,
    });
  }
};

exports.getOrderDetail = async (req, res, next) => {
  try {
    const { orderId } = req.query; // Get orderId from query parameters

    // 1. Validate Input
    if (!orderId) {
      return res.status(400).json({
        success: false,
        message: "Order ID is required in query parameters.",
      });
    }

    // 2. Find the Order by orderId
    // We use .lean() for faster retrieval if we're not modifying the document
    const order = await Order.findOne({ orderId: orderId })
      // Optionally populate the 'shoe' reference inside items array
      // This is useful if you want to display current product info alongside the snapshot
      // but remember that the 'items' array already contains snapshot data (name, price, image, variant details)
      // so populating 'shoe' might only be needed for current product status or latest image/name.
      // For a demo, the snapshot might be enough.
      // .populate({
      //   path: 'items.shoe',
      //   model: 'Shoe', // Ensure this matches your Shoe model name
      //   select: 'name slug image' // Select only necessary fields if populating
      // })
      .lean();

    // 3. Handle Order Not Found
    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Order not found.",
      });
    }

    // 4. Send Success Response
    // The response structure is made similar to createOrder's success response
    res.status(200).json({
      success: true,
      message: "Order details retrieved successfully.",
      order: {
        _id: order._id,
        orderId: order.orderId,
        publicOrderUrl: order.publicOrderUrl,
        totalAmount: order.totalAmount,
        subtotal: order.subtotal, // Include subtotal
        shippingCost: order.shippingCost, // Include shippingCost
        status: order.status,
        orderedAt: order.orderedAt,
        shippingAddress: order.shippingAddress,
        items: order.items, // The items array with its snapshot data
        paymentMethod: order.paymentMethod,
        notes: order.notes,
        createdAt: order.createdAt, // Include timestamps
        updatedAt: order.updatedAt, // Include timestamps
      },
    });
  } catch (error) {
    console.error("Error getting order details:", error);
    // Handle CastError if _id was used instead of orderId, or other potential Mongoose errors
    if (error.name === "CastError") {
      return res.status(400).json({
        success: false,
        message: "Invalid ID format in query.",
        error: error.message,
      });
    }
    res.status(500).json({
      success: false,
      message: "Failed to retrieve order details.",
      error: error.message,
    });
  }
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

      if (variantDetails && Object.keys(variantDetails).length > 0) {
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

    let totalQuantity = orderItems.reduce(
      (sum, item) => sum + item.quantity,
      0
    );

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
      totalQuantity: totalQuantity,
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
        totalQuantity: totalQuantity, // Sertakan total kuantitas
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
