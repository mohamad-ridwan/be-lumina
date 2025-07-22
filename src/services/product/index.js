const { requestCancelOrder } = require("./order");
const { searchShoes } = require("./shoes");

// Map fungsi ke objek agar mudah dipanggil oleh AI
const availableFunctionProducts = {
  searchShoes,
  requestCancelOrder,
};

module.exports = { availableFunctionProducts };
