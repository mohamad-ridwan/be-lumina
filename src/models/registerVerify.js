const mongoose = require('mongoose')

const Schema = mongoose.Schema

const registerVerify = new Schema(
    {
        token: {
            type: String
        },
        tokenClient: {
            type: String
        },
        userId: {
            type: String
        }
    },
    {
        timestamps: true
    }
)

module.exports = mongoose.model('register-verify', registerVerify)