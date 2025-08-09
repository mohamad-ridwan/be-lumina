const router = require("express").Router();

const {
  addShoe,
  getShoe,
  updateShoeEmbedding,
} = require("../controllers/shoes");

router.get("/", getShoe);
router.get("/:id", getShoe);
router.post("/update-embedding/:id", updateShoeEmbedding);
router.get("/slug/:slug", getShoe);
router.get("/category/:category", getShoe);
router.post("/add", addShoe);

module.exports = router;
