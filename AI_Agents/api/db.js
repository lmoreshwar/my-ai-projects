// api/db.js
const mongoose = require('mongoose');

const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ MongoDB connected');

    // Ensure unique indexes are synced (important for duplicate prevention)
    const User = require('./models/User');
    await User.syncIndexes();
    console.log('✅ MongoDB indexes synced');
  } catch (err) {
    console.error('⚠️ MongoDB connection error:', err.message);
    console.log('⚠️ Server will continue without database (generation features still work)');
    // Don't crash - let server run without MongoDB for LLM generation features
  }
};

module.exports = connectDB;
