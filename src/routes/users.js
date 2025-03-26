const router = require('express').Router()

const {
    register
} = require('../controllers/users')

router.post('/register', register)

module.exports = router