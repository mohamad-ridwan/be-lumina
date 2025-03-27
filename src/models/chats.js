const mongoose = require("mongoose");

const Schema = mongoose.Schema;

const chats = new Schema(
    {
        chatId: {
            type: String
        },
        chatRoomId: {
            type: String
        },
        unreadCount:{
            type: Number
        },
        latestMessage:{
            type: Object
        },
        caption: {
            type: String
        },
        latestMessageTimestamp: {
            type: Number
        },
        chatCreationDate: {
            type: Number
        },
        userIds: {
            type: Array
        }
    },
    {
        timestamp: true,
    }
);

module.exports = mongoose.model("chats", chats);
