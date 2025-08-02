const genAI = require("../services/gemini");

const instructionImprovement = {
  text: `evaluasi data yang diberikan apakah sudah valid dan sesuai keinginan pertanyaan?
berikan evaluasi singkat berupa angka dari 1-100. Range valid data terbilang dari angka 80 lebih.

berikan jawaban hanya berupa angka tanpa pernyataan apapun.
`,
};

const refinementDataResult = async (question, data) => {
  try {
    const content = await genAI.models.generateContent({
      // model: "gemini-2.5-flash",
      model: "gemini-2.5-flash",
      contents: [
        {
          role: "user", // AI sebagai asisten, user memberikan informasi
          parts: [
            {
              text: `Pengguna bertanya: ${question}
                  
                  dan data merespon :

                  ${data}
                  `,
            },
          ],
        },
      ],
      config: {
        temperature: 1,
        thinkingConfig: {
          thinkingBudget: 1024,
        },
        systemInstruction: [instructionImprovement],
      },
    });
    return content.text;
  } catch (error) {
    return null;
  }
};

module.exports = { refinementDataResult };
