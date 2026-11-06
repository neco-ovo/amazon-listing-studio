import {mkdir} from 'node:fs/promises';
import path from 'node:path';

import sharp from 'sharp';

async function renderFixture(filePath, {background = '#ffffff', rectangles = [], size = 1600}) {
  const image = sharp({
    create: {width: size, height: size, channels: 3, background},
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
    tooSmall: path.join(root, 'main-too-small.png'),
  };

  await Promise.all([
    renderFixture(fixtures.valid, {
      rectangles: [{left: 32, top: 288, width: 1536, height: 1024}],
    }),
    renderFixture(fixtures.stretched, {
      rectangles: [{left: 32, top: 32, width: 1536, height: 1536}],
    }),
    renderFixture(fixtures.clipped, {
      rectangles: [{left: 0, top: 288, width: 1600, height: 1024}],
    }),
    renderFixture(fixtures.nonwhite, {
      background: '#dddddd',
      rectangles: [{left: 32, top: 288, width: 1536, height: 1024}],
    }),
    renderFixture(fixtures.undersized, {
      rectangles: [{left: 80, top: 320, width: 1440, height: 960}],
    }),
    renderFixture(fixtures.tooSmall, {
      size: 1000,
      rectangles: [{left: 20, top: 180, width: 960, height: 640}],
    }),
  ]);

  return fixtures;
}
