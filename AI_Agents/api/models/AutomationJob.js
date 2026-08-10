const mongoose = require('mongoose');

// Lifecycle states for an AI Native Playwright automation job.
const JOB_STATUSES = [
  'Pending',
  'Planning',
  'WaitingForApproval',
  'Queued',
  'Generating',
  'Executing',
  'Passed',
  'Failed',
  'PushedToGate',
  'Merged',
  'Completed',
];

const TestCaseRefSchema = new mongoose.Schema(
  {
    id: { type: String, required: true },   // e.g. TC-01 (SRL No.)
    title: { type: String, default: '' },
    tags: { type: String, default: '' },
    executionTags: { type: String, default: '' },
    complexity: { type: String, enum: ['Low', 'Medium', 'High'], default: 'Medium' },
    // Full case detail so the automation handoff sees the real steps, not just the title.
    description: { type: String, default: '' },
    preconditions: { type: String, default: '' },
    testData: { type: String, default: '' },
    steps: { type: String, default: '' },
    expectedResults: { type: String, default: '' },
    comments: { type: String, default: '' },
  },
  { _id: false }
);

const GeneratedFileSchema = new mongoose.Schema(
  {
    path: { type: String, required: true },
    layer: { type: String, enum: ['page', 'module', 'spec', 'fixture', 'config', 'other'], default: 'other' },
    reused: { type: Boolean, default: false },
  },
  { _id: false }
);

const AutomationJobSchema = new mongoose.Schema({
  jobId: { type: String, required: true, unique: true },  // human-friendly, e.g. AUTO-1001
  userId: { type: String, default: 'dev-user-id' },

  // Request inputs
  project: { type: String, default: '' },
  environment: { type: String, enum: ['QA', 'UAT', 'Production'], default: 'QA' },
  url: { type: String, default: '' },
  agent: { type: String, default: 'AI Native Playwright Engineer' },
  skill: {
    type: String,
    enum: ['New Automation', 'Modify Automation', 'Debug', 'Self Healing', 'Visual Testing'],
    default: 'New Automation',
  },
  executionMode: {
    type: String,
    enum: ['GenerateOnly', 'GenerateAndExecute', 'GenerateExecutePushToGate'],
    default: 'GenerateAndExecute',
  },
  comments: { type: String, default: '' },
  testCases: [TestCaseRefSchema],

  // Job mode: 'cases' = classic paste-test-cases flow; 'explore' = Autopilot (author cases from a URL).
  mode: { type: String, enum: ['cases', 'explore'], default: 'cases' },
  // Autopilot (explore) inputs — creds are NEVER stored here (used transiently for the explore session only).
  feature: { type: String, default: '' },
  testTypes: [{ type: String }],
  maxCases: { type: Number, default: 8 },
  scopeHint: { type: String, default: '' },
  loginUrl: { type: String, default: '' },   // optional login page URL for auth-gated exploration (not secret)
  notes: { type: String, default: '' },
  evidenceFiles: [{ type: String }],   // uploaded snapshot paths (gitignored temp dir)
  featureSummary: { type: String, default: '' },  // e.g. "2 input(s), 1 button(s)" from the explore snapshot

  // Run configuration (drives Playwright CLI flags at execution time)
  browser: { type: String, enum: ['Chrome', 'Edge', 'Firefox', 'Safari', 'All'], default: 'Chrome' },
  testScope: { type: String, enum: ['Generated only', 'Smoke'], default: 'Generated only' },
  parallel: { type: String, enum: ['Auto', 'Serial'], default: 'Auto' },

  // Orchestration state
  status: { type: String, enum: JOB_STATUSES, default: 'Pending' },
  plan: { type: String, default: '' },              // implementation plan returned by the AI service
  missingInfo: [{ type: String }],                  // questions that block generation until answered
  approved: { type: Boolean, default: false },

  // Provider / coding-agent delegation (GitHub Copilot coding agent)
  provider: { type: String, enum: ['simulation', 'service', 'github', 'local', 'runner', 'github-actions'], default: 'simulation' },
  // Runner (pull-based worker) claim metadata — set when a runner picks up a Queued job.
  claimedBy: { type: String, default: '' },
  claimedAt: { type: Date, default: null },
  issueNumber: { type: Number, default: null },
  issueUrl: { type: String, default: '' },
  checksStatus: { type: String, enum: ['', 'none', 'pending', 'passed', 'failed'], default: '' },

  // Results
  generatedFiles: [GeneratedFileSchema],
  reusedFiles: [{ type: String }],
  executionStatus: { type: String, enum: ['', 'PASSED', 'FAILED', 'SKIPPED'], default: '' },
  reportUrl: { type: String, default: '' },
  reportSummary: { type: mongoose.Schema.Types.Mixed, default: null },  // parsed Playwright results for the in-app report
  prUrl: { type: String, default: '' },
  branch: { type: String, default: '' },            // git branch created on push-to-gate
  prNumber: { type: Number, default: null },        // BLAST pull request number (cloud gate)
  prMerged: { type: Boolean, default: false },
  prMergeable: { type: Boolean, default: null },    // GitHub mergeable flag (null until computed)
  prMergeableState: { type: String, default: '' },  // clean | dirty | blocked | behind | unknown
  gateFailed: { type: Boolean, default: false },    // true when the run finished but the completion gate failed (no PR)
  missingCases: [{ type: String }],                 // requested case ids the runner could not automate
  logs: [{ type: String }],
  error: { type: String, default: '' },

  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

AutomationJobSchema.pre('save', function (next) {
  this.updatedAt = Date.now();
  next();
});

module.exports = mongoose.model('AutomationJob', AutomationJobSchema);
module.exports.JOB_STATUSES = JOB_STATUSES;
