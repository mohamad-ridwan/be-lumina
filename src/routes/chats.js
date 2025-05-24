const router = require("express").Router();

const { getChats, getChatsPagination } = require("../controllers/chats");

// router.get('/', getChats)
router.get("/", getChatsPagination);

module.exports = router;
