// Firebase-only request accounting. The returned records contain numbers and
// fixed provider labels; request bodies, response content and URLs never escape.
export const priceCatalog = Object.freeze({
  asOf: '2026-11-01',
  source: 'https://developers.openai.com/api/docs/models/gpt-6-luna',
  rates: Object.freeze({
    model: 'gpt-6-luna', currency: 'USD', perTokens: 1_000_000,
    input: 0.10, cachedInput: 0.01, cacheWrite: 0.125, cacheWrite12h: 0.25, output: 0.50,
    longContextThreshold: 272_000, longInputMultiplier: 2, longOutputMultiplier: 1.5,
    tierMultipliers: Object.freeze({ default: 1, standard: 1, flex: 0.5, batch: 0.5, fast: 2, priority: 2 })
  })
});

const providerNames = ['openai', 'dso', 'rp', 'koop', 'pdok', 'routing', 'other'];
const usageLimit = 256 * 1024;
const usageTimeoutMs = 2_000;
const stopped = Symbol('metadata-reader-stopped');
const count = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
const object = value => value && typeof value === 'object' && !Array.isArray(value);

function classify(input, options) {
  try {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    if (url.protocol !== 'https:' || url.port && url.port !== '443') return { provider: 'other', prompt: false };
    const host = url.hostname;
    let provider = 'other';
    if (host === 'api.openai.com') provider = 'openai';
    else if (host === 'service.omgevingswet.overheid.nl') provider = 'dso';
    else if (host === 'ruimte.omgevingswet.overheid.nl') provider = 'rp';
    else if (['repository.overheid.nl', 'zoek.officielebekendmakingen.nl'].includes(host)) provider = 'koop';
    else if (['api.pdok.nl', 'service.pdok.nl', 'geodata.nationaalgeoregister.nl'].includes(host)) provider = 'pdok';
    else if (['api.heigit.org', 'api.openrouteservice.org', 'routing.openstreetmap.de'].includes(host)) provider = 'routing';
    const method = String(options?.method || (typeof input === 'object' && input?.method) || 'GET').toUpperCase();
    return { provider, prompt: provider === 'openai' && url.pathname === '/v1/responses' && method === 'POST' };
  } catch {
    return { provider: 'other', prompt: false };
  }
}

async function readMetadata(response) {
  let reader, timer;
  try {
    // clone() tees the body. The application receives its original Response,
    // without waiting for this bounded, best-effort metadata reader.
    reader = response.clone().body?.getReader();
    if (!reader) return null;
    let stop;
    const deadline = new Promise(resolve => { stop = () => resolve(stopped); });
    const cancel = () => {
      stop();
      // A tee cancellation promise may wait for the original branch. Never
      // await it: stopping monitoring must not cancel or delay the application.
      try { Promise.resolve(reader.cancel()).catch(() => {}); } catch {}
    };
    timer = setTimeout(cancel, usageTimeoutMs);
    const chunks = [];
    let size = 0;
    for (;;) {
      const part = await Promise.race([reader.read(), deadline]);
      if (part === stopped) return null;
      if (part.done) break;
      if (!(part.value instanceof Uint8Array) || size + part.value.byteLength > usageLimit) {
        cancel();
        return null;
      }
      size += part.value.byteLength;
      chunks.push(part.value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const result = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    if (!object(result)) return null;
    // Only these explicitly selected fields can reach the numeric parser.
    return { model: result.model, tier: result.service_tier, usage: result.usage };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    try { reader?.releaseLock(); } catch {}
  }
}

function parseUsage(metadata) {
  const usage = metadata?.usage;
  if (!object(usage)) return null;
  const input = count(usage.input_tokens), output = count(usage.output_tokens);
  const inputDetails = object(usage.input_tokens_details) ? usage.input_tokens_details : {};
  const outputDetails = object(usage.output_tokens_details) ? usage.output_tokens_details : {};
  const cached = count(inputDetails.cached_tokens), written = count(inputDetails.cache_write_tokens);
  const reasoning = outputDetails.reasoning_tokens === undefined ? 0 : count(outputDetails.reasoning_tokens);
  if ([input, output, cached, written, reasoning].includes(null) || cached + written > input || reasoning > output) return null;

  // The application currently uses the default 30m write lifetime. Newer
  // responses can explicitly report both lifetimes; price their exact split.
  let write30m = written, write12h = 0, writeSplitKnown = true;
  if (inputDetails.cache_write_tokens_details !== undefined) {
    const details = inputDetails.cache_write_tokens_details;
    write30m = object(details) ? count(details.ttl_30m_tokens) : null;
    write12h = object(details) ? count(details.ttl_12h_tokens) : null;
    writeSplitKnown = write30m !== null && write12h !== null && write30m + write12h === written
      && Object.keys(details).every(key => key === 'ttl_30m_tokens' || key === 'ttl_12h_tokens');
  }
  return { input, output, cached, written, reasoning, write30m, write12h, writeSplitKnown };
}

function estimate(metadata, usage) {
  const rates = priceCatalog.rates;
  const multiplier = typeof metadata.tier === 'string' && Object.hasOwn(rates.tierMultipliers, metadata.tier)
    ? rates.tierMultipliers[metadata.tier] : null;
  if (metadata.model !== rates.model || multiplier === null || !usage.writeSplitKnown) return null;
  const long = usage.input > rates.longContextThreshold;
  const inputMultiplier = long ? rates.longInputMultiplier : 1;
  const outputMultiplier = long ? rates.longOutputMultiplier : 1;
  // Cache writes and reads replace ordinary input billing. Reasoning tokens
  // are already part of output_tokens, so they are never billed a second time.
  const ordinary = usage.input - usage.cached - usage.written;
  return ((ordinary * rates.input + usage.cached * rates.cachedInput + usage.write30m * rates.cacheWrite
    + usage.write12h * rates.cacheWrite12h) * inputMultiplier + usage.output * rates.output * outputMultiplier)
    * multiplier / rates.perTokens;
}

export function createRequestMeter({ fetcher = fetch, now = () => Date.now() } = {}) {
  const started = now();
  const totals = {
    providerCalls: 0, prompts: 0,
    inputTokens: 0, cachedInputTokens: 0, cacheWriteTokens: 0, outputTokens: 0, reasoningTokens: 0,
    estimatedCostUsd: 0, unpricedCalls: 0, usageMissingCalls: 0,
    providers: Object.fromEntries(providerNames.map(provider => [provider, 0]))
  };
  const pending = new Set();

  const missing = () => { totals.usageMissingCalls++; totals.unpricedCalls++; };
  const collect = metadata => {
    const usage = parseUsage(metadata);
    if (!usage) { missing(); return; }
    totals.inputTokens += usage.input;
    totals.cachedInputTokens += usage.cached;
    totals.cacheWriteTokens += usage.written;
    totals.outputTokens += usage.output;
    totals.reasoningTokens += usage.reasoning;
    const cost = estimate(metadata, usage);
    if (cost === null) totals.unpricedCalls++;
    else totals.estimatedCostUsd += cost;
  };

  async function wrappedFetch(input, options) {
    const { provider, prompt } = classify(input, options);
    totals.providerCalls++;
    totals.providers[provider]++;
    if (!prompt) return fetcher(input, options);
    totals.prompts++;
    let complete;
    const task = new Promise(resolve => { complete = resolve; });
    pending.add(task);
    const done = () => { pending.delete(task); complete(); };
    try {
      const response = await fetcher(input, options);
      readMetadata(response).then(metadata => { try { collect(metadata); } catch { missing(); } }, missing).finally(done);
      return response;
    } catch (error) {
      missing();
      done();
      throw error;
    }
  }

  async function finish() {
    while (pending.size) await Promise.allSettled([...pending]);
    return { ...totals, estimatedCostUsd: Number(totals.estimatedCostUsd.toFixed(12)),
      providers: { ...totals.providers }, durationMs: Math.max(0, Math.round(now() - started)) };
  }
  return { fetch: wrappedFetch, finish };
}
