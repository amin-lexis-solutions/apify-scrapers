import * as Sentry from '@sentry/node';
import { checkExistingCouponsAnomaly, processAndStoreData } from './helpers';

export const preProcess = async (...args: any[]) => {
  try {
    const [vouchers, context] = args;

    if (context && vouchers) {
      const url = context.request.url;
      if (await checkExistingCouponsAnomaly(url, vouchers.length)) {
        throw new Error('Anomaly detected');
      }
    }

    return false;
  } catch (error) {
    Sentry.captureException(error as Error, { extra: { args } });
    throw error;
  }
};

export const postProcess = async (...args: any[]) => {
  try {
    const [validator, context] = args;
    if (context && validator) {
      await processAndStoreData(validator, context);
    }
    return false;
  } catch (error) {
    Sentry.captureException(error as Error, { extra: { args } });
    throw error; // re-throw the error if you want it to propagate
  }
};
