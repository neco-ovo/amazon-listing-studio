import path from 'node:path';
import {readFile} from 'node:fs/promises';
import {strFromU8, unzipSync} from 'fflate';
import readXlsxFile from 'read-excel-file/node';

import {fail} from './errors.js';

const HEADER_ALIASES = {
  keyword: ['keyword', '关键词', '流量词'],
  traffic_share: ['traffic share', '流量占比'],
  organic_rank: ['organic rank', '自然排名'],
  sponsored_rank: ['sponsored rank', '广告排名'],
  relevance: ['relevance', '相关度'],
  monthly_searches: ['monthly searches', 'm. searches', '月搜索量'],
  purchases: ['purchases', '月购买量', '购买量'],
  purchase_rate: ['purchase rate', '购买率'],
  spr: ['spr'],
  title_density: ['title density', '标题密度'],
  products: ['products', '商品数'],
  demand_supply_ratio: ['dsr', 'demand to supply ratio', '供需比', '需供比'],
  click_concentration: ['click concentration', '点击集中度', '点击总占比'],
  conversion_concentration: ['conversion concentration', '转化集中度', '转化总占比'],
  ppc: ['ppc bid', 'ppc价格']
};

const ALIAS_TO_FIELD = new Map(Object.entries(HEADER_ALIASES).flatMap(([field, aliases]) => (
  aliases.map(alias => [normalizeHeader(alias), field])
)));

function normalizeHeader(value) {
  return String(value ?? '').trim().toLocaleLowerCase('en-US').replace(/\s+/g, ' ');
}

function cleanBasename(filePath) {
  return path.basename(filePath).replace(/[\u0000-\u001f\u007f]/g, '').trim();
}

function numeric(value, {percent = false} = {}) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const hasPercent = trimmed.endsWith('%');
  const parsed = Number(trimmed.replace(/[$,%\s]/g, ''));
  if (!Number.isFinite(parsed)) return null;
  return (percent || hasPercent) && hasPercent ? parsed / 100 : parsed;
}

function headerMap(row) {
  const output = new Map();
  const duplicates = new Set();
  row.forEach((value, index) => {
    const field = ALIAS_TO_FIELD.get(normalizeHeader(value));
    if (!field) return;
    if (output.has(field)) duplicates.add(field);
    output.set(field, index);
  });
  return {fields: output, duplicates};
}

function reportType(headers) {
  const reverse = ['keyword', 'traffic_share', 'monthly_searches'].every(field => headers.fields.has(field));
  const mining = ['keyword', 'relevance', 'monthly_searches'].every(field => headers.fields.has(field));
  if (reverse === mining) return null;
  const type = reverse ? 'reverse_asin' : 'keyword_mining';
  const required = type === 'reverse_asin'
    ? ['keyword', 'traffic_share', 'monthly_searches']
    : ['keyword', 'relevance', 'monthly_searches'];
  return required.some(field => headers.duplicates.has(field)) ? null : type;
}

function sellerSpriteLike(headers) {
  return headers.fields.has('keyword') && headers.fields.size >= 2;
}

function decodeXml(value) {
  return value.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

async function visibleSheetNames(filePath) {
  const archive = unzipSync(new Uint8Array(await readFile(filePath)));
  const workbook = archive['xl/workbook.xml'];
  if (!workbook) throw new Error('Workbook metadata is missing.');
  const xml = strFromU8(workbook);
  const visible = new Set();
  for (const match of xml.matchAll(/<sheet\b([^>]*)\/?\s*>/g)) {
    const attributes = match[1];
    const name = attributes.match(/\bname="([^"]*)"/)?.[1];
    const state = attributes.match(/\bstate="([^"]*)"/)?.[1] ?? 'visible';
    if (name && state === 'visible') visible.add(decodeXml(name));
  }
  return visible;
}

function value(row, headers, field) {
  return headers.fields.has(field) ? row[headers.fields.get(field)] : null;
}

function parseRow(row, headers, type) {
  const keywordValue = value(row, headers, 'keyword');
  const keyword = typeof keywordValue === 'string' ? keywordValue.trim() : '';
  const monthlySearches = numeric(value(row, headers, 'monthly_searches'));
  const trafficShare = numeric(value(row, headers, 'traffic_share'), {percent: true});
  const relevance = numeric(value(row, headers, 'relevance'));
  const organicRank = numeric(value(row, headers, 'organic_rank'));
  const sponsoredRank = numeric(value(row, headers, 'sponsored_rank'));
  const valid = keyword && monthlySearches !== null && (type === 'keyword_mining'
    ? relevance !== null
    : trafficShare !== null && (organicRank !== null || sponsoredRank !== null));
  if (!valid) return null;
  return {
    keyword,
    traffic_share: trafficShare,
    organic_rank: organicRank,
    sponsored_rank: sponsoredRank,
    relevance,
    monthly_searches: monthlySearches,
    purchases: numeric(value(row, headers, 'purchases')),
    purchase_rate: numeric(value(row, headers, 'purchase_rate'), {percent: true}),
    spr: numeric(value(row, headers, 'spr')),
    title_density: numeric(value(row, headers, 'title_density')),
    products: numeric(value(row, headers, 'products')),
    demand_supply_ratio: numeric(value(row, headers, 'demand_supply_ratio')),
    click_concentration: numeric(value(row, headers, 'click_concentration'), {percent: true}),
    conversion_concentration: numeric(value(row, headers, 'conversion_concentration'), {percent: true}),
    ppc: numeric(value(row, headers, 'ppc'))
  };
}

export async function parseSellerSpriteWorkbook(filePath, importContext = {}) {
  let sheets;
  let visibleSheets;
  try {
    [sheets, visibleSheets] = await Promise.all([readXlsxFile(filePath), visibleSheetNames(filePath)]);
  } catch (error) {
    fail('UNSUPPORTED_KEYWORD_WORKBOOK', 'Cannot read SellerSprite workbook.', {reason: error.message});
  }
  for (const sheet of sheets) {
    if (!visibleSheets.has(sheet.sheet)) continue;
    const rows = sheet.data;
    if (!Array.isArray(rows) || rows.length < 2) continue;
    const headers = headerMap(rows[0]);
    const type = reportType(headers);
    if (!type) {
      if (sellerSpriteLike(headers)) {
        fail('UNSUPPORTED_KEYWORD_WORKBOOK', 'Visible SellerSprite sheet has an ambiguous or incomplete header signature.', {sheet: sheet.sheet});
      }
      continue;
    }
    const parsed = rows.slice(1).map(row => parseRow(row, headers, type));
    const validRows = parsed.filter(Boolean);
    if (!validRows.length) {
      fail('UNSUPPORTED_KEYWORD_WORKBOOK', 'First visible matching SellerSprite sheet has no valid data rows.', {sheet: sheet.sheet});
    }
    const scope = importContext.sampleScope ?? 'unknown_partial';
    return {
      report_type: type,
      source: {
        basename: cleanBasename(filePath),
        export_date: importContext.exportDate ?? null,
        marketplace: importContext.marketplace ?? null,
        analysis_scope: scope,
        scope_provenance: importContext.scopeProvenance ?? 'default',
        imported_rows: validRows.length
      },
      report_identity: type === 'reverse_asin'
        ? {reference_asin: importContext.referenceAsin ?? null}
        : {seed_query: importContext.seedQuery ?? null},
      rows: validRows,
      skipped_rows: parsed.length - validRows.length
    };
  }
  fail('UNSUPPORTED_KEYWORD_WORKBOOK', 'Workbook has no supported SellerSprite sheet with valid data rows.', {
    basename: cleanBasename(filePath)
  });
}
