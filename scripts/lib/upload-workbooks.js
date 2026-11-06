import {strFromU8, strToU8, unzipSync, zipSync} from 'fflate';

const decodeXml = value => String(value)
  .replaceAll('&quot;', '"').replaceAll('&apos;', "'")
  .replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&');
const encodeXml = value => String(value)
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

function columnNumber(column) {
  return [...column].reduce((value, letter) => value * 26 + letter.charCodeAt(0) - 64, 0);
}

function columnName(number) {
  let result = '';
  while (number) {
    number -= 1;
    result = String.fromCharCode(65 + number % 26) + result;
    number = Math.floor(number / 26);
  }
  return result;
}

function rangeColumns(range) {
  const [start, end = start] = range.split(':').map(cell => /^[A-Z]+/.exec(cell)?.[0]);
  if (!start || !end) return [];
  return Array.from({length: columnNumber(end) - columnNumber(start) + 1}, (_, index) => columnName(columnNumber(start) + index));
}

export function rangeAffectsRows(range, mappedColumns, rowCount, dataRow) {
  const mapped = new Set(mappedColumns);
  return String(range).trim().split(/\s+/).some(part => {
    const [start, end = start] = part.split(':');
    const startRow = Number(/\d+$/.exec(start)?.[0]);
    const endRow = Number(/\d+$/.exec(end)?.[0]);
    return rangeColumns(part).some(column => mapped.has(column))
      && startRow <= rowCount + dataRow - 1 && endRow >= dataRow;
  });
}

function workbookParts(archive) {
  const workbook = strFromU8(archive['xl/workbook.xml']);
  const rels = strFromU8(archive['xl/_rels/workbook.xml.rels']);
  const relationships = new Map([...rels.matchAll(/<Relationship\b[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"[^>]*\/?\s*>/g)].map(match => [match[1], match[2]]));
  const sheets = [...workbook.matchAll(/<sheet\b[^>]*name="([^"]+)"[^>]*r:id="([^"]+)"[^>]*>/g)].map(match => ({
    name: decodeXml(match[1]),
    path: `xl/${relationships.get(match[2]).replace(/^\//, '')}`
  }));
  const names = new Map([...workbook.matchAll(/<definedName\b[^>]*name="([^"]+)"[^>]*>([\s\S]*?)<\/definedName>/g)].map(match => [decodeXml(match[1]), decodeXml(match[2])])) ;
  const sharedXml = archive['xl/sharedStrings.xml'] ? strFromU8(archive['xl/sharedStrings.xml']) : '';
  const sharedStrings = [...sharedXml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map(item => (
    [...item[1].matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)]
      .map(text => decodeXml(text[1])).join('')
  ));
  return {sheets, names, sharedStrings};
}

function cellText(cell, sharedStrings = []) {
  const value = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/.exec(cell)?.[1] ?? /<v>([\s\S]*?)<\/v>/.exec(cell)?.[1];
  if (value === undefined) return undefined;
  return /\bt="s"/.test(cell) ? sharedStrings[Number(value)] : decodeXml(value);
}

function cellValues(xml, column, start, end, sharedStrings = []) {
  const values = [];
  for (let row = start; row <= end; row += 1) {
    const cell = new RegExp(`<c\\b[^>]*r="${column}${row}"[^>]*>[\\s\\S]*?<\\/c>`).exec(xml)?.[0];
    if (!cell) continue;
    const value = cellText(cell, sharedStrings);
    if (value !== undefined) values.push(value);
  }
  return values;
}

function technicalHeaders(xml, sharedStrings, attributeRow) {
  const row = new RegExp(`<row\\b[^>]*r="${attributeRow}"[^>]*>([\\s\\S]*?)<\\/row>`).exec(xml)?.[1] ?? '';
  return [...row.matchAll(new RegExp(`<c\\b[^>]*r="([A-Z]+)${attributeRow}"[^>]*>[\\s\\S]*?<\\/c>`, 'g'))].map(match => ({
    column: match[1], value: cellText(match[0], sharedStrings) ?? ''
  }));
}

function templateRows(parts) {
  const pairs = parts.sharedStrings.flatMap(value => {
    const attribute = /(?:^|[?&])attributeRow=(\d+)(?:&|$)/.exec(value)?.[1];
    const data = /(?:^|[?&])dataRow=(\d+)(?:&|$)/.exec(value)?.[1];
    return attribute && data ? [{attribute_row: Number(attribute), data_row: Number(data)}] : [];
  });
  const unique = [...new Map(pairs.map(item => [`${item.attribute_row}:${item.data_row}`, item])).values()];
  if (unique.length !== 1 || !Number.isInteger(unique[0]?.attribute_row) || !Number.isInteger(unique[0]?.data_row)
      || unique[0].attribute_row < 1 || unique[0].data_row <= unique[0].attribute_row) {
    throw new Error('Expected one valid Amazon template attributeRow and dataRow setting');
  }
  return unique[0];
}

function resolveUploadWorksheet(archive, parts, rows) {
  const candidates = parts.sheets.flatMap(worksheet => {
    const xml = strFromU8(archive[worksheet.path]);
    const headers = technicalHeaders(xml, parts.sharedStrings, rows.attribute_row);
    const itemType = headers.find(item => /^item_type_keyword\[.*\](?:#\d+)?\.value$/i.test(item.value));
    const main = headers.find(item => /^main_product_image_locator\[.*\](?:#\d+)?\.media_location$/i.test(item.value));
    const others = headers.flatMap(item => {
      const match = /^other_product_image_locator_(\d+)\[.*\](?:#\d+)?\.media_location$/i.exec(item.value);
      return match ? [{...item, ordinal: Number(match[1])}] : [];
    }).sort((left, right) => left.ordinal - right.ordinal);
    return itemType && (main || others.length) ? [{worksheet, xml, itemType, main, others}] : [];
  });
  if (candidates.length !== 1) {
    throw new Error(`Expected one unique upload worksheet with Amazon technical headers; found ${candidates.length}`);
  }
  return candidates[0];
}

function resolveList(formula, archive, parts) {
  const raw = decodeXml(formula).trim();
  if (/^"[\s\S]*"$/.test(raw)) return raw.slice(1, -1).split(',');
  const target = parts.names.get(raw) ?? raw;
  if (/\b(?:INDIRECT|OFFSET)\s*\(/i.test(target) || /^\[/.test(target)) return null;
  const match = /^(?:'([^']+)'|([^'!]+))!\$([A-Z]+)\$(\d+):\$([A-Z]+)\$(\d+)$/.exec(target);
  if (!match || match[3] !== match[5]) return null;
  const sheet = parts.sheets.find(item => item.name === (match[1] ?? match[2]));
  return sheet ? cellValues(
    strFromU8(archive[sheet.path]), match[3], Number(match[4]), Number(match[6]), parts.sharedStrings
  ) : null;
}

function validationField(column) {
  return {C: 'record_action', F: 'variation_theme', GS: 'shipping_template'}[column] ?? null;
}

export function inspectUploadTemplate(templateBytes, seed) {
  const archive = unzipSync(templateBytes);
  const parts = workbookParts(archive);
  const rows = templateRows(parts);
  const {worksheet, xml, itemType, main, others} = resolveUploadWorksheet(archive, parts, rows);
  const field_columns = Object.fromEntries(Object.entries(seed.upload_field_map).map(([field, rule]) => [field, rule.columns]));
  field_columns.item_type_keyword = [itemType.column];
  field_columns.main_and_other_image_urls = [main, ...others].filter(Boolean).map(item => item.column);
  field_columns.variation_theme = ['F'];
  const columns = Object.fromEntries(Object.entries(field_columns).flatMap(([field, mapped]) => mapped.map(column => [column, field])));
  const validations = {};
  const unsupported_validations = [];
  for (const match of xml.matchAll(/<dataValidation\b(?![^>]*\/\s*>)([^>]*)>([\s\S]*?)<\/dataValidation>/g)) {
    const cells = /\bsqref="([^"]+)"/.exec(match[1])?.[1];
    const formula = /<formula1>([\s\S]*?)<\/formula1>/.exec(match[2])?.[1];
    if (!cells || formula === undefined) continue;
    const column = cells.trim().split(/\s+/).flatMap(rangeColumns)
      .find(item => validationField(item) ?? columns[item]);
    const field = validationField(column) ?? columns[column];
    if (!field) continue;
    const values = resolveList(formula, archive, parts);
    if (values) validations[field] = {column, values};
    else unsupported_validations.push({field, cells, formula: decodeXml(formula)});
  }
  const active_requirements = [];
  const unsupported_conditions = [];
  for (const match of xml.matchAll(/<conditionalFormatting\b[^>]*sqref="([^"]+)"[^>]*>[\s\S]*?<formula>([\s\S]*?)<\/formula>[\s\S]*?<\/conditionalFormatting>/g)) {
    const formula = decodeXml(match[2]);
    if (/^\$?FO\d+="AMAZON_NA"$/.test(formula)) active_requirements.push({cells: match[1], field: 'fulfillment_channel', equals: 'AMAZON_NA'});
    else unsupported_conditions.push({cells: match[1], formula});
  }
  return {...rows, worksheet, columns, field_columns, validations, active_requirements, unsupported_conditions, unsupported_validations};
}

export function verifyVariationTemplateEvidence(templateBytes, {productType, themeDimensions}) {
  const archive = unzipSync(templateBytes);
  const parts = workbookParts(archive);
  const product = String(productType ?? '').trim().toUpperCase();
  const theme = (themeDimensions ?? []).map(value => (
    String(value).replace(/_name$/i, '').toUpperCase()
  )).join('/');
  const allowed = resolveList(`${product}variation_theme1.name`, archive, parts);
  if (!product || !theme || !allowed?.includes(theme)) {
    throw new Error(`Template does not verify ${product || 'unknown'} Variation Theme ${theme || 'unknown'}`);
  }
  return {
    product_type: product,
    variation_theme: theme,
    verified_rule_ids: ['amazon_us_signage_schema', 'color_size_variation_values']
  };
}

export function requiredForRow(inspection, row) {
  return inspection.active_requirements.flatMap(rule => row[rule.field] === rule.equals ? rangeColumns(rule.cells) : []);
}

export function validateRestrictedValues({inspection, rows}) {
  return rows.flatMap((row, rowIndex) => Object.entries(inspection.validations).flatMap(([field, rule]) => {
    const value = row[field];
    return value !== undefined && !rule.values.includes(value)
      ? [{code: 'RESTRICTED_VALUE', field, value, row: rowIndex + inspection.data_row, allowed: rule.values}]
      : [];
  }));
}

function setCell(xml, reference, value, sharedStringIndex) {
  const cellPattern = new RegExp(`<c\\b([^>]*\\br="${reference}"[^>]*)>[\\s\\S]*?<\\/c>`);
  const existing = cellPattern.exec(xml);
  const style = /\bs="([^"]+)"/.exec(existing?.[1] ?? '')?.[1];
  const type = sharedStringIndex === undefined ? '' : ' t="s"';
  const storedValue = sharedStringIndex === undefined ? value : sharedStringIndex;
  const cell = `<c r="${reference}"${style ? ` s="${style}"` : ''}${type}><v>${encodeXml(storedValue)}</v></c>`;
  if (existing) return xml.replace(cellPattern, cell);
  const rowNumber = /\d+$/.exec(reference)[0];
  if (!new RegExp(`<row\\b[^>]*r="${rowNumber}"[^>]*>`).test(xml)) {
    return xml.replace('</sheetData>', `<row r="${rowNumber}">${cell}</row></sheetData>`);
  }
  const targetColumn = columnNumber(/^[A-Z]+/.exec(reference)[0]);
  const rowPattern = new RegExp(`<row\\b[^>]*r="${rowNumber}"[^>]*>[\\s\\S]*?<\\/row>`);
  return xml.replace(rowPattern, row => {
    const nextCell = [...row.matchAll(/<c\b[^>]*r="([A-Z]+)\d+"[^>]*>[\s\S]*?<\/c>/g)]
      .find(match => columnNumber(match[1]) > targetColumn);
    return nextCell ? row.replace(nextCell[0], `${cell}${nextCell[0]}`) : row.replace('</row>', `${cell}</row>`);
  });
}

function expandDimension(xml, references) {
  const match = /<dimension\b[^>]*\bref="([^"]+)"[^>]*\/?\s*>/.exec(xml);
  if (!match || references.length === 0) return xml;
  const [start, end = start] = match[1].split(':');
  const startCell = /^([A-Z]+)(\d+)$/.exec(start);
  const endCell = /^([A-Z]+)(\d+)$/.exec(end);
  if (!startCell || !endCell) return xml;
  const cells = references.map(reference => /^([A-Z]+)(\d+)$/.exec(reference)).filter(Boolean);
  const lastColumn = Math.max(columnNumber(endCell[1]), ...cells.map(cell => columnNumber(cell[1])));
  const lastRow = Math.max(Number(endCell[2]), ...cells.map(cell => Number(cell[2])));
  const ref = `${startCell[1]}${startCell[2]}:${columnName(lastColumn)}${lastRow}`;
  return xml.replace(match[0], match[0].replace(/\bref="[^"]+"/, `ref="${ref}"`));
}

export function writeUploadWorkbook({templateBytes, inspection, rows}) {
  const archive = unzipSync(templateBytes);
  const parts = workbookParts(archive);
  let xml = strFromU8(archive[inspection.worksheet.path]);
  let sharedXml = strFromU8(archive['xl/sharedStrings.xml']);
  const sharedIndexes = new Map(parts.sharedStrings.map((value, index) => [value, index]));
  const addedSharedStrings = [];
  let sharedWrites = 0;
  const writtenReferences = [];
  for (const [index, row] of rows.entries()) {
    for (const [field, value] of Object.entries(row)) {
      const columns = inspection.field_columns[field];
      if (!columns || value === undefined || value === null) continue;
      const allowed = inspection.validations[field]?.values;
      if (allowed && !allowed.includes(value)) continue;
      const values = Array.isArray(value) ? value : [value];
      if (field === 'main_and_other_image_urls' && values.length > columns.length) {
        const error = new Error(`Template supports ${columns.length} image URLs but received ${values.length}`);
        error.code = 'IMAGE_SLOT_CAPACITY_EXCEEDED';
        throw error;
      }
      for (const [columnIndex, item] of values.entries()) {
        const column = columns[columnIndex];
        if (!column || item === undefined || item === null || typeof item === 'object') continue;
        const reference = `${column}${index + inspection.data_row}`;
        let sharedStringIndex;
        if (typeof item === 'string') {
          sharedWrites += 1;
          if (!sharedIndexes.has(item)) {
            sharedIndexes.set(item, parts.sharedStrings.length + addedSharedStrings.length);
            addedSharedStrings.push(item);
          }
          sharedStringIndex = sharedIndexes.get(item);
        }
        xml = setCell(xml, reference, item, sharedStringIndex);
        writtenReferences.push(reference);
      }
    }
  }
  xml = expandDimension(xml, writtenReferences);
  if (addedSharedStrings.length) {
    sharedXml = sharedXml.replace('</sst>', `${addedSharedStrings.map(value => (
      `<si><t xml:space="preserve">${encodeXml(value)}</t></si>`
    )).join('')}</sst>`);
  }
  sharedXml = sharedXml.replace(/\buniqueCount="\d+"/, `uniqueCount="${parts.sharedStrings.length + addedSharedStrings.length}"`);
  sharedXml = sharedXml.replace(/\bcount="(\d+)"/, (_, count) => `count="${Number(count) + sharedWrites}"`);
  archive[inspection.worksheet.path] = strToU8(xml);
  archive['xl/sharedStrings.xml'] = strToU8(sharedXml);
  return Buffer.from(zipSync(archive, {level: 6}));
}

export function verifyWrittenUploadFields({workbookBytes, inspection, rows}) {
  const archive = unzipSync(workbookBytes);
  const parts = workbookParts(archive);
  const xml = strFromU8(archive[inspection.worksheet.path]);
  for (const [rowIndex, row] of rows.entries()) {
    for (const field of ['item_type_keyword', 'main_and_other_image_urls']) {
      const values = Array.isArray(row[field]) ? row[field] : [row[field]];
      for (const [columnIndex, expected] of values.entries()) {
        const column = inspection.field_columns[field]?.[columnIndex];
        if (!column || expected === undefined || expected === null) continue;
        const reference = `${column}${rowIndex + inspection.data_row}`;
        const actual = cellValues(xml, column, rowIndex + inspection.data_row, rowIndex + inspection.data_row, parts.sharedStrings)[0];
        if (String(actual ?? '') !== String(expected)) {
          throw new Error(`Upload workbook verification failed at ${reference}`);
        }
      }
    }
  }
  if (rows.length === 0) return;
  const dimension = /<dimension\b[^>]*\bref="([^"]+)"[^>]*\/?\s*>/.exec(xml)?.[1];
  if (!dimension) return;
  const end = dimension.split(':').at(-1);
  const endCell = /^([A-Z]+)(\d+)$/.exec(end);
  if (!endCell) return;
  const lastDataRow = inspection.data_row + rows.length - 1;
  const dataCells = [...xml.matchAll(/<c\b[^>]*\br="([A-Z]+)(\d+)"/g)]
    .map(match => ({column: match[1], row: Number(match[2])}))
    .filter(cell => cell.row >= inspection.data_row && cell.row <= lastDataRow);
  const outside = dataCells.find(cell => columnNumber(cell.column) > columnNumber(endCell[1]) || cell.row > Number(endCell[2]));
  if (outside) throw new Error(`Upload workbook dimension ${dimension} does not cover ${outside.column}${outside.row}`);
}
