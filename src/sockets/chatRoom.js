const chatRoomDB = require('../models/chatRoom')
const chatsDB = require('../models/chats')

async function isUserInRoom(chatId, chatRoomId, userId, client) {
    return await new Promise((resolve, reject) => {
        client.sCard(`chats:${chatId}:room:${chatRoomId}:users:${userId}`)
            .then(res => {
                resolve(res > 0)
            })
            .catch(err => reject(err))
    });
}

const handleDisconnected = ({chatRoomId, chatId, userId, socketId}, client)=>{
    client.sRem(`chats:${chatId}:room:${chatRoomId}:users:${userId}`, socketId); // Hapus userId dari set Redis

    console.log(`User ${socketId} left room: ${chatRoomId} from disconnected`);
}

const markMessageAsRead = async (message, io) => {
    await chatRoomDB.updateOne(
        {
            chatRoomId: message?.chatRoomId,
            chatId: message?.chatId,
            messageId: message?.messageId
        },
        { status: 'READ' },
        { new: true }
    )

    io.emit('markMessageAsRead', message)
}

const sendMessage = async (message, io, socket, client) => {
    const newChatRoom = new chatRoomDB({
        chatId: message?.chatId,
        chatRoomId: message?.chatRoomId,
        messageId: message?.latestMessage?.messageId,
        senderUserId: message?.latestMessage?.senderUserId,
        messageType: message?.latestMessage?.messageType,
        textMessage: message?.latestMessage?.textMessage,
        latestMessageTimestamp: message?.latestMessage?.latestMessageTimestamp,
        status: message?.latestMessage?.status
    })
    await newChatRoom.save()
    
    const chatsCurrently = await chatsDB.findOne({
        chatRoomId: message?.chatRoomId,
        chatId: message?.chatId
    })

    const secondUserId = Object?.keys(chatsCurrently?.unreadCount)?.filter(id => id !== message?.latestMessage?.senderUserId)?.[0]
    const currentUnreadCountSecondUser = chatsCurrently?.unreadCount?.[secondUserId]

    const isSecondUserInRoom = await isUserInRoom(
        message?.chatId,
        message?.chatRoomId,
        secondUserId,
        client
    )

    const newUnreadCount = () => {
        return {
            [`${message?.latestMessage.senderUserId}`]: 0,
            [`${secondUserId}`]: isSecondUserInRoom === true ? 0 : currentUnreadCountSecondUser + 1
        }
    }
    await chatsDB.updateOne(
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

// const sendMessage = async (message, io, socket, client) => {
//     await chatRoomDB.updateOne(
//         {
//             chatRoomId: message?.chatRoomId,
//             chatId: message?.chatId
//         },
//         { $push: { data: { $each: [message?.latestMessage], $position: 0 } } },
//         { new: true }
//     )
//     const chatsCurrently = await chatsDB.findOne({
//         chatRoomId: message?.chatRoomId,
//         chatId: message?.chatId
//     })

//     const secondUserId = Object?.keys(chatsCurrently?.unreadCount)?.filter(id => id !== message?.latestMessage?.senderUserId)?.[0]
//     const currentUnreadCountSecondUser = chatsCurrently?.unreadCount?.[secondUserId]

//     const isSecondUserInRoom = await isUserInRoom(
//         message?.chatId,
//         message?.chatRoomId,
//         secondUserId,
//         client
//     )

//     const newUnreadCount = () => {
//         return {
//             [`${message?.latestMessage.senderUserId}`]: 0,
//             [`${secondUserId}`]: isSecondUserInRoom === true ? 0 : currentUnreadCountSecondUser + 1
//         }
//     }
//     await chatsDB.updateOne(
//         {
//             chatRoomId: message?.chatRoomId,
//             chatId: message?.chatId
//         },
//         {
//             unreadCount: newUnreadCount(),
//             latestMessage: message?.latestMessage,
//             latestMessageTimestamp: message?.latestMessage?.latestMessageTimestamp
//         },
//         { new: true }
//     )

//     // send back to the client for new message information
//     io.emit('newMessage', {
//         ...message,
//         unreadCount: newUnreadCount()
//     });
// }

const handleGetSendMessage = async (message, io, socket, client) => {
    if (message?.eventType === 'send-message') {
        sendMessage(message, io, socket, client)
    }
}

const chatRoom = {
    handleDisconnected,
    handleGetSendMessage,
    markMessageAsRead
}

module.exports = { chatRoom }