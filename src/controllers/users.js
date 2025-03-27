const { HTTP_STATUS_CODE } = require('../constant')
const { generateRandomId } = require('../helpers/generateRandomId')
const users = require('../models/users')

exports.login = async (req, res, next) => {
    const {
        username, // username || email
        password,
        phoneNumber
    } = req.body

    let err = {}
    if (!username || !username.trim()) {
        err.username = 'Username or email required!'
    } else if (!password || !password.trim()) {
        err.password = 'Password required!'
    } else if (!phoneNumber || !phoneNumber.trim()) {
        err.phoneNumber = 'Phone Number required!'
    }

    if (Object.keys(err).length > 0) {
        res.status(HTTP_STATUS_CODE.BAD_REQUEST).json({
            message: Object.entries(err).map(p => p[1])[0]
        })
        next()
        return
    }

    const userCurrently = await users.findOne({
        $or: [{ username: username }, { email: username }],
        password,
        phoneNumber,
        verification: true
    })

    if(!userCurrently){
        res.status(HTTP_STATUS_CODE.NOT_FOUND).json({
            message: 'Account not registered!'
        })
        next()
        return
    }

    res.status(HTTP_STATUS_CODE.OK).json({
        message: 'Successfully logged in',
        data: userCurrently
    })
    next()
}

exports.register = async (req, res, next) => {
    const {
        email,
        username,
        password,
        phoneNumber
    } = req.body

    let err = {}
    if (!email || !email.trim()) {
        err.email = 'Email required!'
    } else if (!username || !username.trim()) {
        err.username = 'Username required!'
    } else if (!password || !password.trim()) {
        err.password = 'Password required!'
    } else if (!phoneNumber || !phoneNumber.trim()) {
        err.phoneNumber = 'Phone Number required!'
    }

    if (Object.keys(err).length > 0) {
        res.status(HTTP_STATUS_CODE.BAD_REQUEST).json({
            message: Object.entries(err).map(p => p[1])[0]
        })
        next()
        return
    }

    const isUserAvailable = await users.findOne({ email })

    if (isUserAvailable && isUserAvailable?.verification) {
        res.status(HTTP_STATUS_CODE.BAD_REQUEST).json({
            message: 'Email or phone number is already registered!'
        })
        next()
        return
    } else if (isUserAvailable && !isUserAvailable?.verification) {
        res.status(HTTP_STATUS_CODE.BAD_REQUEST).json({
            message: 'Your account needs to be verified'
        })
        next()
        return
    }

    const post = new users({
        verification: false,
        username,
        email,
        password,
        image: null,
        id: generateRandomId(),
        phoneNumber
    })
    post
        .save()
        .then((result) => {
            res.status(HTTP_STATUS_CODE.OK).json({
                message: 'Successfully registered account',
                data: result
            })
            next()
        })
        .catch((err) => {
            console.log('err-register', err)
            next(err)
        })
}