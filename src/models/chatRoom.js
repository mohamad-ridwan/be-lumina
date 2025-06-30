const mongoose = require("mongoose");

const Schema = mongoose.Schema;

const chatRoom = new Schema(
  {
    chatRoomId: {
      type: String,
    },
    chatId: {
      type: String,
    },
    messageId: {
      type: String,
    },
    senderUserId: {
      type: String,
    },
    messageType: {
      type: String,
    },
    textMessage: {
      type: String,
    },
    latestMessageTimestamp: {
      type: String,
    },
    status: {
      type: String,
    },
    role: {
      type: String,
      enum: ["user", "model"],
      default: "user",
    },
    isHeader: {
      type: Boolean,
    },
    replyView: {
      type: Object,
    },
    productData: {
      type: Array,
    },
    reactions: [
      {
        emoji: { type: String },
        senderUserId: { type: String },
        code: { type: String },
        latestMessageTimestamp: { type: String },
      },
    ],
    isDeleted: [
      {
        senderUserId: { type: String },
        deletionType: { type: String },
      },
    ],
    timeId: { type: String },
    document: {
      type: Object,
    },
    completionTimestamp: { type: String, default: null }, // Atau Number jika Anda ingin menyimpannya sebagai Number
    completionTimeId: { type: String, default: null },
  },
  {
    timestamp: true,
  }
);

module.exports = mongoose.model("chat-room", chatRoom);
