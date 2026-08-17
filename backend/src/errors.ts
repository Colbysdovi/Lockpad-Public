// One shape for every error the API returns.
//
//     { "error": { "code": "CONFLICT", "message": "…", "details": … } }
//
// `code` is for the client to branch on and never changes wording; `message` is
// written for a person and several dialogs in the app display it verbatim, so it is
// worth writing as a sentence someone would want to read.
//
// Stack traces and internal messages are NEVER sent — the error handler in app.ts
// turns anything unrecognised into a flat 500. That is both a privacy matter (paths
// and query fragments leak what the server is and where it keeps things) and a
// security one.

export class ApiError extends Error {
  statusCode: number;
  code: string;
  details?: unknown;

  constructor(statusCode: number, code: string, message: string, details?: unknown) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

// The three failures worth distinguishing to a caller:
//   400 the request itself is wrong (bad input, impossible combination)
//   404 the thing referred to does not exist
//   409 the thing exists but the request conflicts with its current state — used
//       where a check must be re-run at execution time, e.g. deleting a tag that
//       has since been applied to a note.
export const badRequest = (message: string, details?: unknown) =>
  new ApiError(400, "BAD_REQUEST", message, details);
export const notFound = (message = "Not found") =>
  new ApiError(404, "NOT_FOUND", message);
export const conflict = (message: string) =>
  new ApiError(409, "CONFLICT", message);

export interface ErrorBody {
  error: { code: string; message: string; details?: unknown };
}
