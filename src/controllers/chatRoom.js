const mongoose = require('mongoose')
const chats = require('../models/chats')
const chatRoom = require('../models/chatRoom')
const { HTTP_STATUS_CODE } = require('../constant');
const { generateRandomId } = require('../helpers/generateRandomId');

exports.stream = async(req, res)=>{
    res.set({
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      
      const { chatId, chatRoomId } = req.query;

      let buffer = [];
    
      try {
        const cursor = chatRoom
          .find({ chatId, chatRoomId })
          .sort({latestMessageTimestamp: -1})
          .batchSize(40)
          .cursor();
    
          for await (const doc of cursor) {
            buffer.push({...doc._doc, id: doc._doc.messageId});
        
            if (buffer.length >= 20) {
              res.write(`data: ${JSON.stringify(buffer)}\n\n`);
              buffer = [];
              await new Promise((resolve) => setTimeout(resolve, 1000));
            }
          }
        
          // Kirim sisa data kalau ada (kurang dari 50)
          if (buffer.length > 0) {
            res.write(`data: ${JSON.stringify(buffer)}\n\n`);
          }
        
          // Kirim event selesai
          res.write(`event: done\ndata: {}\n\n`);
          res.end();
      } catch (error) {
        console.error('Error streaming:', error);
        res.write(`event: error\ndata: ${JSON.stringify({ message: 'Internal Error' })}\n\n`);
        res.end();
      }
}

exports.getChatRoom = async (req, res, next)=>{
    const session = await mongoose.startSession();
    session.startTransaction();

    const { userIds, mainUserId } = req.body

    const isSameIds = userIds?.filter((value, index) => userIds?.indexOf(value) !== index)

    let err = {}
    if (!mainUserId || !mainUserId.trim()) {
        err.mainUserId = 'mainUserId required'
    } else if (!userIds || userIds.length !== 2 || isSameIds?.length > 0) {
        err.userIds = 'Invalid userid error'
    }

    if (Object.keys(err).length > 0) {
        await session.abortTransaction();
        session.endSession();
        res.status(HTTP_STATUS_CODE.BAD_REQUEST).json({
            message: Object.entries(err).map(p => p[1])[0]
        })
        return
    }

    // find existing chat
    const chatsCurrently = await chats.findOne({
        userIds: { $size: 2, $all: userIds },
    });

    // const cursor = chatRoom.findOne({userIds: { $size: 2, $all: userIds }}).batchSize(100).cursor()
    // const cursor = chatRoom.find().batchSize(2).cursor()
    // cursor.on('data',(data) => {
    //     console.log('data', data?._id);
    // })

    // if chat is already exist,
    // don't save to db
    if (chatsCurrently?._doc) {
        await session.commitTransaction();
        session.endSession();

        res.status(HTTP_STATUS_CODE.OK).json({
            message: 'Chat room data',
            ...chatsCurrently._doc
        })
        
        return
    }

    async function createChatroomAndChats() {
        try {
            const chatRoomId = generateRandomId()
            const chatId = generateRandomId()
            const creationDate = Date.now()

            // if chat is empty
            const newChats = new chats({
                chatId,
                chatRoomId,
                unreadCount: {
                    [`${userIds[0]}`]: 0,
                    [`${userIds[1]}`]: 0
                },
                latestMessageTimestamp: 0,
                chatCreationDate: creationDate,
                userIds: userIds,
            })

            await newChats.save({ session })

            await session.commitTransaction();
            session.endSession();

            return {
                message: 'Chat room data',
                ...newChats?._doc
            }
        } catch (error) {
            await session.abortTransaction();
            session.endSession();
            return error
        }
    }

    const result = await createChatroomAndChats()
    if (!result?.chatId) {
        next(result)
        return
    }
    res.status(HTTP_STATUS_CODE.OK).json(result)
}

// exports.getChatRoom = async (req, res, next) => {
//     const session = await mongoose.startSession();
//     session.startTransaction();

//     const { userIds, mainUserId } = req.body

//     const isSameIds = userIds?.filter((value, index) => userIds?.indexOf(value) !== index)

//     let err = {}
//     if (!mainUserId || !mainUserId.trim()) {
//         err.mainUserId = 'mainUserId required'
//     } else if (!userIds || userIds.length !== 2 || isSameIds?.length > 0) {
//         err.userIds = 'Invalid userid error'
//     }

//     if (Object.keys(err).length > 0) {
//         await session.abortTransaction();
//         session.endSession();
//         res.status(HTTP_STATUS_CODE.BAD_REQUEST).json({
//             message: Object.entries(err).map(p => p[1])[0]
//         })
//         return
//     }

//     // find existing chat
//     const chatsCurrently = await chats.findOne({
//         userIds: { $size: 2, $all: userIds },
//     });
//     const chatRoomCurrently = await chatRoom.findOne({
//         userIds: { $size: 2, $all: userIds },
//     })

//     // const cursor = chatRoom.findOne({userIds: { $size: 2, $all: userIds }}).batchSize(100).cursor()
//     // const cursor = chatRoom.find().batchSize(2).cursor()
//     // cursor.on('data',(data) => {
//     //     console.log('data', data?._id);
//     // })

//     // if chat is already exist,
//     // don't save to db
//     if (chatsCurrently?._doc) {
//         await session.commitTransaction();
//         session.endSession();

//         res.status(HTTP_STATUS_CODE.OK).json({
//             message: 'Chat room data',
//             ...chatRoomCurrently._doc
//         })
        
//         return
//     }

//     async function createChatroomAndChats() {
//         try {
//             const chatRoomId = generateRandomId()
//             const chatId = generateRandomId()
//             const creationDate = Date.now()

//             // if chat is empty
//             const newChats = new chats({
//                 chatId,
//                 chatRoomId,
//                 unreadCount: {
//                     [`${userIds[0]}`]: 0,
//                     [`${userIds[1]}`]: 0
//                 },
//                 latestMessageTimestamp: 0,
//                 chatCreationDate: creationDate,
//                 userIds: userIds,
//             })
//             const newChatRoom = new chatRoom({
//                 chatRoomId,
//                 chatId,
//                 data: [],
//                 chatRoomCreationDate: creationDate,
//                 userIds: userIds,
//             })

//             await newChats.save({ session })
//             await newChatRoom.save({ session })

//             await session.commitTransaction();
//             session.endSession();

//             return {
//                 message: 'Chat room data',
//                 ...newChatRoom?._doc
//             }
//         } catch (error) {
//             await session.abortTransaction();
//             session.endSession();
//             return error
//         }
//     }

//     const result = await createChatroomAndChats()
//     if (!result?.chatId) {
//         next(result)
//         return
//     }
//     res.status(HTTP_STATUS_CODE.OK).json(result)
// }