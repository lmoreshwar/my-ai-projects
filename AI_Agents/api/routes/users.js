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

// @route   POST /api/users/connections/github/provision
// @desc    Multi-tenant onboarding: create the caller's OWN fresh copy of the BLAST framework
//          template (clean slate — no app content) and save it as their target repo. Idempotent:
//          if already provisioned it returns the existing repo unless `force` is passed. Opt-in;
//          does not alter the normal connection save/read flow.
router.post('/connections/github/provision', auth, async (req, res) => {
  const dev = process.env.DEV_MODE === 'true';
  try {
    // Load the caller's saved GitHub connection (dev file or DB).
    let conn;
    if (dev) {
      conn = loadDevConnections().github || {};
    } else {
      const user = await User.findById(req.user.id).select('connections');
      conn = (user && user.connections && user.connections.github) || {};
    }

    if (!conn.token) {
      return res.status(400).json({ msg: 'Connect GitHub first — a token is required to provision your framework.' });
    }

    // Idempotent: reuse the already-provisioned repo unless the caller forces a new one.
    if (conn.provisioned && conn.selectedRepo && !req.body.force) {
      return res.json({ msg: 'Framework already provisioned', repo: conn.selectedRepo, provisioned: true });
    }

    const git = { token: conn.token };
    const me = await githubAgent.getAuthenticatedUser(git);
    if (!me.login) {
      return res.status(400).json({ msg: 'Could not identify your GitHub account from the token.' });
    }

    const name = (req.body.name || 'blast-framework').trim();
    let result;
    if (await githubAgent.repoExists(git, me.login, name)) {
      // A repo with this name already exists — adopt it as the target instead of failing.
      result = { owner: me.login, repo: name, defaultBranch: 'main', htmlUrl: `https://github.com/${me.login}/${name}` };
    } else {
      result = await githubAgent.generateFromTemplate(git, {
        owner: me.login,
        name,
        private: req.body.private !== false,
      });
    }

    // Persist the target on the user's GitHub connection (token stays as-is; never logged).
    const selectedRepo = `${result.owner}/${result.repo}`;
    const patch = { selectedRepo, selectedBranch: result.defaultBranch || 'main', provisioned: true };
    if (dev) {
      const connections = loadDevConnections();
      connections.github = { ...(connections.github || {}), ...patch };
      saveDevConnections(connections);
    } else {
      await User.findByIdAndUpdate(
        req.user.id,
        { $set: { 'connections.github.selectedRepo': selectedRepo, 'connections.github.selectedBranch': patch.selectedBranch, 'connections.github.provisioned': true } },
        { new: true, runValidators: true },
      );
    }

    res.json({ msg: 'Framework provisioned', repo: selectedRepo, htmlUrl: result.htmlUrl, provisioned: true });
  } catch (err) {
    console.error('provision framework:', err.message);
    res.status(500).json({ msg: err.message || 'Failed to provision framework' });
  }
});

module.exports = router;
