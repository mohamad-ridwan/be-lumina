const toolsDB = require("../models/tools"); // Pastikan ini mengarah ke model yang benar

exports.getTools = async (req, res, next) => {
  try {
    // Mengambil semua dokumen tool dari koleksi
    // .find({}) tanpa argumen akan mengembalikan semua dokumen
    const allTools = await toolsDB.find({});

    // Jika tidak ada tools yang ditemukan, kirim status 404
    if (!allTools || allTools.length === 0) {
      return res.status(404).json({
        message: "No tools found in the database.",
      });
    }

    // Kirim respon sukses dengan daftar tools
    res.status(200).json({
      message: "Tools fetched successfully!",
      totalTools: allTools.length,
      tools: allTools,
    });
  } catch (error) {
    console.error("Error fetching tools:", error);
    // Teruskan error ke middleware penanganan error global
    next(error);
  }
};

exports.addTools = async (req, res, next) => {
  try {
    // Ambil data untuk satu tool dari body request
    const { name, description, parameters } = req.body;

    // --- Validasi Dasar ---
    if (!name || typeof name !== "string" || name.trim() === "") {
      return res.status(400).json({
        message:
          "Validation Error: 'name' is required and must be a non-empty string.",
      });
    }
    if (
      !description ||
      typeof description !== "string" ||
      description.trim() === ""
    ) {
      return res.status(400).json({
        message:
          "Validation Error: 'description' is required and must be a non-empty string.",
      });
    }
    if (
      !parameters ||
      typeof parameters !== "object" ||
      Array.isArray(parameters) ||
      Object.keys(parameters).length === 0
    ) {
      return res.status(400).json({
        message:
          "Validation Error: 'parameters' is required and must be a non-empty object.",
      });
    }
    // Anda bisa menambahkan validasi lebih lanjut untuk struktur `parameters` di sini,
    // misal: if (!parameters.type || !parameters.properties) { ... }

    // --- Buat instance Tools baru ---
    const newTool = new toolsDB({
      name: name,
      description: description,
      parameters: parameters,
    });

    // --- Simpan tool baru ke database ---
    const savedTool = await newTool.save();

    // --- Kirim respon sukses ---
    res.status(201).json({
      message: "Tool added successfully!",
      tool: savedTool,
    });
  } catch (error) {
    console.error("Error adding tool:", error);

    // --- Tangani Mongoose Validation Errors ---
    if (error.name === "ValidationError") {
      const messages = Object.values(error.errors).map((err) => err.message);
      return res.status(400).json({
        message: "Database Validation Error",
        errors: messages,
      });
    }

    // --- Tangani Duplicate Key Errors (karena 'name' adalah unique: true) ---
    if (error.code === 11000) {
      return res.status(409).json({
        message: `Conflict: Tool with name '${req.body.name}' already exists.`,
      });
    }

    // --- Error Server Umum ---
    next(error); // Teruskan error ke middleware penanganan error global
  }
};
