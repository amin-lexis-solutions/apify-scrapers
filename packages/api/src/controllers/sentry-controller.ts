import { JsonController, Get } from 'routing-controllers';

const SENTRY_DSN="https://87899ea721020ea71b712cb6e26b5861@o4506914093531136.ingest.us.sentry.io/4506930859278336"

@JsonController('/sentry')
export class SentryController {
  @Get('/dsn')
  getSentryUrl() {
    // const sentryUrl = process.env.SENTRY_DSN;
    const sentryUrl = SENTRY_DSN;
    if (!sentryUrl) {
      return {
        error: 'Sentry URL is not configured.',
      };
    }
    return { url: sentryUrl };
  }
}
