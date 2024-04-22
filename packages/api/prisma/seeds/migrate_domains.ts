import { prisma } from '../../src/lib/prisma';

interface SOURCES_DATA {
  apifyActorId: string;
  domains: string[];
  name: string;
}

const SOURCES_DATA = [
  {
    apifyActorId: 'wdX0lCBLy8RO79kSa',
    domains: ['descuentos.milenio.com'],
    name: 'descuentos-milenio-com',
  },
  {
    apifyActorId: 'DGgL1NJ0x2fsAmmE5',
    domains: ['discountcode.dailymail.co.uk'],
    name: 'che-discodes-dailymail-co-uk',
  },
  {
    apifyActorId: 'z5RxDIQgJispxmUS1',
    domains: ['discountcode.metro.co.uk'],
    name: 'discountcode-metro-co-uk',
  },
  {
    apifyActorId: 'bjlyD8L6xZSQnE8Ni',
    domains: ['iprice.sg'],
    name: 'iprice-sg',
  },
  {
    apifyActorId: 'DfKj1xDVK5WdihR48',
    domains: ['coupons.nine.com.au'],
    name: 'coupons-nine-com-au',
  },
  {
    apifyActorId: 'jiqX9kJASkRZPUpsO',
    domains: ['gutscheinsammler.de'],
    name: 'gutscheinsammler-de',
  },
  {
    apifyActorId: 'JPA7emncpprCDZ4xs',
    domains: ['kortingscode.nl'],
    name: 'kortingscode-nl',
  },
  {
    apifyActorId: 'uVCmIDF8fMNw0YSRO',
    domains: ['wagjag.com'],
    name: 'wagjag-com-coupons',
  },
  {
    apifyActorId: 'BJ0jovOycVNS51CQE',
    domains: ['fyvor.com'],
    name: 'fyvor-com',
  },
  {
    apifyActorId: 'uHmwoz9vpNssOw5ER',
    domains: ['monbon.fr'],
    name: 'monbon-fr',
  },
  {
    apifyActorId: 'Y6zvD4CavcX57aoWa',
    domains: ['rabatkoder.ekstrabladet.dk'],
    name: 'rabatkoder-ekstrabladet-dk',
  },
  {
    apifyActorId: 'LSuJSDcILgQV4JoU7',
    domains: ['gutscheine.focus.de'],
    name: 'gutscheine-focus-de',
  },
  {
    apifyActorId: 'coffQyI0HwlPQSq0V',
    domains: ['gratislandet.se'],
    name: 'gratislandet-se',
  },
  {
    apifyActorId: 'GQ6U3VrM7r0oh5xG1',
    domains: ['lovecoupons.com.sg'],
    name: 'lovecoupons-com-sg',
  },
  {
    apifyActorId: '6zdYO2RMYizgJPhbT',
    domains: ['cupomgratis.net'],
    name: 'cupomgratis-net',
  },
  {
    apifyActorId: 'MQiPwlLsilqlYcu1e',
    domains: ['topbargains.com.au'],
    name: 'topbargains-com-au',
  },
  {
    apifyActorId: 'NjmUs14FDt8FxfaVK',
    domains: ['grabon.in'],
    name: 'grabon-in',
  },
  {
    apifyActorId: 'X08aUcWVtiCCJ2nm9',
    domains: ['bargainmoose.ca'],
    name: 'bargainmoose-ca',
  },
  {
    apifyActorId: '2CuApeL4aMl8Fu5QZ',
    domains: ['vouchercodesuae.com'],
    name: 'vouchercodesuae-com',
  },
  {
    apifyActorId: 'l6A2nX95Nxbs6cgUS',
    domains: ['frcodespromo.com'],
    name: 'frcodespromo-com',
  },
  {
    apifyActorId: 'k3ggVQpvlfO2mnjhW',
    domains: ['codepromo.lexpress.fr'],
    name: 'codepromo-lexpress-fr',
  },
  {
    apifyActorId: '6dtg2ZX6ULR2lpTtG',
    domains: ['korting.nl'],
    name: 'korting-nl',
  },
  {
    apifyActorId: 'gtuQ1rl6nl3TvXyav',
    domains: ['apisparwelt'],
    name: 'api-sparwelt-de',
  },
  {
    apifyActorId: 'rDxNsvFgMMY6WtSfi',
    domains: ['sparwelt.de'],
    name: 'gutscheine-sparwelt-de',
  },
  {
    apifyActorId: 'hs2vHdztdLtkP2lBq',
    domains: ['acties.nl'],
    name: 'acties-nl',
  },
  {
    apifyActorId: 'vT0OfdbNNqSheEL9z',
    domains: ['cuponomico.com'],
    name: 'cuponomico-com',
  },
  {
    apifyActorId: 'c3cBBONbb7vmcsyu8',
    domains: ['dealspotr.com'],
    name: 'dealspotr-com',
  },
  {
    apifyActorId: 'i7lzuBdLgbA0VhgF0',
    domains: ['meliuz.com.br'],
    name: 'meliuz-com-br',
  },
  {
    apifyActorId: 'sqTlYoKXhQOxcRI22',
    domains: ['promotionalcodes.org.uk'],
    name: 'promotionalcodes-org-uk',
  },
  {
    apifyActorId: '5UdjmJ3i9QmPsXWox',
    domains: ['coupons.hardwarezone.com.sg'],
    name: 'coupons-hardwarezone-com-sg',
  },
  {
    apifyActorId: '1FBcghRUmg5HYLczo',
    domains: ['pelando.com.br'],
    name: 'pelando-com-br',
  },
  {
    apifyActorId: 'z5RxDIQgJispxmUS1',
    domains: ['discountcode.metro.co.uk'],
    name: 'discountcode-metro-co-uk',
  },
  {
    apifyActorId: 'lgr8bwqepENS9cNpf',
    domains: ['coupons.oneindia.com'],
    name: 'coupons-oneindia-com',
  },
  {
    apifyActorId: 'pV9a5g0NeXaCtuuts',
    domains: [
      'signorsconto.it',
      'cupones.es',
      'rabathelten.dk',
      'rabattkalas.se',
    ],
    name: 'sparheld-gmbh',
  },
  {
    apifyActorId: 'q26APzOjoQoA0r1KD',
    domains: ['rabattkoder.tv2.no'],
    name: 'rabattkoder-tv2-no',
  },
  {
    apifyActorId: '53fGllHXsa6FgT0li',
    domains: [
      'cuponation.ch',
      'cuponation.com.au',
      'cuponation.com.br',
      'cuponation.com.sg',
    ],
    name: 'cuponation',
  },
  {
    apifyActorId: 'Q3C3EqJdUaogMiges',
    domains: ['kuplio.ro'],
    name: 'kuplio-ro',
  },
  {
    apifyActorId: 'E0ttlQYLdG6AIOQZK',
    domains: ['picodi.com'],
    name: 'picodi-com',
  },
  {
    apifyActorId: '6YqT5Fr9b8BsQAEnG',
    domains: [
      'save-up.ch',
      'save-up.cz',
      'save-up.de',
      'saveup.fr',
      'save-up.co.no',
      'save-up.es',
      'save-up.it',
      'save-up.at',
    ],
    name: 'save-up',
  },
  {
    apifyActorId: 'C536JcEAK0Bo5Ojlz',
    domains: [
      'vouchercloud.de',
      'vouchercloud.com',
      'vouchercloud.ie',
      'vouchercloud.fr',
      'voucher-cloud.com.au',
      'vouchercloudbr.com.br',
    ],
    name: 'vouchercloud',
  },
  {
    apifyActorId: 'L8DbgP00QG8VpUbC8',
    domains: [
      'vouchercodes.my',
      'vouchercodes.sg',
      'vouchercodes.ph',
      'vouchercodes.co.in',
      'vouchercodes.hk',
      'vouchercodes.id',
      'myvouchercodes.ae',
    ],
    name: 'vouchercodes',
  },
  {
    apifyActorId: 'F1LGSk4KRLhbb8bOp',
    domains: ['gutscheine.chip.de'],
    name: 'gutscheine-chip-de',
  },
  {
    apifyActorId: 'i7xwOrJTQfutyw7ez',
    domains: ['gutscheine.blick.ch'],
    name: 'gutscheine-blick-ch',
  },
  {
    apifyActorId: 'PwM2HbvD7TveaFZUD',
    domains: ['gutscheine.kleinezeitung.at'],
    name: 'gutscheine-kleinezeitung-at',
  },
  {
    apifyActorId: 'aUa6nMaBNyo4vtmFt',
    domains: ['descuentos.elpais.com'],
    name: 'descuentos-elpais-com',
  },
  {
    apifyActorId: 's8mpQxHhRl9BZtG7q',
    domains: ['cuponomia.com.br'],
    name: 'cuponomia-com-br',
  },
];

async function seedSources() {
  for (const { apifyActorId, domains, name } of SOURCES_DATA) {
    await prisma.source.upsert({
      where: { apifyActorId: apifyActorId },
      update: {
        name,
        domains: {
          create: domains.map((domain) => ({ domain })),
        },
      },
      create: {
        name,
        apifyActorId, // Add this line
        domains: {
          create: domains.map((domain) => ({ domain })),
        },
      },
    });
  }
}

seedSources()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
