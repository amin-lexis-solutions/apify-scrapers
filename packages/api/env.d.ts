declare global {
  namespace NodeJS {
    interface ProcessEnv {
      NODE_ENV: 'development' | 'staging' | 'production';
      PORT?: string;
      API_SECRET?: string;
      API_DOCS_PASSWORD?: string;
      DATABASE_URL?: string;
      DATABASE_URL_NON_POOLED?: string;
      BASE_URL?: string;
      OBERST_API_KEY?: string;
      API_KEY_APIFY?: string;
      MAX_CONCURRENT_RUNS?: string;
      SENTRY_DSN?: string;
      SENTRY_DSN_ACTORS?: string;
      ANOMALY_DETECTION_DAYS?: number;
      APIFY_DAILY_COST_LIMIT_USD: number;
    }
  }
}

// If this file has no import/export statements (i.e. is a script)
// convert it into a module by adding an empty export statement.
export {};
