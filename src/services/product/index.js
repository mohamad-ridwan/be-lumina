// productsService.js atau file tempat fungsi-fungsi tools AI Anda berada
const shoesDB = require("../../models/shoes"); // Sesuaikan path jika berbeda

/**
 * Mendapatkan harga sebuah produk berdasarkan nama produk dari database.
 * @param {string} productName Nama lengkap produk yang ingin dicari harganya.
 * @returns {Promise<object>} Objek yang berisi status, nama produk, harga, dan mata uang.
 */
async function getProductPrice({ productName, variant, size }) {
  console.log(
    `Executing getProductPrice for: ${productName}, Variant: ${variant}, Size: ${size}`
  );

  try {
    let query = {};
    if (productName) {
      query.name = { $regex: new RegExp(productName, "i") };
    }
    if (variant) {
      query.variant = { $regex: new RegExp(variant, "i") };
    }
    if (size) {
      query.size = size;
    }

    const product = await shoesDB.findOne(query);

    if (product) {
      let responseMessage = `Harga ${product.name}`;
      if (product.variant) responseMessage += ` varian ${product.variant}`;
      responseMessage += ` adalah Rp ${product.price.toLocaleString("id-ID")}.`;

      return {
        status: "success",
        productName: product.name,
        variant: product.variant,
        size: product.size,
        price: product.price,
        currency: "IDR",
        message: responseMessage,
      };
    } else {
      return {
        status: "error",
        message: "Harga produk tidak ditemukan dengan kriteria tersebut.",
      };
    }
  } catch (error) {
    console.error("Error in getProductPrice:", error);
    return {
      status: "error",
      message: "Terjadi kesalahan saat mencari harga produk. Mohon coba lagi.",
    };
  }
}

/**
 * Mengecek ketersediaan stok produk berdasarkan nama produk dari database.
 * @param {string} productName Nama lengkap produk yang ingin dicek stoknya.
 * @returns {Promise<object>} Objek yang berisi status, nama produk, stok, dan kuantitas.
 */
async function checkProductStock({ productName, variant, size, isLatest }) {
  // Destructuring parameter
  console.log(
    `Executing checkProductStock for: ${productName}, Variant: ${variant}, Size: ${size}, Latest: ${isLatest}`
  );

  try {
    let query = {};

    // Base query for productName (always required)
    if (productName) {
      query.name = { $regex: new RegExp(productName, "i") };
    }

    // Add optional parameters to the query
    if (variant) {
      query.variant = { $regex: new RegExp(variant, "i") };
    }
    if (size) {
      // Untuk array size, kita cek apakah array 'size' di dokumen mengandung 'size' yang dicari
      query.size = size; // Mongoose akan mencari dokumen di mana array 'size' mengandung elemen ini
    }

    let sortOption = {};
    if (isLatest) {
      // Jika 'isLatest' true, urutkan berdasarkan 'createdAt' descending untuk mendapatkan yang terbaru
      sortOption.createdAt = -1;
    }

    // Eksekusi query ke database
    // Gunakan find() jika mungkin ada beberapa hasil (misal: "sepatu lari" mungkin ada beberapa varian)
    // dan urutkan jika isLatest true
    const products = await shoesDB
      .find(query)
      .sort(sortOption)
      .limit(isLatest ? 1 : undefined);

    console.log("Database Query:", query);
    console.log("Found Products:", products);

    if (products && products.length > 0) {
      // Jika isLatest, ambil produk pertama (terbaru)
      const product = isLatest ? products[0] : products[0]; // Anda mungkin perlu logika lebih kompleks jika ada banyak hasil non-latest

      const stockStatus = product.stock > 0 ? "Tersedia" : "Habis";
      let responseMessage = `Stok untuk ${product.name}`;
      if (product.variant) responseMessage += ` varian ${product.variant}`;
      if (product.size && product.size.length > 0)
        responseMessage += ` ukuran ${product.size.join(", ")}`;
      responseMessage += `: ${stockStatus} (${product.stock} unit).`;

      return {
        status: "success",
        productName: product.name,
        variant: product.variant,
        size: product.size,
        stock: stockStatus,
        quantity: product.stock,
        message: responseMessage, // Tambahkan pesan deskriptif
      };
    } else {
      return {
        status: "error",
        message: "Produk tidak ditemukan dengan kriteria tersebut.",
      };
    }
  } catch (error) {
    console.error("Error in checkProductStock:", error);
    return {
      status: "error",
      message: "Terjadi kesalahan saat mencari stok produk. Mohon coba lagi.",
    };
  }
}

// Map fungsi ke objek agar mudah dipanggil oleh AI
const availableFunctions = {
  getProductPrice,
  checkProductStock,
};

module.exports = { availableFunctions };
