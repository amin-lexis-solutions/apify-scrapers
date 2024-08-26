import * as Sentry from '@sentry/node';
import { SeverityLevel } from '@sentry/types';

// Check for the Sentry DSN and initialize if provided
const SENTRY_DSN = process.env.SENTRY_DSN_ACTORS;

if (!SENTRY_DSN) {
  console.error(
    'SENTRY_DSN_ACTORS is not set. Errors will not be sent to Sentry.'
  );
} else {
  // Initialize Sentry
  Sentry.init({
    dsn: SENTRY_DSN,
    tracesSampleRate: 1.0, // Capture 100% of transactions
    debug: false, // Disable debug mode in production
    enabled: (process.env?.SENTRY_LOGGING || false) as boolean,
  });

  // Global handler for unhandled promise rejections
  process.on('unhandledRejection', (reason) => {
    Sentry.captureException(reason);
  });

  // Global handler for uncaught exceptions
  process.on('uncaughtException', (error) => {
    Sentry.captureException(error);
  });
}

class Logger {
  private static instance: Logger;

  private errors: { message: string; context: any }[] = [];
  private infos: { message: string; context: any }[] = [];
  private warnings: { message: string; context: any }[] = [];

  private readonly maxMessageLength = 8192;
  private readonly maxBatchSize = 200000; // 200KB

  // Private constructor to prevent direct instantiation
  private constructor() {
    if (!Sentry.getCurrentHub().getClient()) {
      console.warn(
        'Sentry is not initialized. Errors will not be sent to Sentry.'
      );
    }
  }

  // Singleton pattern to ensure only one instance
  public static getInstance(): Logger {
    if (!Logger.instance) {
      Logger.instance = new Logger();
    }
    return Logger.instance;
  }

  // Log informational messages with optional context
  info(message: string, context: any = {}) {
    console.log(message);
    this.infos.push({ message, context });
    if (Sentry.getCurrentHub().getClient() && context) {
      Sentry.addBreadcrumb({ message, data: context });
    }
  }

  // Log errors with optional context
  error(error: any, context: any = {}) {
    const errorMessage = error.message || error.toString();
    console.error(errorMessage);
    this.errors.push({ message: errorMessage, context });
    if (Sentry.getCurrentHub().getClient()) {
      this.errors.push({ message: errorMessage, context });
    }
  }

  // Log warnings with optional context
  warning(message: string, context: any = {}) {
    console.warn(message);
    this.warnings.push({ message, context });
    if (Sentry.getCurrentHub().getClient() && context) {
      Sentry.addBreadcrumb({ message, data: context, level: 'warning' });
    }
  }

  // Send a batch of errors to Sentry
  private sendBatch(
    errors: { message: string; context: any }[],
    level: SeverityLevel = 'error'
  ) {
    if (errors.length === 0) return;

    const aggregatedMessages = errors
      .map(
        ({ message, context }) =>
          `${message}\nContext: ${JSON.stringify(context)}`
      )
      .join('\n\n');

    const truncatedMessage =
      aggregatedMessages.length > this.maxMessageLength
        ? `${aggregatedMessages.substring(0, this.maxMessageLength - 3)}...`
        : aggregatedMessages;

    Sentry.withScope((scope) => {
      scope.setLevel(level);
      scope.setExtras({ details: truncatedMessage });
      switch (level) {
        case 'info':
          scope.setTag('info', 'true');
          Sentry.captureMessage(`Batch infos: ${truncatedMessage}`);
          break;
        case 'warning':
          scope.setTag('warning', 'true');
          Sentry.captureMessage(`Batch warnings: ${truncatedMessage}`);
          break;
        default:
          Sentry.captureException(
            new Error(`Batch errors: ${truncatedMessage}`)
          );
          break;
      }
    });
  }

  private processBatch(
    errors: { message: string; context: any }[],
    level: SeverityLevel
  ) {
    let currentBatch: { message: string; context: any }[] = [];
    let currentBatchSize = 0;

    for (const error of errors) {
      const errorSize = JSON.stringify(error).length;

      if (currentBatchSize + errorSize > this.maxBatchSize) {
        this.sendBatch(currentBatch, level);
        currentBatch = [];
        currentBatchSize = 0;
      }

      currentBatch.push(error);
      currentBatchSize += errorSize;
    }

    // Send remaining errors
    if (currentBatch.length > 0) {
      this.sendBatch(currentBatch, level);
    }
  }
  // Finalize by sending all accumulated errors to Sentry
  async publish() {
    if (!Sentry.getCurrentHub().getClient()) return;

    if (this.errors.length > 0) {
      this.processBatch(this.errors, 'error');
    }

    if (this.warnings.length > 0) {
      this.processBatch(this.warnings, 'warning');
    }

    if (this.infos.length > 0) {
      this.processBatch(this.infos, 'info');
    }

    await Sentry.flush(2000);
  }
}

// Export the singleton instance of Logger
export const logger = Logger.getInstance();
