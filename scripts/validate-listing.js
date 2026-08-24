#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { validateListing } from './lib/listing.js';

console.error('[deprecated] Use scripts/studio.js and the Listing draft workflow.');
const filePath = process.argv[2];
if (!filePath) throw new Error('Usage: node scripts/validate-listing.js <listing.json>');
const input = JSON.parse(await readFile(filePath, 'utf8'));
const rules = JSON.parse(await readFile(new URL('../assets/rule-seeds/amazon-us-defaults.json', import.meta.url), 'utf8'));
const context = input.validation_context ?? {};
delete input.validation_context;
const result = validateListing(input, {
  limits: rules.limits,
  publishableFactIds: new Set(context.publishable_fact_ids ?? []),
  schemaVerified: context.schema_verified !== false,
  currentProductMasterVersion: context.current_product_master_version,
  unverifiedFields: context.unverified_fields ?? [],
  schemaAuthorization: context.schema_authorization ?? null,
  competitorBrands: context.competitor_brands ?? []
});
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
if (!result.ok) process.exitCode = 1;
