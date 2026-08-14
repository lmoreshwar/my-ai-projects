const express = require('express');
const router = express.Router();
const User = require('../models/User');
const auth = require('../middleware/auth');
const fs = require('fs');
const path = require('path');
const githubAgent = require('../_tools/github_agent');

// Dev mode storage file
const DEV_CONNECTIONS_FILE = path.join(__dirname, '..', '..', 'dev-connections.json');

// Helper: Load dev connections from file
function loadDevConnections() {
  try {
    if (fs.existsSync(DEV_CONNECTIONS_FILE)) {
      const data = fs.readFileSync(DEV_CONNECTIONS_FILE, 'utf8');
      return JSON.parse(data);
    }
  } catch (err) {
    console.error('Error loading dev connections:', err.message);
  }
  return {
    jira: {},
    llm: {},
    zephyr: {},
    github: {}
  };
}

// Helper: Save dev connections to file
function saveDevConnections(connections) {
  try {
    fs.writeFileSync(DEV_CONNECTIONS_FILE, JSON.stringify(connections, null, 2), 'utf8');
    return true;
  } catch (err) {
    console.error('Error saving dev connections:', err.message);
    return false;
  }
}

// @route   GET /api/users/connections
// @desc    Get the logged-in user's saved connections
router.get('/connections', auth, async (req, res) => {
  try {
    // Dev mode: use local file
    if (process.env.DEV_MODE === 'true') {
      const connections = loadDevConnections();
      return res.json(connections);
    }

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
    // Dev mode: use local file
    if (process.env.DEV_MODE === 'true') {
      const connections = loadDevConnections();
      connections[section] = data;
      const saved = saveDevConnections(connections);
      
      if (saved) {
        return res.json({ 
          msg: 'Connection saved to local file successfully (dev mode)', 
          data: connections[section] 
        });
      } else {
        return res.status(500).json({ msg: 'Failed to save connections' });
      }
    }

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
