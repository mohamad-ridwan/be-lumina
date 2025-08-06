const mongoose = require("mongoose");

const Schema = mongoose.Schema;

const chats = new Schema(
  {
    chatId: {
      type: String,
    },
    chatRoomId: {
      type: String,
    },
    unreadCount: {
      type: Object,
    },
    latestMessage: {
      type: Array,
    },
    caption: {
      type: String,
    },
    latestMessageTimestamp: {
      type: Number,
    },
    chatCreationDate: {
      type: Number,
    },
    userIds: {
      type: Array,
    },
    loadingBubbleMessages: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamp: true,
  }
);

module.exports = mongoose.model("chats", chats);
