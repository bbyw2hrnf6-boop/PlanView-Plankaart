import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequestMeter, priceCatalog } from '../firebase/functions/request-meter.mjs';

const endpoint = 'https://api.openai.com/v1/responses';
const options = { method: 'POST' };
const usage = (input = 1000, output = 100, cached = 200, written = 300, reasoning = 70) => ({
  input_tokens: input, input_tokens_details: { cached_tokens: cached, cache_write_tokens: written },
  output_tokens: output, output_tokens_details: { reasoning_tokens: reasoning }
});
const result = (overrides = {}) => ({ model: 'gpt-6-luna', service_tier: 'default', usage: usage(), ...overrides });
const response = (overrides = {}, init) => Response.json(result(overrides), init);
const closeTo = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-12, `${actual} != ${expected}`);

test('meter counts nested Responses attempts, not merely one user request, and fixed provider groups', async () => {
  let clock = 100;
  const meter = createRequestMeter({ now: () => clock, fetcher: async url => url === endpoint ? response() : new Response('provider data') });
  async function permitQuestion() {
    const intent = await meter.fetch(endpoint, options);
    await intent.json();
    await Promise.all([
      meter.fetch('https://repository.overheid.nl/sru?query=private'),
      meter.fetch('https://api.pdok.nl/parcel?bbox=private'),
      meter.fetch('https://service.omgevingswet.overheid.nl/rules?point=private'),
      meter.fetch('https://ruimte.omgevingswet.overheid.nl/ruimtelijke-plannen/api/opvragen/v4/plannen/private'),
      meter.fetch('https://api.heigit.org/openrouteservice/v2/matrix/driving-car', options),
      meter.fetch('https://unknown.invalid/private?key=never-store-me')
    ]);
    return meter.fetch(endpoint, options);
  }
  await (await permitQuestion()).json();
  clock = 245;
  const metrics = await meter.finish();
  assert.equal(metrics.prompts, 2);
  assert.equal(metrics.providerCalls, 8);
  assert.deepEqual(metrics.providers, { openai: 2, dso: 1, rp: 1, koop: 1, pdok: 1, routing: 1, other: 1 });
  assert.equal(metrics.durationMs, 145);
  assert.equal(metrics.inputTokens, 2000);
  assert.equal(metrics.usageMissingCalls, 0);
  assert.equal(metrics.unpricedCalls, 0);
});

test('cached reads and writes replace ordinary input; reasoning stays included in output', async () => {
  const meter = createRequestMeter({ fetcher: async () => response() });
  await meter.fetch(endpoint, options);
  const metrics = await meter.finish();
  assert.deepEqual([metrics.inputTokens, metrics.cachedInputTokens, metrics.cacheWriteTokens, metrics.outputTokens, metrics.reasoningTokens], [1000, 200, 300, 100, 70]);
  closeTo(metrics.estimatedCostUsd, (500 * .10 + 200 * .01 + 300 * .125 + 100 * .50) / 1e6);
  assert.equal(priceCatalog.asOf, '2026-11-01');
  assert.equal(priceCatalog.source, 'https://developers.openai.com/api/docs/models/gpt-6-luna');
});

test('long context applies to the whole request only above 272K and combines with actual tier', async () => {
  for (const [input, tier, factor] of [[272000, 'default', 1], [272001, 'default', 1], [300000, 'flex', .5], [300000, 'batch', .5], [300000, 'priority', 2], [300000, 'fast', 2]]) {
    const meter = createRequestMeter({ fetcher: async () => response({ service_tier: tier, usage: usage(input, 2000, 10000, 20000, 1500) }) });
    await meter.fetch(endpoint, options);
    const metrics = await meter.finish();
    const isLong = input > 272000;
    closeTo(metrics.estimatedCostUsd, (((input - 30000) * .10 + 10000 * .01 + 20000 * .125) * (isLong ? 2 : 1) + 2000 * .50 * (isLong ? 1.5 : 1)) * factor / 1e6);
  }
});

test('mixed cache lifetimes use their actual write rates and unknown splits remain explicitly unpriced', async () => {
  const known = usage();
  known.input_tokens_details.cache_write_tokens_details = { ttl_30m_tokens: 200, ttl_12h_tokens: 100 };
  const unknown = usage();
  unknown.input_tokens_details.cache_write_tokens_details = { ttl_future_tokens: 300 };
  let call = 0;
  const meter = createRequestMeter({ fetcher: async () => response({ usage: call++ ? unknown : known }) });
  await meter.fetch(endpoint, options);
  await meter.fetch(endpoint, options);
  const metrics = await meter.finish();
  closeTo(metrics.estimatedCostUsd, (500 * .10 + 200 * .01 + 200 * .125 + 100 * .25 + 100 * .50) / 1e6);
  assert.equal(metrics.unpricedCalls, 1);
  assert.equal(metrics.usageMissingCalls, 0);
  assert.equal(metrics.cacheWriteTokens, 600);
});

test('missing or unknown model/tier keeps measured tokens but never pretends a complete cost', async () => {
  const variants = [{ model: 'future-model-with-private-data' }, { model: 'gpt-6-luna-2026-09-22' }, { service_tier: 'auto' }, { service_tier: 'future' }, { service_tier: undefined }, { service_tier: { toString: 'private' } }];
  let call = 0;
  const meter = createRequestMeter({ fetcher: async () => response(variants[call++]) });
  for (const _ of variants) await meter.fetch(endpoint, options);
  const metrics = await meter.finish();
  assert.equal(metrics.unpricedCalls, variants.length);
  assert.equal(metrics.usageMissingCalls, 0);
  assert.equal(metrics.estimatedCostUsd, 0);
  assert.equal(metrics.inputTokens, variants.length * 1000);
  assert.doesNotMatch(JSON.stringify(metrics), /future|private|gpt-/);
});

test('incomplete and failed provider responses with usage still count actual tokens and cost', async () => {
  let call = 0;
  const meter = createRequestMeter({ fetcher: async () => response({ status: call++ ? 'failed' : 'incomplete', error: { message: 'never-log-this' } }, { status: call === 2 ? 500 : 200 }) });
  const first = await meter.fetch(endpoint, options);
  const second = await meter.fetch(endpoint, options);
  assert.equal(first.status, 200);
  assert.equal(second.status, 500);
  const metrics = await meter.finish();
  assert.equal(metrics.prompts, 2);
  assert.equal(metrics.unpricedCalls, 0);
  assert.equal(metrics.inputTokens, 2000);
  closeTo(metrics.estimatedCostUsd, 2 * .0001395);
  assert.doesNotMatch(JSON.stringify(metrics), /never-log/);
});

test('concurrent request meters are isolated and return detached snapshots', async () => {
  let resolveA;
  const delayed = new Promise(resolve => { resolveA = resolve; });
  const a = createRequestMeter({ fetcher: async () => { await delayed; return response(); } });
  const b = createRequestMeter({ fetcher: async () => response({ usage: usage(20, 10, 0, 0, 5) }) });
  const requestA = a.fetch(endpoint, options);
  await b.fetch(endpoint, options);
  const metricsB = await b.finish();
  assert.equal(metricsB.inputTokens, 20);
  resolveA();
  await requestA;
  const metricsA = await a.finish();
  assert.equal(metricsA.inputTokens, 1000);
  metricsA.providers.openai = 999;
  assert.equal((await a.finish()).providers.openai, 1);
  assert.equal(metricsB.prompts, 1);
});

test('original Response, body, options and provider errors/abort identity remain untouched', async () => {
  const signal = new AbortController().signal;
  const headers = { Authorization: 'Bearer secret-request-key' };
  const init = { method: 'POST', body: 'private prompt and point', signal, headers };
  const original = response({ output: [{ text: 'private answer' }] });
  let forwarded;
  const meter = createRequestMeter({ fetcher: async (url, passed) => { forwarded = { url, passed }; return original; } });
  const returned = await meter.fetch(endpoint, init);
  assert.equal(returned, original);
  assert.equal(forwarded.passed, init);
  assert.equal(original.bodyUsed, false);
  assert.equal((await returned.json()).output[0].text, 'private answer');
  const metrics = await meter.finish();
  assert.doesNotMatch(JSON.stringify(metrics), /private|secret|Bearer|point|output_text/);
  const abort = new DOMException('secret abort error', 'AbortError');
  const failing = createRequestMeter({ fetcher: async () => { throw abort; } });
  await assert.rejects(failing.fetch(endpoint, init), error => error === abort);
  const failed = await failing.finish();
  assert.equal(failed.prompts, 1);
  assert.equal(failed.unpricedCalls, 1);
  assert.equal(failed.usageMissingCalls, 1);
  assert.doesNotMatch(JSON.stringify(failed), /abort|secret/);
});

test('only exact OpenAI Responses POST attempts produce prompts; other providers are never body-read', async () => {
  const targets = [
    ['https://api.openai.com/v1/responses', undefined],
    ['https://api.openai.com/v1/chat/completions', options],
    ['https://api.openai.com.evil.invalid/v1/responses', options],
    ['http://api.openai.com/v1/responses', options],
    ['https://api.openai.com:444/v1/responses', options],
    ['https://service.omgevingswet.overheid.nl/private?point=secret', options]
  ];
  const originals = [];
  const meter = createRequestMeter({ fetcher: async () => {
    const r = response();
    r.clone = () => { throw new Error('should never read this body'); };
    originals.push(r);
    return r;
  } });
  for (const [url, init] of targets) await meter.fetch(url, init);
  const metrics = await meter.finish();
  assert.equal(metrics.prompts, 0);
  assert.equal(metrics.providerCalls, 6);
  assert.deepEqual(metrics.providers, { openai: 2, dso: 1, rp: 0, koop: 0, pdok: 0, routing: 0, other: 3 });
  assert.ok(originals.every(r => !r.bodyUsed));
  assert.equal(metrics.usageMissingCalls, 0);
});

test('missing and malformed usage is explicitly unpriced; an explicit zero-token request can cost zero', async () => {
  const invalid = [null, {}, { ...usage(), input_tokens: -1 }, { ...usage(), input_tokens: '1000' }, usage(20, 10, 10, 20, 5), usage(20, 10, 0, 0, 11), { ...usage(), input_tokens_details: { cached_tokens: 0 } }];
  let call = 0;
  const meter = createRequestMeter({ fetcher: async () => response({ usage: call < invalid.length ? invalid[call++] : usage(0, 0, 0, 0, 0) }) });
  for (let i = 0; i <= invalid.length; i++) await meter.fetch(endpoint, options);
  const metrics = await meter.finish();
  assert.equal(metrics.prompts, invalid.length + 1);
  assert.equal(metrics.usageMissingCalls, invalid.length);
  assert.equal(metrics.unpricedCalls, invalid.length);
  assert.equal(metrics.estimatedCostUsd, 0);
});

test('bounded streaming metadata reader stops oversized content without consuming or cancelling original', async () => {
  let cancelled = false;
  const chunks = Array.from({ length: 9 }, () => new Uint8Array(32 * 1024).fill(32));
  const stream = new ReadableStream({ pull(controller) { const next = chunks.shift(); if (next) controller.enqueue(next); else controller.close(); }, cancel() { cancelled = true; } });
  const original = new Response(stream);
  const meter = createRequestMeter({ fetcher: async () => original });
  assert.equal(await meter.fetch(endpoint, options), original);
  const metrics = await meter.finish();
  assert.equal(metrics.usageMissingCalls, 1);
  assert.equal(metrics.unpricedCalls, 1);
  assert.equal(original.bodyUsed, false);
  assert.equal(cancelled, false);
  assert.equal((await original.arrayBuffer()).byteLength, 9 * 32 * 1024);
});

test('metadata clone timeout cannot hang a completed request or cancel the original stream', async () => {
  let controller;
  let cancelled = false;
  const original = new Response(new ReadableStream({ start(c) { controller = c; }, cancel() { cancelled = true; } }));
  const meter = createRequestMeter({ fetcher: async () => original });
  await meter.fetch(endpoint, options);
  const started = Date.now();
  const metrics = await meter.finish();
  assert.ok(Date.now() - started < 3000);
  assert.equal(metrics.usageMissingCalls, 1);
  assert.equal(cancelled, false);
  assert.equal(original.bodyUsed, false);
  controller.enqueue(new TextEncoder().encode('still readable'));
  controller.close();
  assert.equal(await original.text(), 'still readable');
});
