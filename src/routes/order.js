const router = require("express").Router();

const {
  createOrder,
  getOrderDetail,
  getOrdersByUserId,
} = require("../controllers/order");

router.post("/create-order", createOrder);
router.get("/orders", getOrdersByUserId);
router.get("/order-detail", getOrderDetail);

module.exports = router;
