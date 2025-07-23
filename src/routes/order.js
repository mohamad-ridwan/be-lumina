const router = require("express").Router();

const {
  createOrder,
  getOrderDetail,
  getOrdersByUserId,
  getRequestCancelOrder,
  createJobForResponseReqCancelOrder,
} = require("../controllers/order");

router.post("/create-order", createOrder);
router.get("/orders", getOrdersByUserId);
router.get("/order-detail", getOrderDetail);
router.get("/cancel-requested", getRequestCancelOrder);
router.post(
  "/add-job-response-cancel-order",
  createJobForResponseReqCancelOrder
);

module.exports = router;
