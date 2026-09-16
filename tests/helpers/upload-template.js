import {strToU8, zipSync} from 'fflate';

const esc = value => String(value).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');

export function uploadTemplate(options = {}) {
  const actions = options.recordActions ?? ['Create or Replace (Full Update)', 'Edit (Partial Update)', 'Delete'];
  const themes = options.themes ?? ['COLOR/SIZE'];
  const shipping = options.shippingTemplates ?? ['Migrated Template'];
  const hiddenValues = options.hiddenValues ?? actions;
  const validations = [
    ['C6:C20', options.definedName?.name ?? `"${actions.join(',')}"`],
    ['F6:F20', `"${themes.join(',')}"`],
    ['GS6:GS20', `"${shipping.join(',')}"`]
  ];
  if (options.dynamicValidation) validations.push(['AW6:AW20', options.dynamicValidation]);
  const validationXml = validations.map(([sqref, formula]) => `<dataValidation type="list" sqref="${sqref}"><formula1>${esc(formula)}</formula1></dataValidation>`).join('');
  const condition = options.conditionalFormula ?? '$FO6="AMAZON_NA"';
  const worksheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="6"><c r="A6" s="1" t="inlineStr"><is><t>OLD</t></is></c><c r="FO6" t="inlineStr"><is><t>DEFAULT</t></is></c><c r="HZ6"><f>1+1</f><v>${options.cachedValue ?? 2}</v></c></row></sheetData><conditionalFormatting sqref="${options.conditionalRange ?? 'GZ6:HG20'}"><cfRule type="expression"><formula>${esc(condition)}</formula></cfRule></conditionalFormatting><dataValidations count="${validations.length}">${validationXml}</dataValidations></worksheet>`;
  const hiddenRows = hiddenValues.map((value, index) => `<row r="${index + 4}"><c r="C${index + 4}" t="inlineStr"><is><t>${esc(value)}</t></is></c></row>`).join('');
  const definedName = options.definedName ? `<definedName name="${esc(options.definedName.name)}">${esc(options.definedName.target)}</definedName>` : '';
  const files = {
    '[Content_Types].xml': strToU8('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>'),
    'xl/workbook.xml': strToU8(`<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Template" sheetId="1" r:id="rId1"/><sheet name="Dropdown Lists" sheetId="2" state="hidden" r:id="rId2"/></sheets><definedNames>${definedName}</definedNames></workbook>`),
    'xl/_rels/workbook.xml.rels': strToU8('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="worksheets/sheet2.xml"/></Relationships>'),
    'xl/worksheets/sheet1.xml': strToU8(worksheet),
    'xl/worksheets/sheet2.xml': strToU8(`<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${hiddenRows}</sheetData></worksheet>`),
    'docProps/custom.xml': strToU8('<preserve>yes</preserve>')
  };
  if (options.macro) files['xl/vbaProject.bin'] = strToU8('macro-bytes');
  return Buffer.from(zipSync(files));
}
