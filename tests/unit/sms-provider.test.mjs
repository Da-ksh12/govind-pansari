// Fast2SMS request building, response classification, delivery reports and phone handling.
import test from 'node:test';
import assert from 'node:assert/strict';
import { maskIndianMobile, normalizeIndianMobile } from '../../supabase/functions/_shared/phone.ts';
import {
  buildSendRequest,
  classifySendResponse,
  deliveryUpdateFor,
  describeFailureForClient,
  parseDeliveryReport,
  readFast2SmsConfig,
} from '../../supabase/functions/_shared/fast2sms.ts';

const env = (values) => (name) => values[name];
const DLT_ENV = { FAST2SMS_API_KEY: 'test-key', FAST2SMS_ROUTE: 'dlt', FAST2SMS_SENDER_ID: 'GOVPAN', FAST2SMS_TEMPLATE_ID: '178401' };

test('Indian mobile numbers are accepted in every shape Supabase may hand over', () => {
  for (const raw of ['9000000301', '919000000301', '+919000000301', '09000000301', '+91 90000-00301', '(+91) 9000000301']) {
    assert.equal(normalizeIndianMobile(raw), '9000000301', raw);
  }
});

test('anything that is not an Indian mobile number is refused', () => {
  for (const raw of ['', '12345', '5000000301', '+14155550123', '91900000030', '9190000003011', 'abcdefghij', '9000000301x', null, undefined, 9000000301, {}]) {
    assert.equal(normalizeIndianMobile(raw), null, String(raw));
  }
});

test('masked numbers keep only the last four digits', () => {
  assert.equal(maskIndianMobile('9000000301'), '+91XXXXXX0301');
});

test('configuration: dlt route needs sender id, template id and the key', () => {
  const ok = readFast2SmsConfig(env(DLT_ENV));
  assert.equal(ok.ok, true);
  assert.equal(ok.config.variables, '{otp}');
  for (const missing of ['FAST2SMS_API_KEY', 'FAST2SMS_SENDER_ID', 'FAST2SMS_TEMPLATE_ID']) {
    const result = readFast2SmsConfig(env({ ...DLT_ENV, [missing]: undefined }));
    assert.equal(result.ok, false, missing);
    assert.ok(result.problems.some((p) => p.includes(missing)), missing);
  }
});

test('configuration: the route must be explicit and valid; the otp route needs no sender or template', () => {
  assert.equal(readFast2SmsConfig(env({ FAST2SMS_API_KEY: 'k' })).ok, false);
  assert.equal(readFast2SmsConfig(env({ FAST2SMS_API_KEY: 'k', FAST2SMS_ROUTE: 'q' })).ok, false);
  assert.equal(readFast2SmsConfig(env({ FAST2SMS_API_KEY: 'k', FAST2SMS_ROUTE: 'OTP' })).ok, true);
  assert.equal(readFast2SmsConfig(env({ ...DLT_ENV, FAST2SMS_TEMPLATE_VARIABLES: 'no placeholder' })).ok, false);
});

test('configuration problems name variables, never their values', () => {
  const result = readFast2SmsConfig(env({ FAST2SMS_API_KEY: 'super-secret-key', FAST2SMS_ROUTE: 'dlt', FAST2SMS_SENDER_ID: '!!' }));
  assert.equal(result.ok, false);
  assert.doesNotMatch(JSON.stringify(result.problems), /super-secret-key/);
});

test('dlt request: documented endpoint, Authorization header and parameters', () => {
  const config = readFast2SmsConfig(env({ ...DLT_ENV, FAST2SMS_TEMPLATE_VARIABLES: 'GovindPansari|{otp}' })).config;
  const req = buildSendRequest(config, '9000000301', '482913', 'corr-1');
  const url = new URL(req.url);
  assert.equal(`${url.origin}${url.pathname}`, 'https://www.fast2sms.com/dev/bulkV2');
  assert.equal(url.searchParams.get('route'), 'dlt');
  assert.equal(url.searchParams.get('sender_id'), 'GOVPAN');
  assert.equal(url.searchParams.get('message'), '178401', 'message is the template id, not text');
  assert.equal(url.searchParams.get('variables_values'), 'GovindPansari|482913');
  assert.equal(url.searchParams.get('numbers'), '9000000301');
  assert.equal(url.searchParams.get('udf1'), 'corr-1');
  assert.equal(req.headers.Authorization, 'test-key', 'the key goes in the header, with no Bearer prefix');
  assert.equal(url.searchParams.has('authorization'), false, 'the key is never put in the URL');
});

test('otp route: numeric code only, no sender or template', () => {
  const config = readFast2SmsConfig(env({ FAST2SMS_API_KEY: 'k', FAST2SMS_ROUTE: 'otp' })).config;
  const url = new URL(buildSendRequest(config, '9000000301', '482913').url);
  assert.equal(url.searchParams.get('route'), 'otp');
  assert.equal(url.searchParams.get('variables_values'), '482913');
  assert.equal(url.searchParams.get('numbers'), '9000000301');
  assert.equal(url.searchParams.has('sender_id'), false);
});

test('a request is never built for an invalid number or code', () => {
  const config = readFast2SmsConfig(env(DLT_ENV)).config;
  assert.throws(() => buildSendRequest(config, '1234567890', '123456'));
  assert.throws(() => buildSendRequest(config, '9000000301', '12ab56'));
  assert.throws(() => buildSendRequest(config, '9000000301', '123|456'), 'a pipe could smuggle an extra template variable');
});

test('provider acceptance is recognised, with its request id', () => {
  assert.deepEqual(classifySendResponse(200, { return: true, request_id: 'abc123', message: ['Message sent successfully'] }), { accepted: true, requestId: 'abc123' });
  assert.deepEqual(classifySendResponse(200, { return: true }), { accepted: true, requestId: null });
});

test('documented provider error codes map to the right failure kind', () => {
  const cases = [
    [416, 'insufficient_balance'],
    [411, 'invalid_number'],
    [405, 'invalid_number'],
    [412, 'auth'],
    [413, 'auth'],
    [414, 'auth'],
    [415, 'account'],
    [996, 'account'],
    [999, 'account'],
    [406, 'template'],
    [425, 'template'],
    [500, 'template'],
    [997, 'route_config'],
    [998, 'route_config'],
    [995, 'rate_limited'],
  ];
  for (const [code, kind] of cases) {
    const outcome = classifySendResponse(400, { return: false, status_code: code, message: 'x' });
    assert.equal(outcome.accepted, false);
    assert.equal(outcome.kind, kind, `code ${code}`);
    assert.equal(outcome.providerCode, code);
  }
});

test('transport-level failures are classified without a provider code', () => {
  assert.equal(classifySendResponse(401, { return: false, status_code: 401, message: 'Invalid Authorization key' }).kind, 'auth');
  assert.equal(classifySendResponse(429, null).kind, 'rate_limited');
  assert.equal(classifySendResponse(502, null).kind, 'unavailable');
  assert.equal(classifySendResponse(503, '<html>').kind, 'unavailable');
});

test('unknown or malformed answers are a rejection, never a success', () => {
  for (const [status, body] of [[200, null], [200, {}], [200, { return: false }], [200, { return: 'true' }], [400, { return: false, status_code: 12345 }], [400, null]]) {
    const outcome = classifySendResponse(status, body);
    assert.equal(outcome.accepted, false, JSON.stringify([status, body]));
  }
  assert.equal(classifySendResponse(200, { return: false, message: ['You do not have sufficient wallet balance'] }).kind, 'insufficient_balance');
});

test('what the customer is told never exposes operational detail', () => {
  for (const kind of ['insufficient_balance', 'auth', 'account', 'template', 'route_config', 'timeout', 'unavailable', 'rejected']) {
    const out = describeFailureForClient(kind);
    assert.equal(out.httpCode, 503, kind);
    assert.doesNotMatch(out.message, /balance|key|auth|template|route|wallet|kyc|fast2sms|dlt/i, kind);
  }
  assert.equal(describeFailureForClient('invalid_number').httpCode, 400);
  assert.equal(describeFailureForClient('rate_limited').httpCode, 429);
});

test('delivery reports: delivered and failed are told apart; correlation by request id or udf1', () => {
  const delivered = parseDeliveryReport({ request_id: 'req1', status: 'Delivered', mobile: '9000000301', udf1: '' });
  assert.deepEqual({ ...delivered }, { requestId: 'req1', correlationId: null, status: 'delivered', providerStatus: 'delivered', reason: null });
  const failed = parseDeliveryReport({ request_id: 'req2', status: 'failed', failure_reason: 'Handset switched off' });
  assert.equal(failed.status, 'undelivered');
  assert.equal(failed.reason, 'Handset switched off');
  assert.equal(parseDeliveryReport({ udf1: '5b0d5d2c-3d8a-4f5e-9b8e-0c3a2f6a1d11', status: 'delivered' }).correlationId, '5b0d5d2c-3d8a-4f5e-9b8e-0c3a2f6a1d11');
  assert.equal(parseDeliveryReport({ request_id: 'r', status: 'submitted' }).status, 'other');
});

test('delivery reports that carry nothing usable are ignored', () => {
  for (const payload of [null, undefined, 'x', 42, {}, { status: 'delivered' }, { request_id: 'r' }, { request_id: '', status: 'delivered' }]) {
    assert.equal(parseDeliveryReport(payload), null, JSON.stringify(payload));
  }
});

test('delivery update: delivered always wins; a late failure never overwrites a delivery', () => {
  const now = '2026-10-27T10:00:00.000Z';
  const delivered = deliveryUpdateFor(parseDeliveryReport({ request_id: 'req 1', status: 'delivered' }), now);
  assert.equal(delivered.query, 'request_id=eq.req%201');
  assert.equal(delivered.body.status, 'delivered');
  assert.equal(delivered.body.delivered_at, now);

  const failed = deliveryUpdateFor(parseDeliveryReport({ request_id: 'req1', status: 'failed' }), now);
  assert.match(failed.query, /&status=neq\.delivered$/);
  assert.equal(failed.body.status, 'undelivered');

  const other = deliveryUpdateFor(parseDeliveryReport({ request_id: 'req1', status: 'submitted' }), now);
  assert.equal('status' in other.body, false, 'an unknown status must not change the row status');
});

test('delivery update by correlation id only accepts a real uuid (no filter injection)', () => {
  const now = '2026-10-27T10:00:00.000Z';
  const ok = deliveryUpdateFor({ requestId: null, correlationId: '5b0d5d2c-3d8a-4f5e-9b8e-0c3a2f6a1d11', status: 'delivered', providerStatus: 'delivered', reason: null }, now);
  assert.equal(ok.query, 'id=eq.5b0d5d2c-3d8a-4f5e-9b8e-0c3a2f6a1d11');
  const evil = deliveryUpdateFor({ requestId: null, correlationId: '1&status=neq.x', status: 'delivered', providerStatus: 'delivered', reason: null }, now);
  assert.equal(evil, null);
});
