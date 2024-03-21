import * as Sentry from '@sentry/node';
import { fetchSentryUrl } from './helpers';
// import '@sentry/profiling-node'; // Import for performance monitoring, if needed.

async function initSentry() {
  const SENTRY_DSN = await fetchSentryUrl();

  // Initialize Sentry with your DSN and configuration
  Sentry.init({
    dsn: SENTRY_DSN,
    tracesSampleRate: 1.0, // 100% of transactions will be captured
    debug: true, // Add this line to enable debugging mode
    // You can customize this further based on your needs
  });

  // Sentry.captureMessage('Sentry initialization test');

  // Global handler for unhandled promise rejections
  process.on('unhandledRejection', (reason) => {
    Sentry.captureException(reason);
  });

  // Global handler for uncaught exceptions
  process.on('uncaughtException', (error) => {
    Sentry.captureException(error);
  });
}

initSentry();
