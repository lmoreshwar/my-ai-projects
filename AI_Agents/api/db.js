// api/db.js
const mongoose = require('mongoose');

const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('MongoDB connected');

    // Ensure unique indexes are synced (important for duplicate prevention)
    const User = require('./models/User');
    await User.syncIndexes();
    console.log('MongoDB indexes synced');
  } catch (err) {
    console.error('MongoDB connection error:', err);
    process.exit(1);
  }
};

module.exports = connectDB;
