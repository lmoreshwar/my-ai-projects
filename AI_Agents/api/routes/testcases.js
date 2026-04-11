const express = require('express');
const router = express.Router();
const TestCase = require('../models/TestCase');

// Middleware to protect routes (we can add a proper JWT verification later)
// For now, it just passes through so you can develop quickly
const protect = (req, res, next) => next();

// @route   POST /api/testcases
// @desc    Create a new test case
router.post('/', protect, async (req, res) => {
  try {
    const { title, description, status, priority, steps } = req.body;
    
    const newTestCase = new TestCase({
      title,
      description,
      status,
      priority,
      steps
    });

    const savedTestCase = await newTestCase.save();
    res.json(savedTestCase);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server Error');
  }
});

// @route   GET /api/testcases
// @desc    Get all test cases
router.get('/', protect, async (req, res) => {
  try {
    const testCases = await TestCase.find().sort({ createdAt: -1 });
    res.json(testCases);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server Error');
  }
});

// @route   PUT /api/testcases/:id
// @desc    Update a test case
router.put('/:id', protect, async (req, res) => {
  try {
    let testCase = await TestCase.findById(req.params.id);
    if (!testCase) return res.status(404).json({ msg: 'TestCase not found' });

    testCase = await TestCase.findByIdAndUpdate(
      req.params.id,
      { $set: req.body, updatedAt: Date.now() },
      { new: true }
    );

    res.json(testCase);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server Error');
  }
});

// @route   DELETE /api/testcases/:id
// @desc    Delete a test case
router.delete('/:id', protect, async (req, res) => {
  try {
    const testCase = await TestCase.findById(req.params.id);
    if (!testCase) return res.status(404).json({ msg: 'TestCase not found' });

    await TestCase.findByIdAndRemove(req.params.id);
    res.json({ msg: 'TestCase removed' });
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server Error');
  }
});

module.exports = router;
