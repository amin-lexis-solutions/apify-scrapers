import * as Sentry from '@sentry/node';
import { checkExistingCouponsAnomaly, processAndStoreData } from './helpers';

type AnomalyCheckHandler = {
  coupons: any[];
  url?: string;
};
type SaveDataHandler = {
  validator: any;
};

export const preProcess = async (load: any, context: any) => {
  try {
    const {
      AnomalyCheckHandler,
    }: {
      AnomalyCheckHandler: AnomalyCheckHandler;
    } = load;

    if (!context) throw new Error('Context is missing');

    if (AnomalyCheckHandler) {
      if (
        await checkExistingCouponsAnomaly(
          AnomalyCheckHandler?.url || context.request.url,
          AnomalyCheckHandler.coupons.length
        )
      ) {
        throw new Error('Anomaly detected');
      }
    }

    return false;
  } catch (error) {
    Sentry.captureException(error as Error, { extra: { load } });
    throw error;
  }
};

export const postProcess = async (load: any, context: any) => {
  try {
    const {
      SaveDataHandler,
    }: {
      SaveDataHandler: SaveDataHandler;
    } = load;

    if (!context) throw new Error('Context is missing');

    if (SaveDataHandler) {
      await processAndStoreData(SaveDataHandler.validator, context);
    }
    return false;
  } catch (error) {
    Sentry.captureException(error as Error, { extra: { load } });
    throw error; // re-throw the error if you want it to propagate
  }
};
