// why: typed errors so controllers throw once and errorHandler maps to correct HTTP code
export class AppError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number,
    public details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const BadRequest = (message: string, details?: unknown) =>
  new AppError('BAD_REQUEST', message, 400, details);
export const Unauthorized = (message = 'Unauthorized') =>
  new AppError('UNAUTHORIZED', message, 401);
export const Forbidden = (message = 'Forbidden') => new AppError('FORBIDDEN', message, 403);
export const NotFound = (message = 'Not found') => new AppError('NOT_FOUND', message, 404);
export const Conflict = (message: string) => new AppError('CONFLICT', message, 409);
export const TooMany = (message = 'Too many requests') =>
  new AppError('RATE_LIMITED', message, 429);
export const ServerError = (message = 'Internal server error') =>
  new AppError('SERVER_ERROR', message, 500);
