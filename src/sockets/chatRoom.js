const chatRoomDB = require('../models/chatRoom')
const chatsDB = require('../models/chats')

const handleGetSendMessage = async (message, io) => {
    if (message?.eventType === 'send-message') {
        await chatRoomDB.findOneAndUpdate(
            {
                chatRoomId: message?.chatRoomId,
                chatId: message?.chatId
            },
            { $push: { data: message?.latestMessage } },
            { new: true }
        )
        const chatsCurrently = await chatsDB.findOne({
            chatRoomId: message?.chatRoomId,
            chatId: message?.chatId
        })

        const secondUserId = Object?.keys(chatsCurrently?.unreadCount)?.filter(id=>id !== message?.latestMessage?.senderUserId)?.[0]
        const currentUnreadCountSecondUser = chatsCurrently?.unreadCount?.[secondUserId]

        const newUnreadCount = ()=>{
            return {
                [`${message?.latestMessage.senderUserId}`]: 0,
                [`${secondUserId}`]: currentUnreadCountSecondUser + 1
            }
        }
        await chatsDB.findOneAndUpdate(
            {
                chatRoomId: message?.chatRoomId,
                chatId: message?.chatId
            },
            {
                unreadCount: newUnreadCount(),
                latestMessage: message?.latestMessage,
                latestMessageTimestamp: message?.latestMessage?.latestMessageTimestamp
            },
            { new: true }
        )

        // send back to the client for new message information
        io.emit('newMessage', {
            ...message,
            unreadCount: newUnreadCount()
        });
    }
}

const chatRoom = {
    handleGetSendMessage
}

module.exports = { chatRoom }