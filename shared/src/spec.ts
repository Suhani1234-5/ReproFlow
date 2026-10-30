/** First line of every generated spec. */
export const SPEC_HEADER_PREFIX = '// @reproflow-generated';
export const SPEC_VERSION = 1;
/** Every layer refers to the generated test by this name. */
export const SPEC_FILE_NAME = 'reproduction.spec.ts';

const HEADER_PATTERN = /^\/\/ @reproflow-generated v(\d+) sha256=([0-9a-f]{64}) failure=(\S+)$/;

export interface SpecHeader {
  version: number;
  sha256: string;
  /** Value the recorded failure assertion expected; the runner matches it against the replay. */
  failure: string;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** Also used to derive the reproduction fingerprint. */
export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(text));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function encodeBase64Url(value: string): string {
  let binary = '';
  for (const byte of encoder.encode(value)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function decodeBase64Url(value: string): string {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  const binary = atob(padded);
  return decoder.decode(Uint8Array.from(binary, (char) => char.charCodeAt(0)));
}

/** The signed body is everything after the first line. */
export function splitSpec(source: string): { header: string; body: string } {
  const index = source.indexOf('\n');
  if (index === -1) return { header: source, body: '' };
  return { header: source.slice(0, index), body: source.slice(index + 1) };
}

export async function writeSpecHeader(body: string, failure: string): Promise<string> {
  const digest = await sha256Hex(body);
  return `${SPEC_HEADER_PREFIX} v${SPEC_VERSION} sha256=${digest} failure=${encodeBase64Url(failure)}`;
}

/**
 * The signature is a content hash rather than a keyed mac: it proves the file is
 * byte-for-byte what the generator emitted, not who emitted it.
 */
export async function readSpecHeader(source: string): Promise<SpecHeader | null> {
  const { header, body } = splitSpec(source);
  const match = HEADER_PATTERN.exec(header);
  if (!match) return null;
  if (Number(match[1]) !== SPEC_VERSION) return null;
  if (match[2] !== (await sha256Hex(body))) return null;
  return { version: SPEC_VERSION, sha256: match[2], failure: decodeBase64Url(match[3]) };
}
