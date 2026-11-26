import { config } from '../config/index.js';
import { HttpError } from '../utils/httpError.js';
import { logger } from '../utils/logger.js';

export function notFoundHandler(req, res) {
  res.status(404).json({ error: { message: `Route ${req.method} ${req.path} not found` } });
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, _next) {
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: { message: err.message, details: err.details } });
  }
  // Malformed JSON / oversized body from express.json()
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: { message: 'Malformed JSON body' } });
  }
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ error: { message: 'Request body too large' } });
  }

  logger.error('Unhandled request error', { method: req.method, path: req.path, err });
  res.status(500).json({
    error: { message: config.isProduction ? 'Internal server error' : err.message },
  });
}
