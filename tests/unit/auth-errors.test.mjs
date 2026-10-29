// What the person signing in is told when sending or verifying a code fails.
import test from 'node:test';
import assert from 'node:assert/strict';
import { AuthFlowError, classifyAuthError } from '../../services/authErrors.ts';

const classify = (e) => classifyAuthError(e);

test('wrong or expired codes read as one safe message', () => {
  for (const e of [{ code: 'otp_expired' }, { code: 'invalid_credentials' }, { status: 403 }]) {
    const out = classify(e);
    assert.ok(out instanceof AuthFlowError);
    assert.equal(out.code, 'INVALID_OTP');
    assert.match(out.message, /incorrect or has expired/);
  }
});

test('rate limits are recognised from the code or the 429 status', () => {
  for (const e of [{ code: 'over_sms_send_rate_limit' }, { code: 'over_request_rate_limit' }, { status: 429 }]) {
    assert.equal(classify(e).code, 'RATE_LIMITED');
  }
});

test('SMS delivery failures never show provider detail', () => {
  for (const e of [
    { code: 'sms_send_failed', status: 500, message: 'Error sending SMS OTP: Fast2SMS wallet balance is empty' },
    { code: 'unexpected_failure', status: 500, message: 'Unable to get SMS provider' },
    { code: 'hook_failed', status: 500, message: 'hook returned https://swgwcsfnimodloakamtv.supabase.co/functions/v1/send-sms-hook 503' },
    { code: 'hook_timeout', status: 504, message: 'timed out' },
    { code: 'phone_provider_disabled', status: 422, message: 'Unsupported phone provider' },
  ]) {
    const out = classify(e);
    assert.equal(out.code, 'UNKNOWN');
    assert.match(out.message, /couldn't send the code right now/);
    assert.doesNotMatch(out.message, /fast2sms|balance|hook|provider|https?:|supabase/i);
  }
});

test('an invalid number is reported as such', () => {
  assert.equal(classify({ code: 'validation_failed' }).code, 'INVALID_PHONE');
});

test('offline and DNS failures are told apart from server errors', () => {
  assert.equal(classify({ name: 'AuthRetryableFetchError', message: 'Failed to fetch' }).code, 'NETWORK_ERROR');
  assert.equal(classify({ message: 'Network request failed' }).code, 'NETWORK_ERROR');
});

test('unknown server-side (5xx / no status) text is replaced, not shown', () => {
  for (const e of [{ status: 500, message: 'relation "auth.users" is locked' }, { message: 'ECONNRESET at 10.0.0.1:5432' }, {}, null, undefined, 'boom']) {
    const out = classify(e);
    assert.equal(out.message, 'Something went wrong. Please try again.', JSON.stringify(e));
  }
});

test('short, plainly client-input 4xx messages are still shown (e.g. password rules for staff accounts)', () => {
  assert.equal(classify({ status: 422, message: 'New password should be different from the old password.' }).message, 'New password should be different from the old password.');
});

test('a 4xx message that mentions the SMS machinery, or is very long, is replaced', () => {
  assert.equal(classify({ status: 400, message: 'Error sending SMS via provider' }).message, 'Something went wrong. Please try again.');
  assert.equal(classify({ status: 400, message: 'x'.repeat(300) }).message, 'Something went wrong. Please try again.');
});
