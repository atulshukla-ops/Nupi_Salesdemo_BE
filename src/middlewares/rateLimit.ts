import rateLimit from "express-rate-limit";

const tooMany = { status: "fail", statusCode: 429, message: "Too many requests, please slow down" };

/** Public (no team key) endpoints such as the viewer's waiting-room lookup. */
export const publicRateLimit = rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: tooMany
});

/** Wrong team keys: slows down anyone trying to guess the key. Only 401 responses are counted. */
export const authRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  requestWasSuccessful: (_req, res) => res.statusCode !== 401,
  message: tooMany
});
