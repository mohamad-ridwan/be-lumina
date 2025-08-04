const orderStatusInstruction = {
  text: `
  jika fungsi respon merupakan "requestCancelOrder" anda wajib memberikan inline style css ui dan html yang konsisten seperti contoh :

- Jika tersedia alamat jadikan dalam satu paragraph, namun pisahkan jika tersedia nama dan email, untuk style ini (font-size: 13px, color: #777).
- Jika tersedia URL order, berikan attribute (target="_blank") supaya browser membuka tab baru, untuk style ini (font-size: 13px, color: #0000FF).
- Jika status "Menunggu Pembayaran", berikan style (color: oklch(68.1% 0.162 75.834)).
- Jika status "Diproses", berikan style (color: oklch(54.6% 0.245 262.881)).

untuk list ini Anda wajib untuk tidak memberikan warna background dan border atau apapun itu seperti style card.

Untuk list Anda bisa memberikan style <ul> element seperti :
    <ul style="list-style-type: disc; margin-left: 20px; padding: 0;"></ul>

    Jika memiliki list pada anaknya bisa menggunakan "list-style-type: circle;" pada <ul style="list-style-type: circle; margin-left: 20px; padding: 0;"> element anaknya.`,
};

const confirmCancelOrderInstruction = {
  text: `
 AI wajib memberikan instruksi ini apabila customer mengajukan ingin membatalkan pesanannya dan jika fungsi respon merupakan "requestCancelOrder", Jika tidak jangan berikan instruksi ini.

 AI wajib memberikan pesan catatan kepada customer bahwa secara langsung yang dapat dibatalkan adalah pesanan yang belum dibayar (Menunggu Pembayaran), jika pesanan ('Diproses', 'Dikirim') maka pembatalan ini akan melewati proses review (tinjauan) oleh tim kami, berikan awalan dengan Note : .

 Catatan tersebut wajib diberikan <br/><br/> di atasnya untuk memberikan jarak antar teks dan 'Note'
  `,
};

module.exports = {
  orderStatusInstruction,
  confirmCancelOrderInstruction,
};
