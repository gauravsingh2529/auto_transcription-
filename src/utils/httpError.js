export class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.details = details;
  }
}

export const notFound = (message = 'Resource not found') => new HttpError(404, message);
export const badRequest = (message, details) => new HttpError(400, message, details);
