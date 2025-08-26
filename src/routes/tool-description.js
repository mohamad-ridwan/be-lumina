const router = require("express").Router();

const {
  addOrUpdateTool,
  getBestMatchingTool,
} = require("../controllers/tool-description");

router.post("/add-or-update-tool", addOrUpdateTool);
router.post("/best-matching-tool", getBestMatchingTool);

module.exports = router;
