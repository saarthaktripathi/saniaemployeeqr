/** Application error with a stable code and a safe, user-facing message. */
export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export type ErrorCode =
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "VALIDATION"
  | "CONFLICT"
  | "RATE_LIMITED"
  | "INVALID_STATE"
  | "PAYLOAD_TOO_LARGE"
  | "INTERNAL";

export const httpStatus: Record<ErrorCode, number> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VALIDATION: 422,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  INVALID_STATE: 409,
  PAYLOAD_TOO_LARGE: 413,
  INTERNAL: 500,
};

export const notFound = (what = "Resource") => new AppError("NOT_FOUND", `${what} not found`);
export const forbidden = () => new AppError("FORBIDDEN", "You do not have permission to perform this action");
export const unauthenticated = () => new AppError("UNAUTHENTICATED", "Sign in required");
export const conflict = (message: string, details?: Record<string, unknown>) =>
  new AppError("CONFLICT", message, details);
