/**
 * CLI error hierarchy with typed exit codes.
 *
 * Exit codes:
 *   1  — General error (network, unexpected, validation)
 *   2  — Authentication error (no token, expired, 401)
 *   78 — Limit exceeded (402 — project/env/storage limit reached)
 *   79 — Rate limited (429 — monthly API request limit exceeded)
 */

export class CliError extends Error {
  constructor(
    message: string,
    public readonly exitCode: number = 1,
    public readonly hint?: string,
  ) {
    super(message);
    this.name = 'CliError';
  }
}

export class AuthError extends CliError {
  constructor(
    message: string = 'Not authenticated.',
    hint: string = 'Run: skystate auth login',
  ) {
    super(message, 2, hint);
    this.name = 'AuthError';
  }
}

export class LimitError extends CliError {
  constructor(
    message: string,
    hint: string = 'Run: skystate billing upgrade pro',
  ) {
    super(message, 78, hint);
    this.name = 'LimitError';
  }
}

export class RateLimitError extends CliError {
  constructor(
    message: string,
    public readonly resetDate?: string,
  ) {
    super(message, 79, resetDate ? `Resets: ${resetDate}` : undefined);
    this.name = 'RateLimitError';
  }
}

export class NetworkError extends CliError {
  constructor(
    message: string = 'Network error -- check your connection and try again',
  ) {
    super(message, 1);
    this.name = 'NetworkError';
  }
}

export class ApiError extends CliError {
  constructor(
    public readonly status: number,
    message: string,
    public readonly responseBody?: string,
    exitCode?: number,
    hint?: string,
  ) {
    super(message, exitCode ?? 1, hint);
    this.name = 'ApiError';
  }
}
