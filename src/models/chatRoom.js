const mongoose = require("mongoose");

const Schema = mongoose.Schema;

const chatRoom = new Schema(
    {
        chatRoomId: {
            type: String
        },
        chatId: {
            type: String
        },
        messageId: {
            type: String
        },
        senderUserId:{
            type: String
        },
        messageType: {
            type: String
        },
        textMessage: {
            type: String
        },
        latestMessageTimestamp: {
            type: String
        },
        status: {
            type: String
        },
        isHeader: {
            type: Boolean
        },
        replyView: {
            type: Object
        }
    },
    {
        timestamp: true,
    }
);

module.exports = mongoose.model("chat-room", chatRoom);
