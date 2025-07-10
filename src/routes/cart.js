const router = require("express").Router();

const { addCart, getCart, updateCart } = require("../controllers/cart");

router.get("/", getCart);
router.post("/add", addCart);
router.post("/update-quantity", updateCart);

module.exports = router;
