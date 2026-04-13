const mongoose = require('mongoose');

const SavedArtifactSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  type: {
    type: String,
    required: true,
    enum: ['test-plan', 'test-cases', 'test-scenarios', 'test-review', 'selenium-bdd', 'playwright-js', 'playwright-pom'],
    index: true
  },
  title: {
    type: String,
    required: true,
    trim: true
  },
  content: {
    type: String,       // Markdown string for plans/cases/scenarios/reviews
    default: ''
  },
  files: [{             // For automation code (array of {path, content})
    path: String,
    content: String
  }],
  metadata: {
    type: mongoose.Schema.Types.Mixed,  // Extra context: coverage %, ticket ID, LLM model used, etc.
    default: {}
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

// Compound index for fast user + type queries
SavedArtifactSchema.index({ userId: 1, type: 1, createdAt: -1 });

module.exports = mongoose.model('SavedArtifact', SavedArtifactSchema);
