const router = require("express").Router();

const { addCart, getCart } = require("../controllers/cart");

router.get("/", getCart);
router.post("/add", addCart);

module.exports = router;
