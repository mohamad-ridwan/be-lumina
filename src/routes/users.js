const router = require('express').Router()

const {
    register,
    login,
    profile
} = require('../controllers/users')

router.post('/register', register)
router.post('/login', login)
router.post('/profile', profile)

module.exports = router