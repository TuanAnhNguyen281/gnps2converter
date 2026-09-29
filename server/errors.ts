import type { RequestHandler } from "express";
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code = "REQUEST_FAILED",
  ) {
    super(message);
  }
}
export const route =
  (handler: RequestHandler): RequestHandler =>
  (req, res, next) => {
    Promise.resolve()
      .then(() => handler(req, res, next))
      .catch(next);
  };
export function owner(req: Parameters<RequestHandler>[0]) {
  if (!req.session?.userId)
    throw new ApiError(401, "Hãy đăng nhập để tiếp tục.", "UNAUTHENTICATED");
  return req.session.userId;
}
