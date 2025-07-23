const router = require("express").Router();

const {
  createOrder,
  getOrderDetail,
  getOrdersByUserId,
  getRequestCancelOrder,
} = require("../controllers/order");

router.post("/create-order", createOrder);
router.get("/orders", getOrdersByUserId);
router.get("/order-detail", getOrderDetail);
router.get("/cancel-requested", getRequestCancelOrder);

module.exports = router;
