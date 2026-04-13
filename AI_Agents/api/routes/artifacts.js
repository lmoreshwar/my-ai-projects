const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const SavedArtifact = require('../models/SavedArtifact');

// ─── POST /api/artifacts — Save a new artifact ───
router.post('/', auth, async (req, res) => {
  try {
    const { type, title, content, files, metadata } = req.body;
    if (!type || !title) {
      return res.status(400).json({ msg: 'type and title are required' });
    }
    const artifact = new SavedArtifact({
      userId: req.user.id,
      type, title,
      content: content || '',
      files: files || [],
      metadata: metadata || {}
    });
    const saved = await artifact.save();
    res.json(saved);
  } catch (err) {
    console.error('[artifacts] save error:', err.message);
    res.status(500).json({ msg: 'Server error' });
  }
});

// ─── GET /api/artifacts?type=test-plan — List artifacts for current user ───
router.get('/', auth, async (req, res) => {
  try {
    const filter = { userId: req.user.id };
    if (req.query.type) filter.type = req.query.type;
    const artifacts = await SavedArtifact.find(filter)
      .sort({ createdAt: -1 })
      .select('type title metadata createdAt')   // lightweight list
      .limit(50);
    res.json(artifacts);
  } catch (err) {
    console.error('[artifacts] list error:', err.message);
    res.status(500).json({ msg: 'Server error' });
  }
});

// ─── GET /api/artifacts/:id — Get full artifact by ID ───
router.get('/:id', auth, async (req, res) => {
  try {
    const artifact = await SavedArtifact.findOne({ _id: req.params.id, userId: req.user.id });
    if (!artifact) return res.status(404).json({ msg: 'Not found' });
    res.json(artifact);
  } catch (err) {
    console.error('[artifacts] get error:', err.message);
    res.status(500).json({ msg: 'Server error' });
  }
});

// ─── DELETE /api/artifacts/:id — Delete an artifact ───
router.delete('/:id', auth, async (req, res) => {
  try {
    const artifact = await SavedArtifact.findOneAndDelete({ _id: req.params.id, userId: req.user.id });
    if (!artifact) return res.status(404).json({ msg: 'Not found' });
    res.json({ msg: 'Deleted' });
  } catch (err) {
    console.error('[artifacts] delete error:', err.message);
    res.status(500).json({ msg: 'Server error' });
  }
});

module.exports = router;
