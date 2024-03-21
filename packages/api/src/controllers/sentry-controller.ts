import { JsonController, Get } from 'routing-controllers';

@JsonController('/sentry')
export class SentryController {
  @Get('/dsn')
  getSentryUrl() {
    const sentryUrl = process.env.SENTRY_DSN;
    if (!sentryUrl) {
      return {
        error: 'Sentry URL is not configured.',
      };
    }
    return { url: sentryUrl };
  }
}
