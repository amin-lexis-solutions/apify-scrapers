import { Actor } from 'apify';
import { CheerioCrawler, CheerioCrawlingContext, RouterHandler } from 'crawlee';

type MainFunctionArgs = {
  startUrl: string;
  label: string;
  router: RouterHandler<CheerioCrawlingContext<any>>;
};

export function buildCheerioMainFunction(args: MainFunctionArgs) {
  return async function main() {
    await Actor.init();

    const input: any = await Actor.getInput();
    const proxyConfiguration = await Actor.createProxyConfiguration(
      input?.proxyConfiguration
    );

    let effectiveTestLimit = 0;
    if (typeof input?.testLimit === 'number' && input?.testLimit > 0) {
      effectiveTestLimit = input?.testLimit;
    }

    const crawler = new CheerioCrawler({
      proxyConfiguration,
      requestHandler: args.router,
    });

    await crawler.addRequests([
      {
        url: args.startUrl,
        label: args.label,
        userData: {
          testLimit: effectiveTestLimit,
        },
      },
    ]);

    await crawler.run();
    await Actor.exit();
  };
}
