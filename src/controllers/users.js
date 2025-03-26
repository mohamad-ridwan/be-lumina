const { HTTP_STATUS_CODE } = require('../constant')
const { generateRandomId } = require('../helpers/generateRandomId')
const users = require('../models/users')

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
    }

    const isUserAvailable = await users.findOne({ email })

    if (isUserAvailable && isUserAvailable?.verification) {
        res.status(HTTP_STATUS_CODE.BAD_REQUEST).json({
            message: 'Email or phone number is already registered!'
        })
    } else if (isUserAvailable && !isUserAvailable?.verification) {
        res.status(HTTP_STATUS_CODE.BAD_REQUEST).json({
            message: 'Your account needs to be verified'
        })
    }

    res.status(HTTP_STATUS_CODE.OK).json({
        message: 'Successfully registered account',
    })

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
        })
        .catch((err) => {
            console.log('err-register', err)
            next(err)
        })
}