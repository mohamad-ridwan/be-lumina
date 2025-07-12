const router = require("express").Router();

const { createOrder, getOrderDetail } = require("../controllers/order");

router.post("/create-order", createOrder);
router.get("/order-detail", getOrderDetail);

module.exports = router;
