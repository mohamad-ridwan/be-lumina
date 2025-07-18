const { searchShoes } = require("./shoes");

// Map fungsi ke objek agar mudah dipanggil oleh AI
const availableFunctionProducts = {
  searchShoes,
};

module.exports = { availableFunctionProducts };
