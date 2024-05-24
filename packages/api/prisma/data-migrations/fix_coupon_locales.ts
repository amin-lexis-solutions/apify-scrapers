import { PrismaClient } from '@prisma/client';
import ProgressBar from 'progress';
import { parse } from 'tldts';
import { detect } from 'langdetect';

const prisma = new PrismaClient();

async function main() {
  console.log('Start Coupon Locale Fix');

  // Find all coupons limited to 10 for this example
  const coupons = await prisma.coupon.findMany({
    take: 100,
    select: {
      id: true,
      title: true,
      sourceUrl: true,
      domain: true,
      description: true,
      locale: true,
    },
  });

  // find all targetPage

  const targetPages = await prisma.targetPage.findMany({
    select: {
      id: true,
      url: true,
      locale: true,
    },
  });

  const locales = await prisma.targetLocale.findMany({
    select: {
      locale: true,
      countryCode: true,
      languageCode: true,
    },
  });

  const batchSize = 100; // Adjust this value based on your needs
  const bar = new ProgressBar('Processing [:bar] :percent :etas', {
    total: Math.ceil(coupons.length / batchSize),
    width: 40,
  });

  for (let i = 0; i < coupons.length; i += batchSize) {
    const batch = coupons.slice(i, i + batchSize);
    const updates = batch.map((coupon: any) => {
      console.log(`\n`); // Debugging
      const targetPage = targetPages.find(
        (tp: any) => tp.url === coupon.sourceUrl
      );

      const countryCode = getCountryCodeFromDomain(coupon.domain);
      const localeFromCountryCode = locales.find(
        (l: any) => l.countryCode === countryCode?.toLowerCase()
      );

      const langCode = detectLanguage(
        [coupon.title, coupon.description].join(' ')
      );

      const locale = locales.find((l: any) => l.languageCode === langCode);

      console.log(
        `Coupon Match Base URL`,
        ' [TP locale] :',
        targetPage?.locale?.locale,
        ' : [COUPON locale] :',
        coupon.locale
      ); // Debugging

      console.log(
        'Coupon Match Domain Country Code',
        coupon.domain,
        ' [Detected locale] :',
        localeFromCountryCode?.locale,
        ' : [COUPON locale] :',
        coupon.locale
      ); // Debugging

      console.log(
        `Coupon Match Language Detection ${langCode}`,
        ' [Detected locale] :',
        locale?.locale,
        ' : [COUPON Locale] :',
        coupon.locale
      ); // Debugging

      console.log(coupon.title, coupon.description);

      const local = getMostCommonLocale(
        targetPage?.locale?.locale || '',
        localeFromCountryCode?.locale || '',
        locale?.locale || ''
      );

      console.log(
        `Coupon Match Most Common Locale`,
        ' [Detected locale] :',
        local,
        ' : [COUPON Locale] :',
        coupon.locale
      ); // Debugging

      return prisma.coupon.update({
        where: { id: coupon.id },
        data: {
          locale: coupon.locale,
        },
      });
    });

    await prisma.$transaction(updates);
    bar.tick();
  }
}

const detectLanguage = (text: string): string => {
  const langCode = detect(text);
  return langCode[0].lang ? langCode[0].lang : '';
};

const getCountryCodeFromDomain = (domain: string): string | null => {
  const parsed = parse(domain);

  // tldts does not provide country codes directly, but it gives the TLD
  const tld = parsed.publicSuffix;

  if (!tld) {
    return null;
  }

  // Map common TLDs to ISO country codes (this list is not exhaustive)
  const tldToCountryCode: { [key: string]: string } = {
    ac: 'SH', // Ascension Island
    ad: 'AD', // Andorra
    ae: 'AE', // United Arab Emirates
    af: 'AF', // Afghanistan
    ag: 'AG', // Antigua and Barbuda
    ai: 'AI', // Anguilla
    al: 'AL', // Albania
    am: 'AM', // Armenia
    ao: 'AO', // Angola
    aq: 'AQ', // Antarctica
    ar: 'AR', // Argentina
    as: 'AS', // American Samoa
    at: 'AT', // Austria
    au: 'AU', // Australia
    aw: 'AW', // Aruba
    ax: 'AX', // Åland Islands
    az: 'AZ', // Azerbaijan
    ba: 'BA', // Bosnia and Herzegovina
    bb: 'BB', // Barbados
    bd: 'BD', // Bangladesh
    be: 'BE', // Belgium
    bf: 'BF', // Burkina Faso
    bg: 'BG', // Bulgaria
    bh: 'BH', // Bahrain
    bi: 'BI', // Burundi
    bj: 'BJ', // Benin
    bm: 'BM', // Bermuda
    bn: 'BN', // Brunei Darussalam
    bo: 'BO', // Bolivia
    bq: 'BQ', // Bonaire, Sint Eustatius and Saba
    br: 'BR', // Brazil
    bs: 'BS', // Bahamas
    bt: 'BT', // Bhutan
    bv: 'BV', // Bouvet Island
    bw: 'BW', // Botswana
    by: 'BY', // Belarus
    bz: 'BZ', // Belize
    ca: 'CA', // Canada
    cc: 'CC', // Cocos (Keeling) Islands
    cd: 'CD', // Congo, Democratic Republic of the
    cf: 'CF', // Central African Republic
    cg: 'CG', // Congo, Republic of the
    ch: 'CH', // Switzerland
    ci: 'CI', // Côte d'Ivoire
    ck: 'CK', // Cook Islands
    cl: 'CL', // Chile
    cm: 'CM', // Cameroon
    cn: 'CN', // China
    co: 'CO', // Colombia
    cr: 'CR', // Costa Rica
    cu: 'CU', // Cuba
    cv: 'CV', // Cape Verde
    cw: 'CW', // Curaçao
    cx: 'CX', // Christmas Island
    cy: 'CY', // Cyprus
    cz: 'CZ', // Czech Republic
    de: 'DE', // Germany
    dj: 'DJ', // Djibouti
    dk: 'DK', // Denmark
    dm: 'DM', // Dominica
    do: 'DO', // Dominican Republic
    dz: 'DZ', // Algeria
    ec: 'EC', // Ecuador
    ee: 'EE', // Estonia
    eg: 'EG', // Egypt
    eh: 'EH', // Western Sahara
    er: 'ER', // Eritrea
    es: 'ES', // Spain
    et: 'ET', // Ethiopia
    eu: 'EU', // European Union
    fi: 'FI', // Finland
    fj: 'FJ', // Fiji
    fk: 'FK', // Falkland Islands (Malvinas)
    fm: 'FM', // Micronesia, Federated States of
    fo: 'FO', // Faroe Islands
    fr: 'FR', // France
    ga: 'GA', // Gabon
    gb: 'GB', // United Kingdom
    gd: 'GD', // Grenada
    ge: 'GE', // Georgia
    gf: 'GF', // French Guiana
    gg: 'GG', // Guernsey
    gh: 'GH', // Ghana
    gi: 'GI', // Gibraltar
    gl: 'GL', // Greenland
    gm: 'GM', // Gambia
    gn: 'GN', // Guinea
    gp: 'GP', // Guadeloupe
    gq: 'GQ', // Equatorial Guinea
    gr: 'GR', // Greece
    gs: 'GS', // South Georgia and the South Sandwich Islands
    gt: 'GT', // Guatemala
    gu: 'GU', // Guam
    gw: 'GW', // Guinea-Bissau
    gy: 'GY', // Guyana
    hk: 'HK', // Hong Kong
    hm: 'HM', // Heard Island and McDonald Islands
    hn: 'HN', // Honduras
    hr: 'HR', // Croatia
    ht: 'HT', // Haiti
    hu: 'HU', // Hungary
    id: 'ID', // Indonesia
    ie: 'IE', // Ireland
    il: 'IL', // Israel
    im: 'IM', // Isle of Man
    in: 'IN', // India
    io: 'IO', // British Indian Ocean Territory
    iq: 'IQ', // Iraq
    ir: 'IR', // Iran, Islamic Republic of
    is: 'IS', // Iceland
    it: 'IT', // Italy
    je: 'JE', // Jersey
    jm: 'JM', // Jamaica
    jo: 'JO', // Jordan
    jp: 'JP', // Japan
    ke: 'KE', // Kenya
    kg: 'KG', // Kyrgyzstan
    kh: 'KH', // Cambodia
    ki: 'KI', // Kiribati
    km: 'KM', // Comoros
    kn: 'KN', // Saint Kitts and Nevis
    kp: 'KP', // Korea, Democratic People's Republic of
    kr: 'KR', // Korea, Republic of
    kw: 'KW', // Kuwait
    ky: 'KY', // Cayman Islands
    kz: 'KZ', // Kazakhstan
    la: 'LA', // Lao People's Democratic Republic
    lb: 'LB', // Lebanon
    lc: 'LC', // Saint Lucia
    li: 'LI', // Liechtenstein
    lk: 'LK', // Sri Lanka
    lr: 'LR', // Liberia
    ls: 'LS', // Lesotho
    lt: 'LT', // Lithuania
    lu: 'LU', // Luxembourg
    lv: 'LV', // Latvia
    ly: 'LY', // Libya
    ma: 'MA', // Morocco
    mc: 'MC', // Monaco
    md: 'MD', // Moldova, Republic of
    me: 'ME', // Montenegro
    mf: 'MF', // Saint Martin (French part)
    mg: 'MG', // Madagascar
    mh: 'MH', // Marshall Islands
    mk: 'MK', // North Macedonia
    ml: 'ML', // Mali
    mm: 'MM', // Myanmar
    mn: 'MN', // Mongolia
    mo: 'MO', // Macao
    mp: 'MP', // Northern Mariana Islands
    mq: 'MQ', // Martinique
    mr: 'MR', // Mauritania
    ms: 'MS', // Montserrat
    mt: 'MT', // Malta
    mu: 'MU', // Mauritius
    mv: 'MV', // Maldives
    mw: 'MW', // Malawi
    mx: 'MX', // Mexico
    my: 'MY', // Malaysia
    mz: 'MZ', // Mozambique
    na: 'NA', // Namibia
    nc: 'NC', // New Caledonia
    ne: 'NE', // Niger
    nf: 'NF', // Norfolk Island
    ng: 'NG', // Nigeria
    ni: 'NI', // Nicaragua
    nl: 'NL', // Netherlands
    no: 'NO', // Norway
    np: 'NP', // Nepal
    nr: 'NR', // Nauru
    nu: 'NU', // Niue
    nz: 'NZ', // New Zealand
    om: 'OM', // Oman
    pa: 'PA', // Panama
    pe: 'PE', // Peru
    pf: 'PF', // French Polynesia
    pg: 'PG', // Papua New Guinea
    ph: 'PH', // Philippines
    pk: 'PK', // Pakistan
    pl: 'PL', // Poland
    pm: 'PM', // Saint Pierre and Miquelon
    pn: 'PN', // Pitcairn
    pr: 'PR', // Puerto Rico
    ps: 'PS', // Palestine, State of
    pt: 'PT', // Portugal
    pw: 'PW', // Palau
    py: 'PY', // Paraguay
    qa: 'QA', // Qatar
    re: 'RE', // Réunion
    ro: 'RO', // Romania
    rs: 'RS', // Serbia
    ru: 'RU', // Russian Federation
    rw: 'RW', // Rwanda
    sa: 'SA', // Saudi Arabia
    sb: 'SB', // Solomon Islands
    sc: 'SC', // Seychelles
    sd: 'SD', // Sudan
    se: 'SE', // Sweden
    sg: 'SG', // Singapore
    sh: 'SH', // Saint Helena, Ascension and Tristan da Cunha
    si: 'SI', // Slovenia
    sj: 'SJ', // Svalbard and Jan Mayen
    sk: 'SK', // Slovakia
    sl: 'SL', // Sierra Leone
    sm: 'SM', // San Marino
    sn: 'SN', // Senegal
    so: 'SO', // Somalia
    sr: 'SR', // Suriname
    ss: 'SS', // South Sudan
    st: 'ST', // Sao Tome and Principe
    sv: 'SV', // El Salvador
    sx: 'SX', // Sint Maarten (Dutch part)
    sy: 'SY', // Syrian Arab Republic
    sz: 'SZ', // Eswatini
    tc: 'TC', // Turks and Caicos Islands
    td: 'TD', // Chad
    tf: 'TF', // French Southern Territories
    tg: 'TG', // Togo
    th: 'TH', // Thailand
    tj: 'TJ', // Tajikistan
    tk: 'TK', // Tokelau
    tl: 'TL', // Timor-Leste
    tm: 'TM', // Turkmenistan
    tn: 'TN', // Tunisia
    to: 'TO', // Tonga
    tr: 'TR', // Turkey
    tt: 'TT', // Trinidad and Tobago
    tv: 'TV', // Tuvalu
    tz: 'TZ', // Tanzania, United Republic of
    ua: 'UA', // Ukraine
    ug: 'UG', // Uganda
    uk: 'GB', // United Kingdom
    us: 'US', // United States of America
    uy: 'UY', // Uruguay
    uz: 'UZ', // Uzbekistan
    va: 'VA', // Holy See
    vc: 'VC', // Saint Vincent and the Grenadines
    ve: 'VE', // Venezuela
    vg: 'VG', // Virgin Islands, British
    vi: 'VI', // Virgin Islands, U.S.
    vn: 'VN', // Viet Nam
    vu: 'VU', // Vanuatu
    wf: 'WF', // Wallis and Futuna
    ws: 'WS', // Samoa
    ye: 'YE', // Yemen
    yt: 'YT', // Mayotte
    za: 'ZA', // South Africa
    zm: 'ZM', // Zambia
    zw: 'ZW', // Zimbabwe
  };

  return tldToCountryCode[tld] || null;
};

function getMostCommonLocale(...data: string[]): string {
  const countMap: { [key: string]: number } = {};

  // Count occurrences of each language code
  data.forEach((code) => {
    countMap[code] = (countMap[code] || 0) + 1;
  });

  // Find the most common language code
  let mostCommonCode = '';
  let maxCount = 0;

  for (const code in countMap) {
    if (countMap[code] > maxCount) {
      mostCommonCode = code;
      maxCount = countMap[code];
    }
  }

  return mostCommonCode;
}

main()
  .catch(async (e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
