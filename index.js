require('dotenv').config()
const express = require('express')
const redis = require('redis');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors')
const dbConnection = require('./src/dbConnection')
const errorHandler = require('./src/utils/errorHandler')
const { customHeader } = require('./src/utils/middlewares');
const { chatRoom } = require('./src/sockets/chatRoom');
const { usersSocket } = require('./src/sockets/users');
const { chatsSocket } = require('./src/sockets/chats');

const app = express()
const server = http.createServer(app); // Buat server HTTP
const io = socketIo(server, { // Inisialisasi Socket.io
    cors: {
        origin: ["https://lumina-a8fa3.web.app", "http://localhost:3125"], // Sesuaikan dengan origin aplikasi client Anda
        methods: ["GET", "POST"],
    },
});

const PORT = process.env.PORT || 4001

// Gunakan REDIS_URL dari environment variable
const client = redis.createClient({
    url: process.env.REDIS_URL
});

client.on('error', (err) => {
    console.error('Redis Client Error', err);
});

client.connect().then(() => {
    console.log('Redis client connected');
}).catch((err) => {
    console.error('Redis connection error:', err);
});

dbConnection()
    .then(async () => {
        app.use(cors({
            origin: "http://localhost:3125" // Sesuaikan untuk development
            // origin: "https://<nama-app-frontend>.vercel.app" // Sesuaikan untuk production
        }));
        app.use(express.json());
        app.use(express.urlencoded({ extended: true }));

        app.use(customHeader)
        app.use("/", require("./src/routes"));
        app.use(errorHandler);

        // app.listen(PORT, () => {
        //     console.log(`Server is running on port ${PORT}`)
        // })

        // Socket.io Connection
        io.on('connection', (socket) => {
            console.log('A user connected', socket.id)
            const socketId = socket.id

            socket.on('disconnect', () => {
                console.log('A user disconnected', socket.id);

                const { chatRoomId, chatId, userId, typingId, typingRecipientId } = socket
                if(userId){
                    usersSocket.handleDisconnected(userId, io, socketId, client)
                }
                if(typingId){
                    io.emit('typing-stop', {recipientId: typingRecipientId, senderId: typingId})
                    delete socket.typingId
                    delete socket.typingRecipientId
                }
                if(chatRoomId){
                    chatRoom.handleDisconnected({
                        chatRoomId,
                        chatId,
                        userId,
                        socketId
                    }, client)
                }
            });

            socket.on('typing-start', (data)=>{
                if(data){
                    socket.typingId = data.senderId
                    socket.typingRecipientId = data.recipientId
                }
                io.emit('typing-start', data)
            })
            socket.on('typing-stop', (data)=>{
                if(data){
                    delete socket.typingId
                    delete socket.typingRecipientId
                }
                io.emit('typing-stop', data)
            })

            socket.on('getUserOnlineInfo', (data)=>{
                if(data){
                    usersSocket.getUserOnlineInfo(data, io, client)
                }
            })

            socket.on('userOnline', (id)=>{
                if(id){
                    client.sAdd(`user-online:${id}`, socketId)
                    usersSocket.userOnline(id, io)
                    socket.userId = id

                    console.log(`User online : ${socketId} userId : ${id}`)
                }
            })

            socket.on('userOffline', (id)=>{
                if(id){
                    usersSocket.userOffline(id, io, client, socketId)

                    console.log(`User Offline : ${socketId} userId : ${id}`)
                }
            })

            socket.on('joinRoom', (room) => {
                const { chatRoomId, chatId, userId } = room;

                // save chatRoom information to socket session
                socket.chatRoomId = chatRoomId
                socket.chatId = chatId
                socket.userId = userId

                client.sAdd(`chats:${chatId}:room:${chatRoomId}:users:${userId}`, socketId); // Tambahkan userId ke set Redis
                chatsSocket.readNotification(room, io)

                console.log(`User ${socketId} joined room: ${chatRoomId}`);
            });

            socket.on('leaveRoom', (room) => {
                const { chatRoomId, chatId, userId } = room;

                client.sRem(`chats:${chatId}:room:${chatRoomId}:users:${userId}`, socketId); // Hapus userId dari set Redis

                console.log(`User ${socketId} left room: ${chatRoomId}`);
            });

            socket.on('sendMessage', (message) => {
                chatRoom.handleGetSendMessage(message, io, socket, client)
            });

            socket.on('markMessageAsRead', (message) => {
                chatRoom.markMessageAsRead(message, io)
            })

            socket.on('user-profile', (data)=>{
                usersSocket.userProfile(data, io)
                console.log('get from userId : ', data.profileId)
            })
        });

        server.listen(PORT, () => { // Gunakan server.listen, bukan app.listen
            console.log(`Server is running on port ${PORT}`);
        });
    })
    .catch((error) => console.log(error))