const router = require('express').Router()

const {
    register,
    login,
    profile,
    getUser,
    searchUser
} = require('../controllers/users')

router.post('/register', register)
router.post('/login', login)
router.post('/profile', profile)
router.post('/get-user', getUser)
router.post('/search-users', searchUser)

module.exports = router