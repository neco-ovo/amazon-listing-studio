import {createHash} from 'node:crypto';
import {readdir, readFile} from 'node:fs/promises';
import path from 'node:path';

import {strFromU8, unzipSync} from 'fflate';
import {create as createFont} from 'fontkit';

import {DomainError} from './errors.js';

const FONT_EXTENSIONS = new Set(['.otf', '.ttf', '.woff', '.woff2', '.ttc']);
const DEFAULT_LIMITS = {
  maxEntryBytes: 20 * 1024 * 1024,
  maxTotalBytes: 100 * 1024 * 1024,
  maxCompressionRatio: 100,
};

function unsafe(message, details = {}) {
  return new DomainError('UNSAFE_ARCHIVE', message, details);
}

function fontFormat(sourcePath) {
  return path.extname(sourcePath).slice(1).toLowerCase();
}

function isFontPath(sourcePath) {
  return FONT_EXTENSIONS.has(path.extname(sourcePath).toLowerCase());
}

function assertSafeArchivePath(name) {
  const normalized = name.replaceAll('\\', '/');
  if (/^(?:\/|[A-Za-z]:)/.test(normalized) || normalized.split('/').includes('..')) {
    throw unsafe('Archive font path is absolute or contains traversal.', {name});
  }
}

function centralEntries(buffer) {
  const bytes = Buffer.from(buffer);
  let eocd = -1;
  for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 65_557); offset -= 1) {
    if (bytes.readUInt32LE(offset) === 0x06054b50) {
      eocd = offset;
      break;
    }
  }
  if (eocd < 0) throw unsafe('ZIP central directory was not found.');
  const count = bytes.readUInt16LE(eocd + 10);
  let offset = bytes.readUInt32LE(eocd + 16);
  const entries = [];
  for (let index = 0; index < count; index += 1) {
    if (offset + 46 > bytes.length || bytes.readUInt32LE(offset) !== 0x02014b50) {
      throw unsafe('ZIP central directory is malformed.', {index});
    }
    const flags = bytes.readUInt16LE(offset + 8);
    const compressedSize = bytes.readUInt32LE(offset + 20);
    const originalSize = bytes.readUInt32LE(offset + 24);
    const nameLength = bytes.readUInt16LE(offset + 28);
    const extraLength = bytes.readUInt16LE(offset + 30);
    const commentLength = bytes.readUInt16LE(offset + 32);
    const nameStart = offset + 46;
    const name = strFromU8(
      bytes.subarray(nameStart, nameStart + nameLength),
      (flags & 0x0800) === 0,
    );
    entries.push({name, flags, compressedSize, originalSize});
    offset = nameStart + nameLength + extraLength + commentLength;
  }
  return entries;
}

export function inspectZipFonts(buffer, limits = {}) {
  const configured = {...DEFAULT_LIMITS, ...limits};
  const selected = centralEntries(buffer).filter(entry => isFontPath(entry.name));
  let totalBytes = 0;
  for (const entry of selected) {
    assertSafeArchivePath(entry.name);
    if ((entry.flags & 1) !== 0) throw unsafe('Encrypted font entries are not allowed.', {name: entry.name});
    if (entry.originalSize > configured.maxEntryBytes) {
      throw unsafe('Archive font entry size exceeds the configured limit.', {name: entry.name, bytes: entry.originalSize});
    }
    totalBytes += entry.originalSize;
    if (totalBytes > configured.maxTotalBytes) {
      throw unsafe('Total selected font content exceeds the configured limit.', {bytes: totalBytes});
    }
    const ratio = entry.originalSize === 0 ? 1 : entry.originalSize / Math.max(1, entry.compressedSize);
    if (ratio > configured.maxCompressionRatio) {
      throw unsafe('Archive font compression ratio exceeds the configured limit.', {name: entry.name, ratio});
    }
  }

  const names = new Set(selected.map(entry => entry.name));
  const extracted = unzipSync(new Uint8Array(buffer), {filter: entry => names.has(entry.name)});
  return selected.map(entry => ({
    ...entry,
    bytes: Buffer.from(extracted[entry.name]),
  }));
}

function titleCaseFamily(value) {
  if (/^[A-Z0-9-]{2,6}$/.test(value)) return value;
  return value.toLowerCase().replace(/(^|[\s-])([\p{L}\p{N}])/gu, (_, prefix, letter) => `${prefix}${letter.toUpperCase()}`);
}

export function normalizeFamily(metadata, context = {}) {
  const compact = String(metadata?.family ?? context.fallbackFamily ?? 'Unknown')
    .trim()
    .replace(/\s+/g, ' ');
  const aliases = Object.entries(context.aliases ?? {});
  const alias = aliases.find(([key]) => key.toLocaleLowerCase() === compact.toLocaleLowerCase());
  if (alias) return alias[1];
  const preferred = String(context.preferredFamily ?? '').trim().replace(/\s+/g, ' ');
  if (preferred && preferred.toLocaleLowerCase() === compact.toLocaleLowerCase()) return preferred;
  return titleCaseFamily(compact);
}

function defaultMetadata(sourcePath, bytes) {
  const parsed = createFont(Buffer.from(bytes));
  const font = parsed.fonts?.[0] ?? parsed;
  return {
    family: font.familyName,
    postscriptName: font.postscriptName,
    variant: font.subfamilyName ?? 'Regular',
    languages: [],
    styleTags: [],
    fullName: font.fullName,
    sourcePath,
  };
}

function fallbackMetadata(sourcePath, error) {
  return {
    family: path.basename(sourcePath, path.extname(sourcePath)).replace(/[-_]+/g, ' '),
    postscriptName: null,
    variant: 'Unknown',
    languages: [],
    styleTags: [],
    metadataError: error.message,
  };
}

function sourceLabel(relativePath) {
  return relativePath.replaceAll('\\', '/').split('/')[0];
}

async function toRecord({sourcePath, relativePath, bytes, container, readMetadata, aliases}) {
  let metadata;
  try {
    metadata = await readMetadata(sourcePath, bytes);
  } catch (error) {
    metadata = fallbackMetadata(sourcePath, error);
  }
  return {
    normalizedFamily: normalizeFamily(metadata, {
      aliases,
      fallbackFamily: path.basename(sourcePath, path.extname(sourcePath)),
      preferredFamily: path.basename(sourcePath, path.extname(sourcePath)).replace(/[-_]+/g, ' '),
    }),
    rawFamily: metadata.family ?? null,
    postscriptName: metadata.postscriptName ?? null,
    fullName: metadata.fullName ?? null,
    variant: metadata.variant ?? 'Regular',
    languages: [...new Set(metadata.languages ?? [])].sort(),
    styleTags: [...new Set(metadata.styleTags ?? [])].sort(),
    format: fontFormat(sourcePath),
    container,
    sourcePath: relativePath.replaceAll('\\', '/'),
    sourceLabel: sourceLabel(relativePath),
    sha256: createHash('sha256').update(bytes).digest('hex'),
    fallback: metadata.metadataError ? {used: true, reason: metadata.metadataError} : {used: false, reason: null},
  };
}

async function walk(root) {
  const found = [];
  async function visit(directory) {
    const entries = await readdir(directory, {withFileTypes: true});
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(absolute);
      else if (entry.isFile()) found.push(absolute);
    }
  }
  await visit(root);
  return found;
}

export async function discoverFonts(root, options = {}) {
  const absoluteRoot = path.resolve(root);
  const readMetadata = options.readMetadata ?? defaultMetadata;
  const records = [];
  for (const absolute of await walk(absoluteRoot)) {
    const relative = path.relative(absoluteRoot, absolute);
    if (isFontPath(absolute)) {
      const bytes = await readFile(absolute);
      records.push(await toRecord({sourcePath: absolute, relativePath: relative, bytes, container: 'file', readMetadata, aliases: options.aliases}));
    } else if (path.extname(absolute).toLowerCase() === '.zip') {
      const archive = await readFile(absolute);
      for (const entry of inspectZipFonts(archive, options.zipLimits)) {
        const logicalPath = `${absolute}::${entry.name}`;
        const relativePath = `${relative.replaceAll('\\', '/')}::${entry.name}`;
        records.push(await toRecord({sourcePath: logicalPath, relativePath, bytes: entry.bytes, container: 'zip', readMetadata, aliases: options.aliases}));
      }
    }
  }
  records.sort((left, right) => [left.normalizedFamily, left.variant, left.format, left.sourcePath]
    .join('\0').localeCompare([right.normalizedFamily, right.variant, right.format, right.sourcePath].join('\0')));
  const grouped = new Map();
  for (const record of records) {
    const group = grouped.get(record.normalizedFamily) ?? {normalizedFamily: record.normalizedFamily, files: 0, formats: new Set(), variants: new Set()};
    group.files += 1;
    group.formats.add(record.format);
    group.variants.add(record.variant);
    grouped.set(record.normalizedFamily, group);
  }
  const families = [...grouped.values()].map(group => ({...group, formats: [...group.formats].sort(), variants: [...group.variants].sort()}));
  return {root: absoluteRoot, files: records, families};
}

export function selectFont(catalog, request = {}) {
  const requested = request.family ? normalizeFamily({family: request.family}) : null;
  const fallback = request.fallbackFamily ? normalizeFamily({family: request.fallbackFamily}) : null;
  const exact = catalog.files.find(file => file.normalizedFamily === requested);
  if (exact) return {...exact, fallbackFrom: null};
  const replacement = catalog.files.find(file => file.normalizedFamily === fallback) ?? catalog.files[0];
  if (!replacement) throw new DomainError('FONT_UNAVAILABLE', 'No font is available for the overlay.');
  return {...replacement, fallbackFrom: request.family ?? null};
}
