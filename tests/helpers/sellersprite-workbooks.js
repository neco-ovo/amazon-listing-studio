import {writeFile} from 'node:fs/promises';
import {strToU8, zipSync} from 'fflate';

export const reverseHeaders = [
  '流量词', '流量占比', '自然排名', '广告排名', '月搜索量',
  '购买量', '购买率', 'SPR', '标题密度', '商品数', '需供比', 'PPC价格'
];

export const miningHeaders = [
  '关键词', '相关度', '月搜索量', '购买量', '购买率',
  'SPR', '标题密度', '商品数', '需供比', 'PPC价格'
];

function escapeXml(value) {
  return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

function columnName(index) {
  let value = index + 1;
  let output = '';
  while (value > 0) {
    value -= 1;
    output = String.fromCharCode(65 + (value % 26)) + output;
    value = Math.floor(value / 26);
  }
  return output;
}

function cellXml(value, row, column) {
  const reference = `${columnName(column)}${row}`;
  if (value === null || value === undefined) return `<c r="${reference}"/>`;
  if (typeof value === 'number') return `<c r="${reference}"><v>${value}</v></c>`;
  if (value?.formula !== undefined) return `<c r="${reference}"><f>${escapeXml(value.formula)}</f>${value.cached === undefined ? '' : `<v>${value.cached}</v>`}</c>`;
  if (value?.error) return `<c r="${reference}" t="e"><v>${escapeXml(value.error)}</v></c>`;
  return `<c r="${reference}" t="inlineStr"><is><t>${escapeXml(value)}</t></is></c>`;
}

function worksheetXml(headers, rows) {
  const allRows = [headers, ...rows].map((values, index) => {
    const row = index + 1;
    return `<row r="${row}">${values.map((value, column) => cellXml(value, row, column)).join('')}</row>`;
  }).join('');
  return `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${allRows}</sheetData></worksheet>`;
}

export async function writeSellerSpriteWorkbook(filePath, options) {
  const sheets = options.sheets ?? [{headers: options.headers, rows: options.rows, sheetName: options.sheetName ?? 'Data'}];
  const overrides = sheets.map((_, index) => `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('');
  const sheetEntries = sheets.map((sheet, index) => `<sheet name="${escapeXml(sheet.sheetName ?? `Sheet${index + 1}`)}" sheetId="${index + 1}"${sheet.state ? ` state="${sheet.state}"` : ''} r:id="rId${index + 1}"/>`).join('');
  const relationships = sheets.map((_, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join('');
  const files = {
    '[Content_Types].xml': strToU8(`<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${overrides}</Types>`),
    '_rels/.rels': strToU8('<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'),
    'xl/workbook.xml': strToU8(`<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheetEntries}</sheets></workbook>`),
    'xl/_rels/workbook.xml.rels': strToU8(`<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${relationships}</Relationships>`)
  };
  sheets.forEach((sheet, index) => {
    files[`xl/worksheets/sheet${index + 1}.xml`] = strToU8(worksheetXml(sheet.headers, sheet.rows));
  });
  await writeFile(filePath, zipSync(files));
}
