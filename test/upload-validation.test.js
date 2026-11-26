const assert = require('node:assert/strict');
const { test } = require('node:test');
const sharp = require('sharp');
const {
  MAX_CHAT_UPLOAD_BYTES,
  MAX_COURSE_UPLOAD_BYTES,
  MAX_PROFILE_IMAGE_BYTES,
  UploadValidationError,
  inspectUpload,
  sanitizeProfileImage
} = require('../upload-validation');

test('upload limits preserve the chat, course, and profile caps', () => {
  assert.equal(MAX_CHAT_UPLOAD_BYTES, 10 * 1024 * 1024);
  assert.equal(MAX_COURSE_UPLOAD_BYTES, 25 * 1024 * 1024);
  assert.equal(MAX_PROFILE_IMAGE_BYTES, 400 * 1024);
});

test('detects an image format from file contents and treats UTF-8 content as plain text', async () => {
  const png = await sharp({
    create: { width: 8, height: 8, channels: 3, background: { r: 12, g: 126, b: 123 } }
  }).png().toBuffer();

  assert.deepEqual(await inspectUpload(png), { mimeType: 'image/png' });
  assert.deepEqual(await inspectUpload(Buffer.from('<html>not an image</html>')), { mimeType: 'text/plain' });
});

test('rejects unknown binary content rather than trusting a filename or MIME header', async () => {
  await assert.rejects(
    inspectUpload(Buffer.from([0x00, 0x13, 0x37, 0xff])),
    error => error instanceof UploadValidationError && /not supported/.test(error.message)
  );
});

test('decodes and re-encodes profile photos as bounded WebP images', async () => {
  const webp = await sharp({
    create: { width: 40, height: 30, channels: 3, background: { r: 12, g: 126, b: 123 } }
  }).webp().toBuffer();

  const sanitized = await sanitizeProfileImage(webp);
  assert.equal((await sharp(sanitized).metadata()).format, 'webp');
  assert.ok(sanitized.length <= MAX_PROFILE_IMAGE_BYTES);
});

test('rejects content that only claims to be WebP', async () => {
  const fakeWebp = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0x04, 0, 0, 0]), Buffer.from('WEBPbad!')]);
  await assert.rejects(
    sanitizeProfileImage(fakeWebp),
    error => error instanceof UploadValidationError && /valid WebP/.test(error.message)
  );
});
