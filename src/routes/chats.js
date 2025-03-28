const router = require('express').Router()

const {
    getChats,
} = require('../controllers/chats')

router.get('/', getChats)

module.exports = router