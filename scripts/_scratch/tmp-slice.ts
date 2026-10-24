// @ts-nocheck
import sharp from 'sharp';

const src = process.argv[2];
const out = process.argv[3];
const slices = Number(process.argv[4] ?? 4);

const meta = await sharp(src).metadata();
const width = meta.width!;
const height = meta.height!;
const sh = Math.floor(height / slices);
const bufs: Buffer[] = [];

for (let i = 0; i < slices; i++) {
  const top = i * sh;
  const h = i === slices - 1 ? height - top : sh;
  const b = await sharp(src)
    .extract({ left: 0, top, width, height: h })
    .resize({ width: 300 })
    .png()
    .toBuffer();
  bufs.push(b);
}

const mh = (await sharp(bufs[0]).metadata()).height!;
await sharp({ create: { width: 300 * slices, height: mh, channels: 3, background: '#ffffff' } })
  .composite(bufs.map((input, i) => ({ input, left: i * 300, top: 0 })))
  .jpeg({ quality: 70 })
  .toFile(out);
console.log('ok', out, width, height);
