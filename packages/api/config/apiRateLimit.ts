import { rateLimit } from 'express-rate-limit';
import { sendMail } from '@api/utils/smtp';

const SKIP_PATHS: ReadonlyArray<string> = [
  '/targets',
  '/webhooks',
  '/tests',
  '/exports',
];

const {
  API_RATE_LIMIT = 100,
  EMAIL_TO = 'api@api-scrapper.com',
  EMAIL_FROM = 'api@api-scrapper.com',
  API_RATE_LIMIT_WINDOW_IN_MS = 15 * 60 * 1000,
} = process.env;

const emailCache = new Map<string, number>();

const rateLimitHandler = (req: any, res: any, next: any, options: any) => {
  if (req.rateLimit.used === req.rateLimit.limit + 1) {
    const now = Date.now();
    const lastEmailSent = emailCache.get(req.ip) || 0;

    if (now - lastEmailSent > Number(API_RATE_LIMIT_WINDOW_IN_MS)) {
      sendMail({
        from: EMAIL_FROM,
        to: EMAIL_TO,
        subject: 'Rate limit exceeded',
        text: `Rate limit exceeded for IP ${req.ip}`,
        html: `Rate limit exceeded for IP ${req.ip}`,
      });
      emailCache.set(req.ip, now);
    }
  }
  res.status(options.statusCode).send(options.message);
};
const apiLimiter = rateLimit({
  windowMs: Number(API_RATE_LIMIT_WINDOW_IN_MS),
  limit: Number(API_RATE_LIMIT),
  standardHeaders: false, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: true, // Disable the `X-RateLimit-*` headers
  skip: (req: any) => SKIP_PATHS.some((path) => req.url.startsWith(path)), // Skip rate limiting for certain paths
  handler: rateLimitHandler,
});

export { apiLimiter };
