import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readSpecHeader } from '../../shared/src/spec.ts';
import { verifySpec } from './verify.ts';

const HOST = '127.0.0.1';
const PORT = Number(process.env.REPROFLOW_PORT ?? 8787);
const MAX_BODY_BYTES = 2 * 1024 * 1024;

/** Per-runner token; the extension reads it from stdout or supplies REPROFLOW_TOKEN. */
const SESSION_TOKEN = process.env.REPROFLOW_TOKEN ?? randomBytes(32).toString('hex');

function send(response: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
  });
  response.end(body);
}

function tokenMatches(header: string | undefined): boolean {
  if (header === undefined || !header.startsWith('Bearer ')) return false;
  const provided = Buffer.from(header.slice('Bearer '.length));
  const expected = Buffer.from(SESSION_TOKEN);
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    request.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('request body too large'));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      resolve(Buffer.concat(chunks).toString('utf8'));
    });
    request.on('error', reject);
  });
}

async function handleVerify(request: IncomingMessage, response: ServerResponse): Promise<void> {
  if (!tokenMatches(request.headers.authorization)) {
    send(response, 401, { error: 'invalid session token' });
    return;
  }

  const body = await readBody(request);
  let spec: unknown;
  try {
    spec = (JSON.parse(body) as { spec?: unknown }).spec;
  } catch {
    send(response, 400, { error: 'body must be JSON' });
    return;
  }
  if (typeof spec !== 'string') {
    send(response, 400, { error: 'spec must be a string' });
    return;
  }

  const header = await readSpecHeader(spec);
  if (header === null) {
    send(response, 400, { error: 'not a signed ReproFlow spec' });
    return;
  }

  send(response, 200, await verifySpec(spec, header));
}

async function route(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const path = new URL(request.url ?? '/', `http://${HOST}:${PORT}`).pathname;
  if (request.method === 'GET' && path === '/health') {
    send(response, 200, { status: 'ok' });
    return;
  }
  if (request.method === 'POST' && path === '/verify') {
    await handleVerify(request, response);
    return;
  }
  send(response, 404, { error: 'not found' });
}

const server = createServer((request, response) => {
  route(request, response).catch((error: unknown) => {
    send(response, 500, { error: error instanceof Error ? error.message : String(error) });
  });
});

server.listen(PORT, HOST, () => {
  console.log(`ReproFlow runner listening on http://${HOST}:${PORT}`);
  console.log(`reproflow-session-token=${SESSION_TOKEN}`);
});
