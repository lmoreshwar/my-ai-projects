const mongoose = require('mongoose');

const PageObjectSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    unique: true,
    trim: true
  },
  description: {
    type: String,
    trim: true
  },
  url: {
    type: String,
    trim: true
  },
  locators: [{
    elementName: { type: String, required: true },
    selectorType: { type: String, enum: ['css', 'xpath', 'id', 'name', 'class', 'testId'], required: true },
    selectorValue: { type: String, required: true }
  }],
  actions: [{
    actionName: { type: String, required: true },
    description: String
  }],
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

// Update the updatedAt timestamp before saving
PageObjectSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

module.exports = mongoose.model('PageObject', PageObjectSchema);
