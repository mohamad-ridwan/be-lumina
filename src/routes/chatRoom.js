const router = require('express').Router()

const {
    getChatRoom,
    stream,
    getMessagesPagination,
    getMessagesAround
    // getBatchChatRoom
} = require('../controllers/chatRoom')

router.post('/', getChatRoom)
router.get('/stream', stream)
router.get('/messages', getMessagesPagination)
router.get('/messages/:chatRoomId/message/:messageId/around', getMessagesAround)
// router.post('/batch', getBatchChatRoom)

module.exports = router