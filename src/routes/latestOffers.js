const router = require("express").Router();

const { add, getOffers } = require("../controllers/latestOffers");

router.post("/add", add);
router.get("/", getOffers);

module.exports = router;
