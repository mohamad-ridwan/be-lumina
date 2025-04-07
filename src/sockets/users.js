const users = require('../models/users')

async function isUserInOnline(id, client) {
    return await new Promise((resolve, reject) => {
        client.sCard(`user-online:${id}`)
            .then(res => {
                resolve(res > 0)
            })
            .catch(err => reject(err))
    });
}

const getUserOnlineInfo = async ({recipientId, senderId, profileIdConnection}, io, client)=>{
    const isUserOnline = await isUserInOnline(recipientId, client)
    if(isUserOnline === true){
        io.emit('getUserOnlineInfo', {status: 'online', recipientId, senderId, profileIdConnection})
    }else {
        const profile = await users.findOne({id: recipientId})
        if(profile?.id){
            io.emit('getUserOnlineInfo', {status: profile.lastSeenTime, recipientId, senderId, profileIdConnection})
        }
    }
}

async function userOffline(id, io, client, socketId){
    // delete first
    client.sRem(`user-online:${id}`, socketId)

    const isOtherDeviceInOnline = await isUserInOnline(id, client)

    const lastSeenTime = Date.now()

    if(isOtherDeviceInOnline === false){
        await users.updateOne({id}, {lastSeenTime}, {new: true})

        io.emit('userOffline', {id, lastSeenTime})
    }
}

const handleDisconnected = (id, io, socketId, client)=>{
    userOffline(id, io, client, socketId)
    console.log(`User Offline : ${socketId} userId : ${id}`)
}

function userOnline(id, io){
    io.emit('userOnline', id)
}

async function userProfile(data, io){
    const userCurrently = await users.findOne({id: data.profileId})

    if(!userCurrently){
        return
    }

    io.emit('user-profile', {
        senderId: data.senderId,
        profile: userCurrently,
        profileIdConnection: data.profileIdConnection,
        actionType: data.actionType
    })
}

const usersSocket = {
    getUserOnlineInfo,
    handleDisconnected,
    userOffline,
    userProfile,
    userOnline
}

module.exports = { usersSocket }