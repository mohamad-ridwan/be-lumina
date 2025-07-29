const automatedCancelOrderOfProcessingStatusTools = {
  functionDeclarations: [
    {
      name: "confirmCancellation",
      description:
        "Mengkonfirmasi pembatalan pesanan dan memberikan persetujuan jika semua syarat terpenuhi (alasan 'Produk tidak cocok'/'Salah memilih produk' dan waktu <= 30 menit).",
      parameters: {
        type: "object",
        properties: {
          orderId: {
            type: "string",
            description: "ID unik pesanan.",
          },
          customerReason: {
            type: "string",
            description: "Alasan pembatalan yang diberikan oleh pelanggan.",
          },
          timeSinceProcessedMinutes: {
            type: "number",
            description:
              "Waktu dalam menit sejak pesanan berstatus 'Diproses'.",
          },
        },
        required: ["orderId", "customerReason", "timeSinceProcessedMinutes"],
      },
    },
    {
      name: "rejectCancellation",
      description:
        "Menolak permintaan pembatalan pesanan karena alasan yang tidak valid ('Spam'), waktu yang kadaluarsa (>30 menit), atau jika alasan pelanggan tidak jelas dan membutuhkan klarifikasi lebih lanjut.",
      parameters: {
        type: "object",
        properties: {
          orderId: {
            type: "string",
            description: "ID unik pesanan.",
          },
          customerReason: {
            type: "string",
            description: "Alasan pembatalan yang diberikan oleh pelanggan.",
          },
          timeSinceProcessedMinutes: {
            type: "number",
            description:
              "Waktu dalam menit sejak pesanan berstatus 'Diproses'.",
          },
          rejectionType: {
            type: "string",
            description:
              "Tipe penolakan: 'spam_reason' (alasan spam), 'time_limit_exceeded' (waktu > 30 menit), atau 'clarification_needed' (alasan tidak jelas).",
            enum: [
              "spam_reason",
              "time_limit_exceeded",
              "clarification_needed",
            ],
          },
          clarificationDetail: {
            type: "string",
            description:
              "Opsional: Detail spesifik yang dibutuhkan jika rejectionType adalah 'clarification_needed'. Contoh: 'Mohon jelaskan lebih lanjut alasan tidak suka Anda.', 'Detail apa yang tidak sesuai?'.",
          },
        },
        required: [
          "orderId",
          "customerReason",
          "timeSinceProcessedMinutes",
          "rejectionType",
        ],
      },
    },
  ],
};

module.exports = { automatedCancelOrderOfProcessingStatusTools };
