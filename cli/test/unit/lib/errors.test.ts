import { describe, it, expect } from 'vitest';
import {
  CliError,
  AuthError,
  LimitError,
  RateLimitError,
  NetworkError,
  ApiError,
} from '../../../src/lib/errors.js';

describe('CliError', () => {
  it('has correct defaults', () => {
    const err = new CliError('something failed');
    expect(err.name).toBe('CliError');
    expect(err.message).toBe('something failed');
    expect(err.exitCode).toBe(1);
    expect(err.hint).toBeUndefined();
  });

  it('accepts custom exit code and hint', () => {
    const err = new CliError('oops', 42, 'Try again');
    expect(err.exitCode).toBe(42);
    expect(err.hint).toBe('Try again');
  });

  it('is an instance of Error', () => {
    const err = new CliError('test');
    expect(err).toBeInstanceOf(Error);
  });
});

describe('AuthError', () => {
  it('has correct defaults', () => {
    const err = new AuthError();
    expect(err.name).toBe('AuthError');
    expect(err.message).toBe('Not authenticated.');
    expect(err.exitCode).toBe(2);
    expect(err.hint).toBe('Run: skystate auth login');
  });

  it('accepts custom message and hint', () => {
    const err = new AuthError('Session expired.', 'Run: skystate auth login');
    expect(err.message).toBe('Session expired.');
    expect(err.hint).toBe('Run: skystate auth login');
  });

  it('is an instance of CliError and Error', () => {
    const err = new AuthError();
    expect(err).toBeInstanceOf(CliError);
    expect(err).toBeInstanceOf(Error);
  });
});

describe('LimitError', () => {
  it('has correct defaults', () => {
    const err = new LimitError('Too many projects');
    expect(err.name).toBe('LimitError');
    expect(err.message).toBe('Too many projects');
    expect(err.exitCode).toBe(78);
    expect(err.hint).toBe('Run: skystate billing upgrade pro');
  });

  it('accepts custom hint', () => {
    const err = new LimitError('Over limit', 'Contact support');
    expect(err.hint).toBe('Contact support');
  });

  it('is an instance of CliError', () => {
    const err = new LimitError('test');
    expect(err).toBeInstanceOf(CliError);
  });
});

describe('RateLimitError', () => {
  it('has correct exit code', () => {
    const err = new RateLimitError('Rate limit exceeded');
    expect(err.name).toBe('RateLimitError');
    expect(err.exitCode).toBe(79);
    expect(err.hint).toBeUndefined();
    expect(err.resetDate).toBeUndefined();
  });

  it('derives hint from resetDate', () => {
    const err = new RateLimitError('Rate limit exceeded', '2026-04-01');
    expect(err.resetDate).toBe('2026-04-01');
    expect(err.hint).toBe('Resets: 2026-04-01');
  });

  it('is an instance of CliError', () => {
    const err = new RateLimitError('test');
    expect(err).toBeInstanceOf(CliError);
  });
});

describe('NetworkError', () => {
  it('has correct defaults', () => {
    const err = new NetworkError();
    expect(err.name).toBe('NetworkError');
    expect(err.message).toBe(
      'Network error -- check your connection and try again',
    );
    expect(err.exitCode).toBe(1);
  });

  it('accepts custom message', () => {
    const err = new NetworkError('DNS failed');
    expect(err.message).toBe('DNS failed');
  });

  it('is an instance of CliError', () => {
    const err = new NetworkError();
    expect(err).toBeInstanceOf(CliError);
  });
});

describe('ApiError', () => {
  it('stores status and responseBody', () => {
    const err = new ApiError(422, 'Validation failed', '{"errors":[]}');
    expect(err.name).toBe('ApiError');
    expect(err.status).toBe(422);
    expect(err.message).toBe('Validation failed');
    expect(err.responseBody).toBe('{"errors":[]}');
    expect(err.exitCode).toBe(1);
  });

  it('accepts custom exit code and hint', () => {
    const err = new ApiError(500, 'Server error', undefined, 3, 'Retry later');
    expect(err.exitCode).toBe(3);
    expect(err.hint).toBe('Retry later');
  });

  it('defaults exit code to 1 when not provided', () => {
    const err = new ApiError(404, 'Not found');
    expect(err.exitCode).toBe(1);
  });

  it('is an instance of CliError', () => {
    const err = new ApiError(500, 'test');
    expect(err).toBeInstanceOf(CliError);
  });
});
