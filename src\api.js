import { gridFor, range, workSize } from './utils.js';

export const fetchPicture = async (url) => {
  const res = await fetch(url, { mode: 'cors' }).catch(() => {
    throw new Error('That site won’t share its pictures with other pages. Save the photo and upload the file instead.');
  });
  if (!res.ok) throw new Error(`The link answered ${res.status}. Check the address and try again.`);
  const blob = await res.blob();
  if (!blob.type.startsWith('image/')) throw new Error('That link opens a page, not a picture. Copy the image’s own address instead.');
  return blob;
};

export const decodePicture = (blob) => createImageBitmap(blob).catch(() => {
  throw new Error('This picture couldn’t be read. JPEG, PNG and WebP files all work.');
});

const canvasOf = (w, h) => Object.assign(document.createElement('canvas'), { width: w, height: h });

const toBlob = (canvas, quality) => new Promise((done, fail) => {
  canvas.toBlob((b) => (b ? done(b) : fail(new Error('The picture couldn’t be prepared.'))), 'image/jpeg', quality);
});

export const preparePicture = async (blob, count) => {
  const bmp = await decodePicture(blob);
  const grid = gridFor(count, bmp.width / bmp.height);
  const size = workSize(grid, bmp.width, bmp.height);
  const work = canvasOf(size.w, size.h);
  const wctx = work.getContext('2d');
  wctx.imageSmoothingQuality = 'high';
  wctx.drawImage(bmp, 0, 0, size.w, size.h);
  const k = 360 / Math.max(size.w, size.h);
  const thumb = canvasOf(Math.round(size.w * k), Math.round(size.h * k));
  const tctx = thumb.getContext('2d');
  tctx.imageSmoothingQuality = 'high';
  tctx.drawImage(work, 0, 0, thumb.width, thumb.height);
  bmp.close();
  return { grid, ...size, blob: await toBlob(work, 0.9), thumb: thumb.toDataURL('image/jpeg', 0.72) };
};

export const pictureAt = async (blob, w, h) => {
  const bmp = await decodePicture(blob);
  if (bmp.width === w && bmp.height === h) return bmp;
  const c = canvasOf(w, h);
  c.getContext('2d').drawImage(bmp, 0, 0, w, h);
  bmp.close();
  return createImageBitmap(c);
};

const loadPhoto = (src) => new Promise((done, fail) => {
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = () => done(img);
  img.onerror = () => fail(new Error('The tabletop photo didn’t load.'));
  img.src = src;
});
const reliefOf = (tile) => {
  const n = Math.min(1024, tile.width);
  const c = canvasOf(n, n);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(tile, 0, 0, n, n);
  const px = ctx.getImageData(0, 0, n, n);
  const high = Float32Array.from({ length: n * n }, (_, k) => (px.data[k * 4] * 0.3 + px.data[k * 4 + 1] * 0.6 + px.data[k * 4 + 2] * 0.1) / 255);
  const at = (x, y) => high[((y + n) % n) * n + ((x + n) % n)];
  px.data.set(Uint8ClampedArray.from({ length: n * n * 4 }, (_, k) => {
    const [x, y, ch] = [(k >> 2) % n, Math.floor((k >> 2) / n), k % 4];
    if (ch > 1) return 255;
    const slope = ch === 0 ? at(x - 1, y) - at(x + 1, y) : at(x, y - 1) - at(x, y + 1);
    return 128 + slope * 420;
  }));
  ctx.putImageData(px, 0, 0);
  return c;
};

export const tabletopTile = async (top, src, side = 1024) => {
  const img = await loadPhoto(src);
  const crop = Math.min(img.width, img.height) * top.crop;
  const flat = canvasOf(side, side);
  const ctx = flat.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, (img.width - crop) / 2, (img.height - crop) / 2, crop, crop, 0, 0, side, side);
  const grid = top.flat;
  const tiny = canvasOf(grid, grid);
  const tctx = tiny.getContext('2d', { willReadFrequently: true });
  tctx.drawImage(flat, 0, 0, grid, grid);
  const small = tctx.getImageData(0, 0, grid, grid).data;
  const mean = [0, 1, 2].map((ch) => small.reduce((sum, v, k) => (k % 4 === ch ? sum + v : sum), 0) / (grid * grid));
  const blur = canvasOf(side, side);
  const bctx = blur.getContext('2d', { willReadFrequently: true });
  bctx.imageSmoothingQuality = 'high';
  bctx.drawImage(tiny, -side / grid / 2, -side / grid / 2, side + side / grid, side + side / grid);
  const px = ctx.getImageData(0, 0, side, side);
  const low = bctx.getImageData(0, 0, side, side).data;
  px.data.set(px.data.map((v, k) => (k % 4 === 3 ? 255 : v * top.shade[k % 4] * Math.min(2, Math.max(0.5, (mean[k % 4] + 6) / (low[k] + 6))))));
  ctx.putImageData(px, 0, 0);
  const tile = canvasOf(side * 2, side * 2);
  const mctx = tile.getContext('2d');
  [[1, 1], [-1, 1], [1, -1], [-1, -1]].forEach(([fx, fy]) => {
    mctx.setTransform(fx, 0, 0, fy, fx < 0 ? side * 2 : 0, fy < 0 ? side * 2 : 0);
    mctx.drawImage(flat, 0, 0);
  });
  return { map: tile, normal: reliefOf(tile), swatch: swatchOf(tile) };
};

const scanUrl = (id, map, res) => `https://dl.polyhaven.org/file/ph-assets/Textures/jpg/${res}/${id}/${id}_${map}_${res}.jpg`;
const drawn = (img) => {
  const c = canvasOf(img.width, img.height);
  c.getContext('2d', { willReadFrequently: true }).drawImage(img, 0, 0);
  return c;
};
const dyed = (canvas, tint) => {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const px = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const light = (k) => px.data[k] * 0.3 + px.data[k + 1] * 0.6 + px.data[k + 2] * 0.1;
  const mean = range(0, 4096).reduce((sum, n) => sum + light(Math.floor((n / 4096) * (px.data.length / 4)) * 4), 0) / 4096;
  px.data.set(px.data.map((v, k) => (k % 4 === 3 ? 255 : (light(k - (k % 4)) / mean) * tint[k % 4])));
  ctx.putImageData(px, 0, 0);
  return canvas;
};
const swatchOf = (map) => {
  const c = canvasOf(96, 96);
  c.getContext('2d').drawImage(map, 0, 0, map.width / 2, map.height / 2, 0, 0, 96, 96);
  return c.toDataURL('image/jpeg', 0.8);
};
const colorOf = async (top, res) => {
  const map = drawn(await loadPhoto(scanUrl(top.ph, top.diff ?? 'diff', res)));
  return top.tint ? dyed(map, top.tint) : map;
};

export const materialSet = async (top) => {
  const [map, normal, rough] = await Promise.all([
    colorOf(top, '1k'),
    loadPhoto(scanUrl(top.ph, 'nor_gl', '1k')).then(drawn),
    loadPhoto(scanUrl(top.ph, 'rough', '1k')).then(drawn),
  ]);
  return {
    map, normal, rough, swatch: swatchOf(map),
  };
};
export const sharpened = async (top, tile) => ({ ...tile, map: await colorOf(top, '2k') });
