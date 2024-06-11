import * as Sentry from '@sentry/node';
import {
  checkExistingCouponsAnomaly,
  checkIndexPageSelectors,
  processAndStoreData,
} from './helpers';

/**
 * Type definition for the AnomalyCheckHandler object.
 * @typedef {Object} AnomalyCheckHandler
 * @property {Array} coupons - An array of coupons.
 * @property {string} [url] - The URL to check for anomalies.
 */
type AnomalyCheckHandler = {
  coupons: any[];
  url?: string;
};

/**
 * Type definition for the IndexPageHandler object.
 * @typedef {Object} IndexPageHandler
 * @property {Object} selectors - Non index selectors.
 */
type IndexPageHandler = {
  indexPageSelectors: any;
};

/**
 * Type definition for the SaveDataHandler object.
 * @typedef {Object} SaveDataHandler
 * @property {any} validator - The validator to use when processing and storing data.
 */
type SaveDataHandler = {
  validator: any;
};

/**
 * Pre-processes hook.
 * Checks for anomalies in the coupons and throws an error if an anomaly is detected.
 * @param {any} load - The load to pre-process.
 * @param {any} context - The context in which the pre-processing is happening.
 * @throws {Error} If the context is missing or an anomaly is detected.
 * @returns {Promise<boolean>} A promise that resolves to false.
 */
export const preProcess = async (load: any, context: any): Promise<boolean> => {
  try {
    const {
      AnomalyCheckHandler,
      IndexPageHandler,
    }: {
      AnomalyCheckHandler: AnomalyCheckHandler;
      IndexPageHandler: IndexPageHandler;
    } = load;

    if (!context) throw new Error('Context is missing');

    if (IndexPageHandler) {
      await checkIndexPageSelectors(
        IndexPageHandler.indexPageSelectors,
        context
      );
    }

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

/**
 * Post-processes hook
 * Processes and stores the data using the provided validator.
 * @param {any} load - The load to post-process.
 * @param {any} context - The context in which the post-processing is happening.
 * @throws {Error} If the context is missing.
 * @returns {Promise<boolean>} A promise that resolves to false.
 */
export const postProcess = async (
  load: any,
  context: any
): Promise<boolean> => {
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
