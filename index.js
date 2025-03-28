require('dotenv').config()
const express = require('express')
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors')
const dbConnection = require('./src/dbConnection')
const errorHandler = require('./src/utils/errorHandler')
const { customHeader } = require('./src/utils/middlewares');
const { chatRoom } = require('./src/sockets/chatRoom');

const app = express()
const server = http.createServer(app); // Buat server HTTP
const io = socketIo(server, { // Inisialisasi Socket.io
    cors: {
        origin: "*", // Sesuaikan dengan origin aplikasi client Anda
        methods: ["GET", "POST"],
    },
});

const PORT = process.env.PORT || 4001

dbConnection()
    .then(() => {
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

            socket.on('sendMessage', (message) => {
                chatRoom.handleGetSendMessage(message, io)
            });
        });

        server.listen(PORT, () => { // Gunakan server.listen, bukan app.listen
            console.log(`Server is running on port ${PORT}`);
        });
    })
    .catch((error) => console.log(error))