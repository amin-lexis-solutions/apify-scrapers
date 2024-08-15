import * as Sentry from '@sentry/node';
import {
  ExpressErrorMiddlewareInterface,
  HttpError,
  Middleware,
} from 'routing-controllers';
import { Request, Response, NextFunction } from 'express';
import { StandardResponse } from '../utils/validators';

@Middleware({ type: 'after' })
export class CustomErrorHandler implements ExpressErrorMiddlewareInterface {
  async error(
    error: any,
    request: Request,
    response: Response,
    next: NextFunction
  ) {
    if (process.env.NODE_ENV === 'production') {
      const sanitize = (data: any) => {
        // Sanitization logic remains the same
        const sanitized = { ...data };
        delete sanitized.password;
        delete sanitized.secret;
        return sanitized;
      };

      // Asynchronous Sentry capture
      await Sentry.withScope(async (scope) => {
        scope.setTag('method', request.method);
        scope.setTag('path', request.path);
        scope.setExtra('query', sanitize(request.query));
        scope.setExtra('body', sanitize(request.body));
        Sentry.captureException(error);
      });
    }

    // Log the error details, excluding sensitive information
    console.error('Error occurred:', {
      timestamp: new Date().toISOString(),
      method: request.method,
      path: request.path,
      errorMessage: error.message,
      // Avoid logging the error stack or sensitive data in production
      // errorStack: error instanceof Error ? error.stack : '',
    });

    let responseMessage = error.message || 'An error occurred';
    const httpCode = error instanceof HttpError ? error.httpCode : 500;
    if (httpCode === 500) {
      responseMessage = 'Internal Server Error';
    }

    // Standardized error response with appropriate message
    response.status(httpCode).json(new StandardResponse(responseMessage, true));

    if (!response.headersSent) {
      next(error);
    }
  }
}
