const mongoose = require('mongoose')
const chats = require('../models/chats')
const chatRoom = require('../models/chatRoom')
const { HTTP_STATUS_CODE } = require('../constant');
const { generateRandomId } = require('../helpers/generateRandomId');

exports.getMessagesAround = async (req, res) => {
  const { chatRoomId, messageId } = req.params
  const limit = Math.min(parseInt(req.query.limit) || 50, 100) // Default 50, max 100

  try {
    // Cari pesan target untuk ambil timestamp & messageId
    const targetMessage = await chatRoom.findOne({ chatRoomId, messageId })
    if (!targetMessage) {
      return res.status(404).json({ error: 'Message not found' })
    }

    const targetTimestamp = Number(targetMessage.latestMessageTimestamp)
    const targetMessageId = targetMessage.messageId
    const halfLimit = Math.floor(limit / 2)

    // Ambil pesan sebelum target
    let beforeMessages = await chatRoom.find({
      chatRoomId,
      $or: [
        { latestMessageTimestamp: { $lt: targetTimestamp } },
        {
          latestMessageTimestamp: targetTimestamp,
          messageId: { $lt: targetMessageId } // Kalau timestamp sama, messageId lebih kecil dianggap "sebelum"
        }
      ]
    })
      .sort({ latestMessageTimestamp: -1, messageId: -1 }) // Urutkan terbaru ke terlama
      .limit(halfLimit)

    // Cek apakah pesan teratas beforeMessages adalah header
    if (beforeMessages.length > 0 && beforeMessages[0]?.isHeader === true) {
      const topMessage = beforeMessages[beforeMessages.length - 1]

      const extraMessage = await chatRoom.findOne({
        chatRoomId,
        $or: [
          { latestMessageTimestamp: { $lt: topMessage.latestMessageTimestamp } },
          {
            latestMessageTimestamp: topMessage.latestMessageTimestamp,
            messageId: { $lt: topMessage.messageId }
          }
        ]
      })
        .sort({ latestMessageTimestamp: -1, messageId: -1 })

      if (extraMessage) {
        beforeMessages.push(extraMessage)
      }
    }

    // Ambil pesan sesudah target
    const afterLimit = limit - beforeMessages.length - 1 // Sisa quota
    const afterMessages = await chatRoom.find({
      chatRoomId,
      $or: [
        { latestMessageTimestamp: { $gt: targetTimestamp } },
        {
          latestMessageTimestamp: targetTimestamp,
          messageId: { $gt: targetMessageId }
        }
      ]
    })
      .sort({ latestMessageTimestamp: 1, messageId: 1 }) // Terlama ke terbaru
      .limit(afterLimit > 0 ? afterLimit : 0)

    // Gabungkan: before (dibalik dulu) + target + after
    const result = [
      ...beforeMessages.reverse(),
      targetMessage,
      ...afterMessages
    ]

    res.json({
      messages: result,
      targetMessageId: messageId,
      total: result.length
    })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
}

exports.getMessagesPagination = async (req, res, next) => {
  try {
    const { chatId, chatRoomId, messageId, direction } = req.query
    const limit = parseInt(req.query.limit) || 20

    if (!chatId || !chatRoomId || !messageId || !direction) {
      return res.status(400).json({ error: 'Missing required query parameters.' })
    }

    // Temukan anchor message berdasarkan messageId
    const anchor = await chatRoom.findOne({ chatId, chatRoomId, messageId })

    if (!anchor) {
      return res.status(404).json({ error: 'Anchor message not found.' })
    }

    const timestamp = Number(anchor.latestMessageTimestamp)

    let query = {}
    let sort = {}

    // ⛔️ FIXED: Tukar logika prev & next
    if (direction === 'next') {
      // Sebelumnya prev → sekarang jadi next
      query = {
        chatId,
        chatRoomId,
        latestMessageTimestamp: { $lt: timestamp },
      }
      sort = { latestMessageTimestamp: -1 }
    } else if (direction === 'prev') {
      // Sebelumnya next → sekarang jadi prev
      query = {
        chatId,
        chatRoomId,
        latestMessageTimestamp: { $gt: timestamp },
      }
      sort = { latestMessageTimestamp: 1 }
    } else {
      return res.status(400).json({ error: 'Invalid direction. Use "prev" or "next".' })
    }

    const messages = await chatRoom
      .find(query)
      .sort(sort)
      .limit(limit)
      .lean()

    const totalMessages = await chatRoom.countDocuments({ chatId, chatRoomId })

    const firstMessage = await chatRoom
      .findOne({ chatId, chatRoomId })
      .sort({ latestMessageTimestamp: 1 })

    const lastMessage = await chatRoom
      .findOne({ chatId, chatRoomId })
      .sort({ latestMessageTimestamp: -1 })

    const hasPrev = timestamp < Number(lastMessage.latestMessageTimestamp)
    const hasNext = timestamp > Number(firstMessage.latestMessageTimestamp)

    // ✅ Tetap balik jika dari arah 'next' (sekarang ambil dari paling baru → lama)
    const sortedMessages = direction === 'next' ? messages.reverse() : messages

    return res.json({
      data: sortedMessages.map((item)=>({
        ...item,
        latestMessageTimestamp: Number(item.latestMessageTimestamp),
      })).sort((a, b) => {
        if (a.latestMessageTimestamp === b.latestMessageTimestamp) {
          if (a.isHeader && !b.isHeader) return 1
          if (!a.isHeader && b.isHeader) return -1
          return 0
        }
        return b.latestMessageTimestamp - a.latestMessageTimestamp
      }),
      meta: {
        anchorMessageId: anchor.messageId,
        hasPrev,
        hasNext,
        totalMessages,
        fetchedCount: sortedMessages.length,
        direction
      },
    })
  } catch (err) {
    next(err)
  }
}

exports.stream = async(req, res)=>{
    res.set({
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      
      const { chatId, chatRoomId } = req.query;

      let buffer = [];
      let totalMessages = 0
    
      try {
        const cursor = chatRoom
        .find({ chatId, chatRoomId })
        .sort({ latestMessageTimestamp: -1, isHeader: 1 }) // Urutkan berdasarkan timestamp menurun, lalu isHeader menaik
        .allowDiskUse(true)
        .batchSize(40)
        .cursor();
    
          for await (const doc of cursor) {
            buffer.push({...doc._doc, id: doc._doc.messageId});
        
            if (buffer.length >= 20) {
              res.write(`data: ${JSON.stringify(buffer)}\n\n`);
              totalMessages += buffer.length;
              buffer = [];
              await new Promise((resolve) => setTimeout(resolve, 500));
            }
          }
        
          // Kirim sisa data kalau ada (kurang dari 20)
          if (buffer.length > 0) {
            res.write(`data: ${JSON.stringify(buffer)}\n\n`);
            totalMessages += buffer.length;
          }

          const totalMessageData = {
            totalMessages
          }
        
          // Kirim event selesai
          res.write(`event: done\ndata: ${JSON.stringify(totalMessageData)}\n\n`);
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