const router = require("express").Router();

const { addTools, getTools } = require("../controllers/tools");

router.post("/add", addTools);
router.get("/", getTools);

module.exports = router;
