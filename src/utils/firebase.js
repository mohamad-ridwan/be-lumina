// Contoh penggunaan di file controller/utilitas Anda
const admin = require("../services/firebase/index");
const chatRoom = require("../models/chatRoom");

/**
 * Mengunggah buffer ke Firebase Storage dan mengembalikan URL download.
 * @param {Buffer} fileBuffer Buffer dari file yang akan diunggah.
 * @param {string} destinationPath Jalur di Storage (misal: 'videos/kompresi/namafile.mp4').
 * @param {string} contentType Tipe MIME dari file (misal: 'video/mp4', 'image/jpeg').
 * @returns {Promise<string>} URL download publik dari file yang diunggah.
 */
async function uploadFileToFirebase(
  fileBuffer,
  destinationPath,
  contentType,
  io,
  message
) {
  const { chatRoomId, latestMessage } = message;
  const { senderUserId, messageId, document } = latestMessage;
  try {
    const bucket = admin.storage().bucket(); // Mendapatkan bucket default
    const file = bucket.file(destinationPath); // Membuat referensi ke file di bucket

    // Upload buffer
    await file.save(fileBuffer, {
      contentType: contentType,
      // Jika Anda ingin file bisa diakses publik (tanpa token, untuk download),
      // Anda perlu mengatur ACL secara eksplisit. Namun, disarankan menggunakan
      // signed URLs untuk kontrol akses yang lebih baik jika perlu.
      // Untuk public download URL seperti getDownloadURL dari client SDK,
      // Anda biasanya perlu mengatur ACL ke publicRead atau membuat Signed URL.
      // Jika hanya untuk penggunaan internal atau validasi di backend,
      // cukup dengan save() dan dapatkan URL yang diperlukan.
      public: true, // Membuat file bisa diakses publik
      // Jika Anda tidak ingin public, hapus `public: true` dan gunakan `getSignedUrl`
      // Cache-Control: 'public, max-age=31536000' // Contoh cache header
    });

    // Setelah diupload, dapatkan URL download-nya
    // Untuk mendapatkan URL publik yang mirip dengan getDownloadURL,
    // Anda bisa membangunnya secara manual atau menggunakan getSignedUrl untuk URL sementara.

    // Cara membangun URL download secara manual (jika bucket public atau object public):
    // const publicUrl = `https://storage.googleapis.com/${bucket.name}/${file.name}`;
    // console.log(`File uploaded to: ${publicUrl}`);
    // return publicUrl;

    // Cara mendapatkan Signed URL (direkomendasikan untuk kontrol akses dan keamanan)
    const [url] = await file.getSignedUrl({
      action: "read",
      expires: "03-17-2026", // Tanggal kadaluarsa URL, format 'MM-DD-YYYY' atau angka timestamp
    });
    console.log(`File uploaded successfully`);
    return url;

    // Catatan: Jika Anda *benar-benar* butuh URL yang sama persis dengan yang dihasilkan oleh
    // `getDownloadURL` di client SDK (yang merupakan URL publik tanpa token akses di akhir jika file bersifat publik),
    // Anda harus memastikan file yang diunggah bersifat publik (misalnya, dengan setting ACL bucket
    // ke public atau object secara individual) DAN menggunakan cara manual seperti di atas.
    // Namun, cara yang paling umum dan aman dengan Admin SDK adalah Signed URL.
    // Jika file tidak publik, `getDownloadURL` di client SDK akan gagal tanpa token.
    // Client SDK `getDownloadURL` juga secara otomatis menghasilkan token akses untuk file non-publik.
    // Admin SDK biasanya tidak menghasilkan token akses yang sama; ia lebih ke arah Signed URL.
  } catch (error) {
    io.emit("video-message-progress-done", {
      ...message,
      latestMessage: {
        ...message.latestMessage,
        document: {
          ...message.latestMessage.document,
          url: null,
          thumbnail: document.thumbnail,
          progress: 100,
          isProgressDone: true,
          isCancelled: true,
        },
      },
    });
    chatRoom
      .updateOne(
        { chatRoomId: chatRoomId, messageId: messageId },
        {
          $set: {
            "document.progress": 100,
            "document.isProgressDone": true,
            "document.isCancelled": true,
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
    console.error("Error uploading file to Firebase Storage:", error);
    throw new Error("Gagal mengunggah file ke Storage: " + error.message);
  }
}

module.exports = {
  uploadFileToFirebase,
};
