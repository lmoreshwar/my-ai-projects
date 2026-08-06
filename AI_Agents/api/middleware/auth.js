const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET || 'super_secret_blast_key_2026';

module.exports = function (req, res, next) {
  // Dev mode bypass
  if (process.env.DEV_MODE === 'true') {
    req.user = { id: 'dev-user-id', email: 'dev@localhost' };
    return next();
  }

  // Get token from header, or query param (EventSource/SSE can't set custom headers).
  const token = req.header('x-auth-token') || req.headers.authorization?.split(' ')[1] || req.query.token;

  // Check if no token
  if (!token) {
    return res.status(401).json({ msg: 'No token, authorization denied' });
  }

  // Verify token
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded.user;
    next();
  } catch (err) {
    res.status(401).json({ msg: 'Token is not valid' });
  }
};
