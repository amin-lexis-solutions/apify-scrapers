import ProgressBar from 'progress';
import { SOURCES_DATA } from '../config/actors';
import { candidateDomains } from '../config/candidateDomains';
import { localesToImport } from '../config/primary-locales';
import { Locale } from '../config/locales';
import fs from 'fs';

async function main() {
  const results: Record<string, any[]> = {};

  // Get sorted locales from Locale enum
  const locales = Object.values(Locale).sort();

  const progressBar = new ProgressBar(
    'Processing :current/:total [:bar] :percent :etas',
    {
      total: locales.length,
    }
  );

  // Process each locale
  for (const locale of locales) {
    const domains = SOURCES_DATA.filter((source) =>
      source.domains.some((d) => d.locales.includes(locale))
    )
      .map((source) => {
        const domain = source.domains.find((d) => d.locales.includes(locale));
        if (!domain) return null;

        let route = '';
        if (domain.routes && Object.keys(domain.routes).length > 0) {
          route =
            Object.keys(domain.routes).find(
              (key) => domain.routes[key] === locale
            ) || '';
        }

        return {
          domain: `${domain.domain}${route}`,
          apifyActorId: source.apifyActorId,
        };
      })
      .filter(Boolean); // Remove null values

    results[locale] = domains;
    progressBar.tick();
  }

  // Generate markdown content
  const markdownContent = generateMarkdown(results, localesToImport);

  // Write markdown to file
  fs.writeFileSync(
    './wiki/State of project ‐ locales, domains & actors.md',
    markdownContent
  );

  // Log total domains count
  const totalDomains = Object.values(results).flat().length;
  console.log(`Total domains: ${totalDomains}`);
}

function generateMarkdown(
  results: Record<string, any[]>,
  localesToImport: any[]
): string {
  let markdown = '';

  const getColorAndMarkup = (status: string) => {
    switch (status) {
      case 'accepted':
        return { color: 'green', markup: '**' };
      case 'rejected':
        return { color: 'red', markup: '~~' };
      default:
        return { color: 'gray', markup: '' };
    }
  };

  // Process primary locales
  markdown += '# Primary locales : \n\n';
  for (const locale of localesToImport) {
    markdown += `## ${locale.locale}\n\n`;
    for (const domain of results[locale.locale] || []) {
      markdown += `- \`${domain.domain}\`\n`;
    }
    markdown += '\n';
    const domains = candidateDomains[locale.locale] || null;
    if (domains?.length > 0) {
      for (const domain of domains) {
        const { color, markup } = getColorAndMarkup(domain.status);
        const formattedStatus = `<span style="color:${color}">${domain.status}</span>`;
        markdown += `- ${markup}\` ${domain.domain} \`${markup}  - ${formattedStatus}\n`;
      }
    }
    markdown += '\n\n\n';
    markdown += '\n\n\n';
  }

  // Process extra locales
  const localesNotToImport = Object.keys(results).filter(
    (locale) => !localesToImport.some((l) => l.locale === locale)
  );
  markdown += '# Extra locales : \n\n';
  for (const locale of localesNotToImport) {
    markdown += `## ${locale}\n\n`;
    for (const domain of results[locale] || []) {
      markdown += `- \`${domain.domain}\`\n`;
    }

    markdown += '\n';
    const domains = candidateDomains[locale] || null;
    if (domains?.length > 0) {
      for (const domain of domains) {
        const { color, markup } = getColorAndMarkup(domain.status);
        const formattedStatus = `<span style="color:${color}">${domain.status}</span>`;
        markdown += `- ${markup}\` ${domain.domain} \`${markup}  - ${formattedStatus}\n`;
      }
    }
    markdown += '\n\n\n';
  }

  return markdown;
}

main()
  .catch(async (error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    console.log('Done');
  });
