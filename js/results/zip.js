/**
 * results/zip.js — reading a .zip without a dependency.
 *
 * Results come off a cluster, a remote machine or a colleague's inbox as one
 * archive far more often than as a folder, and asking someone to unpack it
 * before they can look at it is asking them to do work the page can do. This
 * app has no build step and no libraries beyond three.js, so the archive is
 * read here, against the format, using the browser's own `DecompressionStream`
 * for the deflate part.
 *
 * Only what a results archive actually contains is supported: stored and
 * deflated entries. An encrypted or ZIP64 archive is refused by name rather
 * than half-read, because a file that comes back wrong is worse than one that
 * does not come back at all.
 */

const EOCD_SIG = 0x06054b50;
const CENTRAL_SIG = 0x02014b50;
const LOCAL_SIG = 0x04034b50;

/** The largest a comment can be, which bounds how far back the EOCD can sit. */
const MAX_COMMENT = 0xffff;

const STORED = 0;
const DEFLATED = 8;

export class ZipError extends Error {}

export const isZip = (file) => /\.zip$/i.test(file.name || '');

/**
 * Expands an archive into file-like objects: `{ name, text() }`, which is all
 * the results reader asks of a `File`. Directory entries and the folder part of
 * a path are dropped, so an archive of `output/node_disp.out` reads exactly
 * like the folder it was made from.
 */
export async function readZip(file) {
  if (typeof DecompressionStream !== 'function') {
    throw new ZipError('This browser cannot unpack a .zip. Drop the output folder itself instead.');
  }

  const buffer = await file.arrayBuffer();
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);

  const eocd = findEocd(view);
  if (eocd < 0) throw new ZipError(`${file.name} is not a zip archive.`);

  const count = view.getUint16(eocd + 10, true);
  const start = view.getUint32(eocd + 16, true);
  if (start === 0xffffffff || count === 0xffff) {
    throw new ZipError(`${file.name} is a ZIP64 archive, which is not supported. `
      + 'Unpack it and drop the folder.');
  }

  const out = [];
  let at = start;
  for (let i = 0; i < count; i++) {
    if (at + 46 > bytes.length || view.getUint32(at, true) !== CENTRAL_SIG) {
      throw new ZipError(`${file.name} is damaged: its directory ends early.`);
    }

    const flags = view.getUint16(at + 8, true);
    const method = view.getUint16(at + 10, true);
    const compressed = view.getUint32(at + 20, true);
    const nameLen = view.getUint16(at + 28, true);
    const extraLen = view.getUint16(at + 30, true);
    const commentLen = view.getUint16(at + 32, true);
    const localAt = view.getUint32(at + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(at + 46, at + 46 + nameLen));
    at += 46 + nameLen + extraLen + commentLen;

    if (name.endsWith('/')) continue;                      // a directory entry
    if (flags & 0x1) throw new ZipError(`${name} in ${file.name} is encrypted.`);
    if (compressed === 0xffffffff || localAt === 0xffffffff) {
      throw new ZipError(`${file.name} is a ZIP64 archive, which is not supported.`);
    }
    if (method !== STORED && method !== DEFLATED) {
      throw new ZipError(`${name} in ${file.name} uses compression method ${method}, `
        + 'which is not supported.');
    }

    // The central directory is the authority on where an entry lives, but the
    // name and extra fields are repeated in the local header at their own
    // lengths, and it is those that say where the bytes begin.
    if (view.getUint32(localAt, true) !== LOCAL_SIG) {
      throw new ZipError(`${file.name} is damaged: ${name} is not where its directory says.`);
    }
    const dataAt = localAt + 30
      + view.getUint16(localAt + 26, true)
      + view.getUint16(localAt + 28, true);
    const body = bytes.subarray(dataAt, dataAt + compressed);

    out.push({
      // A results folder inside the archive is the usual shape, and the reader
      // downstream matches on file names alone.
      name: name.slice(name.lastIndexOf('/') + 1),
      text: () => (method === STORED
        ? Promise.resolve(new TextDecoder().decode(body))
        : inflate(body)),
    });
  }

  if (!out.length) throw new ZipError(`${file.name} is empty.`);
  return out;
}

/** Raw deflate, through the browser's own decompressor. */
async function inflate(body) {
  const stream = new Blob([body]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Response(stream).text();
}

/**
 * The end-of-central-directory record, found by scanning back from the end.
 * It is the only structure in a zip whose position is not written down
 * anywhere, because a trailing comment of any length may follow it.
 */
function findEocd(view) {
  const limit = Math.max(0, view.byteLength - MAX_COMMENT - 22);
  for (let at = view.byteLength - 22; at >= limit; at--) {
    if (view.getUint32(at, true) === EOCD_SIG) return at;
  }
  return -1;
}
