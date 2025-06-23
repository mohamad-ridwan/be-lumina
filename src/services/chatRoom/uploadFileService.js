const path = require("path");
const fs = require("fs").promises;
const {
  processVideo,
  BASE_UPLOAD_DIR,
  processImage,
  generateThumbnailFromVideo,
  isUserInRoom,
  getTodayHeader,
} = require("../../helpers/general");
const chatRoom = require("../../models/chatRoom");
const chatsDB = require("../../models/chats");
const usersDB = require("../../models/users");
const { generateRandomId } = require("../../helpers/generateRandomId");
const { uploadFileToFirebase } = require("../../utils/firebase");
const { sendMessage } = require("../../sockets/chatRoom");
const ffprobeStatic = require("ffprobe-static");
const { spawn } = require("child_process");

const uploadImageService = async (req, res) => {
  let originalInputFilePath = null;
  let compressedImageFilePath = null;

  try {
    if (!req.file) {
      return res.status(400).send("Tidak ada file yang diupload.");
    }

    originalInputFilePath = req.file.path; // Path file asli dari Multer
    const message = JSON.parse(req.body.message); // Objek pesan dari frontend
    const {
      chatId,
      chatRoomId,
      latestMessage,
      recipientProfileId,
      isNeedHeaderDate,
    } = message;
    const { senderUserId, messageId, document } = latestMessage;

    const io = req.app.locals.io; // Mengakses instance Socket.IO dari app.locals
    const client = req.app.locals.redisClient;

    // send message first
    await sendMessage(message, io, undefined, client);

    const originalFileName = req.file.originalname;
    const inputFilePath = req.file.path;
    const mimetype = req.file.mimetype; // e.g., 'image/jpeg'

    // Buat nama file output yang unik untuk gambar terkompresi
    const timestamp = Date.now();
    const originalNameWithoutExt = path.parse(originalFileName).name;
    const outputFileName = `compressed_image_${originalNameWithoutExt}_${timestamp}.jpeg`; // Asumsi output JPEG
    compressedImageFilePath = path.join(BASE_UPLOAD_DIR, outputFileName);

    console.log("Memulai pemrosesan gambar...");

    // Panggil processImage untuk kompresi gambar
    const { filePath: actualCompressedFilePath, buffer: compressedBuffer } =
      await processImage(
        inputFilePath,
        compressedImageFilePath,
        [], // Biarkan argumen kosong agar processImage menggunakan default untuk gambar
        (percentage) => {
          // Progress untuk gambar mungkin tidak selalu relevan seperti video
          // tapi callback ini tetap bisa dipanggil sekali di 100% jika perlu.
          console.log(`Progress kompresi gambar: ${percentage}%`);
          io.emit("media-message-progress", {
            ...message,
            latestMessage: {
              ...message.latestMessage,
              document: {
                ...message.latestMessage.document,
                progress: percentage,
              },
            },
          });
          chatRoom
            .updateOne(
              { chatRoomId: chatRoomId, messageId: messageId },
              { $set: { "document.progress": percentage } }
            )
            .then(() =>
              console.log(
                `Image progress for message ${messageId} updated to ${percentage}%`
              )
            )
            .catch((dbErr) =>
              console.error(
                `Failed to update image progress for message ${messageId}:`,
                dbErr
              )
            );
        }
      );

    // Unggah gambar terkompresi ke Firebase Storage
    const destinationPath = `lumina/images/lumina-${generateRandomId(15)}.jpeg`; // Pastikan ekstensi sesuai output
    const imageMimetype = "image/jpeg"; // MIME type gambar terkompresi

    const downloadURL = await uploadFileToFirebase(
      compressedBuffer,
      destinationPath,
      imageMimetype,
      io,
      message // Meneruskan objek message ke uploader jika diperlukan untuk event
    );

    if (!downloadURL) {
      throw new Error("Image download URL tidak tersedia.");
    }

    // mulai proses update chatRoom dan chatsDB
    // Cari header yang ada hari ini
    const headerMessageToday = await getTodayHeader(chatId, chatRoomId);

    const completionTimestamp = Date.now();

    let completionTimeId;
    let headerMessage;
    let headerId;

    if (!headerMessageToday) {
      // ❌ Belum ada header → buat header baru
      completionTimeId = generateRandomId(15);
      headerId = generateRandomId(15);

      headerMessage = new chatRoom({
        chatId,
        chatRoomId,
        messageId: headerId,
        isHeader: true,
        senderUserId: latestMessage?.senderUserId,
        latestMessageTimestamp: completionTimestamp,
        timeId: completionTimeId,
        completionTimestamp,
        completionTimeId,
      });
      await headerMessage.save();
    } else {
      completionTimeId = headerMessageToday.timeId;
      headerId = headerMessageToday.messageId;
    }

    await chatRoom
      .updateOne(
        { chatRoomId, messageId },
        {
          $set: {
            "document.progress": 100,
            "document.isProgressDone": true,
            "document.url": downloadURL,
            completionTimestamp,
            completionTimeId,
          },
        }
      )
      .then(() => {
        console.log(
          `Progress untuk message ${messageId} di chatRoom ${chatRoomId} diupdate ke ${100}%`
        );
      })
      .catch((dbErr) => {
        console.error(
          `Gagal mengupdate progress database untuk message ${messageId}:`,
          dbErr
        );
        // Anda mungkin ingin mengirim notifikasi error ke frontend juga
        // io.to(processId).emit("video-message-progress-error", { messageId, error: dbErr.message });
      });

    // update unreadcount & get latest message
    const chatsCurrently = await chatsDB.findOne({ chatRoomId, chatId });
    const secondUserId = Object.keys(chatsCurrently?.unreadCount || {}).find(
      (id) => id !== latestMessage?.senderUserId
    );
    const currentMainUserUnreadCount =
      chatsCurrently?.unreadCount?.[senderUserId] || 0;
    const currentSecondUserUnreadCount =
      chatsCurrently?.unreadCount?.[secondUserId] || 0;

    const isSecondUserInRoom = await isUserInRoom(
      chatId,
      chatRoomId,
      secondUserId,
      client
    );

    const newUnreadCount = {
      [latestMessage.senderUserId]: currentMainUserUnreadCount,
      [secondUserId]: isSecondUserInRoom ? 0 : currentSecondUserUnreadCount + 1,
    };

    // Update latestMessage sebagai array
    let updatedLatestMessages = Array.isArray(chatsCurrently.latestMessage)
      ? [...chatsCurrently.latestMessage]
      : [];

    const latestMessageWithUserId2 = {
      ...latestMessage,
      userId: recipientProfileId,
      timeId: completionTimeId,
      completionTimestamp,
      completionTimeId,
    };

    latestMessageWithUserId2.document = {
      ...message.latestMessage.document,
      mimetype,
      url: downloadURL,
      progress: 100,
      isProgressDone: true,
      isCancelled: false,
    };

    const existingIndexUserId2 = updatedLatestMessages.findIndex(
      (item) => item.userId === recipientProfileId
    );

    if (existingIndexUserId2 !== -1) {
      updatedLatestMessages[existingIndexUserId2] = latestMessageWithUserId2;
    } else {
      updatedLatestMessages.push(latestMessageWithUserId2);
    }

    updatedLatestMessages = updatedLatestMessages.filter(
      (item) => item?.userId
    );

    await chatsDB.updateOne(
      { chatRoomId, chatId },
      {
        unreadCount: newUnreadCount,
        latestMessage: updatedLatestMessages,
      },
      { new: true }
    );

    // emit header dulu
    if (headerMessage?.messageId) {
      io.emit("newMessage", {
        chatId,
        chatRoomId,
        eventType: message.eventType,
        isNeedHeaderDate,
        recipientProfileId,
        timeId: completionTimeId,
        messageId: headerMessage.messageId,
        isHeader: true,
        isFromMedia: true,
        latestMessageTimestamp: headerMessage.latestMessageTimestamp,
        completionTimestamp,
        completionTimeId,
      });
    }

    const senderUserProfile = await usersDB.findOne({ id: senderUserId });

    io.emit("media-message-progress-done", {
      ...message,
      latestMessage: {
        ...message.latestMessage,
        document: {
          ...message.latestMessage.document,
          url: downloadURL,
          progress: 100,
          isProgressDone: true,
          isCancelled: false,
        },
        completionTimestamp,
        completionTimeId,
      },
      updatedChatLatestMessages: updatedLatestMessages,
      username: senderUserProfile?.username,
      image: senderUserProfile?.image,
      imgCropped: senderUserProfile?.imgCropped,
      thumbnail: senderUserProfile?.thumbnail,
      unreadCount: newUnreadCount,
      timeId: completionTimeId,
      headerId,
    });

    console.log("Pemrosesan gambar selesai.");

    // Kirim respons sukses ke client
    res.status(200).json({
      message: "Gambar berhasil diupload dan diproses!",
      originalFile: originalFileName,
      //   compressedFileUrl: downloadURL,
    });
  } catch (error) {
    console.error("Error dalam uploadImageService:", error);
    if (originalInputFilePath) {
      await fs
        .unlink(originalInputFilePath)
        .catch((err) =>
          console.error(
            `Gagal menghapus file input asli setelah error ${originalInputFilePath}:`,
            err
          )
        );
    }
    if (compressedImageFilePath) {
      await fs
        .unlink(compressedImageFilePath)
        .catch((err) =>
          console.error(
            `Gagal menghapus file terkompresi lokal setelah error ${compressedImageFilePath}:`,
            err
          )
        );
    }
    res
      .status(500)
      .send("Terjadi kesalahan server internal selama pemrosesan gambar.");
  } finally {
    if (originalInputFilePath) {
      await fs
        .unlink(originalInputFilePath)
        .catch((err) =>
          console.error(
            `Gagal menghapus file input asli ${originalInputFilePath}:`,
            err
          )
        );
    }
    if (compressedImageFilePath) {
      await fs
        .unlink(compressedImageFilePath)
        .catch((err) =>
          console.error(
            `Gagal menghapus file terkompresi lokal ${compressedImageFilePath}:`,
            err
          )
        );
    }
  }
};

const uploadVideoService = async (req, res) => {
  let originalInputFilePath = null; // Tambahkan ini untuk cleanup yang lebih baik
  let compressedVideoFilePath = null; // Tambahkan ini untuk cleanup yang lebih baik
  let downloadedVideoTempPath = null; // Untuk cleanup video yang diunduh untuk thumbnail
  let thumbnailTempFilePath = null;

  try {
    if (!req.file) {
      return res.status(400).send("Tidak ada file yang diupload.");
    }
    originalInputFilePath = req.file.path;

    const message = JSON.parse(req.body.message);
    const {
      chatRoomId,
      chatId,
      isNeedHeaderDate,
      latestMessage,
      recipientProfileId,
    } = message;
    const { senderUserId, messageId, document } = latestMessage;

    const io = req.app.locals.io;
    const client = req.app.locals.redisClient;

    // send message first
    await sendMessage(message, io, undefined, client);

    const originalFileName = req.file.originalname;
    const inputFilePath = req.file.path;
    const mimetype = req.file.mimetype;

    // --- Dapatkan dimensi video asli menggunakan ffprobe secara langsung ---
    let originalVideoWidth = 0,
      originalVideoHeight = 0;
    try {
      const ffprobeArgs = [
        "-v",
        "error",
        "-select_streams",
        "v:0",
        "-show_entries",
        "stream=width,height",
        "-of",
        "json",
        inputFilePath,
      ];
      console.log(
        `Mendapatkan metadata video dengan ffprobe: ${
          ffprobeStatic.path
        } ${ffprobeArgs.join(" ")}`
      );

      const ffprobeProcess = spawn(ffprobeStatic.path, ffprobeArgs);
      let ffprobeStdout = "";
      let ffprobeStderr = "";

      ffprobeProcess.stdout.on("data", (data) => {
        ffprobeStdout += data.toString();
      });

      ffprobeProcess.stderr.on("data", (data) => {
        ffprobeStderr += data.toString();
      });

      await new Promise((resolve, reject) => {
        ffprobeProcess.on("close", (code) => {
          if (code === 0) {
            try {
              const data = JSON.parse(ffprobeStdout);
              if (data.streams && data.streams.length > 0) {
                originalVideoWidth = data.streams[0].width;
                originalVideoHeight = data.streams[0].height;
                console.log(
                  `Dimensi video asli: ${originalVideoWidth}x${originalVideoHeight}`
                );
              } else {
                console.warn("Tidak ada stream video ditemukan di metadata.");
              }
              resolve();
            } catch (parseErr) {
              console.error("Gagal parse output ffprobe:", parseErr);
              reject(parseErr);
            }
          } else {
            console.error(`FFprobe gagal. Kode: ${code}`);
            console.error(`FFprobe stderr:\n${ffprobeStderr}`);
            reject(
              new Error(
                `FFprobe gagal mendapatkan dimensi video. Stderr: ${ffprobeStderr}`
              )
            );
          }
        });
        ffprobeProcess.on("error", (err) => {
          reject(new Error(`Gagal menjalankan FFprobe: ${err.message}`));
        });
      });
    } catch (probeErr) {
      console.error(
        "Kesalahan saat mendapatkan dimensi video asli dengan ffprobe:",
        probeErr
      );
      // Dimensi akan tetap 0, ini akan memicu fallback
    }

    // --- Hitung dimensi thumbnail video yang proporsional ---
    const MAX_THUMBNAIL_WIDTH = 300; // Sesuai dengan logika frontend Anda
    const MAX_THUMBNAIL_HEIGHT = 400; // Batas tinggi maksimum untuk thumbnail di UI

    let finalThumbnailWidth, finalThumbnailHeight;

    if (originalVideoWidth && originalVideoHeight) {
      const aspectRatio = originalVideoWidth / originalVideoHeight;

      // Logika penskalaan yang sama untuk mempertahankan rasio aspek
      if (originalVideoWidth >= originalVideoHeight) {
        // Landscape atau persegi
        finalThumbnailWidth = Math.min(originalVideoWidth, MAX_THUMBNAIL_WIDTH);
        finalThumbnailHeight = Math.round(finalThumbnailWidth / aspectRatio);

        if (finalThumbnailHeight > MAX_THUMBNAIL_HEIGHT) {
          finalThumbnailHeight = Math.min(
            originalVideoHeight,
            MAX_THUMBNAIL_HEIGHT
          );
          finalThumbnailWidth = Math.round(finalThumbnailHeight * aspectRatio);
        }
      } else {
        // Portrait
        finalThumbnailHeight = Math.min(
          originalVideoHeight,
          MAX_THUMBNAIL_HEIGHT
        );
        finalThumbnailWidth = Math.round(finalThumbnailHeight * aspectRatio);

        if (finalThumbnailWidth > MAX_THUMBNAIL_WIDTH) {
          finalThumbnailWidth = Math.min(
            originalVideoWidth,
            MAX_THUMBNAIL_WIDTH
          );
          finalThumbnailHeight = Math.round(finalThumbnailWidth / aspectRatio);
        }
      }
      finalThumbnailWidth = Math.max(1, finalThumbnailWidth);
      finalThumbnailHeight = Math.max(1, finalThumbnailHeight);
    } else {
      // Fallback jika tidak bisa mendapatkan dimensi asli video
      finalThumbnailWidth = MAX_THUMBNAIL_WIDTH;
      finalThumbnailHeight = Math.round(MAX_THUMBNAIL_WIDTH / (16 / 9)); // Default ke rasio 16:9 yang umum
      if (finalThumbnailHeight > MAX_THUMBNAIL_HEIGHT) {
        finalThumbnailHeight = MAX_THUMBNAIL_HEIGHT;
        finalThumbnailWidth = Math.round(MAX_THUMBNAIL_HEIGHT * (16 / 9));
      }
    }
    console.log(
      `Dimensi thumbnail video target: ${finalThumbnailWidth}x${finalThumbnailHeight}`
    );
    // ---------------------------------------------------------------------------------------------------

    // Pastikan Anda menggunakan penamaan file output yang unik
    const timestamp = Date.now();
    const originalNameWithoutExt = path.parse(originalFileName).name;
    const outputFileName = `compressed_${originalNameWithoutExt}_${timestamp}.mp4`; // <<< Pastikan unik!

    const outputFilePath = path.join(BASE_UPLOAD_DIR, outputFileName);
    compressedVideoFilePath = outputFilePath;

    console.log("Memulai pemrosesan video...");

    const { filePath: compressedFilePath, buffer: compressedBuffer } =
      await processVideo(inputFilePath, outputFilePath, [], (percentage) => {
        console.log(`Progress kompresi: ${percentage}%`);
        // Anda bisa mengirim progress ke frontend di sini (misalnya via WebSocket)
        io.emit("media-message-progress", {
          ...message,
          latestMessage: {
            ...message.latestMessage,
            document: {
              ...message.latestMessage.document,
              progress: percentage,
            },
          },
        });

        chatRoom
          .updateOne(
            { chatRoomId: chatRoomId, messageId: messageId },
            { $set: { "document.progress": percentage } }
          )
          .then(() => {
            console.log(
              `Progress untuk message ${messageId} di chatRoom ${chatRoomId} diupdate ke ${percentage}%`
            );
          })
          .catch((dbErr) => {
            console.error(
              `Gagal mengupdate progress database untuk message ${messageId}:`,
              dbErr
            );
            // Anda mungkin ingin mengirim notifikasi error ke frontend juga
            // io.to(processId).emit("media-message-progress-error", { messageId, error: dbErr.message });
          });
      });

    const compressedFileBase64 = compressedBuffer.toString("base64");

    const destinationPath = `lumina/videos/lumina-${generateRandomId(15)}`;

    const downloadURL = await uploadFileToFirebase(
      compressedBuffer,
      destinationPath,
      mimetype,
      io,
      message
    );

    if (!downloadURL) {
      throw new Error(
        "Video download URL tidak tersedia untuk membuat thumbnail."
      );
    }

    // --- Panggil generateThumbnailFromVideo dengan dimensi target ---
    const thumbnailFileName = `thumbnail_${originalNameWithoutExt}_${timestamp}.jpeg`;
    const thumbnailTempDir = BASE_UPLOAD_DIR;

    const {
      thumbnailBuffer,
      videoTempPath,
      thumbnailPath,
      width: actualGeneratedThumbWidth,
      height: actualGeneratedThumbHeight,
    } = await generateThumbnailFromVideo(
      downloadURL, // Gunakan URL video yang baru saja diupload
      thumbnailTempDir,
      thumbnailFileName,
      5, // Ambil thumbnail dari detik ke-5
      finalThumbnailWidth, // Lebar target thumbnail
      finalThumbnailHeight // Tinggi target thumbnail
    );
    downloadedVideoTempPath = videoTempPath;
    thumbnailTempFilePath = thumbnailPath;

    const thumbnailStorageDestinationPath = `lumina/thumbnails/lumina-thumb-${generateRandomId(
      15
    )}.jpeg`;
    const thumbnailMimetype = "image/jpeg";

    const thumbnailDownloadURL = await uploadFileToFirebase(
      thumbnailBuffer,
      thumbnailStorageDestinationPath,
      thumbnailMimetype,
      io,
      message
    );

    // console.log(
    //   `Thumbnail diunggah ke Firebase Storage: ${thumbnailDownloadURL}`
    // );

    // mulai proses update chatRoom dan chatsDB
    // Cari header yang ada hari ini
    const headerMessageToday = await getTodayHeader(chatId, chatRoomId);

    const completionTimestamp = Date.now();

    let completionTimeId;
    let headerMessage;
    let headerId;

    if (!headerMessageToday) {
      // ❌ Belum ada header → buat header baru
      completionTimeId = generateRandomId(15);
      headerId = generateRandomId(15);

      headerMessage = new chatRoom({
        chatId,
        chatRoomId,
        messageId: headerId,
        isHeader: true,
        senderUserId: latestMessage?.senderUserId,
        latestMessageTimestamp: completionTimestamp,
        timeId: completionTimeId,
        completionTimestamp,
        completionTimeId,
      });
      await headerMessage.save();
    } else {
      completionTimeId = headerMessageToday.timeId;
      headerId = headerMessageToday.messageId;
    }

    await chatRoom
      .updateOne(
        { chatRoomId: chatRoomId, messageId: messageId },
        {
          $set: {
            "document.progress": 100,
            "document.isProgressDone": true,
            "document.poster": thumbnailDownloadURL,
            "document.url": downloadURL,
            completionTimestamp,
            completionTimeId,
          },
        }
      )
      .then(() => {
        console.log(
          `Progress untuk message ${messageId} di chatRoom ${chatRoomId} diupdate ke ${100}%`
        );
      })
      .catch((dbErr) => {
        console.error(
          `Gagal mengupdate progress database untuk message ${messageId}:`,
          dbErr
        );
        // Anda mungkin ingin mengirim notifikasi error ke frontend juga
        // io.to(processId).emit("video-message-progress-error", { messageId, error: dbErr.message });
      });

    // update unreadcount & get latest message
    const chatsCurrently = await chatsDB.findOne({ chatRoomId, chatId });
    const secondUserId = Object.keys(chatsCurrently?.unreadCount || {}).find(
      (id) => id !== latestMessage?.senderUserId
    );
    const currentMainUserUnreadCount =
      chatsCurrently?.unreadCount?.[senderUserId] || 0;
    const currentSecondUserUnreadCount =
      chatsCurrently?.unreadCount?.[secondUserId] || 0;

    const isSecondUserInRoom = await isUserInRoom(
      chatId,
      chatRoomId,
      secondUserId,
      client
    );

    const newUnreadCount = {
      [latestMessage.senderUserId]: currentMainUserUnreadCount,
      [secondUserId]: isSecondUserInRoom ? 0 : currentSecondUserUnreadCount + 1,
    };

    // Update latestMessage sebagai array
    let updatedLatestMessages = Array.isArray(chatsCurrently.latestMessage)
      ? [...chatsCurrently.latestMessage]
      : [];

    const latestMessageWithUserId2 = {
      ...latestMessage,
      userId: recipientProfileId,
      timeId: completionTimeId,
      completionTimestamp,
      completionTimeId,
    };

    latestMessageWithUserId2.document = {
      ...message.latestMessage.document,
      mimetype,
      url: downloadURL,
      poster: thumbnailDownloadURL,
      progress: 100,
      isProgressDone: true,
      isCancelled: false,
    };

    const existingIndexUserId2 = updatedLatestMessages.findIndex(
      (item) => item.userId === recipientProfileId
    );

    if (existingIndexUserId2 !== -1) {
      updatedLatestMessages[existingIndexUserId2] = latestMessageWithUserId2;
    } else {
      updatedLatestMessages.push(latestMessageWithUserId2);
    }

    updatedLatestMessages = updatedLatestMessages.filter(
      (item) => item?.userId
    );

    await chatsDB.updateOne(
      { chatRoomId, chatId },
      {
        unreadCount: newUnreadCount,
        latestMessage: updatedLatestMessages,
      },
      { new: true }
    );

    // emit header dulu
    if (headerMessage?.messageId) {
      io.emit("newMessage", {
        chatId,
        chatRoomId,
        eventType: message.eventType,
        isNeedHeaderDate,
        recipientProfileId,
        timeId: completionTimeId,
        messageId: headerMessage.messageId,
        isHeader: true,
        isFromMedia: true,
        latestMessageTimestamp: headerMessage.latestMessageTimestamp,
        completionTimestamp,
        completionTimeId,
      });
    }

    const senderUserProfile = await usersDB.findOne({ id: senderUserId });

    io.emit("media-message-progress-done", {
      ...message,
      latestMessage: {
        ...message.latestMessage,
        document: {
          ...message.latestMessage.document,
          mimetype,
          url: downloadURL,
          poster: thumbnailDownloadURL,
          progress: 100,
          isProgressDone: true,
          isCancelled: false,
        },
        completionTimestamp,
        completionTimeId,
      },
      updatedChatLatestMessages: updatedLatestMessages,
      username: senderUserProfile?.username,
      image: senderUserProfile?.image,
      imgCropped: senderUserProfile?.imgCropped,
      thumbnail: senderUserProfile?.thumbnail,
      unreadCount: newUnreadCount,
      timeId: completionTimeId,
      headerId,
    });

    console.log("Pemrosesan video selesai.");

    // --- Mengirimkan Base64 ke Client ---
    res.status(200).json({
      message: "Video berhasil diupload dan diproses!",
      originalFile: originalFileName,
      // Tidak perlu kirim compressedFilePath jika hanya butuh Base64
      compressedFileBase64: compressedFileBase64, // Mengirim Buffer sebagai Base64
    });
  } catch (error) {
    console.error("Error dalam uploadVideoService:", error);
    if (res.headersSent) {
      console.warn("Headers already sent, cannot send 500 error response.");
    } else {
      res
        .status(500)
        .send("Terjadi kesalahan server internal selama pemrosesan video.");
    }
  } finally {
    // Cleanup file sementara
    if (originalInputFilePath) {
      await fs
        .unlink(originalInputFilePath)
        .then(() => console.log(`File asli dihapus: ${originalInputFilePath}`))
        .catch((err) =>
          console.error(
            `Gagal menghapus file input asli ${originalInputFilePath}:`,
            err
          )
        );
    }
    if (compressedVideoFilePath) {
      await fs
        .unlink(compressedVideoFilePath)
        .then(() =>
          console.log(
            `File terkompresi lokal dihapus: ${compressedVideoFilePath}`
          )
        )
        .catch((err) =>
          console.error(
            `Gagal menghapus file terkompresi lokal ${compressedVideoFilePath}:`,
            err
          )
        );
    }
    if (downloadedVideoTempPath) {
      await fs
        .unlink(downloadedVideoTempPath)
        .catch((err) =>
          console.error(
            `Gagal menghapus video sementara setelah error ${downloadedVideoTempPath}:`,
            err
          )
        );
    }
    if (thumbnailTempFilePath) {
      await fs
        .unlink(thumbnailTempFilePath)
        .catch((err) =>
          console.error(
            `Gagal menghapus thumbnail sementara setelah error ${thumbnailTempFilePath}:`,
            err
          )
        );
    }
  }
};

module.exports = { uploadVideoService, uploadImageService };
