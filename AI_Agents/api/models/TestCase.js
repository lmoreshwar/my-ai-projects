const mongoose = require('mongoose');

const TestCaseSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
    trim: true
  },
  description: {
    type: String,
    trim: true
  },
  status: {
    type: String,
    enum: ['Draft', 'Active', 'Obsolete'],
    default: 'Draft'
  },
  priority: {
    type: String,
    enum: ['High', 'Medium', 'Low'],
    default: 'Medium'
  },
  // References to Page Objects used in this test case
  linkedPageObjects: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'PageObject'
  }],
  steps: [{
    stepNumber: Number,
    action: String,
    expectedResult: String,
    data: String
  }],
  // For history/versioning
  version: {
    type: Number,
    default: 1
  },
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
TestCaseSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

module.exports = mongoose.model('TestCase', TestCaseSchema);
