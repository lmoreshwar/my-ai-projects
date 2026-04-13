const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const SavedArtifact = require('../models/SavedArtifact');

// ─── GET /api/artifacts/check?type=test-cases&ticketId=ATP-10 — Check if artifact exists ───
router.get('/check', auth, async (req, res) => {
  try {
    const { type, ticketId } = req.query;
    if (!type || !ticketId) return res.json({ exists: false });
    const existing = await SavedArtifact.findOne({
      userId: req.user.id,
      type,
      'metadata.ticketId': { $regex: new RegExp(`^${ticketId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') }
    }).select('_id title metadata createdAt').sort({ createdAt: -1 });
    if (existing) {
      return res.json({ exists: true, artifact: existing });
    }
    res.json({ exists: false });
  } catch (err) {
    console.error('[artifacts] check error:', err.message);
    res.status(500).json({ msg: 'Server error' });
  }
});

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

// ─── PUT /api/artifacts/:id — Update an existing artifact ───
router.put('/:id', auth, async (req, res) => {
  try {
    const { title, content, files, metadata } = req.body;
    const artifact = await SavedArtifact.findOne({ _id: req.params.id, userId: req.user.id });
    if (!artifact) return res.status(404).json({ msg: 'Not found' });
    if (title) artifact.title = title;
    if (content !== undefined) artifact.content = content;
    if (files !== undefined) artifact.files = files;
    if (metadata) artifact.metadata = { ...artifact.metadata, ...metadata };
    artifact.createdAt = new Date(); // bump timestamp on update
    const updated = await artifact.save();
    res.json(updated);
  } catch (err) {
    console.error('[artifacts] update error:', err.message);
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
