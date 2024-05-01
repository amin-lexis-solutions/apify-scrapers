import { JsonController, Get } from 'routing-controllers';

@JsonController('/sentry')
export class SentryController {
  @Get('/dsn')
  getSentryUrl() {
    // env variable is not available, so hardcoding the URL as temporary solution
    const sentryUrl = process.env.SENTRY_DSN_ACTORS;
    if (!sentryUrl) {
      return {
        error: 'Sentry URL is not configured.',
      };
    }
    return { url: sentryUrl };
  }

  @Get('/error')
  throwSentryError() {
    throw new Error('This is a test error for Sentry.');
  }
}
