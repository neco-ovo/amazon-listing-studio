import {mkdir} from 'node:fs/promises';
import path from 'node:path';

import sharp from 'sharp';

async function renderFixture(filePath, {background = '#ffffff', rectangles = []}) {
  const image = sharp({
    create: {width: 1000, height: 1000, channels: 3, background},
  });
  await image
    .composite(rectangles.map(rectangle => ({
      input: Buffer.from(
        `<svg width="${rectangle.width}" height="${rectangle.height}">`
        + `<rect width="100%" height="100%" fill="${rectangle.color ?? '#000000'}"/>`
        + '</svg>',
      ),
      left: rectangle.left,
      top: rectangle.top,
    })))
    .png()
    .toFile(filePath);
}

export async function createMainImageFixtures(root) {
  await mkdir(root, {recursive: true});
  const fixtures = {
    valid: path.join(root, 'main-valid.png'),
    stretched: path.join(root, 'main-stretched.png'),
    clipped: path.join(root, 'main-clipped.png'),
    nonwhite: path.join(root, 'main-nonwhite.png'),
    undersized: path.join(root, 'main-undersized.png'),
  };

  await Promise.all([
    renderFixture(fixtures.valid, {
      rectangles: [{left: 20, top: 180, width: 960, height: 640}],
    }),
    renderFixture(fixtures.stretched, {
      rectangles: [{left: 20, top: 20, width: 960, height: 960}],
    }),
    renderFixture(fixtures.clipped, {
      rectangles: [{left: 0, top: 180, width: 1000, height: 640}],
    }),
    renderFixture(fixtures.nonwhite, {
      background: '#dddddd',
      rectangles: [{left: 20, top: 180, width: 960, height: 640}],
    }),
    renderFixture(fixtures.undersized, {
      rectangles: [{left: 50, top: 200, width: 900, height: 600}],
    }),
  ]);

  return fixtures;
}
