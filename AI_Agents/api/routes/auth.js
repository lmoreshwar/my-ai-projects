const express = require('express');
const router = express.Router();
const User = require('../models/User');
const jwt = require('jsonwebtoken');
const { getJwtSecret } = require('../_tools/jwt_secret');
const { loginLimiter, signupLimiter, clientIp, rateLimitEnabled } = require('../_tools/auth_rate_limit');

// @route   POST /api/auth/signup
// @desc    Register a new user
router.post('/signup', async (req, res) => {
  try {
    const ip = clientIp(req);
    if (rateLimitEnabled()) {
      if (signupLimiter.isLimited(ip)) {
        res.set('Retry-After', String(Math.ceil(signupLimiter.retryAfterMs(ip) / 1000)));
        return res.status(429).json({ message: 'Too many attempts. Please try again later.' });
      }
      signupLimiter.record(ip);
    }

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

    jwt.sign(payload, getJwtSecret(), { expiresIn: '5h' }, (err, token) => {
      if (err) throw err;
      res.status(201).json({ token, user: { id: user.id, firstName: user.firstName, lastName: user.lastName, email: user.email, role: user.role } });
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
    const ip = clientIp(req);
    if (rateLimitEnabled() && loginLimiter.isLimited(ip)) {
      res.set('Retry-After', String(Math.ceil(loginLimiter.retryAfterMs(ip) / 1000)));
      return res.status(429).json({ message: 'Too many attempts. Please try again later.' });
    }

    const email = (req.body.email || '').trim().toLowerCase();
    const { password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password are required.' });
    }

    // Check if user exists
    const user = await User.findOne({ email });
    if (!user) {
      if (rateLimitEnabled()) loginLimiter.record(ip);
      return res.status(400).json({ message: 'Invalid Credentials' });
    }

    // Compare password
    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      if (rateLimitEnabled()) loginLimiter.record(ip);
      return res.status(400).json({ message: 'Invalid Credentials' });
    }

    // Successful authentication clears the failed-attempt counter for this IP.
    if (rateLimitEnabled()) loginLimiter.reset(ip);

    // Generate JWT token
    const payload = {
      user: {
        id: user.id,
        role: user.role
      }
    };

    jwt.sign(payload, getJwtSecret(), { expiresIn: '5h' }, (err, token) => {
      if (err) throw err;
      res.json({ token, user: { id: user.id, firstName: user.firstName, lastName: user.lastName, email: user.email, role: user.role } });
    });

  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server error');
  }
});

module.exports = router;