const Cart = require("../models/cart"); // Model 'Cart'
const shoesDB = require("../models/shoes"); // Model 'shoes' (atau 'Shoe')
const mongoose = require("mongoose"); // Diperlukan untuk ObjectId.isValid

const getAndFormatCartData = async (userId) => {
  const cartItems = await Cart.find({
    user: new mongoose.Types.ObjectId(userId),
  })
    .populate({
      path: "shoe",
      model: "shoes", // Pastikan nama model sepatu Anda di Mongoose adalah 'Shoe' atau sesuai
      // Select field yang dibutuhkan dari model sepatu
      select:
        "name image price stock slug variants.optionValues variants.price variants.stock variants.sku variants.imageUrl variants._id",
    })
    .lean();

  if (!cartItems || cartItems.length === 0) {
    return {
      cartItems: [],
      currentCartTotalUniqueItems: 0,
      cartTotalPrice: 0,
      totalProduct: 0, // <<< Tambahkan ini untuk keranjang kosong
    };
  }

  let cartTotalPrice = 0;
  let totalProductQuantity = 0; // <<< Inisialisasi variabel baru untuk total kuantitas

  const formattedCartItems = cartItems.map((item) => {
    const shoe = item.shoe;

    let itemImage = shoe ? shoe.image : null;
    let variantOptionValues = null;
    let variantSku = null;
    let actualPrice = item.price; // Harga diambil dari snapshot di dokumen cart item
    let availableStock = 0; // Default stock ke 0

    // Logika untuk menentukan stok: dari varian atau dari stok utama sepatu
    if (
      item.selectedVariantId &&
      shoe &&
      shoe.variants &&
      shoe.variants.length > 0
    ) {
      const selectedVariant = shoe.variants.find(
        (v) => v._id && v._id.equals(item.selectedVariantId)
      );

      if (selectedVariant) {
        availableStock = selectedVariant.stock;
        if (selectedVariant.imageUrl) {
          itemImage = selectedVariant.imageUrl;
        }
        variantOptionValues = Object.fromEntries(
          Object.entries(selectedVariant.optionValues)
        );
        variantSku = selectedVariant.sku;
      } else {
        // Varian tidak ditemukan, fallback ke stok utama sepatu
        availableStock = shoe ? shoe.stock : 0;
      }
    } else {
      // Tidak ada selectedVariantId, ambil stok dari sepatu utama
      availableStock = shoe ? shoe.stock : 0;
    }

    const itemSubtotal = actualPrice * item.quantity;
    cartTotalPrice += itemSubtotal;
    totalProductQuantity += item.quantity; // <<< Akumulasikan total kuantitas

    return {
      _id: item._id,
      shoeId: item.shoe ? item.shoe._id : null,
      name: item.name,
      image: itemImage,
      price: actualPrice,
      quantity: item.quantity,
      subtotal: itemSubtotal,
      selectedVariantId: item.selectedVariantId,
      variantOptionValues: variantOptionValues,
      variantSku: variantSku,
      slug: shoe ? shoe.slug : null, // Ambil slug dari sepatu yang dipopulasi
      availableStock: availableStock,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    };
  });

  return {
    cartItems: formattedCartItems,
    currentCartTotalUniqueItems: formattedCartItems.length,
    cartTotalPrice: cartTotalPrice,
    totalProduct: totalProductQuantity, // <<< Tambahkan field baru di sini
  };
};

exports.deleteCart = async (req, res, next) => {
  try {
    const { userId, cartId } = req.query; // Mengambil userId dan cartId dari query parameter

    // 1. Validasi Input
    if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({
        success: false,
        message: "Valid User ID is required in query parameters.",
      });
    }
    if (!cartId || !mongoose.Types.ObjectId.isValid(cartId)) {
      return res.status(400).json({
        success: false,
        message: "Valid Cart Item ID is required in query parameters.",
      });
    }

    // 2. Hapus item keranjang spesifik
    // Penting: Hapus berdasarkan _id item keranjang DAN userId
    // Ini mencegah pengguna menghapus item keranjang pengguna lain hanya dengan mengetahui cartId
    const deleteResult = await Cart.deleteOne({
      _id: new mongoose.Types.ObjectId(cartId),
      user: new mongoose.Types.ObjectId(userId),
    });

    if (deleteResult.deletedCount === 0) {
      return res.status(404).json({
        success: false,
        message: "Cart item not found or already deleted for this user.",
      });
    }

    // 3. Ambil dan kembalikan seluruh keranjang yang sudah diperbarui
    const updatedCartData = await getAndFormatCartData(userId);

    res.status(200).json({
      success: true,
      message: "Item removed from cart successfully.",
      ...updatedCartData,
    });
  } catch (error) {
    console.error("Error deleting cart item:", error);
    if (error.name === "CastError") {
      return res.status(400).json({
        success: false,
        message: "Invalid ID format in request or database.",
        error: error.message,
      });
    }
    res.status(500).json({
      success: false,
      message: "Failed to remove item from cart.",
      error: error.message,
    });
  }
};

exports.updateCart = async (req, res, next) => {
  try {
    const { userId } = req.query; // Dari query
    const { quantity, shoeId, selectedVariantId } = req.body; // Dari body

    // 1. Validasi Input
    if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({
        success: false,
        message: "Valid User ID is required in query parameters.",
      });
    }
    if (!shoeId || !mongoose.Types.ObjectId.isValid(shoeId)) {
      return res.status(400).json({
        success: false,
        message: "Valid Shoe ID is required in request body.",
      });
    }
    if (
      selectedVariantId &&
      !mongoose.Types.ObjectId.isValid(selectedVariantId)
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid selectedVariantId format.",
      });
    }
    if (typeof quantity !== "number" || quantity < 0) {
      // Kuantitas bisa 0 untuk menghapus item
      return res.status(400).json({
        success: false,
        message: "Quantity must be a non-negative number.",
      });
    }

    // 2. Cari item keranjang spesifik
    const query = {
      user: new mongoose.Types.ObjectId(userId),
      shoe: new mongoose.Types.ObjectId(shoeId),
      selectedVariantId: selectedVariantId
        ? new mongoose.Types.ObjectId(selectedVariantId)
        : null,
    };

    let cartItemToUpdate = await Cart.findOne(query);

    if (!cartItemToUpdate) {
      return res.status(404).json({
        success: false,
        message: "Cart item not found.",
      });
    }

    // 3. Dapatkan informasi stok dari produk/varian
    const shoe = await shoesDB
      .findById(new mongoose.Types.ObjectId(shoeId))
      .lean();

    if (!shoe) {
      return res.status(404).json({
        success: false,
        message: "Associated shoe not found.",
      });
    }

    let availableStock = 0;
    if (selectedVariantId && shoe.variants && shoe.variants.length > 0) {
      const selectedVariant = shoe.variants.find(
        (v) => v._id && v._id.equals(selectedVariantId)
      );
      if (selectedVariant) {
        availableStock = selectedVariant.stock;
      } else {
        // Varian tidak ditemukan, fallback ke stok utama
        availableStock = shoe.stock;
      }
    } else {
      availableStock = shoe.stock;
    }

    // 4. Validasi kuantitas baru terhadap stok
    if (quantity > availableStock) {
      return res.status(400).json({
        success: false,
        message: `Insufficient stock. Only ${availableStock} available.`,
      });
    }

    // 5. Perbarui kuantitas atau hapus item jika kuantitasnya 0
    if (quantity === 0) {
      await cartItemToUpdate.deleteOne(); // Gunakan deleteOne() atau remove()
      // console.log(`Cart item for user ${userId}, shoe ${shoeId}, variant ${selectedVariantId} removed.`);
      // Tidak perlu update price/name karena item dihapus
    } else {
      cartItemToUpdate.quantity = quantity; // Ganti kuantitas
      // Optional: Perbarui harga dan nama jika mungkin berubah di master produk
      // cartItemToUpdate.price = ...
      // cartItemToUpdate.name = ...
      await cartItemToUpdate.save();
      // console.log(`Cart item for user ${userId}, shoe ${shoeId}, variant ${selectedVariantId} updated to quantity ${quantity}.`);
    }

    // 6. Ambil dan kembalikan seluruh keranjang yang sudah diperbarui
    const updatedCartData = await getAndFormatCartData(userId);

    res.status(200).json({
      success: true,
      message:
        quantity === 0
          ? "Item removed from cart successfully."
          : "Cart item updated successfully.",
      ...updatedCartData,
    });
  } catch (error) {
    console.error("Error updating cart:", error);
    if (error.name === "CastError") {
      return res.status(400).json({
        success: false,
        message: "Invalid ID format in request or database.",
        error: error.message,
      });
    }
    res.status(500).json({
      success: false,
      message: "Failed to update cart item.",
      error: error.message,
    });
  }
};

// Tambahkan atau gabungkan dengan exports.addCart Anda yang sudah ada
exports.getCart = async (req, res, next) => {
  try {
    const { userId } = req.query; // Mengambil userId dari query parameter

    // 1. Validasi Input userId
    if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({
        success: false,
        message: "Valid User ID is required in query parameters.",
      });
    }

    // 2. Panggil fungsi helper untuk mendapatkan dan memformat data keranjang
    const cartData = await getAndFormatCartData(userId);

    // 3. Kirim respons dengan data yang sudah diformat
    res.status(200).json({
      success: true,
      message:
        cartData.cartItems.length > 0
          ? "Cart items retrieved successfully."
          : "Cart is empty for this user.",
      ...cartData, // Menggabungkan properti dari cartData (cartItems, currentCartTotalUniqueItems, cartTotalPrice)
    });
  } catch (error) {
    console.error("Error getting cart:", error);
    if (error.name === "CastError") {
      return res.status(400).json({
        success: false,
        message: "Invalid ID format in request or database.",
        error: error.message,
      });
    }
    res.status(500).json({
      success: false,
      message: "Failed to retrieve cart items.",
      error: error.message,
    });
  }
};

exports.addCart = async (req, res, next) => {
  try {
    // KOREKSI: Ambil userId dari req.query.userId seperti permintaan Anda
    const { userId } = req.query; // <<< PERUBAHAN DI SINI

    const { shoeId, quantity, selectedVariantId } = req.body;

    // 1. Validasi Input
    if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({
        success: false,
        message: "Valid User ID is required in query parameters.",
      });
    }

    if (!shoeId || !mongoose.Types.ObjectId.isValid(shoeId)) {
      return res.status(400).json({
        success: false,
        message: "Valid Shoe ID is required.",
      });
    }

    if (quantity <= 0) {
      return res.status(400).json({
        success: false,
        message: "Quantity must be at least 1.",
      });
    }

    if (
      selectedVariantId &&
      !mongoose.Types.ObjectId.isValid(selectedVariantId)
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid selectedVariantId format.",
      });
    }

    // 2. Cari Sepatu dan Varian (jika ada) dari database sepatu
    const shoe = await shoesDB
      .findById(new mongoose.Types.ObjectId(shoeId))
      .lean();

    if (!shoe) {
      return res.status(404).json({
        success: false,
        message: "Shoe not found.",
      });
    }

    let itemPrice;
    let itemStock;
    let itemImage = shoe.image;
    let variantOptionValues = null;
    let variantSku = null;

    if (shoe.variants && shoe.variants.length > 0) {
      if (!selectedVariantId) {
        return res.status(400).json({
          success: false,
          message: "A variant must be selected for this shoe.",
        });
      }

      const selectedVariant = shoe.variants.find(
        (v) => v._id.toString() === selectedVariantId
      );

      if (!selectedVariant) {
        return res.status(404).json({
          success: false,
          message: "Selected variant not found for this shoe.",
        });
      }

      itemPrice = selectedVariant.price;
      itemStock = selectedVariant.stock;
      if (selectedVariant.imageUrl) {
        itemImage = selectedVariant.imageUrl;
      }
      variantOptionValues = Object.fromEntries(
        Object.entries(selectedVariant.optionValues)
      );
      variantSku = selectedVariant.sku;
    } else {
      if (selectedVariantId) {
        return res.status(400).json({
          success: false,
          message:
            "This shoe does not have variants. Do not provide selectedVariantId.",
        });
      }
      itemPrice = shoe.price;
      itemStock = shoe.stock;
    }

    // 3. Cek Stok dan Tentukan apakah item sudah ada di keranjang
    const existingCartItem = await Cart.findOne({
      user: new mongoose.Types.ObjectId(userId),
      shoe: new mongoose.Types.ObjectId(shoeId),
      selectedVariantId: selectedVariantId
        ? new mongoose.Types.ObjectId(selectedVariantId)
        : null,
    });

    let currentQuantityInCart = existingCartItem
      ? existingCartItem.quantity
      : 0;
    const newTotalQuantity = currentQuantityInCart + quantity;

    if (itemStock < newTotalQuantity) {
      return res.status(400).json({
        success: false,
        message: `Insufficient stock. Current in cart: ${currentQuantityInCart}, trying to add: ${quantity}. Only ${itemStock} total available.`,
      });
    }

    // 4. Tambahkan/Perbarui Item di Keranjang
    if (existingCartItem) {
      existingCartItem.quantity = newTotalQuantity;
      existingCartItem.price = itemPrice;
      existingCartItem.name = shoe.name;
      await existingCartItem.save();
    } else {
      await Cart.create({
        user: new mongoose.Types.ObjectId(userId),
        shoe: new mongoose.Types.ObjectId(shoeId),
        selectedVariantId: selectedVariantId
          ? new mongoose.Types.ObjectId(selectedVariantId)
          : null,
        name: shoe.name,
        price: itemPrice,
        quantity: quantity,
      });
    }

    // --- BARIS KUNCI: Ambil dan kembalikan seluruh keranjang yang sudah diperbarui ---
    const updatedCartData = await getAndFormatCartData(userId);

    res.status(200).json({
      success: true,
      message: "Item added/updated in cart successfully.",
      ...updatedCartData, // Menggabungkan data keranjang yang sudah diformat
    });
  } catch (error) {
    console.error("Error adding to cart:", error);
    if (error.name === "CastError") {
      return res.status(400).json({
        success: false,
        message: "Invalid ID format in request.",
        error: error.message,
      });
    }
    res.status(500).json({
      success: false,
      message: "Failed to add item to cart.",
      error: error.message,
    });
  }
};
