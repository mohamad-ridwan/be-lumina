require('dotenv').config()
const express = require('express')
const redis = require('redis');
const client = redis.createClient();
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors')
const dbConnection = require('./src/dbConnection')
const errorHandler = require('./src/utils/errorHandler')
const { customHeader } = require('./src/utils/middlewares');
const { chatRoom } = require('./src/sockets/chatRoom');
const { usersSocket } = require('./src/sockets/users');

const app = express()
const server = http.createServer(app); // Buat server HTTP
const io = socketIo(server, { // Inisialisasi Socket.io
    cors: {
        origin: "*", // Sesuaikan dengan origin aplikasi client Anda
        methods: ["GET", "POST"],
    },
});

const PORT = process.env.PORT || 4001

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
        app.use(cors())
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
            console.log('A user connected');

            // Tambahkan penanganan peristiwa socket di sini
            socket.on('disconnect', () => {
                console.log('A user disconnected');
            });

            socket.on('joinRoom', (room) => {
                const { chatRoomId, chatId, userId } = room;

                client.sAdd(`chats:${chatId}:room:${chatRoomId}:users`, userId); // Tambahkan userId ke set Redis

                console.log(`User ${userId} joined room: ${chatRoomId}`);
            });

            socket.on('leaveRoom', (room) => {
                const { chatRoomId, chatId, userId } = room;

                client.sRem(`chats:${chatId}:room:${chatRoomId}:users`, userId); // Hapus userId dari set Redis

                console.log(`User ${userId} left room: ${chatRoomId}`);
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