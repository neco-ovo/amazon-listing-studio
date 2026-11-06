import {strToU8, zipSync} from 'fflate';

const esc = value => String(value).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');

export function uploadTemplate(options = {}) {
  const attributeRow = options.attributeRow ?? 5;
  const dataRow = options.dataRow ?? 7;
  const actions = options.recordActions ?? ['Create or Replace (Full Update)', 'Edit (Partial Update)', 'Delete'];
  const themes = options.themes ?? ['COLOR/SIZE'];
  const shipping = options.shippingTemplates ?? ['Migrated Template'];
  const hiddenValues = options.hiddenValues ?? actions;
  const validations = [
    [`C${dataRow}:C20`, options.definedName?.name ?? `"${actions.join(',')}"`],
    [`F${dataRow}:F20`, `"${themes.join(',')}"`],
    [`GS${dataRow}:GS20`, `"${shipping.join(',')}"`]
  ];
  if (options.dynamicValidation) validations.push([options.dynamicValidationRange ?? 'AW6:AW20', options.dynamicValidation]);
  const blankValidation = options.blankSelfClosingValidation
    ? `<dataValidation allowBlank="1" sqref="A${dataRow}:A1048576" />`
    : '';
  const validationXml = blankValidation + validations.map(([sqref, formula]) => `<dataValidation type="list" sqref="${sqref}"><formula1>${esc(formula)}</formula1></dataValidation>`).join('');
  const condition = options.conditionalFormula ?? `$FO${dataRow}="AMAZON_NA"`;
  const technicalHeaders = options.technicalHeaders ?? {
    M: 'item_type_keyword[marketplace_id=ATVPDKIKX0DER]#1.value',
    T: 'main_product_image_locator[marketplace_id=ATVPDKIKX0DER]#1.media_location',
    U: 'other_product_image_locator_1[marketplace_id=ATVPDKIKX0DER]#1.media_location',
    V: 'other_product_image_locator_2[marketplace_id=ATVPDKIKX0DER]#1.media_location',
    W: 'other_product_image_locator_3[marketplace_id=ATVPDKIKX0DER]#1.media_location',
    X: 'other_product_image_locator_4[marketplace_id=ATVPDKIKX0DER]#1.media_location',
    Y: 'other_product_image_locator_5[marketplace_id=ATVPDKIKX0DER]#1.media_location',
    Z: 'other_product_image_locator_6[marketplace_id=ATVPDKIKX0DER]#1.media_location',
    AA: 'other_product_image_locator_7[marketplace_id=ATVPDKIKX0DER]#1.media_location',
    AB: 'other_product_image_locator_8[marketplace_id=ATVPDKIKX0DER]#1.media_location'
  };
  const headerXml = Object.entries(technicalHeaders).map(([column, value]) => (
    `<c r="${column}${attributeRow}" t="inlineStr"><is><t>${esc(value)}</t></is></c>`
  )).join('');
  const exampleRow = dataRow - 1;
  const dimension = options.dimension ? `<dimension ref="${options.dimension}"/>` : '';
  const worksheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${dimension}<sheetData><row r="${attributeRow}">${headerXml}</row><row r="${exampleRow}"><c r="A${exampleRow}" s="1" t="inlineStr"><is><t>OLD</t></is></c><c r="FO${exampleRow}" t="inlineStr"><is><t>DEFAULT</t></is></c><c r="HZ${exampleRow}"><f>1+1</f><v>${options.cachedValue ?? 2}</v></c></row></sheetData><conditionalFormatting sqref="${options.conditionalRange ?? `GZ${dataRow}:HG20`}"><cfRule type="expression"><formula>${esc(condition)}</formula></cfRule></conditionalFormatting><dataValidations count="${validations.length + (options.blankSelfClosingValidation ? 1 : 0)}">${validationXml}</dataValidations></worksheet>`;
  const hiddenRows = hiddenValues.map((value, index) => `<row r="${index + 4}"><c r="C${index + 4}" t="inlineStr"><is><t>${esc(value)}</t></is></c></row>`).join('');
  const definedName = options.definedName ? `<definedName name="${esc(options.definedName.name)}">${esc(options.definedName.target)}</definedName>` : '';
  const uploadCopies = options.duplicateUploadSheet ? 2 : 1;
  const sheetEntries = [];
  const relationshipEntries = [];
  const sheetFiles = {};
  let sheetIndex = 1;
  if (options.leadingInstructionSheet) {
    sheetEntries.push(`<sheet name="Changes" sheetId="${sheetIndex}" r:id="rId${sheetIndex}"/>`);
    relationshipEntries.push(`<Relationship Id="rId${sheetIndex}" Target="worksheets/sheet${sheetIndex}.xml"/>`);
    sheetFiles[`xl/worksheets/sheet${sheetIndex}.xml`] = strToU8('<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Instructions</t></is></c></row></sheetData></worksheet>');
    sheetIndex += 1;
  }
  for (let copy = 0; copy < uploadCopies; copy += 1) {
    sheetEntries.push(`<sheet name="${copy ? 'Upload Data Copy' : 'Upload Data'}" sheetId="${sheetIndex}" r:id="rId${sheetIndex}"/>`);
    relationshipEntries.push(`<Relationship Id="rId${sheetIndex}" Target="worksheets/sheet${sheetIndex}.xml"/>`);
    sheetFiles[`xl/worksheets/sheet${sheetIndex}.xml`] = strToU8(worksheet);
    sheetIndex += 1;
  }
  sheetEntries.push(`<sheet name="Dropdown Lists" sheetId="${sheetIndex}" state="hidden" r:id="rId${sheetIndex}"/>`);
  relationshipEntries.push(`<Relationship Id="rId${sheetIndex}" Target="worksheets/sheet${sheetIndex}.xml"/>`);
  sheetFiles[`xl/worksheets/sheet${sheetIndex}.xml`] = strToU8(`<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${hiddenRows}</sheetData></worksheet>`);
  const files = {
    '[Content_Types].xml': strToU8('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>'),
    'xl/workbook.xml': strToU8(`<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheetEntries.join('')}</sheets><definedNames>${definedName}</definedNames></workbook>`),
    'xl/_rels/workbook.xml.rels': strToU8(`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${relationshipEntries.join('')}</Relationships>`),
    'xl/sharedStrings.xml': strToU8(`<sst><si><t>${esc(`settings?labelRow=${Math.max(1, attributeRow - 1)}&attributeRow=${attributeRow}&dataRow=${dataRow}`)}</t></si></sst>`),
    ...sheetFiles,
    'docProps/custom.xml': strToU8('<preserve>yes</preserve>')
  };
  if (options.macro) files['xl/vbaProject.bin'] = strToU8('macro-bytes');
  return Buffer.from(zipSync(files));
}
