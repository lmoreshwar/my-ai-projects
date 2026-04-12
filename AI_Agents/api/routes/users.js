const express = require('express');
const router = express.Router();
const User = require('../models/User');
const auth = require('../middleware/auth');

// @route   GET /api/users/connections
// @desc    Get the logged-in user's saved connections
router.get('/connections', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('connections');
    if (!user) {
      return res.status(404).json({ msg: 'User not found' });
    }
    res.json(user.connections);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server Error');
  }
});

// @route   PUT /api/users/connections/:section
// @desc    Update a specific connection section (e.g., jira, llm, github)
router.put('/connections/:section', auth, async (req, res) => {
  const { section } = req.params;
  const data = req.body;

  const validSections = ['jira', 'llm', 'zephyr', 'github'];
  if (!validSections.includes(section)) {
    return res.status(400).json({ msg: 'Invalid connection section' });
  }

  try {
    // Use findByIdAndUpdate to avoid triggering the pre-save password hash hook
    const updateKey = `connections.${section}`;
    const user = await User.findByIdAndUpdate(
      req.user.id,
      { $set: { [updateKey]: data } },
      { new: true, runValidators: true }
    );
    if (!user) return res.status(404).json({ msg: 'User not found' });

    res.json({ msg: 'Connection saved to database successfully', data: user.connections[section] });
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server Error');
  }
});

module.exports = router;
