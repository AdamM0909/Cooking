// Link reader for Our Kitchen, written for Cloudflare Workers (free plan is plenty).
// Browsers may not read other websites directly, so the app asks this worker to fetch a
// recipe page. It returns the page's schema.org Recipe data when present, or the page text.
// KitchenLib (assets/lib.js) is bundled in above this section by tools/build-worker.mjs.

const MAX_BYTES = 3000000;

function reply(body, status, cors) {
  return new Response(JSON.stringify(body), { status: status || 200, headers: Object.assign({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, cors) });
}

// Refuse addresses that point inside a network rather than at a public website.
function isBlockedHost(host) {
  host = host.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.+$/, ''); // "localhost." is still localhost
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) return true;
  if (host.indexOf(':') >= 0) return true; // raw IPv6 literals
  var m = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(host);
  if (m) {
    var a = +m[1], b = +m[2], c = +m[3];
    return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
      (a === 192 && b === 0 && c === 0) || (a === 100 && b >= 64 && b <= 127) || (a === 198 && (b === 18 || b === 19));
  }
  return host.indexOf('.') < 0;
}

export default {
  async fetch(request, env) {
    const allowed = (env && env.ALLOWED_ORIGIN) || '';
    // Safe by default: until it is locked to one site it answers nobody, so it can never be used as an open proxy.
    if (!allowed) {
      return reply({ ok: false, error: 'This reader is not set up yet. In Cloudflare add a variable named ALLOWED_ORIGIN with your site address (see docs/LINK_IMPORT.md).' }, 503, { 'Access-Control-Allow-Origin': '*' });
    }
    const cors = { 'Access-Control-Allow-Origin': allowed, 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', Vary: 'Origin' };
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (request.method !== 'GET') return reply({ ok: false, error: 'Use GET.' }, 405, cors);
    if (request.headers.get('Origin') !== allowed) return reply({ ok: false, error: 'This reader is private to another site.' }, 403, cors);

    let target;
    try { target = new URL(new URL(request.url).searchParams.get('url') || ''); } catch (e) { return reply({ ok: false, error: 'Give a web address in ?url=' }, 400, cors); }
    if (!/^https?:$/.test(target.protocol) || isBlockedHost(target.hostname)) return reply({ ok: false, error: 'That address cannot be read.' }, 400, cors);

    try {
      const res = await fetch(target.toString(), {
        redirect: 'follow', signal: AbortSignal.timeout(10000),
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; OurKitchenReader/1.0)', Accept: 'text/html,application/xhtml+xml' }
      });
      if (isBlockedHost(new URL(res.url).hostname)) return reply({ ok: false, error: 'That page redirected somewhere that cannot be read.' }, 400, cors);
      if (!res.ok) return reply({ ok: false, error: 'The site answered ' + res.status + '.' }, 502, cors);
      const html = await res.text();
      if (html.length > MAX_BYTES) return reply({ ok: false, error: 'That page is too large.' }, 413, cors);
      const recipe = KitchenLib.extractJsonLdRecipe(html);
      if (recipe) return reply({ ok: true, url: res.url, recipe }, 200, cors);
      return reply({ ok: true, url: res.url, text: KitchenLib.htmlToText(html).slice(0, 30000) }, 200, cors);
    } catch (e) {
      return reply({ ok: false, error: 'Could not load that page.' }, 502, cors);
    }
  }
};
