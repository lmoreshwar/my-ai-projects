const jwt = require('jsonwebtoken');
const { getJwtSecret, isDevBypassAllowed } = require('../_tools/jwt_secret');

module.exports = function (req, res, next) {
  // Dev mode bypass — local development only, never when NODE_ENV === 'production'.
  if (isDevBypassAllowed()) {
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
    const decoded = jwt.verify(token, getJwtSecret());
    req.user = decoded.user;
    next();
  } catch (err) {
    res.status(401).json({ msg: 'Token is not valid' });
  }
};
