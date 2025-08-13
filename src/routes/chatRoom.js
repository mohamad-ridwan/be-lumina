const router = require("express").Router();
const multer = require("multer");
const path = require("path");
const fs = require("fs");

const {
  getChatRoom,
  stream,
  getMessagesPagination,
  getMessagesAround,
  getMediaMessagesAround,
  uploadMediaMessage,
  confirmCancelOrder,
  getBubbleMessages,
  loadingBubbleMessages,
  sendMessage,
  // getBatchChatRoom
} = require("../controllers/chatRoom");

const BASE_UPLOAD_DIR = path.join(__dirname, "..", "..", "uploads"); // Mengarah ke be-lumina/uploads

// Pastikan folder ini ada (dan dibuat secara rekursif)
if (!fs.existsSync(BASE_UPLOAD_DIR)) {
  fs.mkdirSync(BASE_UPLOAD_DIR, { recursive: true });
  console.log(`Direktori 'uploads' dibuat di: ${BASE_UPLOAD_DIR}`);
}

// --- Multer Storage Configuration (Menggunakan BASE_UPLOAD_DIR) ---
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, BASE_UPLOAD_DIR); // Multer menyimpan di sini
  },
  filename: function (req, file, cb) {
    cb(
      null,
      file.fieldname + "-" + Date.now() + path.extname(file.originalname)
    );
  },
});

const upload = multer({ storage: storage });

router.post("/", getChatRoom);
router.post("/upload-media-message", upload.single("file"), uploadMediaMessage);
router.post("/user/send-message", sendMessage);
router.post("/loading-bubble-messages", loadingBubbleMessages);
router.post("/bubble-messages", getBubbleMessages);
router.get("/stream", stream);
router.get("/messages", getMessagesPagination);
router.post("/confirm-cancel-order", confirmCancelOrder);
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
