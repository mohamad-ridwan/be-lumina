const dayjs = require("dayjs");
require("dayjs/locale/id");
const isToday = require("dayjs/plugin/isToday");
const isYesterday = require("dayjs/plugin/isYesterday");
const weekOfYear = require("dayjs/plugin/weekOfYear");
const weekday = require("dayjs/plugin/weekday");
const utc = require("dayjs/plugin/utc");
const timezone = require("dayjs/plugin/timezone");
const sharp = require("sharp");
const fetch = require("node-fetch");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs"); // <<< Impor modul 'fs' secara normal
const fsp = require("fs").promises;
const ffmpegPath = require("ffmpeg-static");
const axios = require("axios");
const chatRoomDB = require("../models/chatRoom");

dayjs.extend(isToday);
dayjs.extend(isYesterday);
dayjs.extend(weekOfYear);
dayjs.extend(weekday);
dayjs.extend(utc);
dayjs.extend(timezone);

dayjs.tz.setDefault("Asia/Jakarta");

const formatDate = (date) => {
  const today = dayjs().startOf("day");
  const yesterday = dayjs().subtract(1, "day").startOf("day");
  // const now = dayjs();
  const dateToCheck = dayjs(date);
  const oneWeekAgo = today.subtract(7, "day");

  if (dateToCheck.isSame(today, "day")) {
    return "Today";
  } else if (dateToCheck.isSame(yesterday, "day")) {
    return "Yesterday";
  } else if (dateToCheck.isAfter(oneWeekAgo)) {
    return dateToCheck.format("dddd");
  } else {
    return dateToCheck.format("DD MMMM YYYY");
  }
};

async function generateBase64ThumbnailFromUrl(imageUrl) {
  const response = await fetch(imageUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch image: ${response.statusText}`);
  }

  const imageBuffer = await response.buffer();

  const resizedBuffer = await sharp(imageBuffer)
    .jpeg({ quality: 1 })
    .blur()
    .toBuffer();

  const base64 = `data:image/jpeg;base64,${resizedBuffer.toString("base64")}`;
  return base64;
}

const BASE_UPLOAD_DIR = path.join(__dirname, "..", "..", "uploads");

async function processVideo(
  inputFilePath,
  outputFilePath,
  ffmpegArgs = [],
  onProgress = null
) {
  return new Promise(async (resolve, reject) => {
    console.log(`--- Memulai Pemrosesan Video ---`);
    console.log(`Jalur file input untuk FFmpeg: ${inputFilePath}`);
    console.log(`Jalur file output untuk FFmpeg: ${outputFilePath}`);

    // --- Langkah 1: Mendapatkan Durasi Total Video Input (Metode Alternatif) ---
    let duration = 0;
    try {
      // Menggunakan perintah FFmpeg untuk mendapatkan informasi format,
      // lalu parsing stderr untuk menemukan "Duration:"
      const ffprobeProcess = spawn(ffmpegPath, [
        "-i",
        inputFilePath,
        "-f",
        "null", // Tidak menghasilkan output file
        "-", // Menulis ke stdout/stderr
      ]);

      let ffprobeErrorOutput = ""; // FFmpeg biasanya menulis info durasi ke stderr

      ffprobeProcess.stderr.on("data", (data) => {
        ffprobeErrorOutput += data.toString();
      });

      await new Promise((res, rej) => {
        ffprobeProcess.on("close", (code) => {
          // Cari pola durasi di output stderr FFmpeg
          // Contoh: Duration: 00:01:13.19, start: 0.005000, bitrate: 5157 kb/s
          const durationMatch = ffprobeErrorOutput.match(
            /Duration: (\d{2}):(\d{2}):(\d{2})\.(\d{2})/
          );

          if (durationMatch) {
            const hours = parseInt(durationMatch[1]);
            const minutes = parseInt(durationMatch[2]);
            const seconds = parseInt(durationMatch[3]);
            const centiseconds = parseInt(durationMatch[4]);
            duration =
              hours * 3600 + minutes * 60 + seconds + centiseconds / 100;

            if (isNaN(duration) || duration <= 0) {
              rej(
                new Error(
                  `Gagal mem-parse durasi dari ffprobe output. Output: ${ffprobeErrorOutput}`
                )
              );
            } else {
              console.log(
                `Durasi video input (dari parsing stderr): ${duration} detik`
              );
              res();
            }
          } else {
            rej(
              new Error(
                `Durasi tidak ditemukan di ffprobe output. Stderr: ${ffprobeErrorOutput}`
              )
            );
          }
        });
        ffprobeProcess.on("error", (err) => {
          rej(
            new Error(`Gagal menjalankan ffprobe untuk durasi: ${err.message}`)
          );
        });
      });
    } catch (err) {
      console.error("Error saat mendapatkan durasi video:", err.message);
      reject(
        new Error(`Fatal: Gagal mendapatkan durasi video input. ${err.message}`)
      );
      return;
    }

    // --- Langkah 2: Menjalankan Proses Kompresi FFmpeg ---
    const defaultArgs = [
      "-i",
      inputFilePath,
      // Tambahkan opsi -y DI SINI untuk menimpa file jika sudah ada
      "-y", // <<< Tambahkan baris ini
      "-c:v",
      "libx264",
      "-preset",
      "medium",
      "-crf",
      "28",
      "-c:a",
      "copy",
      outputFilePath,
    ];

    const argsToUse = ffmpegArgs.length > 0 ? ffmpegArgs : defaultArgs;

    console.log(
      `Menjalankan perintah FFmpeg: ${ffmpegPath} ${argsToUse.join(" ")}`
    );

    const ffmpegProcess = spawn(ffmpegPath, argsToUse);

    let stderrOutput = ""; // Untuk menangkap semua output stderr dari FFmpeg

    ffmpegProcess.stderr.on("data", (data) => {
      const chunk = data.toString();
      stderrOutput += chunk;

      // --- Logika Parsing Progress ---
      if (duration > 0 && typeof onProgress === "function") {
        const timeMatch = chunk.match(/time=(\d{2}):(\d{2}):(\d{2})\.(\d{2})/);
        if (timeMatch) {
          const hours = parseInt(timeMatch[1]);
          const minutes = parseInt(timeMatch[2]);
          const seconds = parseInt(timeMatch[3]);
          const centiseconds = parseInt(timeMatch[4]);
          const currentTime =
            hours * 3600 + minutes * 60 + seconds + centiseconds / 100;

          const percentage = Math.min(
            100,
            Math.floor((currentTime / duration) * 100)
          );
          onProgress(percentage);
        }
      }
    });

    ffmpegProcess.on("close", async (code) => {
      if (code === 0) {
        console.log("Proses FFmpeg berhasil diselesaikan.");
        try {
          const outputBuffer = await fsp.readFile(outputFilePath);
          console.log(
            `File output terkompresi berhasil dibaca sebagai Buffer. Ukuran: ${outputBuffer.length} byte.`
          );
          resolve({ filePath: outputFilePath, buffer: outputBuffer });
        } catch (readErr) {
          console.error(
            `Gagal membaca file output terkompresi dari ${outputFilePath}:`,
            readErr
          );
          reject(
            new Error(
              `Pemrosesan FFmpeg berhasil, tetapi gagal membaca file output: ${readErr.message}`
            )
          );
        }
      } else {
        console.error(`Proses FFmpeg keluar dengan kode ${code}`);
        console.error(`Output stderr FFmpeg lengkap:\n${stderrOutput}`);
        reject(
          new Error(
            `Pemrosesan FFmpeg gagal dengan kode ${code}. Detail: ${stderrOutput}`
          )
        );
      }
    });

    ffmpegProcess.on("error", (err) => {
      console.error(
        "Gagal memulai proses FFmpeg. Apakah FFmpeg terinstal dan dapat diakses?",
        err
      );
      reject(
        new Error(
          `Gagal memulai proses FFmpeg: ${err.message}. Pastikan FFmpeg terinstal atau ffmpeg-static digunakan dengan benar.`
        )
      );
    });
  });
}

async function processImage(
  inputFilePath,
  outputFilePath,
  ffmpegArgs = [],
  onProgress = null
) {
  return new Promise(async (resolve, reject) => {
    console.log(`--- Memulai Pemrosesan Gambar ---`);
    console.log(`Jalur file input untuk FFmpeg: ${inputFilePath}`);
    console.log(`Jalur file output untuk FFmpeg: ${outputFilePath}`);

    let argsToUse = ffmpegArgs;

    if (ffmpegArgs.length === 0) {
      // Jika tidak ada argumen kustom, gunakan default
      argsToUse = [
        "-i",
        inputFilePath, // Input file
        "-y", // Overwrite output file if it exists
        "-q:v",
        "31", // Kualitas kompresi gambar (0-31, 0 = lossless, 31 = terburuk). 5-10 umumnya memberikan keseimbangan baik.
        outputFilePath, // Output file
      ];
    }

    console.log(
      `Menjalankan perintah FFmpeg: ${ffmpegPath} ${argsToUse.join(" ")}`
    );

    const ffmpegProcess = spawn(ffmpegPath, argsToUse);

    let stderrOutput = ""; // Untuk menangkap semua output stderr dari FFmpeg

    ffmpegProcess.stderr.on("data", (data) => {
      const chunk = data.toString();
      stderrOutput += chunk;
      // Untuk gambar, progress seringkali tidak dilaporkan secara bertahap oleh FFmpeg
      // Jika onProgress ada, kita bisa panggil di awal dan akhir saja.
    });

    ffmpegProcess.on("close", async (code) => {
      if (code === 0) {
        console.log("Proses FFmpeg untuk gambar berhasil diselesaikan.");
        if (typeof onProgress === "function") {
          onProgress(100); // Pastikan progress dilaporkan 100% saat selesai
        }
        try {
          const outputBuffer = await fsp.readFile(outputFilePath);
          console.log(
            `File gambar output terkompresi berhasil dibaca sebagai Buffer. Ukuran: ${outputBuffer.length} byte.`
          );
          resolve({ filePath: outputFilePath, buffer: outputBuffer });
        } catch (readErr) {
          console.error(
            `Gagal membaca file gambar output terkompresi dari ${outputFilePath}:`,
            readErr
          );
          reject(
            new Error(
              `Pemrosesan gambar FFmpeg berhasil, tetapi gagal membaca file output: ${readErr.message}`
            )
          );
        }
      } else {
        console.error(`Proses FFmpeg untuk gambar keluar dengan kode ${code}`);
        console.error(`Output stderr FFmpeg lengkap:\n${stderrOutput}`);
        reject(
          new Error(
            `Pemrosesan gambar FFmpeg gagal dengan kode ${code}. Detail: ${stderrOutput}`
          )
        );
      }
    });

    ffmpegProcess.on("error", (err) => {
      console.error(
        "Gagal memulai proses FFmpeg untuk gambar. Apakah FFmpeg terinstal dan dapat diakses?",
        err
      );
      reject(
        new Error(
          `Gagal memulai proses FFmpeg: ${err.message}. Pastikan FFmpeg terinstal atau ffmpeg-static digunakan dengan benar.`
        )
      );
    });
  });
}

async function generateThumbnailFromVideo(
  videoUrl,
  tempDir,
  thumbnailFileName,
  positionSeconds = 1,
  targetWidth = 0,
  targetHeight = 0
) {
  const videoTempPath = path.join(tempDir, `temp_video_${Date.now()}.mp4`);
  const thumbnailTempPath = path.join(tempDir, thumbnailFileName);

  try {
    // 1. Unduh Video
    console.log(`Mengunduh video dari URL: ${videoUrl} ke ${videoTempPath}`);
    const response = await axios({
      method: "GET",
      url: videoUrl,
      responseType: "stream",
    });

    const writer = fs.createWriteStream(videoTempPath);
    response.data.pipe(writer);

    await new Promise((resolve, reject) => {
      writer.on("finish", resolve);
      writer.on("error", reject);
    });
    console.log(`Video berhasil diunduh ke: ${videoTempPath}`);

    // 2. Hasilkan Thumbnail dengan FFmpeg (menggunakan spawn langsung)
    let scaleFilter = "";
    if (targetWidth > 0 && targetHeight > 0) {
      scaleFilter = `scale=${targetWidth}:${targetHeight}`;
    } else if (targetWidth > 0) {
      scaleFilter = `scale=${targetWidth}:-1`; // Lebar tetap, tinggi auto
    } else if (targetHeight > 0) {
      scaleFilter = `scale=-1:${targetHeight}`; // Tinggi tetap, lebar auto
    } else {
      // Default fallback jika tidak ada target, bisa atur ukuran maksimal yang wajar
      scaleFilter = `scale='min(iw,300)':'min(ih,400)':force_original_aspect_ratio=increase`;
    }

    const ffmpegArgs = [
      "-i",
      videoTempPath, // Input video
      "-ss",
      `00:00:${String(positionSeconds).padStart(2, "0")}`, // Posisi waktu (misal: 00:00:02)
      "-vframes",
      "1", // Hanya ambil 1 frame
      "-vf",
      scaleFilter, // Filter skala untuk ukuran target
      "-q:v",
      "2", // Kualitas output (2-5 umumnya baik untuk JPEG)
      thumbnailTempPath, // Output thumbnail
    ];

    console.log(
      `Menghasilkan thumbnail dengan FFmpeg: ${ffmpegPath} ${ffmpegArgs.join(
        " "
      )}`
    );
    const ffmpegProcess = spawn(ffmpegPath, ffmpegArgs);

    let ffmpegStderr = "";
    ffmpegProcess.stderr.on("data", (data) => {
      ffmpegStderr += data.toString();
    });

    await new Promise((resolve, reject) => {
      ffmpegProcess.on("close", (code) => {
        if (code === 0) {
          console.log(`Thumbnail berhasil dibuat di: ${thumbnailTempPath}`);
          resolve();
        } else {
          console.error(`FFmpeg gagal membuat thumbnail. Kode: ${code}`);
          console.error(`FFmpeg stderr:\n${ffmpegStderr}`);
          reject(
            new Error(`FFmpeg gagal membuat thumbnail. Stderr: ${ffmpegStderr}`)
          );
        }
      });
      ffmpegProcess.on("error", (err) => {
        reject(
          new Error(`Gagal menjalankan FFmpeg untuk thumbnail: ${err.message}`)
        );
      });
    });

    // 3. Baca Thumbnail ke Buffer dan dapatkan dimensi aktualnya
    const thumbnailBuffer = await fsp.readFile(thumbnailTempPath);
    console.log(
      `Thumbnail dibaca ke buffer. Ukuran: ${thumbnailBuffer.length} byte.`
    );

    const metadata = await sharp(thumbnailTempPath).metadata();
    const actualThumbnailWidth = metadata.width;
    const actualThumbnailHeight = metadata.height;
    console.log(
      `Dimensi thumbnail yang dihasilkan: ${actualThumbnailWidth}x${actualThumbnailHeight}`
    );

    return {
      thumbnailBuffer,
      videoTempPath,
      thumbnailPath: thumbnailTempPath,
      width: actualThumbnailWidth,
      height: actualThumbnailHeight,
    };
  } catch (error) {
    console.error("Error dalam generateThumbnailFromVideo:", error.message);
    throw error;
  }
}

// async function generateThumbnailFromVideo(
//   videoUrl,
//   tempDir,
//   thumbnailFileName,
//   positionSeconds = 2
// ) {
//   const videoTempPath = path.join(tempDir, `temp_video_${Date.now()}.mp4`);
//   const thumbnailTempPath = path.join(tempDir, thumbnailFileName);

//   try {
//     // 1. Unduh Video
//     console.log(`Mengunduh video dari URL: *** ke ${videoTempPath}`);
//     const response = await axios({
//       method: "GET",
//       url: videoUrl,
//       responseType: "stream",
//     });

//     // Gunakan `fs` yang diimpor secara normal untuk createWriteStream
//     const writer = fs.createWriteStream(videoTempPath); // <<< PERBAIKAN DI SINI
//     response.data.pipe(writer);

//     await new Promise((resolve, reject) => {
//       writer.on("finish", resolve);
//       writer.on("error", reject);
//     });
//     console.log(`Video berhasil diunduh ke: ${videoTempPath}`);

//     // 2. Hasilkan Thumbnail dengan FFmpeg
//     const ffmpegArgs = [
//       "-i",
//       videoTempPath, // Input video
//       "-ss",
//       `00:00:${String(positionSeconds).padStart(2, "0")}`, // Posisi waktu (misal: 00:00:02)
//       "-vframes",
//       "1", // Hanya ambil 1 frame
//       "-q:v",
//       "2", // Kualitas output (lebih rendah = file lebih kecil)
//       thumbnailTempPath, // Output thumbnail
//     ];

//     console.log(
//       `Menghasilkan thumbnail dengan FFmpeg: ${ffmpegPath} ${ffmpegArgs.join(
//         " "
//       )}`
//     );
//     const ffmpegProcess = spawn(ffmpegPath, ffmpegArgs);

//     let ffmpegStderr = "";
//     ffmpegProcess.stderr.on("data", (data) => {
//       ffmpegStderr += data.toString();
//     });

//     await new Promise((resolve, reject) => {
//       ffmpegProcess.on("close", (code) => {
//         if (code === 0) {
//           console.log(`Thumbnail berhasil dibuat di: ${thumbnailTempPath}`);
//           resolve();
//         } else {
//           console.error(`FFmpeg gagal membuat thumbnail. Kode: ${code}`);
//           console.error(`FFmpeg stderr:\n${ffmpegStderr}`);
//           reject(
//             new Error(`FFmpeg gagal membuat thumbnail. Stderr: ${ffmpegStderr}`)
//           );
//         }
//       });
//       ffmpegProcess.on("error", (err) => {
//         reject(
//           new Error(`Gagal menjalankan FFmpeg untuk thumbnail: ${err.message}`)
//         );
//       });
//     });

//     // 3. Baca Thumbnail ke Buffer
//     // Gunakan `fsp` (fs.promises) untuk readFile
//     const thumbnailBuffer = await fsp.readFile(thumbnailTempPath); // <<< PERBAIKAN DI SINI
//     console.log(
//       `Thumbnail dibaca ke buffer. Ukuran: ${thumbnailBuffer.length} byte.`
//     );

//     return { thumbnailBuffer, videoTempPath, thumbnailTempPath };
//   } catch (error) {
//     console.error("Error dalam generateThumbnailFromVideo:", error.message);
//     throw error;
//   } finally {
//     // Cleanup file sementara jika terjadi error, atau setelah berhasil
//     // Namun, cleanup di controller juga sudah menangani ini
//   }
// }

async function isUserInRoom(chatId, chatRoomId, userId, client) {
  return await new Promise((resolve, reject) => {
    client
      .sCard(`chats:${chatId}:room:${chatRoomId}:users:${userId}`)
      .then((res) => {
        resolve(res > 0);
      })
      .catch((err) => reject(err));
  });
}

const existingBotReplyMessageJob = async (
  chatId,
  chatRoomId,
  userId,
  client
) => {
  try {
    const existingJobId = await client.get(
      `bot-message:chats:${chatId}:room:${chatRoomId}:userId:${userId}`
    );
    return existingJobId;
  } catch (error) {
    return error;
  }
};

// Fungsi tambahan → cari header untuk tanggal ini (sekalian ambil timeId)
const getTodayHeader = async (chatId, chatRoomId) => {
  const todayStart = dayjs().startOf("day").valueOf();
  const todayEnd = dayjs().endOf("day").valueOf();

  return await chatRoomDB.findOne({
    chatId,
    chatRoomId,
    isHeader: true,
    latestMessageTimestamp: { $gte: todayStart, $lte: todayEnd },
  });
};

// Fungsi helper untuk mendapatkan sortTimestamp field definition untuk aggregation
const getSortTimestampAggregationField = (profileId) => {
  return {
    $cond: {
      if: {
        $and: [
          { $ne: ["$senderUserId", profileId] }, // Jika senderUserId BUKAN profileId yang sedang login
          { $ne: ["$completionTimestamp", null] }, // DAN completionTimestamp tidak null
        ],
      },
      then: { $toDouble: "$completionTimestamp" }, // Maka gunakan completionTimestamp
      else: { $toDouble: "$latestMessageTimestamp" }, // Selain itu, gunakan latestMessageTimestamp
    },
  };
};

// Fungsi helper untuk mendapatkan latest message berdasarkan profileId dan kondisi
const findLatestMessageForUser = async (
  chatId,
  chatRoomId,
  profileIdToMatch
) => {
  try {
    const pipeline = [
      {
        $match: {
          chatId,
          chatRoomId,
          isHeader: { $ne: true },
          // Pastikan pesan tidak dihapus oleh profileIdToMatch
          isDeleted: {
            $not: {
              $elemMatch: {
                senderUserId: profileIdToMatch,
                deletionType: { $in: ["me", "permanent"] },
              },
            },
          },
        },
      },
      {
        $addFields: {
          // Tambahkan field sortTimestamp dengan logika kompleks
          sortTimestamp: getSortTimestampAggregationField(profileIdToMatch),
        },
      },
      {
        $sort: { sortTimestamp: -1 }, // Urutkan dari yang terbaru
      },
      { $limit: 1 }, // Hanya ambil satu dokumen (yang paling baru)
    ];

    const result = await chatRoomDB.aggregate(pipeline);
    return result.length > 0 ? result[0] : null;
  } catch (error) {
    console.error("Error in findLatestMessageForUser:", error);
    return null;
  }
};

const formatVariantFiltersSearchIndex = (filters) => {
  // 1. Dapatkan array dari pasangan key-value
  const entries = Object.entries(filters);

  // 2. Map setiap pasangan menjadi string yang diformat
  const formattedStrings = entries.map(([key, value]) => {
    // Gabungkan semua nilai dalam array 'value' menjadi string
    const valuesString = Array.isArray(value) ? value.join(", ") : value;

    // Kembalikan string dengan format "key: value, value"
    return `${key}: ${valuesString}`;
  });

  // 3. Gabungkan semua string yang sudah diformat
  return formattedStrings.join(", ");
};

const createRegexObjectFromFilters = (filters) => {
  const regexFilters = {};

  // Iterasi melalui setiap pasangan kunci-nilai di objek filter
  for (const [key, value] of Object.entries(filters)) {
    // Ubah setiap item dalam array 'value' menjadi RegExp
    const regexArray = value.map((item) => new RegExp(String(item), "i"));

    // Tambahkan pasangan kunci-nilai baru ke objek regexFilters
    regexFilters[key] = regexArray;
  }

  return regexFilters;
};

module.exports = {
  formatDate,
  generateBase64ThumbnailFromUrl,
  BASE_UPLOAD_DIR,
  processVideo,
  generateThumbnailFromVideo,
  processImage,
  isUserInRoom,
  getTodayHeader,
  findLatestMessageForUser,
  getSortTimestampAggregationField,
  existingBotReplyMessageJob,
  formatVariantFiltersSearchIndex,
  createRegexObjectFromFilters,
};
