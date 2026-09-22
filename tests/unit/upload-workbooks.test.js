import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

import {strFromU8, unzipSync} from 'fflate';

import {uploadTemplate} from '../helpers/upload-template.js';
import {
  inspectUploadTemplate,
  requiredForRow,
  validateRestrictedValues,
  verifyVariationTemplateEvidence,
  verifyWrittenUploadFields,
  writeUploadWorkbook
} from '../../scripts/lib/upload-workbooks.js';

const signageSeed = JSON.parse(await readFile(new URL('../../assets/rule-seeds/amazon-us-signage-upload-fields.json', import.meta.url)));
const fbaChild = () => ({seller_sku: 'CHILD-1', fulfillment_channel: 'AMAZON_NA'});
const fbmChild = () => ({seller_sku: 'CHILD-1', fulfillment_channel: 'DEFAULT'});

test('patches mapped cells while preserving every unrelated OOXML member', () => {
  const template = uploadTemplate({macro: true, namedRange: true, conditionalFormula: '$FO6="AMAZON_NA"'});
  const before = unzipSync(template);
  const inspection = inspectUploadTemplate(template, signageSeed);
  const output = writeUploadWorkbook({templateBytes: template, inspection, rows: [fbaChild()]});
  const after = unzipSync(output);
  for (const member of Object.keys(before)) {
    if (![inspection.worksheet.path, 'xl/sharedStrings.xml'].includes(member)) {
      assert.deepEqual(after[member], before[member], member);
    }
  }
  const sheet = strFromU8(after[inspection.worksheet.path]);
  const shared = strFromU8(after['xl/sharedStrings.xml']);
  assert.match(sheet, /dataValidations/);
  assert.match(sheet, /conditionalFormatting/);
  assert.match(sheet, /<f>/);
  assert.match(sheet, /r="A6"[^>]*s="1"/);
  assert.match(shared, /AMAZON_NA/);
});

test('activates package fields for supported FBA condition but not FBM', () => {
  const inspection = inspectUploadTemplate(uploadTemplate({conditionalFormula: '$FO6="AMAZON_NA"'}), signageSeed);
  assert.deepEqual(requiredForRow(inspection, fbaChild()).sort(), ['GZ', 'HA', 'HB', 'HC', 'HD', 'HE', 'HF', 'HG']);
  assert.deepEqual(requiredForRow(inspection, fbmChild()), []);
});

test('reports unsupported active expressions instead of trusting cached values', () => {
  const inspection = inspectUploadTemplate(uploadTemplate({conditionalFormula: 'INDIRECT("FO"&ROW())="AMAZON_NA"', cachedValue: 0}), signageSeed);
  assert.deepEqual(inspection.unsupported_conditions.map(item => item.cells), ['GZ7:HG20']);
});

test('requires exact current dropdown values and omits invalid candidates', () => {
  const inspection = inspectUploadTemplate(uploadTemplate(), signageSeed);
  const invalid = validateRestrictedValues({inspection, rows: [{
    record_action: '(Default) Create or Replace', variation_theme: 'Size/Color', shipping_template: 'Default'
  }]});
  assert.deepEqual(invalid.map(item => item.field), ['record_action', 'variation_theme', 'shipping_template']);
  const output = writeUploadWorkbook({templateBytes: uploadTemplate(), inspection, rows: [{record_action: '(Default) Create or Replace'}]});
  assert.doesNotMatch(strFromU8(unzipSync(output)[inspection.worksheet.path]), /\(Default\) Create or Replace/);
});

test('resolves a defined name to hidden-sheet cells and defers dynamic validation sources', () => {
  const inspection = inspectUploadTemplate(uploadTemplate({
    definedName: {name: 'record_action', target: "'Dropdown Lists'!$C$4:$C$6"},
    hiddenValues: ['Create or Replace (Full Update)', 'Edit (Partial Update)', 'Delete'],
    dynamicValidation: 'INDIRECT($B7&"variation_theme1.name")'
  }), signageSeed);
  assert.deepEqual(inspection.validations.record_action.values, ['Create or Replace (Full Update)', 'Edit (Partial Update)', 'Delete']);
  assert.equal(inspection.unsupported_validations[0].formula, 'INDIRECT($B7&"variation_theme1.name")');
});

test('verifies an exact product-type Variation Theme from the template defined list', () => {
  const template = uploadTemplate({
    definedName: {
      name: 'SIGNAGEvariation_theme1.name',
      target: "'Dropdown Lists'!$C$4:$C$6"
    },
    hiddenValues: ['SIZE', 'COLOR', 'COLOR/SIZE']
  });
  assert.deepEqual(verifyVariationTemplateEvidence(template, {
    productType: 'SIGNAGE', themeDimensions: ['color_name', 'size_name']
  }), {
    product_type: 'SIGNAGE',
    variation_theme: 'COLOR/SIZE',
    verified_rule_ids: ['amazon_us_signage_schema', 'color_size_variation_values']
  });
});

test('checks every area in a multi-area validation range', () => {
  const inspection = inspectUploadTemplate(uploadTemplate({
    dynamicValidation: 'INDIRECT($B7&"variation_theme1.name")',
    dynamicValidationRange: 'HZ6:HZ20 T6:T20'
  }), signageSeed);
  assert.equal(inspection.unsupported_validations[0].cells, 'HZ6:HZ20 T6:T20');
});

test('creates missing worksheet rows before writing additional Children', () => {
  const template = uploadTemplate();
  const inspection = inspectUploadTemplate(template, signageSeed);
  const output = writeUploadWorkbook({
    templateBytes: template,
    inspection,
    rows: [{seller_sku: 'CHILD-1'}, {seller_sku: 'CHILD-2'}]
  });
  const sheet = strFromU8(unzipSync(output)[inspection.worksheet.path]);
  assert.match(sheet, /<row r="7"><c r="A7" t="s"><v>\d+<\/v><\/c><\/row>/);
  assert.match(sheet, /<row r="8"><c r="A8" t="s"><v>\d+<\/v><\/c><\/row>/);
  assert.doesNotThrow(() => verifyWrittenUploadFields({
    workbookBytes: output, inspection, rows: [{seller_sku: 'CHILD-1'}, {seller_sku: 'CHILD-2'}]
  }));
});

test('writes the product type keyword and every supported image slot', () => {
  const template = uploadTemplate();
  const inspection = inspectUploadTemplate(template, signageSeed);
  const images = Array.from({length: 9}, (_, index) => `https://img.example/${index + 1}.png`);
  const output = writeUploadWorkbook({
    templateBytes: template,
    inspection,
    rows: [{item_type_keyword: 'industrial-warning-signs', main_and_other_image_urls: images}]
  });
  const sheet = strFromU8(unzipSync(output)[inspection.worksheet.path]);
  assert.match(sheet, /r="M7"[^>]*t="s"/);
  for (const column of ['T', 'U', 'V', 'W', 'X', 'Y', 'Z', 'AA', 'AB']) {
    assert.match(sheet, new RegExp(`r="${column}7"`));
  }
  assert.doesNotThrow(() => verifyWrittenUploadFields({
    workbookBytes: output,
    inspection,
    rows: [{item_type_keyword: 'industrial-warning-signs', main_and_other_image_urls: images}]
  }));
  assert.throws(() => verifyWrittenUploadFields({
    workbookBytes: output,
    inspection,
    rows: [{item_type_keyword: 'wrong', main_and_other_image_urls: images}]
  }), /M7/);
});

test('finds the unique upload sheet and derives moved sparse columns from technical headers', () => {
  const inspection = inspectUploadTemplate(uploadTemplate({
    leadingInstructionSheet: true,
    technicalHeaders: {
      N: 'item_type_keyword[marketplace_id=ATVPDKIKX0DER]#1.value',
      V: 'main_product_image_locator[marketplace_id=ATVPDKIKX0DER]#1.media_location',
      X: 'other_product_image_locator_1[marketplace_id=ATVPDKIKX0DER]#1.media_location',
      Z: 'other_product_image_locator_2[marketplace_id=ATVPDKIKX0DER]#1.media_location'
    }
  }), signageSeed);
  assert.equal(inspection.worksheet.name, 'Upload Data');
  assert.deepEqual(inspection.field_columns.item_type_keyword, ['N']);
  assert.deepEqual(inspection.field_columns.main_and_other_image_urls, ['V', 'X', 'Z']);
});

test('rejects ambiguous upload worksheets instead of selecting the first match', () => {
  assert.throws(() => inspectUploadTemplate(uploadTemplate({duplicateUploadSheet: true}), signageSeed), /unique upload worksheet/i);
});

test('rejects image arrays larger than the discovered template capacity', () => {
  const template = uploadTemplate({technicalHeaders: {
    M: 'item_type_keyword[marketplace_id=ATVPDKIKX0DER]#1.value',
    T: 'main_product_image_locator[marketplace_id=ATVPDKIKX0DER]#1.media_location'
  }});
  const inspection = inspectUploadTemplate(template, signageSeed);
  assert.throws(() => writeUploadWorkbook({
    templateBytes: template,
    inspection,
    rows: [{main_and_other_image_urls: ['https://img.example/1.png', 'https://img.example/2.png']}]
  }), error => error.code === 'IMAGE_SLOT_CAPACITY_EXCEEDED');
});

test('ignores a self-closing blank validation without stealing the next list formula', () => {
  const inspection = inspectUploadTemplate(uploadTemplate({blankSelfClosingValidation: true}), signageSeed);
  assert.equal(inspection.validations.seller_sku, undefined);
  assert.deepEqual(inspection.validations.record_action, {
    column: 'C',
    values: ['Create or Replace (Full Update)', 'Edit (Partial Update)', 'Delete']
  });
});

test('uses template attributeRow and dataRow while preserving the example row', () => {
  const template = uploadTemplate({attributeRow: 8, dataRow: 10});
  const before = unzipSync(template);
  const inspection = inspectUploadTemplate(template, signageSeed);
  assert.equal(inspection.attribute_row, 8);
  assert.equal(inspection.data_row, 10);
  const output = writeUploadWorkbook({
    templateBytes: template,
    inspection,
    rows: [{seller_sku: 'PARENT'}, {seller_sku: 'CHILD'}]
  });
  const beforeSheet = strFromU8(before[inspection.worksheet.path]);
  const afterSheet = strFromU8(unzipSync(output)[inspection.worksheet.path]);
  assert.equal(/<row\b[^>]*r="9"[^>]*>[\s\S]*?<\/row>/.exec(afterSheet)?.[0],
    /<row\b[^>]*r="9"[^>]*>[\s\S]*?<\/row>/.exec(beforeSheet)?.[0]);
  assert.match(afterSheet, /r="A10"[^>]*t="s"/);
  assert.match(afterSheet, /r="A11"[^>]*t="s"/);
  assert.doesNotThrow(() => verifyWrittenUploadFields({
    workbookBytes: output, inspection, rows: [{seller_sku: 'PARENT'}, {seller_sku: 'CHILD'}]
  }));
});

test('expands an existing worksheet dimension without changing the example row or package members', () => {
  const template = uploadTemplate({dimension: 'A1:LK7', macro: true});
  const before = unzipSync(template);
  const inspection = inspectUploadTemplate(template, signageSeed);
  const rows = Array.from({length: 11}, (_, index) => ({seller_sku: `SKU-${index}`}));
  const output = writeUploadWorkbook({templateBytes: template, inspection, rows});
  const after = unzipSync(output);
  const beforeSheet = strFromU8(before[inspection.worksheet.path]);
  const afterSheet = strFromU8(after[inspection.worksheet.path]);
  assert.match(afterSheet, /<dimension ref="A1:LK17"\s*\/>/);
  assert.equal(/<row\b[^>]*r="6"[^>]*>[\s\S]*?<\/row>/.exec(afterSheet)?.[0],
    /<row\b[^>]*r="6"[^>]*>[\s\S]*?<\/row>/.exec(beforeSheet)?.[0]);
  for (const member of Object.keys(before)) {
    if (![inspection.worksheet.path, 'xl/sharedStrings.xml'].includes(member)) {
      assert.deepEqual(after[member], before[member], member);
    }
  }
  assert.doesNotThrow(() => verifyWrittenUploadFields({workbookBytes: output, inspection, rows}));
});

test('supports a single-cell dimension, a farther mapped column, no dimension, and empty rows', () => {
  const single = uploadTemplate({dimension: 'A1', technicalHeaders: {
    Z: 'item_type_keyword[marketplace_id=ATVPDKIKX0DER]#1.value',
    AA: 'main_product_image_locator[marketplace_id=ATVPDKIKX0DER]#1.media_location'
  }});
  const inspection = inspectUploadTemplate(single, signageSeed);
  const output = writeUploadWorkbook({
    templateBytes: single, inspection, rows: [{item_type_keyword: 'signage'}]
  });
  assert.match(strFromU8(unzipSync(output)[inspection.worksheet.path]), /<dimension ref="A1:Z7"\s*\/>/);
  assert.doesNotThrow(() => verifyWrittenUploadFields({
    workbookBytes: output, inspection, rows: [{item_type_keyword: 'signage'}]
  }));

  const withoutDimension = uploadTemplate();
  const noDimensionInspection = inspectUploadTemplate(withoutDimension, signageSeed);
  const empty = writeUploadWorkbook({templateBytes: withoutDimension, inspection: noDimensionInspection, rows: []});
  assert.equal(strFromU8(unzipSync(empty)[noDimensionInspection.worksheet.path]),
    strFromU8(unzipSync(withoutDimension)[noDimensionInspection.worksheet.path]));
  assert.doesNotThrow(() => verifyWrittenUploadFields({
    workbookBytes: empty, inspection: noDimensionInspection, rows: []
  }));
});

test('writes text through shared strings for WPS-compatible XLSM cells', () => {
  const template = uploadTemplate({dimension: 'A1:LK7'});
  const inspection = inspectUploadTemplate(template, signageSeed);
  const output = unzipSync(writeUploadWorkbook({
    templateBytes: template, inspection, rows: [{seller_sku: 'VISIBLE-IN-WPS'}]
  }));
  const sheet = strFromU8(output[inspection.worksheet.path]);
  const shared = strFromU8(output['xl/sharedStrings.xml']);
  assert.match(sheet, /<c r="A7"[^>]*t="s"><v>\d+<\/v><\/c>/);
  assert.doesNotMatch(sheet, /r="A7"[^>]*t="inlineStr"/);
  assert.match(shared, /<t[^>]*>VISIBLE-IN-WPS<\/t>/);
});

test('keeps newly written cells in ascending column order for WPS', () => {
  const template = uploadTemplate({dimension: 'A1:LK7'});
  const inspection = inspectUploadTemplate(template, signageSeed);
  const output = unzipSync(writeUploadWorkbook({
    templateBytes: template,
    inspection,
    rows: [{
      seller_sku: 'ORDERED',
      record_action: 'Create or Replace (Full Update)',
      item_type_keyword: 'signage',
      main_and_other_image_urls: ['https://img.example/main.png']
    }]
  }));
  const sheet = strFromU8(output[inspection.worksheet.path]);
  const row = /<row\b[^>]*r="7"[^>]*>([\s\S]*?)<\/row>/.exec(sheet)?.[1] ?? '';
  const references = [...row.matchAll(/<c\b[^>]*r="([A-Z]+)7"/g)].map(match => match[1]);
  const numbers = references.map(column => [...column]
    .reduce((number, character) => number * 26 + character.charCodeAt(0) - 64, 0));
  assert.deepEqual(numbers, [...numbers].sort((left, right) => left - right));
});
