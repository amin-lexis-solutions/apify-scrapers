import { Action } from 'routing-controllers';
import { AuthorizationChecker } from 'routing-controllers/types/AuthorizationChecker';

export const authorizationChecker: AuthorizationChecker = async (
  action: Action
) => {
  // Extract the Authorization header
  const authHeader = action.request.headers['authorization'];

  // Check if the Authorization header is present and formatted as "Bearer <token>"
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7); // Extract the token part of the header

    // Here you can include any token verification logic you might have,
    // for example, verifying a JWT token or comparing with a stored token.
    // This example directly compares the extracted token with the API_SECRET environment variable.
    return token === process.env.API_SECRET;
  }

  // If there is no Authorization header, or it does not start with "Bearer",
  // or the token does not match, return false.
  return false;
};
