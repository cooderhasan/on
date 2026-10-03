export type AppErrorCode = "VALIDATION" | "UNAUTHORIZED" | "FORBIDDEN" | "NOT_FOUND" | "CONFLICT" | "EXTERNAL" | "INTERNAL";

/** Kullanıcıya gösterilebilir hata. Mesaj Türkçe ve teknik ayrıntı içermez. */
export class AppError extends Error {
  constructor(
    readonly code: AppErrorCode,
    message: string,
    readonly fieldErrors?: Record<string, string>,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export function isAppError(err: unknown): err is AppError {
  return err instanceof AppError;
}
