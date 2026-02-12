export class ApiError extends Error {
  status: number;
  statusText: string;
  errorBody: Record<string, unknown> | null;

  constructor(
    status: number,
    statusText: string,
    errorBody: Record<string, unknown> | null,
  ) {
    super(typeof errorBody?.message === 'string' ? errorBody.message : statusText);
    this.name = 'ApiError';
    this.status = status;
    this.statusText = statusText;
    this.errorBody = errorBody;
  }
}
