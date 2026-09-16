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

export function rangeAffectsRows(range, mappedColumns, rowCount) {
  const mapped = new Set(mappedColumns);
  return String(range).trim().split(/\s+/).some(part => {
    const [start, end = start] = part.split(':');
    const startRow = Number(/\d+$/.exec(start)?.[0]);
    const endRow = Number(/\d+$/.exec(end)?.[0]);
    return rangeColumns(part).some(column => mapped.has(column))
      && startRow <= rowCount + 5 && endRow >= 6;
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
  return {sheets, names};
}

function cellValues(xml, column, start, end) {
  const values = [];
  for (let row = start; row <= end; row += 1) {
    const cell = new RegExp(`<c\\b[^>]*r="${column}${row}"[^>]*>([\\s\\S]*?)<\\/c>`).exec(xml)?.[1];
    if (!cell) continue;
    const value = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/.exec(cell)?.[1] ?? /<v>([\s\S]*?)<\/v>/.exec(cell)?.[1];
    if (value !== undefined) values.push(decodeXml(value));
  }
  return values;
}

function resolveList(formula, archive, parts) {
  const raw = decodeXml(formula).trim();
  if (/^"[\s\S]*"$/.test(raw)) return raw.slice(1, -1).split(',');
  const target = parts.names.get(raw) ?? raw;
  if (/\b(?:INDIRECT|OFFSET)\s*\(/i.test(target) || /^\[/.test(target)) return null;
  const match = /^(?:'([^']+)'|([^'!]+))!\$([A-Z]+)\$(\d+):\$([A-Z]+)\$(\d+)$/.exec(target);
  if (!match || match[3] !== match[5]) return null;
  const sheet = parts.sheets.find(item => item.name === (match[1] ?? match[2]));
  return sheet ? cellValues(strFromU8(archive[sheet.path]), match[3], Number(match[4]), Number(match[6])) : null;
}

function validationField(column) {
  return {C: 'record_action', F: 'variation_theme', GS: 'shipping_template'}[column] ?? null;
}

export function inspectUploadTemplate(templateBytes, seed) {
  const archive = unzipSync(templateBytes);
  const parts = workbookParts(archive);
  const worksheet = parts.sheets[0];
  const xml = strFromU8(archive[worksheet.path]);
  const columns = Object.fromEntries(Object.entries(seed.upload_field_map).flatMap(([field, rule]) => rule.columns.map(column => [column, field])));
  columns.F = 'variation_theme';
  const field_columns = Object.fromEntries(Object.entries(seed.upload_field_map).map(([field, rule]) => [field, rule.columns]));
  field_columns.variation_theme = ['F'];
  const validations = {};
  const unsupported_validations = [];
  for (const match of xml.matchAll(/<dataValidation\b[^>]*sqref="([^"]+)"[^>]*>[\s\S]*?<formula1>([\s\S]*?)<\/formula1>[\s\S]*?<\/dataValidation>/g)) {
    const column = /^[A-Z]+/.exec(match[1])?.[0];
    const field = validationField(column) ?? columns[column];
    if (!field) continue;
    const values = resolveList(match[2], archive, parts);
    if (values) validations[field] = {column, values};
    else unsupported_validations.push({field, cells: match[1], formula: decodeXml(match[2])});
  }
  const active_requirements = [];
  const unsupported_conditions = [];
  for (const match of xml.matchAll(/<conditionalFormatting\b[^>]*sqref="([^"]+)"[^>]*>[\s\S]*?<formula>([\s\S]*?)<\/formula>[\s\S]*?<\/conditionalFormatting>/g)) {
    const formula = decodeXml(match[2]);
    if (/^\$?FO\d+="AMAZON_NA"$/.test(formula)) active_requirements.push({cells: match[1], field: 'fulfillment_channel', equals: 'AMAZON_NA'});
    else unsupported_conditions.push({cells: match[1], formula});
  }
  return {worksheet, columns, field_columns, validations, active_requirements, unsupported_conditions, unsupported_validations};
}

export function requiredForRow(inspection, row) {
  return inspection.active_requirements.flatMap(rule => row[rule.field] === rule.equals ? rangeColumns(rule.cells) : []);
}

export function validateRestrictedValues({inspection, rows}) {
  return rows.flatMap((row, rowIndex) => Object.entries(inspection.validations).flatMap(([field, rule]) => {
    const value = row[field];
    return value !== undefined && !rule.values.includes(value)
      ? [{code: 'RESTRICTED_VALUE', field, value, row: rowIndex + 6, allowed: rule.values}]
      : [];
  }));
}

function setCell(xml, reference, value) {
  const cellPattern = new RegExp(`<c\\b([^>]*\\br="${reference}"[^>]*)>[\\s\\S]*?<\\/c>`);
  const existing = cellPattern.exec(xml);
  const style = /\bs="([^"]+)"/.exec(existing?.[1] ?? '')?.[1];
  const cell = `<c r="${reference}"${style ? ` s="${style}"` : ''} t="inlineStr"><is><t>${encodeXml(value)}</t></is></c>`;
  if (existing) return xml.replace(cellPattern, cell);
  const rowNumber = /\d+$/.exec(reference)[0];
  return xml.replace(new RegExp(`(<row\\b[^>]*r="${rowNumber}"[^>]*>)`), `$1${cell}`);
}

export function writeUploadWorkbook({templateBytes, inspection, rows}) {
  const archive = unzipSync(templateBytes);
  let xml = strFromU8(archive[inspection.worksheet.path]);
  for (const [index, row] of rows.entries()) {
    for (const [field, value] of Object.entries(row)) {
      const columns = inspection.field_columns[field];
      if (!columns || value === undefined || value === null) continue;
      const allowed = inspection.validations[field]?.values;
      if (allowed && !allowed.includes(value)) continue;
      const values = Array.isArray(value) ? value : [value];
      for (const [columnIndex, item] of values.entries()) {
        const column = columns[columnIndex];
        if (!column || item === undefined || item === null || typeof item === 'object') continue;
        xml = setCell(xml, `${column}${index + 6}`, item);
      }
    }
  }
  archive[inspection.worksheet.path] = strToU8(xml);
  return Buffer.from(zipSync(archive, {level: 6}));
}
