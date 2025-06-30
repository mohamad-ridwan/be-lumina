const router = require("express").Router();

const { addBrand } = require("../controllers/brand");

router.post("/add", addBrand);

module.exports = router;
