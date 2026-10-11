# Universal Fetch Relay Worker

This provider-agnostic, single-file Cloudflare Worker implements the protocol
documented in [`docs/en/proxy/01-fetch-relay.md`](../../docs/en/proxy/01-fetch-relay.md). It stores no
target-site or LLM-provider configuration. Each request supplies its complete
public HTTP(S) target through `Fetch-Relay-Target`.

## Deploy

### Render

This folder includes a Node.js adapter for Render; Render cannot run the
Cloudflare Worker entry point directly.

1. In Render, create a **Web Service** connected to this repository.
2. Set **Root Directory** to `examples/fetch-relay-worker`.
3. Set **Build Command** to `npm ci` and **Start Command** to `npm start`.
4. Add the environment variable `RELAY_TOKEN` with a strong, private value.
   Render provides `PORT` automatically.
5. Deploy, then use the service's `https://<service-name>.onrender.com` URL as
   the relay URL.

The Node.js adapter blocks non-public DNS results before connecting to upstream
hosts. Keep `RELAY_TOKEN` private and configure FreeLLMAPI as described below.

### Cloudflare Workers

Install Wrangler, authenticate it, set a strong secret, and deploy:

```bash
npx wrangler login
npx wrangler secret put RELAY_TOKEN
npx wrangler deploy
```

Do not put the token in `wrangler.jsonc` or commit it. Configure FreeLLMAPI:

```dotenv
PROXY_MODE=fetch-relay
PROXY_URL=https://universal-fetch-relay.<your-subdomain>.workers.dev
FETCH_RELAY_TOKEN=<the same RELAY_TOKEN>
```

Or select `fetch-relay` in **Keys -> Outbound proxy** and enter the same URL and
token. The Test button exercises the draft values before saving.

## Direct smoke test

```bash
curl https://universal-fetch-relay.<your-subdomain>.workers.dev \
  -H "Fetch-Relay-Authorization: Bearer $RELAY_TOKEN" \
  -H "Fetch-Relay-Target: https://httpbingo.org/anything?relay=smoke" \
  -H "Content-Type: application/json" \
  --data-binary '{"hello":"relay"}'
```

The Worker supports JSON, GraphQL, binary uploads, arbitrary ordinary HTTP
methods, SSE, and other streamed responses. It rejects `CONNECT`, `TRACE`, URL
credentials, IP-literal and local host targets, fragments, and relay loops. It
does not implement SOCKS, raw TCP, WebSockets, cookies, or automatic redirects.
Logs contain request ID, method, target hostname/protocol, status, TTFB, and
Cloudflare colo—not bodies, credentials, paths, or query values.
