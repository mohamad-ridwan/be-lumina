const router = require('express').Router()

const {
    getChatRoom,
} = require('../controllers/chatRoom')

router.post('/', getChatRoom)

module.exports = router