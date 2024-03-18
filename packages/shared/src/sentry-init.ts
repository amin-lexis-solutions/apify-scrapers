import * as Sentry from '@sentry/node';
// import '@sentry/profiling-node'; // Import for performance monitoring, if needed.

// This is only for testing. Normally, you would use an environment variable
const SENTRY_DSN =
  'https://87899ea721020ea71b712cb6e26b5861@o4506914093531136.ingest.us.sentry.io/4506930859278336';

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
