import { describe, it, expect } from 'vitest';
import { ApiError } from '@/lib/api-error';

describe('ApiError', () => {
  it('uses errorBody.message as Error.message when available', () => {
    const err = new ApiError(400, 'Bad Request', { message: 'Invalid input' });
    expect(err.message).toBe('Invalid input');
  });

  it('uses statusText as Error.message when errorBody has no message', () => {
    const err = new ApiError(500, 'Internal Server Error', { code: 'ERR' });
    expect(err.message).toBe('Internal Server Error');
  });

  it('uses statusText as Error.message when errorBody is null', () => {
    const err = new ApiError(404, 'Not Found', null);
    expect(err.message).toBe('Not Found');
  });

  it('sets name to ApiError', () => {
    const err = new ApiError(400, 'Bad Request', null);
    expect(err.name).toBe('ApiError');
  });

  it('stores status, statusText, and errorBody', () => {
    const body = { message: 'test', details: [1, 2] };
    const err = new ApiError(422, 'Unprocessable Entity', body);
    expect(err.status).toBe(422);
    expect(err.statusText).toBe('Unprocessable Entity');
    expect(err.errorBody).toEqual(body);
  });

  it('is an instance of Error', () => {
    const err = new ApiError(500, 'Error', null);
    expect(err).toBeInstanceOf(Error);
  });

  it('uses statusText when errorBody.message is not a string', () => {
    const err = new ApiError(400, 'Bad Request', { message: 123 } as unknown as Record<string, unknown>);
    expect(err.message).toBe('Bad Request');
  });
});
