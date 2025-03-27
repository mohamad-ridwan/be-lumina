const chats = require('../models/chats')
const { HTTP_STATUS_CODE } = require('../constant');

exports.addChats = async (req, res, next) => {
    const { userIds } = req.body

    if(!userIds || userIds.length !== 2){
        res.status(HTTP_STATUS_CODE.BAD_REQUEST).json({
            message: 'Invalid userid error'
        })
        return
    }
}