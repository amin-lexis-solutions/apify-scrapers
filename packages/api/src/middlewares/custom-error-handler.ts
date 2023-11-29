import {
  ExpressErrorMiddlewareInterface,
  HttpError,
  Middleware,
} from 'routing-controllers';

import { StandardResponse } from '../utils/validators';

@Middleware({ type: 'after' })
export class CustomErrorHandler implements ExpressErrorMiddlewareInterface {
  error(error: any, request: any, response: any, next: (err?: any) => any) {
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

    // Check if error is an instance of HttpError (routing-controllers)
    if (error instanceof HttpError) {
      response.status(error.httpCode);

      // For internal server errors, send a generic message to the client
      if (error.httpCode === 500) {
        responseMessage = 'Internal Server Error';
      }
    } else {
      response.status(500); // Internal Server Error for unhandled errors
      responseMessage = 'Internal Server Error';
    }

    // Standardized error response with appropriate message
    response.json(new StandardResponse(responseMessage, true), error);

    next();
  }
}
