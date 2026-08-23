import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

export async function withTempWorkspace(run) {
  const root = await mkdtemp(path.join(tmpdir(), 'amazon-listing-studio-'));
  try {
    return await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
