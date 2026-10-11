import { lookup } from 'node:dns';
import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import ipaddr from 'ipaddr.js';
import { Agent, setGlobalDispatcher } from 'undici';
import worker from './index.js';

function isPublicAddress(address) {
  try {
    return ipaddr.process(address).range() === 'unicast';
  } catch {
    return false;
  }
}

function lookupPublicAddress(hostname, options, callback) {
  const normalizedOptions = typeof options === 'number' ? { family: options } : options;
  lookup(hostname, { ...normalizedOptions, all: true, verbatim: true }, (error, records) => {
    if (error) {
      callback(error);
      return;
    }
    if (records.length === 0 || records.some(({ address }) => !isPublicAddress(address))) {
      const denied = new Error('DNS resolved to a non-public address');
      denied.code = 'ERR_RELAY_NON_PUBLIC_ADDRESS';
      callback(denied);
      return;
    }
    if (normalizedOptions?.all) {
      callback(null, records);
      return;
    }
    callback(null, records[0].address, records[0].family);
  });
}

setGlobalDispatcher(new Agent({ connect: { lookup: lookupPublicAddress } }));

function getRequestUrl(incoming) {
  const host = process.env.RENDER_EXTERNAL_HOSTNAME || incoming.headers.host;
  if (!host) throw new Error('Missing request host');
  return new URL(incoming.url || '/', `https://${host}`).toString();
}

function getRequestHeaders(incoming) {
  const headers = new Headers();
  for (const [name, value] of Object.entries(incoming.headers)) {
    if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(', ') : value);
  }
  return headers;
}

function writeResponseHeaders(outgoing, response) {
  outgoing.statusCode = response.status;
  const encoding = response.headers.get('content-encoding')?.trim().toLowerCase();
  const decodedContent = encoding === 'br' || encoding === 'gzip' || encoding === 'deflate';
  for (const [name, value] of response.headers) outgoing.setHeader(name, value);
  if (decodedContent) {
    outgoing.removeHeader('content-encoding');
    outgoing.removeHeader('content-length');
  }
}

async function handleRequest(incoming, outgoing) {
  const controller = new AbortController();
  incoming.once('aborted', () => controller.abort());
  outgoing.once('close', () => {
    if (!outgoing.writableEnded) controller.abort();
  });

  try {
    const method = incoming.method || 'GET';
    const request = {
      method,
      headers: getRequestHeaders(incoming),
      url: getRequestUrl(incoming),
      body: method === 'GET' || method === 'HEAD' ? null : Readable.toWeb(incoming),
      signal: controller.signal,
      duplex: 'half',
    };
    const response = await worker.fetch(request, { RELAY_TOKEN: process.env.RELAY_TOKEN });
    writeResponseHeaders(outgoing, response);
    if (!response.body) {
      outgoing.end();
      return;
    }
    await pipeline(Readable.fromWeb(response.body), outgoing);
  } catch (error) {
    console.error(JSON.stringify({
      event: 'relay.server_error',
      errorType: error instanceof Error ? error.name : 'unknown',
    }));
    if (!outgoing.headersSent) {
      outgoing.statusCode = 500;
      outgoing.setHeader('Content-Type', 'application/json; charset=utf-8');
      outgoing.setHeader('Cache-Control', 'no-store');
      outgoing.end(JSON.stringify({ error: 'internal_error' }));
    } else if (!outgoing.destroyed) {
      outgoing.destroy();
    }
  }
}

const server = createServer((incoming, outgoing) => {
  void handleRequest(incoming, outgoing);
});

server.on('connect', (_incoming, socket) => {
  socket.end('HTTP/1.1 405 Method Not Allowed\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
});

const port = Number.parseInt(process.env.PORT || '3000', 10);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('PORT must be a valid TCP port');
}

server.listen(port, '0.0.0.0', () => {
  console.log(JSON.stringify({ event: 'relay.server_started', port }));
});
