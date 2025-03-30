const chats = require('../models/chats') 

const readNotification = async (message, io) => {
    const chatCurrently = await chats.findOne({
        chatRoomId: message?.chatRoomId,
        chatId: message?.chatId,
    })

    const secondUserId = chatCurrently.userIds.find(id=>id !== message.userId)

    if(chatCurrently.unreadCount[message.userId] === 0){
        return
    }

    const newChatCurrently = await chats.findOneAndUpdate(
        {
            chatRoomId: message?.chatRoomId,
            chatId: message?.chatId,
        },
        {
            unreadCount : {
                [message.userId]: 0,
                [secondUserId]: chatCurrently.unreadCount[secondUserId]
            } 
        },
        { new: true }
    )

    io.emit('readNotification', newChatCurrently)
}

const chatsSocket = {
    readNotification
}

module.exports = {chatsSocket}