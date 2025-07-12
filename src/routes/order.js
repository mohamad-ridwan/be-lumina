const router = require("express").Router();

const { createOrder } = require("../controllers/order");

router.post("/create-order", createOrder);

module.exports = router;
