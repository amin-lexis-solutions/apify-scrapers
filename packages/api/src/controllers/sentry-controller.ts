import { JsonController, Get } from 'routing-controllers';

@JsonController('/sentry')
export class SentryController {
  @Get('/dsn')
  getSentryUrl() {
    // const sentryUrl = process.env.SENTRY_DSN;
    const sentryUrl =
      'https://87899ea721020ea71b712cb6e26b5861@o4506914093531136.ingest.us.sentry.io/4506930859278336';
    if (!sentryUrl) {
      return {
        error: 'Sentry URL is not configured.',
      };
    }
    return { url: sentryUrl };
  }
}
