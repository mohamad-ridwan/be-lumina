const router = require("express").Router();

const {
  addCart,
  getCart,
  updateCart,
  deleteCart,
} = require("../controllers/cart");

router.get("/", getCart);
router.post("/add", addCart);
router.post("/update-quantity", updateCart);
router.post("/delete", deleteCart);

module.exports = router;
