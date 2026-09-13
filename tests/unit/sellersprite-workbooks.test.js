import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

import {parseSellerSpriteWorkbook} from '../../scripts/lib/sellersprite-workbooks.js';
import {miningHeaders, reverseHeaders, writeSellerSpriteWorkbook} from '../helpers/sellersprite-workbooks.js';
import {withTempWorkspace} from '../helpers/temp-workspace.js';

const reverseRow = ['slow down kids at play sign', '6.23%', 6, null, '6,254', 563, '9%', 13, 7, 2673, 14.5, '$1.84'];
const miningRow = ['slow down kids at play sign', 100, '6,254', 563, 0.09, 13, 7, 2673, 14.5, '$1.84'];

test('detects Reverse ASIN and accepts one valid rank', async () => {
  await withTempWorkspace(async root => {
    const file = path.join(root, 'reverse.xlsx');
    await writeSellerSpriteWorkbook(file, {headers: reverseHeaders, rows: [reverseRow]});
    const report = await parseSellerSpriteWorkbook(file, {
      sampleScope: 'top_10_sample', scopeProvenance: 'user_declared', referenceAsin: 'B0FQ1RL7YK'
    });
    assert.equal(report.report_type, 'reverse_asin');
    assert.equal(report.report_identity.reference_asin, 'B0FQ1RL7YK');
    assert.equal(report.rows[0].traffic_share, 0.0623);
    assert.equal(report.rows[0].organic_rank, 6);
    assert.equal(report.rows[0].sponsored_rank, null);
    assert.equal(report.rows[0].monthly_searches, 6254);
    assert.equal(report.rows[0].purchases, 563);
    assert.equal(report.rows[0].demand_supply_ratio, 14.5);
  });
});

test('detects Keyword Mining with reordered known columns', async () => {
  await withTempWorkspace(async root => {
    const file = path.join(root, 'mining.xlsx');
    const headers = [...miningHeaders].reverse();
    await writeSellerSpriteWorkbook(file, {headers, rows: [[...miningRow].reverse()]});
    const report = await parseSellerSpriteWorkbook(file, {
      sampleScope: 'top_10_sample', scopeProvenance: 'user_declared', seedQuery: 'slow down kids at play sign'
    });
    assert.equal(report.report_type, 'keyword_mining');
    assert.equal(report.report_identity.seed_query, 'slow down kids at play sign');
    assert.equal(report.rows[0].relevance, 100);
    assert.equal(report.rows[0].purchase_rate, 0.09);
    assert.equal(report.rows[0].purchases, 563);
    assert.equal(report.rows[0].demand_supply_ratio, 14.5);
    assert.equal(report.rows[0].ppc, 1.84);
  });
});

test('skips malformed mandatory rows and counts them', async () => {
  await withTempWorkspace(async root => {
    const file = path.join(root, 'mixed.xlsx');
    await writeSellerSpriteWorkbook(file, {headers: miningHeaders, rows: [miningRow, ['bad row', 90, 'not-a-number']]});
    const report = await parseSellerSpriteWorkbook(file, {seedQuery: 'slow kids'});
    assert.equal(report.rows.length, 1);
    assert.equal(report.skipped_rows, 1);
  });
});

test('fails a workbook with no valid rows', async () => {
  await withTempWorkspace(async root => {
    const file = path.join(root, 'invalid.xlsx');
    await writeSellerSpriteWorkbook(file, {headers: miningHeaders, rows: [['bad row', 90, 'not-a-number']]});
    await assert.rejects(() => parseSellerSpriteWorkbook(file), error => error.code === 'UNSUPPORTED_KEYWORD_WORKBOOK');
  });
});

test('rejects duplicate mandatory headers and ordinary spreadsheets', async () => {
  await withTempWorkspace(async root => {
    const duplicate = path.join(root, 'duplicate.xlsx');
    await writeSellerSpriteWorkbook(duplicate, {headers: ['关键词', '关键词', '相关度', '月搜索量'], rows: [['one', 'one', 100, 5]]});
    await assert.rejects(() => parseSellerSpriteWorkbook(duplicate), error => error.code === 'UNSUPPORTED_KEYWORD_WORKBOOK');

    const ordinary = path.join(root, 'ordinary.xlsx');
    await writeSellerSpriteWorkbook(ordinary, {headers: ['Name', 'Price'], rows: [['Sign', 10]]});
    await assert.rejects(() => parseSellerSpriteWorkbook(ordinary), error => error.code === 'UNSUPPORTED_KEYWORD_WORKBOOK');
  });
});

test('defaults unknown scope and keeps optional malformed values null', async () => {
  await withTempWorkspace(async root => {
    const file = path.join(root, 'optional.xlsx');
    const row = [...miningRow];
    row[miningHeaders.indexOf('PPC价格')] = 'unknown';
    await writeSellerSpriteWorkbook(file, {headers: miningHeaders, rows: [row]});
    const report = await parseSellerSpriteWorkbook(file, {seedQuery: 'slow kids'});
    assert.equal(report.source.analysis_scope, 'unknown_partial');
    assert.equal(report.source.scope_provenance, 'default');
    assert.equal(report.rows[0].ppc, null);
    assert.equal(report.source.basename, 'optional.xlsx');
  });
});

test('reads SellerSprite current Chinese optional metric headers', async () => {
  await withTempWorkspace(async root => {
    const file = path.join(root, 'current-headers.xlsx');
    await writeSellerSpriteWorkbook(file, {
      headers: ['关键词', '相关度', '月搜索量', '购买量', '需供比', '点击总占比', '转化总占比'],
      rows: [['slow kids sign', 95, 1200, 108, 2.5, '31%', '27%']]
    });
    const report = await parseSellerSpriteWorkbook(file, {seedQuery: 'slow kids sign'});
    assert.equal(report.rows[0].purchases, 108);
    assert.equal(report.rows[0].demand_supply_ratio, 2.5);
    assert.equal(report.rows[0].click_concentration, 0.31);
    assert.equal(report.rows[0].conversion_concentration, 0.27);
  });
});

test('skips mandatory formula and error cells without usable values', async () => {
  await withTempWorkspace(async root => {
    const file = path.join(root, 'cells.xlsx');
    await writeSellerSpriteWorkbook(file, {
      headers: miningHeaders,
      rows: [miningRow, ['formula', 90, {formula: '1+1'}], ['error', 90, {error: '#VALUE!'}]]
    });
    const report = await parseSellerSpriteWorkbook(file, {seedQuery: 'slow kids'});
    assert.equal(report.rows.length, 1);
    assert.equal(report.skipped_rows, 2);
  });
});
