const mongoose = require('mongoose');
const bcrypt = require('bcrypt');

const UserSchema = new mongoose.Schema({
  firstName: {
    type: String,
    required: true,
    trim: true
  },
  lastName: {
    type: String,
    required: true,
    trim: true
  },
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true
  },
  password: {
    type: String,
    required: true,
    minlength: 8
  },
  role: {
    type: String,
    enum: ['user', 'admin'],
    default: 'user'
  },
  connections: {
    jira: {
      url: { type: String, default: '' },
      email: { type: String, default: '' },
      token: { type: String, default: '' }
    },
    llm: {
      platform: { type: String, default: 'groq' },
      apiKey: { type: String, default: '' },
      endpoint: { type: String, default: '' },
      model: { type: String, default: '' }
    },
    zephyr: {
      url: { type: String, default: 'https://api.zephyrscale.smartbear.com/v2' },
      apiKey: { type: String, default: '' },
      releaseName: { type: String, default: '' }
    },
    github: {
      token: { type: String, default: '' },
      apiUrl: { type: String, default: 'https://api.github.com' }
    }
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

// Hash the password before saving the user model
UserSchema.pre('save', async function() {
  const user = this;
  
  if (!user.isModified('password')) {
    return;
  }

  const salt = await bcrypt.genSalt(10);
  user.password = await bcrypt.hash(user.password, salt);
});

// Method to compare passwords
UserSchema.methods.comparePassword = async function(candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

module.exports = mongoose.model('User', UserSchema);