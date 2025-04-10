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
        isEndHeader: {
            type: Boolean
        },
        headerText: {
            type: String
        }
    },
    {
        timestamp: true,
    }
);

module.exports = mongoose.model("chat-room", chatRoom);
