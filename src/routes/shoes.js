const router = require("express").Router();

const {
  addShoe,
  getShoe,
  updateManyShoesEmbedding,
  updateManyShoeVariants,
  updateSpecs,
} = require("../controllers/shoes");

router.get("/", getShoe);
router.get("/:id", getShoe);
router.post("/update-embeddings", updateManyShoesEmbedding);
router.post("/update-specs", updateSpecs);
router.post("/update-variants", updateManyShoeVariants);
router.get("/slug/:slug", getShoe);
router.get("/category/:category", getShoe);
router.post("/add", addShoe);

module.exports = router;
