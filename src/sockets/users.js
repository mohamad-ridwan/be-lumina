const users = require('../models/users')

async function userProfile(userId, io){
    const userCurrently = await users.findOne({id: userId})

    if(!userCurrently){
        return
    }

    io.emit('user-profile', userCurrently)
}

const usersSocket = {
    userProfile
}

module.exports = { usersSocket }