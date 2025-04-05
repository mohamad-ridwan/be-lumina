const chats = require('../models/chats')
const { HTTP_STATUS_CODE } = require('../constant');

exports.getChats = async (req, res, next) => {
    const { userId } = req.query

    if (!userId || !userId.trim()) {
        res.status(HTTP_STATUS_CODE.BAD_REQUEST).json({
            message: 'userId required'
        })
        return
    }

    const chatsCurrently = await chats.find({
        userIds: { $in: [userId] },
        latestMessage: { $exists: true }
    }).sort({ latestMessageTimestamp: -1 })

    res.status(HTTP_STATUS_CODE.OK).json({
        message: 'Chats Data',
        data: chatsCurrently
    })
}