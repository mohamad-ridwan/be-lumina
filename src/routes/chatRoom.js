const router = require("express").Router();

const {
  getChatRoom,
  stream,
  getMessagesPagination,
  getMessagesAround,
  getMediaMessagesAround,
  // getBatchChatRoom
} = require("../controllers/chatRoom");

router.post("/", getChatRoom);
router.get("/stream", stream);
router.get("/messages", getMessagesPagination);
router.get(
  "/messages/:chatRoomId/message/:messageId/around",
  getMessagesAround
);
router.get(
  "/media-messages/:chatRoomId/message/:messageId/around",
  getMediaMessagesAround
);
// router.post('/batch', getBatchChatRoom)

module.exports = router;
