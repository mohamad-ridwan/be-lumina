const router = require('express').Router()

const {
    register,
    login,
    profile,
    getUser
} = require('../controllers/users')

router.post('/register', register)
router.post('/login', login)
router.post('/profile', profile)
router.post('/get-user', getUser)

module.exports = router