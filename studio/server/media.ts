import { BadRequestException } from '@nestjs/common';
import { shortText } from './validation';
export function mediaFile(
  bytes: unknown,
  name: unknown,
  mime: unknown,
  maxBytes = 8388608,
) {
  if (
    !Buffer.isBuffer(bytes) ||
    !bytes.length ||
    bytes.length > maxBytes ||
    typeof name !== 'string'
  )
    throw new BadRequestException();
  let filename: string;
  try {
    filename = shortText(decodeURIComponent(name), 200);
  } catch {
    throw new BadRequestException();
  }
  if (/[\\/]/.test(filename)) throw new BadRequestException();
  const png = bytes
    .subarray(0, 8)
    .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  const gif = ['GIF87a', 'GIF89a'].includes(bytes.toString('ascii', 0, 6));
  const webp =
    bytes.toString('ascii', 0, 4) === 'RIFF' &&
    bytes.toString('ascii', 8, 12) === 'WEBP';
  const mp4 = bytes.toString('ascii', 4, 8) === 'ftyp' && bytes.length > 24;
  const actual = png
    ? 'image/png'
    : jpeg
      ? 'image/jpeg'
      : gif
        ? 'image/gif'
        : webp
          ? 'image/webp'
          : mp4
            ? 'video/mp4'
            : '';
  if (!actual || actual !== mime) throw new BadRequestException();
  return { name: filename, mime: actual, content: bytes };
}
