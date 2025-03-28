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
        data: {
            type: Array
        },
        chatRoomCreationDate: {
            type: Number
        },
        userIds: {
            type: Array
        },
    },
    {
        timestamp: true,
    }
);

module.exports = mongoose.model("chat-room", chatRoom);
