# Intro

The projects aim to collect coupon codes and promotions by scraping target websites for target countries. In this project, we call countries locales and scrapers actors.

The target countries (locales) are specified in the DB, and the merchants (brands) we are interested in for every locale come from the client’s API.

The target websites are sourced via Google. Since we know which locales and brands we are interested in, we can ask Google to find websites with coupon codes for those locale-brand pairs. We make the Google request by specifying the country's location and translating the query into the appropriate language. We then analyze the top results and see which domains are among the best ranked.

Apify’s Google actor is utilized for the automation of this process.

Once we have a DB with Google-sourced coupon URLs, we can manually inspect domains containing multiple URLs. If a domain proves a good scraping candidate, we create a scraper.

The scrapers themselves are Apify actors that run on Apify infrastructure but persist data in our DB via a custom API we’ve created.

# Creating a new Apify actor

## Analyze the site

When you receive a domain to evaluate and implement a new Apify actor, your first step is to define if this is a specialized website for coupon codes or a general-purpose site with a coupon codes section somewhere inside. For example, [rabattsok.se](https://www.rabattsok.se/) is a specialized one. In [coupons.usatoday.com](https://coupons.usatoday.com/) we have a general-purpose website, but the coupon codes section is realized as a subdomain.

What do you do if the coupon codes section of a general-purpose website is somewhere in a folder and you cannot easily locate it?

For example, let’s see the domain [forbes.com](https://forbes.com). It is a pretty huge website, and you cannot find the coupon codes section. So you can use Google search with this template query **_site:&lt;domain_name> coupon codes _**. So, for our example, we receive the right place as the first result:

<img width="618" alt="image" src="https://github.com/OberstBV/apify-scrapers/assets/12779603/7bf94a62-9600-4cf1-b415-09244dc2872b">

## Find at least one merchant listing page

The next step you must take is to find a merchant listing page. This is a page where coupon codes for one particular merchant are listed. These kinds of pages are the starting points of all Oberst actors. You will recognize these pages because they usually contain a merchant logo, and all the coupons listed are provided by the same merchant.

For example:

<img width="623" alt="image" src="https://github.com/OberstBV/apify-scrapers/assets/12779603/bf2626c7-d93d-4e28-8f9c-5c7cfdfccb9a">

## Extract merchant name and domain

All coupon pages dedicated to merchants have the merchant's name on them. If not, we shall not scrape the site. You must extract the merchant’s name to ensure the current listing page is correct. This can be done in a few places:

- Merchant logo image - usually in “alt” or “title” attribute.
- Breadcrumbs - the last item is the current page, and it usually contains the merchant name
- &lt;title> element or &lt;h1> element, not very convenient because they usually contain a lot of information put there for SEO purposes.
- If the data is stored in a JSON format, you should preferably extract all data, including merchant name, from there
- As a last resort, you can extract the merchant name from the coupon items, but this is not advisable because you should have a valid merchant name before you continue with coupon items listing

Sometimes, you must purify the value to extract only the name and not bulk strings. For example, here, you must remove “logo “ from the value of the “alt” attribute: \

![image](https://github.com/OberstBV/apify-scrapers/assets/12779603/6ef95de1-3698-4576-bf3a-6de5ecb81e10)

**_NB! If you cannot extract a valid merchant name, you must throw an error that this is not a merchant coupons listing page._**

Sometimes, but not always, there is information about the merchant's domain name, and if this is the case, you have to extract it. The merchant domain name can be found in several places:

- In the URL of the merchant page, like here for [groupon.com](https://www.groupon.com/): \
  [https://www.forbes.com/coupons/groupon.com/](https://www.forbes.com/coupons/groupon.com/)
- If the data is stored in a JSON format, you preferably should extract all, including merchant domain name, from there
- Somewhere else on the page. Be creative!

## Extract the coupon items on the merchant listing page

Usually, there must be at least one listing of the valid coupons and offers, but there might also be another list of recently expired ones. If that’s the case, we need to extract both.

You can usually find the list of items:

1. In JSON - this place must be preferred if present because it offers a fast and clean way of loading all needed data. For example, all sites based on ‘shared/next-routes.ts’ store their data in a JSON included in a &lt;script> element:

<img width="1022" alt="image" src="https://github.com/OberstBV/apify-scrapers/assets/12779603/0922fc0f-82c5-4dcf-850b-9972dc087281">

2. In the HTML code itself. This is the most common case. You must find the right CSS query to select all coupon and/or offers items. For example, here we gather both valid and expired items:

<img width="622" alt="image" src="https://github.com/OberstBV/apify-scrapers/assets/12779603/6bb5cb60-1261-4dcd-9cd2-a65c879de4bf">

## Check if the coupon codes are fully presented on the merchant listing page or must be requested one by one

Usually, coupon items have a button to reveal the code. Offer items that have no coupon code must be left intact.

When you click on this button, you are redirected to a new page with a popup modal dialogue. You can copy the code and link to the merchant site to use it.

Example:

<img width="621" alt="image" src="https://github.com/OberstBV/apify-scrapers/assets/12779603/ae2a51ed-b51f-4548-a449-dfbe65df45c4">

When we click on “peel” button to reveal the coupon code, we receive this modal popup:

<img width="621" alt="image" src="https://github.com/OberstBV/apify-scrapers/assets/12779603/2b60ae72-2526-4635-be22-21f6c821f6d5">

In most cases, we have to request each individual coupon code. However, sometimes, the full coupon code is presented on the listing page so that we can skip those individual requests. We must ensure we don’t make any requests without need.

# Deployment process

## Running the deployment script

When deploying a new actor to the Apify system, the first step is to issue the right command line on your local system. This command runs a helper script `./scripts/deploy-apify.js`, and it receives two parameters: the actor name, which is the same as the package folder name and the type of the actor - `cheerio` or `puppeteer`.

For example:

`./scripts/deploy-apify.js acties-ns cheerio`

This script does the following steps:

### Script Overview

The script is a Node.js application designed to deploy an actor to Apify. An actor is a cloud program that can perform tasks such as web scraping. The script handles input from the command line, writes configuration files based on templates, potentially performs a deployment to Apify, and cleans up afterwards.

### Detailed Steps

1. **Environment Setup and Imports:**
   - The script starts with a shebang line that specifies the script should be run with Node.js.
   - It imports necessary Node.js modules such as `fs` for file system operations, `execSync` from `child_process` for executing shell commands, and `path` for file path operations.
2. **Command Line Arguments Parsing:**
   - `actorId` is read from the first command-line argument. This is the actor's unique identifier.
   - `actorType` is read from the second command line argument, and it should be either 'cheerio' or 'puppeteer', which are types of actors/scrapers.
   - `dryRun` checks if the third command line argument is `--dry-run`, which means the script will simulate the deployment without making any changes.
3. **Initial Validations:**
   - The script checks if `actorId` and `actorType` were provided. If not, it prints an error message and exits.
   - It also checks whether the `actorType` is valid ('cheerio' or 'puppeteer'). If not, it prints an error message and exits.
4. **Configuration File Preparation:**
   - It reads a Dockerfile template from a path based on the `actorType`.
   - The Dockerfile template text is modified by replacing a placeholder (`{{actorId}}`) with the actual `actorId`.
5. **Writing Configuration Files:**
   - Three JSON configuration files are generated and written to the filesystem:
     - `actor.json` using `getActorSpec` function, which contains metadata about the actor.
     - `input.json` using `getActorInputSpec` function, which defines inputs for the actor such as URLs to scrape.
     - `Dockerfile`, which is prepared from the Dockerfile template.
6. **Update .gitignore:**
   - The script reads the existing `.gitignore` file.
   - It appends additional lines to ignore certain directories, but keep directories related to the shared package and the current actor package.
   - This updated content is written back to the `.gitignore` file if it does not already contain the additional lines.
7. **Deployment Process:**
   - If `dryRun` is true, the script prints a message about the dry run completion and exits.
   - If not a dry run, it executes the `apify push` command using `execSync`. This command deploys the actor to Apify.
   - This command is run from the parent directory of the current script's directory.
8. **Error and Signal Handling:**
   - The script defines a `cleanup` function that deletes the configuration files created earlier and restores the original `.gitignore` file.
   - It registers this function to be called on the `SIGINT` signal (which is sent when you press CTRL+C).
   - The `cleanup` function is also called in a `finally` block to ensure it executes regardless of how the script terminates (normally or due to an error).

### **Helper Functions**

- `getActorSpec(actorId)`: Generates and returns an object representing the actor's configuration.
- `getActorInputSpec()`: Generates and returns an object representing the input configuration for the actor.

### **Summary**

This script is a comprehensive deployment tool that automates the setup of environment configurations for different types of Apify actors, handles conditional dry runs for safe testing, and cleans up after itself to maintain a tidy working environment. External configuration templates and JSON structures ensure that actors are configurable and versatile for different scraping tasks.

## Setting the start URL-s and proxy configuration

After the above deployment is complete, open the actor’s Apify page and set start URL-s:

<img width="756" alt="image" src="https://github.com/OberstBV/apify-scrapers/assets/12779603/bb823ce1-b6d1-4176-a237-826487312ef2">

… and proxy configuration for the current actor:

<img width="707" alt="image" src="https://github.com/OberstBV/apify-scrapers/assets/12779603/6ef7ff7f-6682-4c15-be16-7c3a615bb973">

## Inserting a record for the new actor into the production DB

The next step is to get its `apifyActorId`, which is on the address bar:

<img width="707" alt="image" src="https://github.com/OberstBV/apify-scrapers/assets/12779603/ab948e78-35bc-4510-9500-313d373df26e">

Having this `apifyActorId` in hand, we must insert a record in the prod DB, the `Source` table. We also save the `domain` and package `name`. The field `isActive` for now is `false`, until we share the actor to the Oberst Apify account. We execute an insert query:

<img width="620" alt="image" src="https://github.com/OberstBV/apify-scrapers/assets/12779603/d8a698e1-3f02-48cc-b5d5-a2e44312a77b">

… and the record is created:

<img width="621" alt="image" src="https://github.com/OberstBV/apify-scrapers/assets/12779603/086ef69b-dafb-4d09-a893-bb2ba463b9bf">

The next step is to share the actor with the Oberst Apify account. We click on the three dots button on the top right:

<img width="1199" alt="image" src="https://github.com/OberstBV/apify-scrapers/assets/12779603/192340d3-956b-4f89-9c71-30974c51b3f6">

… and share the actor with Oberst Apify account, which is `huggable_baobab`:

<img width="620" alt="image" src="https://github.com/OberstBV/apify-scrapers/assets/12779603/0c83c016-975c-435f-a550-78ea5f92b4a5">

… we must check these options: `read, write, run, build, manage access rights`:

<img width="923" alt="image" src="https://github.com/OberstBV/apify-scrapers/assets/12779603/79443fd7-6cd6-4a0f-971f-d8182966dbe8">

After that, we must update `apifyActorId` field in the prod DB, the `Source` table, setting it to true:

<img width="227" alt="image" src="https://github.com/OberstBV/apify-scrapers/assets/12779603/f71cb78a-9822-470a-8a56-930668f52f39">

… and now the actor is in operation:

<img width="622" alt="image" src="https://github.com/OberstBV/apify-scrapers/assets/12779603/49d5a0d5-ac7d-4657-93dc-93b5ccb4b19a">

# File and directory structure of an actor

Each actor follows, in general, the typical file and directory structure of a node.js project. However, some parts are stored in `shared` folder, others are generated during the deployment process.

Here is an example of an actor files and directories:

<img width="622" alt="image" src="https://github.com/OberstBV/apify-scrapers/assets/12779603/8a680a22-047d-4312-8f62-9a939ac8b9e0">

## The root directory

This directory contains the other subdirectories, as well as some common files for every `node.js` project like: <em>package. json</em>, <em>README.md</em> and <em>tsconfig.json</em>

## The dist directory

This directory contains compiled `TypeScript` code into `JavaScript`.

## The node_modules directory

This directory contains the `TypeScript` modules used in the current actor.

## The storage directory

This directory contains all data used as input or output of the actor.

## The src directory

This directory contains the actual code of the current actor and usually contains two `TypeScript` files: main.ts and routes.ts. The latter may not be presented if the actor uses a generic router from the `shared` folder.

# Overview of the code of an actor

Each actor receives the same input structure and returns the same output structure. The actual code must ensure these, regardless of the website, it crawls and scrapes. Each actor is from one of the two kinds: `CheerioCrawler` and `PuppeteerCrawler`. Apart from that distinction, the actors have very similar code structures.

## The main.ts file

Each actor must have at least one _src/main.ts_ `TypeScript` file, which is the entry point of its code run. This file contains very few lines of code and is mostly standard and the same in each actor. The only differences are:

- The kind of the actor (`CheerioCrawler` or `PuppeteerCrawler`)
- The router may be custom and located in the same <em>src</em> folder as<em> src/routes.ts</em> (the most common case) or a generic one imported from <em>shared</em> folder
- The crawler may or may not (the most common case) receive some custom parameters when it is created.

The first line of the code is always the initialization of [Sentry](https://sentry.io/) for bug reporting.

Let’s see some examples:

This is a `CheerioCrawler` with a custom router. This is the most common cause:

<img width="707" alt="image" src="https://github.com/OberstBV/apify-scrapers/assets/12779603/03619681-ff49-451f-bb45-942920b993a3">

This is a `PuppeteerCrawler` with a custom router:

<img width="622" alt="image" src="https://github.com/OberstBV/apify-scrapers/assets/12779603/82431ad4-39de-4aa6-a071-12f902981d4d">

This is a `CheerioCrawler` with a generic router and parameters:

![Uploading image.png…]()

## The shared/src/actor-utils.ts file

This file provides utility functions for initializing and configuring Cheerio and Puppeteer crawlers within the Apify platform. The main purpose of the code is to set up two separate scraping utilities (`CheerioCrawler` and `PuppeteerCrawler`) to crawl web pages using custom configurations efficiently. The code handles input, logging, and data extraction using various imported dependencies.

### **Structure**

1. **Imports & Type Definitions**:
   - **External Libraries**:
     - `@sentry/node`: Used for error logging and tracking in Sentry.
     - `apify`: To access the `Actor` utility and `RequestQueue`.
     - `crawlee`: Provides types and functionality for crawlers.
   - **Type Definitions**:
     - `Input`: Defines the format of the input provided to the actor. It includes an array of starting URLs and optional proxy configuration.
     - `MainFunctionArgs`: Configuration parameters for custom headers, domain/country identification, and retry mechanisms.
2. **Constants**:
   - `CUSTOM_HEADERS`: Predefined user-agent header for identification in web requests.
   - `Label`: Enumerated constants for classifying web pages into categories.
3. **Utility Functions**:
   - `buildRequestData`:
     - Converts an array of objects containing URLs into an array of requestQueue for the start URLs.
4. <strong>Crawler Preparation Functions</strong>:
   - `prepareCheerioScraper`:
     - Prepares a Cheerio-based crawler with custom configurations.
     - Retrieves and validates the input, initializes the proxy configuration, and opens a request queue.
     - Configures the crawler using `CheerioCrawler` with retry settings and Sentry error logging.
     - Merges custom headers and manually add URLs to the request queue, extracting domain and country code optionally.
   - `preparePuppeteerScraper`:
     - Prepares a Puppeteer-based crawler similar to the Cheerio scraper.
     - Sets up the `PuppeteerCrawler` with headless browsing, session pooling, and custom navigation settings.
     - Like the Cheerio function, merges custom headers and adds URLs to the request queue.

### <strong>What the Code Does</strong>

- The file is designed to help set up two types of crawlers (Cheerio and Puppeteer) using shared utilities and practices.
- Each crawler receives a router handler for scraping logic and uses custom headers, retry settings, and error logging via Sentry.
- Custom labels categorize pages, and data extraction can be modified based on provided inputs (e.g., domain and country code).
- Both functions share similar initialization steps but differ in crawler-specific configurations (e.g., Puppeteer runs headless by default).

Overall, this file aims to abstract and simplify the initialization and configuration of web scrapers for specific data extraction tasks.

## The src/routes.ts file

Routes defines an asynchronous handler for processing coupon data from a web page. It is integrated with a router to handle requests labeled as Label.listing. The handler extracts coupon information, processes it, and enqueues links for further processing if necessary.

### Handler Function: `router.addHandler(Label.listing, async (context) => { ... })`

#### Parameters

- context: An object containing various properties and methods related to the current request, including:
- request: The original request object.
- page: The Puppeteer page object.
- enqueueLinks: A function to enqueue new links for processing.
- log: A logger for recording messages.

#### Detailed Steps and Function Descriptions

1. **Check Request Label**

![Captura desde 2024-06-06 00-40-33](https://github.com/OberstBV/apify-scrapers/assets/167449927/5e74ac57-f4b9-48c0-8603-1d2af2b22464)

2. **Extract **NEXT_DATA** Script Content**

![Captura desde 2024-06-06 00-41-36](https://github.com/OberstBV/apify-scrapers/assets/167449927/ba422632-82f8-465a-8a95-5ccb36abd8da)

3. **Parse JSON data and validates its structure.**

![Captura desde 2024-06-06 00-42-11](https://github.com/OberstBV/apify-scrapers/assets/167449927/6f1cd22d-a5b2-47d9-875c-41bcc564a85b)

4. **Extract Merchant Information**

![Captura desde 2024-06-06 00-42-38](https://github.com/OberstBV/apify-scrapers/assets/167449927/f016c4b1-20ff-4d9b-bae5-60d148db6749)

5. **Combine Active and Expired Items**

![Captura desde 2024-06-06 00-43-06](https://github.com/OberstBV/apify-scrapers/assets/167449927/fe70b9fa-a678-4cd2-98c3-97322fb43cc4)

6. **Pre-process Items**

![Captura desde 2024-06-06 00-49-26](https://github.com/OberstBV/apify-scrapers/assets/167449927/234f4612-5172-4146-96cd-86520f57a62c)

Calls a pre-processing function to handle initial data preparation.

7. **Process Each Coupon Item**

![Captura desde 2024-06-06 00-51-22](https://github.com/OberstBV/apify-scrapers/assets/167449927/b1122ea1-cc3f-4ea1-a24d-a5c8402e45bd)

Validates and processes each voucher item, handling both those with and without codes.

![Captura desde 2024-06-06 00-55-28](https://github.com/OberstBV/apify-scrapers/assets/167449927/fcb4929a-5d1e-4842-9a16-323958cf9abb)

8. **Post-process Coupons with Codes**

![Captura desde 2024-06-06 00-55-38](https://github.com/OberstBV/apify-scrapers/assets/167449927/69fdc63e-7300-4b5d-ad13-71f55b56b013)

9. **Check Coupons with Codes**

![Captura desde 2024-06-06 00-53-34](https://github.com/OberstBV/apify-scrapers/assets/167449927/c7f75ad3-fee8-478b-a5eb-093ea64170f0)

This handler processes coupon data from a web page by extracting, validating, and processing item information, then enqueuing a itemUrl for further processing code if necessary. It also incorporates error handling and logging to ensure robust operation.
