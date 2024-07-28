import { ApifyClient } from 'apify-client';

export const apify = new ApifyClient({
  token: process.env.APIFY_ORG_TOKEN_OBERST,
  timeoutSecs: 5 * 60,
});

export type WebhookApify = {
  userId: string;
  createdAt: string;
  eventType:
    | 'ACTOR.RUN.CREATED'
    | 'ACTOR.RUN.SUCCEEDED'
    | 'ACTOR.RUN.FAILED'
    | 'ACTOR.RUN.ABORTED'
    | 'ACTOR.RUN.TIMED_OUT'
    | 'ACTOR.RUN.RESURRECTED';
  eventData: { actorId: string; actorRunId: string };
  resource: {
    id: string;
    actId: string;
    userId: string;
    startedAt: string;
    finishedAt: string;
    status: string;
    meta: { origin: string; userAgent: string };
    createdByOrganizationMemberUserId: string;
    buildId: string;
    exitCode: number;
    defaultKeyValueStoreId: string;
    defaultDatasetId: string;
    defaultRequestQueueId: string;
    buildNumber: string;
    containerUrl: string;
  };
};

export type ApifyGoogleSearchResult = {
  searchQuery: {
    term: string;
    url: string;
    device: string;
    page: number;
    type: string;
    domain: string;
    countryCode: string;
    languageCode: string;
    locationUule: string;
    resultsPerPage: string;
  };
  resultsTotal: number;
  title: string;
  url: string;
  displayedUrl: string;
  description: string;
  emphasizedKeywords: string[];
  siteLinks: string[];
  productInfo: {
    rating: number;
    numberOfReviews: number;
  };
  type: string;
  position: number;
};
