import {readFile} from 'node:fs/promises';

import {validateListing} from './lib/listing.js';

const filePath = process.argv[2];
if (!filePath) throw new Error('Usage: node scripts/validate-listing.js <listing.json>');
const input = JSON.parse(await readFile(filePath, 'utf8'));
const rules = JSON.parse(await readFile(new URL('../assets/rules/amazon-us-defaults.json', import.meta.url), 'utf8'));
const validationContext = input.validation_context ?? {};
delete input.validation_context;
const result = validateListing(input, {
  limits: rules.limits,
  publishableFactIds: new Set(validationContext.publishable_fact_ids ?? []),
  schemaVerified: validationContext.schema_verified !== false,
  currentProductMasterVersion: validationContext.current_product_master_version,
  unverifiedFields: validationContext.unverified_fields ?? [],
  schemaAuthorization: validationContext.schema_authorization ?? null,
  competitorBrands: validationContext.competitor_brands ?? [],
});
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
if (!result.ok) process.exitCode = 1;
