// Upload type detection for receipts / note attachments (lib/files.ts).
import test from 'node:test';
import assert from 'node:assert/strict';
import { acceptedType, base64Head, fileNameFor, sniffUploadType } from '../files.ts';

const b64 = (bytes: number[] | string) => Buffer.from(typeof bytes === 'string' ? bytes : Uint8Array.from(bytes)).toString('base64');

test('base64Head decodes the leading bytes', () => {
  assert.deepEqual(base64Head(b64([1, 2, 3, 4, 5, 250]), 6), [1, 2, 3, 4, 5, 250]);
  assert.deepEqual(base64Head(`data:image/png;base64,${b64([9, 8, 7])}`, 3), [9, 8, 7]);
  assert.deepEqual(base64Head(b64([0xff, 0xd8]), 16), [0xff, 0xd8]);
});

test('sniffUploadType reads the real file type from the bytes', () => {
  assert.equal(sniffUploadType(b64([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70])), 'image/jpeg');
  assert.equal(sniffUploadType(b64([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13])), 'image/png');
  assert.equal(sniffUploadType(b64('GIF89a\x01\x00\x01\x00')), 'image/gif');
  assert.equal(sniffUploadType(b64('RIFF\x24\x00\x00\x00WEBPVP8 ')), 'image/webp');
  assert.equal(sniffUploadType(b64('\x00\x00\x00\x18ftypheic\x00\x00\x00\x00')), 'image/heic');
  assert.equal(sniffUploadType(b64('\x00\x00\x00\x18ftypmif1\x00\x00\x00\x00')), 'image/heic');
  assert.equal(sniffUploadType(b64('%PDF-1.7\n%')), 'application/pdf');
  // not accepted by the server
  assert.equal(sniffUploadType(b64('BM\x36\x00\x00\x00\x00\x00')), null);
  assert.equal(sniffUploadType(b64('\x00\x00\x00\x1cftypavif\x00\x00\x00\x00')), null);
  assert.equal(sniffUploadType(b64('<svg xmlns="http://www.w3.org/2000/svg">')), null);
  assert.equal(sniffUploadType(''), null);
});

test('acceptedType normalizes MIME types', () => {
  assert.equal(acceptedType('image/JPG'), 'image/jpeg');
  assert.equal(acceptedType('image/heif'), 'image/heic');
  assert.equal(acceptedType('image/png'), 'image/png');
  assert.equal(acceptedType('image/bmp'), null);
  assert.equal(acceptedType(undefined), null);
});

test('fileNameFor matches the extension to the type', () => {
  assert.equal(fileNameFor('IMG_0001.HEIC', 'image/jpeg'), 'IMG_0001.jpg');
  assert.equal(fileNameFor('scan.png', 'image/png'), 'scan.png');
  assert.equal(fileNameFor('receipt', 'image/webp'), 'receipt.webp');
  assert.equal(fileNameFor(null, 'image/gif', 'photo-1'), 'photo-1.gif');
  assert.equal(fileNameFor('my.trip.photo.jpeg', 'image/heic'), 'my.trip.photo.heic');
});
