const router = require("express").Router();

const { addShoe } = require("../controllers/shoes");

router.post("/add", addShoe);

module.exports = router;
