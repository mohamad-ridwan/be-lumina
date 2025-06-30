const router = require("express").Router();

const { addCategory } = require("../controllers/category");

router.post("/add", addCategory);

module.exports = router;
