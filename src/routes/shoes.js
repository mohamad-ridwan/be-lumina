const router = require("express").Router();

const { addShoe, getShoe } = require("../controllers/shoes");

router.get("/:id", getShoe);
router.get("/slug/:slug", getShoe);
router.post("/add", addShoe);

module.exports = router;
