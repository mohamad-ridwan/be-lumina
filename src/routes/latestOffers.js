const router = require("express").Router();

const { add } = require("../controllers/latestOffers");

router.post("/add", add);

module.exports = router;
