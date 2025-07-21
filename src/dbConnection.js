const mongoose = require("mongoose");
const URI = process.env.MONGO_DB_URI;

const connectDB = async (cb) => {
  try {
    const conn = await mongoose.connect(URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      connectTimeoutMS: 120000, // Timeout after 60 seconds
      serverSelectionTimeoutMS: 120000, // Timeout after 60 seconds
      timeoutMS: 120000, // Timeout for all operations after 60 seconds
    });
    // mongoose.set("useCreateIndex", true);
    console.log(`MongoDB Connected: ${conn.connection.host}`);
  } catch (error) {
    console.log(error);
    process.exit(1);
  }
};
module.exports = connectDB;
