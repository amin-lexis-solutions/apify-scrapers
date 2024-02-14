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
    }
  }
}

// If this file has no import/export statements (i.e. is a script)
// convert it into a module by adding an empty export statement.
export {};
