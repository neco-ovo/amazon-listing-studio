import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

import {strFromU8, unzipSync} from 'fflate';

import {uploadTemplate} from '../helpers/upload-template.js';
import {
  inspectUploadTemplate,
  requiredForRow,
  validateRestrictedValues,
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
    if (member !== inspection.worksheet.path) assert.deepEqual(after[member], before[member], member);
  }
  const sheet = strFromU8(after[inspection.worksheet.path]);
  assert.match(sheet, /dataValidations/);
  assert.match(sheet, /conditionalFormatting/);
  assert.match(sheet, /<f>/);
  assert.match(sheet, /r="A6"[^>]*s="1"/);
  assert.match(sheet, /AMAZON_NA/);
});

test('activates package fields for supported FBA condition but not FBM', () => {
  const inspection = inspectUploadTemplate(uploadTemplate({conditionalFormula: '$FO6="AMAZON_NA"'}), signageSeed);
  assert.deepEqual(requiredForRow(inspection, fbaChild()).sort(), ['GZ', 'HA', 'HB', 'HC', 'HD', 'HE', 'HF', 'HG']);
  assert.deepEqual(requiredForRow(inspection, fbmChild()), []);
});

test('reports unsupported active expressions instead of trusting cached values', () => {
  const inspection = inspectUploadTemplate(uploadTemplate({conditionalFormula: 'INDIRECT("FO"&ROW())="AMAZON_NA"', cachedValue: 0}), signageSeed);
  assert.deepEqual(inspection.unsupported_conditions.map(item => item.cells), ['GZ6:HG20']);
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
  assert.match(sheet, /<row r="7">[\s\S]*r="A7"[\s\S]*CHILD-2/);
});
