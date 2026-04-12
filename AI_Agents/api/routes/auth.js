const express = require('express');
const router = express.Router();
const User = require('../models/User');
const jwt = require('jsonwebtoken');

// We need a secret key for JWT. Using a default fallback for local dev.
const JWT_SECRET = process.env.JWT_SECRET || 'super_secret_blast_key_2026';

// @route   POST /api/auth/signup
// @desc    Register a new user
router.post('/signup', async (req, res) => {
  try {
    const { firstName, lastName, password } = req.body;
    const email = (req.body.email || '').trim().toLowerCase();

    if (!email || !password || !firstName || !lastName) {
      return res.status(400).json({ message: 'All fields are required.' });
    }

    // Check if user already exists (case-insensitive)
    let user = await User.findOne({ email });
    if (user) {
      return res.status(400).json({ message: 'User already exists with this email.' });
    }

    // Create new user (password is hashed automatically by the pre-save hook in User model)
    user = new User({
      firstName,
      lastName,
      email,
      password,
      // Temporarily making lmoreshwar the admin based on email
      role: email === 'lmoreshwar@example.com' || email === 'admin@blastai.com' || email === 'l.moreshwar@gmail.com' ? 'admin' : 'user'
    });

    await user.save();

    // Generate JWT token
    const payload = {
      user: {
        id: user.id,
        role: user.role
      }
    };

    jwt.sign(payload, JWT_SECRET, { expiresIn: '5h' }, (err, token) => {
      if (err) throw err;
      res.status(201).json({ token, user: { id: user.id, email: user.email, role: user.role } });
    });

  } catch (err) {
    // Handle MongoDB duplicate key error as a safety net
    if (err.code === 11000) {
      return res.status(400).json({ message: 'User already exists with this email.' });
    }
    console.error(err.message);
    res.status(500).send('Server error');
  }
});

// @route   POST /api/auth/login
// @desc    Authenticate user & get token
router.post('/login', async (req, res) => {
  try {
    const email = (req.body.email || '').trim().toLowerCase();
    const { password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password are required.' });
    }

    // Check if user exists
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(400).json({ message: 'Invalid Credentials' });
    }

    // Compare password
    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(400).json({ message: 'Invalid Credentials' });
    }

    // Generate JWT token
    const payload = {
      user: {
        id: user.id,
        role: user.role
      }
    };

    jwt.sign(payload, JWT_SECRET, { expiresIn: '5h' }, (err, token) => {
      if (err) throw err;
      res.json({ token, user: { id: user.id, email: user.email, role: user.role } });
    });

  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server error');
  }
});

module.exports = router;