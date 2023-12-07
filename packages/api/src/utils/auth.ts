import { Action } from 'routing-controllers';
import { AuthorizationChecker } from 'routing-controllers/types/AuthorizationChecker';

export const authorizationChecker: AuthorizationChecker = async (
  action: Action
) => {
  const token = action.request.headers['authorization'];
  return token === process.env.API_SECRET;
};
