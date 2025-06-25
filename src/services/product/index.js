// Misalnya di services/productService.js
// Ini adalah fungsi dummy. Anda akan menggantinya dengan query DB Anda.
async function getProductPrice(productName) {
  console.log(`Executing getProductPrice for: ${productName}`);
  // Logika untuk query database Anda atau memanggil API internal
  if (productName.toLowerCase().includes("sepatu lari xyz")) {
    return {
      status: "success",
      productName: "Sepatu Lari XYZ",
      price: "Rp 750.000",
      currency: "IDR",
    };
  }
  return { status: "error", message: "Produk tidak ditemukan." };
}

async function checkProductStock(productName) {
  console.log(`Executing checkProductStock for: ${productName}`);
  if (productName.toLowerCase().includes("sepatu lari xyz")) {
    return {
      status: "success",
      productName: "Sepatu Lari XYZ",
      stock: "Tersedia",
      quantity: 50,
    };
  }
  return { status: "error", message: "Produk tidak ditemukan." };
}

// Map fungsi ke objek agar mudah dipanggil
const availableFunctions = {
  getProductPrice,
  checkProductStock,
};

module.exports = {
  availableFunctions,
};
