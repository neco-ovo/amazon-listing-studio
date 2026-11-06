import {spawn} from 'node:child_process';
import {mkdir, readFile, rename, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {unzipSync} from 'fflate';

import {DomainError} from './errors.js';
import {createImageUploadArchive, projectUploadPreparation} from './upload-preparation.js';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function invalid(code, message, details = {}) {
  return new DomainError(code, message, details);
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

async function readJsonIfExists(filePath) {
  try {
    return await readJson(filePath);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function writeJsonAtomically(filePath, value) {
  await mkdir(path.dirname(filePath), {recursive: true});
  const temporary = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {flag: 'wx'});
  await rename(temporary, filePath);
}

function publicUrl(base, objectKey) {
  let url;
  try {
    url = new URL(base);
  } catch {
    throw invalid('R2_PUBLIC_URL_INVALID', 'R2 public base URL must be a valid HTTPS URL.');
  }
  if (url.protocol !== 'https:' || url.search || url.hash) {
    throw invalid('R2_PUBLIC_URL_INVALID', 'R2 public base URL must be HTTPS without a query or fragment.');
  }
  const prefix = url.pathname.replace(/\/+$/, '');
  const encoded = objectKey.split('/').map(encodeURIComponent).join('/');
  url.pathname = `${prefix}/${encoded}`;
  return url.href;
}

function stagingPath(root, objectKey) {
  const segments = objectKey.split('/');
  if (!objectKey || segments.some(segment => !segment || segment === '.' || segment === '..')) {
    throw invalid('R2_OBJECT_KEY_INVALID', 'R2 object key contains an unsafe path segment.', {object_key: objectKey});
  }
  return path.join(root, ...segments);
}

async function defaultHeadUrl(url) {
  try {
    const response = await fetch(url, {method: 'HEAD'});
    return {status: response.status, contentType: response.headers.get('content-type')};
  } catch (cause) {
    const error = invalid('R2_URL_CHECK_FAILED', 'Could not determine whether an R2 public object exists.', {url});
    error.cause = cause;
    throw error;
  }
}

function runWrangler(args, logPath) {
  const wrangler = path.join(packageRoot, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [wrangler, ...args], {
      cwd: packageRoot,
      env: {...process.env, WRANGLER_LOG_PATH: logPath},
      shell: false,
      stdio: ['ignore', 'ignore', 'pipe']
    });
    let stderr = '';
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', code => code === 0
      ? resolve()
      : reject(Object.assign(new Error(stderr.trim() || `Wrangler exited with code ${code}`), {exitCode: code})));
  });
}

async function defaultCheckWrangler({logPath}) {
  try {
    await runWrangler(['whoami'], logPath);
    return true;
  } catch {
    return false;
  }
}

async function defaultPutObject({bucket, objectKey, filePath, contentType, logPath}) {
  await runWrangler(['r2', 'object', 'put', `${bucket}/${objectKey}`, '--file', filePath,
    '--content-type', contentType, '--remote', '--force'], logPath);
}

function isPublicImage(result) {
  return result.status >= 200 && result.status < 300
    && String(result.contentType ?? '').toLowerCase().startsWith('image/');
}

export async function hostImagesR2({
  projectDir, deliveryDir, inputPath, bucket, publicBaseUrl, imageZipPath
}, {
  readDelivery,
  readArchive = () => readFile(path.join(deliveryDir, 'delivery.zip')),
  checkWrangler = defaultCheckWrangler,
  headUrl = defaultHeadUrl,
  putObject = defaultPutObject
} = {}) {
  if (!readDelivery) throw invalid('R2_DELIVERY_READER_MISSING', 'Verified delivery reader is required.');
  if (!bucket) throw invalid('R2_BUCKET_REQUIRED', 'R2 bucket is required.');
  const [delivery, archiveBytes, input] = await Promise.all([readDelivery(), readArchive(), readJson(inputPath)]);
  const projection = projectUploadPreparation({delivery, input});
  const keys = projection.proposed_images.map(image => image.object_key);
  if (new Set(keys).size !== keys.length) {
    throw invalid('R2_OBJECT_KEY_DUPLICATE', 'Proposed R2 object keys must be unique.');
  }

  const archive = unzipSync(archiveBytes);
  for (const image of projection.proposed_images) {
    if (!String(image.media_type ?? '').startsWith('image/') || !archive[image.source]) {
      throw invalid('R2_SOURCE_INVALID', 'Every R2 upload must map to an image member in verified delivery.zip.', {
        source: image.source
      });
    }
  }

  const workDir = path.join(projectDir, '.studio', 'work');
  const logPath = path.join(workDir, 'wrangler.log');
  const receiptPath = path.join(workDir, 'r2-upload-receipt.json');
  const stagingDir = path.join(workDir, 'upload-staging');
  await mkdir(workDir, {recursive: true});
  if (!await checkWrangler({logPath})) {
    const fallbackPath = imageZipPath ?? path.join(deliveryDir, 'product-images.zip');
    await mkdir(path.dirname(fallbackPath), {recursive: true});
    await writeFile(fallbackPath, createImageUploadArchive({archiveBytes, proposedImages: projection.proposed_images}));
    return {status: 'manual_upload_required', image_zip_path: fallbackPath};
  }
  const receipt = await readJsonIfExists(receiptPath);
  const sameReceipt = receipt?.delivery_identity === projection.delivery_identity
    && receipt?.bucket === bucket
    && receipt?.public_base_url === publicBaseUrl;
  const completed = new Set(sameReceipt ? receipt.completed_object_keys ?? [] : []);
  const candidates = projection.proposed_images.map(image => ({
    ...image,
    url: publicUrl(publicBaseUrl, image.object_key)
  }));

  const checks = await Promise.all(candidates.map(async image => ({image, result: await headUrl(image.url)})));
  for (const {image, result} of checks) {
    if (completed.has(image.object_key) && isPublicImage(result)) continue;
    completed.delete(image.object_key);
    if (result.status === 404) continue;
    if (result.status >= 200 && result.status < 300) {
      throw invalid('R2_OBJECT_COLLISION', 'An R2 object already exists; no files were uploaded.', {
        object_key: image.object_key
      });
    }
    throw invalid('R2_URL_CHECK_FAILED', 'Could not safely determine whether an R2 object exists.', {
      object_key: image.object_key, status: result.status
    });
  }

  const saveReceipt = () => writeJsonAtomically(receiptPath, {
    delivery_identity: projection.delivery_identity,
    bucket,
    public_base_url: publicBaseUrl,
    completed_object_keys: [...completed]
  });
  for (const image of candidates) {
    if (completed.has(image.object_key)) continue;
    const filePath = stagingPath(stagingDir, image.object_key);
    await mkdir(path.dirname(filePath), {recursive: true});
    await writeFile(filePath, archive[image.source]);
    try {
      await putObject({
        bucket, objectKey: image.object_key, filePath, contentType: image.media_type, url: image.url, logPath
      });
      const result = await headUrl(image.url);
      if (!isPublicImage(result)) {
        throw invalid('R2_PUBLIC_URL_INVALID', 'Uploaded R2 object is not publicly reachable as an image.', {
          object_key: image.object_key, status: result.status, content_type: result.contentType
        });
      }
    } catch (cause) {
      if (cause instanceof DomainError) throw cause;
      const error = invalid('R2_UPLOAD_FAILED', 'Wrangler could not upload an R2 object.', {
        object_key: image.object_key
      });
      error.cause = cause;
      throw error;
    }
    completed.add(image.object_key);
    await saveReceipt();
  }

  const hostedInput = {
    ...input,
    image_urls: {
      delivery_identity: projection.delivery_identity,
      images: Object.fromEntries(candidates.map(image => [image.object_key, image.url]))
    }
  };
  const finalPath = path.join(deliveryDir, 'hosted-input.json');
  await writeJsonAtomically(finalPath, hostedInput);
  return {status: 'hosted', input_path: finalPath, receipt_path: receiptPath, uploaded_images: candidates.length};
}

export async function mapManualR2Images({deliveryDir, inputPath, publicBaseUrl, prefix}, {
  readDelivery,
  headUrl = defaultHeadUrl
} = {}) {
  if (!readDelivery) throw invalid('R2_DELIVERY_READER_MISSING', 'Verified delivery reader is required.');
  const [delivery, input] = await Promise.all([readDelivery(), readJson(inputPath)]);
  const projection = projectUploadPreparation({delivery, input});
  const cleanPrefix = String(prefix ?? '').replace(/^\/+|\/+$/g, '');
  if (!cleanPrefix) throw invalid('R2_PREFIX_REQUIRED', 'User-uploaded R2 prefix is required.');
  const images = projection.proposed_images.map(image => ({
    ...image,
    url: publicUrl(publicBaseUrl, `${cleanPrefix}/${image.source}`)
  }));
  const checks = await Promise.all(images.map(async image => ({image, result: await headUrl(image.url)})));
  const invalidImage = checks.find(item => !isPublicImage(item.result));
  if (invalidImage) {
    throw invalid('R2_PUBLIC_URL_INVALID', 'A user-uploaded R2 image is not publicly reachable.', {
      source: invalidImage.image.source,
      status: invalidImage.result.status,
      content_type: invalidImage.result.contentType
    });
  }
  const hostedInput = {
    ...input,
    image_urls: {
      delivery_identity: projection.delivery_identity,
      images: Object.fromEntries(images.map(image => [image.object_key, image.url]))
    }
  };
  const finalPath = path.join(deliveryDir, 'hosted-input.json');
  await writeJsonAtomically(finalPath, hostedInput);
  return {status: 'hosted', input_path: finalPath, hosted_images: images.length};
}
