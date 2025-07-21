const { getOrderStatus } = require("./order");
const { searchShoes } = require("./shoes");

// Map fungsi ke objek agar mudah dipanggil oleh AI
const availableFunctionProducts = {
  searchShoes,
  getOrderStatus,
};

module.exports = { availableFunctionProducts };
