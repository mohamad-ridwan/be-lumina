const router = require("express").Router();

const { addShoe, getShoe } = require("../controllers/shoes");

router.get("/", getShoe);
router.get("/:id", getShoe);
router.get("/slug/:slug", getShoe);
router.get("/category/:category", getShoe);
router.post("/add", addShoe);

module.exports = router;
