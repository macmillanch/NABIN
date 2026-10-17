// =============================================================================
// SmsGatewayService — NABIN Transactional SMS Dispatcher
//
// This is the single place that sends every OTP, ride-update, and system SMS
// the platform emits. No other file may call an SMS provider directly.
//
// PROVIDER SELECTION (SMS_PROVIDER env var):
//   CONSOLE   — dev / test only: prints to stdout, never sends network traffic.
//               Refused in production as SMS_MOCK_PROVIDER_FORBIDDEN.
//   FAST2SMS  — India DLT registered transactional route (default production).
//   TWILIO    — international fallback / non-India numbers.
//
// FAIL-CLOSED POLICY:
//   In production (NODE_ENV === 'production') dispatch() throws when the gateway
//   cannot really deliver: SMS_GATEWAY_NOT_CONFIGURED when SMS_PROVIDER is missing
//   or a real provider's credentials are absent, and SMS_MOCK_PROVIDER_FORBIDDEN
//   when the declared provider is CONSOLE. Declaring the mock is not configuring a
//   gateway — it only looks like success.
//   This is intentional: a user who enters their phone and receives nothing
//   is told "something went wrong, please retry" — that is correct behaviour
//   when the gateway is down, and an incorrect OTP arriving silently (e.g.
//   still held in memory) is a security failure, not a graceful degradation.
//
// DLT COMPLIANCE (India TRAI):
//   Every FAST2SMS call MUST carry the DLT entity ID and approved template ID.
//   The message text is assembled from the NABIN_DLT_TEMPLATE env var so that
//   Telecom Regulatory Authority of India can match it to an approved template.
//   Deviating from the approved text causes the carrier to silently drop the
//   message; the gateway returns 200 with a delivered status, so the only
//   symptom is a customer who never receives the code.
//
// ADDING A NEW PROVIDER:
//   1. Add a case in _dispatch() below.
//   2. Document its required env vars in the REQUIRED_VARS map.
//   3. Add a row to the sms_gateway_test.js provider matrix.
//
// =============================================================================

'use strict';

const https = require('https');
const { isProduction } = require('./RuntimeMode');

// ---------------------------------------------------------------------------
// Environment helpers
// ---------------------------------------------------------------------------

/** Read an env var. Throws SMS_ENV_MISSING in production if absent. */
function requireEnv(key, context) {
  const val = process.env[key];
  if (!val && isProduction()) {
    const err = new Error(
      `SMS gateway misconfiguration: ${key} is required for provider ${context} in production.`
    );
    err.code = 'SMS_GATEWAY_NOT_CONFIGURED';
    err.status = 503;
    throw err;
  }
  return val || '';
}

// ---------------------------------------------------------------------------
// Message template assembly
// ---------------------------------------------------------------------------

const DEFAULT_TEMPLATE = 'Your NABIN verification code is {otp}. Valid for 5 minutes. Do not share this OTP.';

/**
 * Builds the SMS body from the DLT-approved template.
 * In production the template MUST match the registered text exactly.
 * The only substitution allowed is replacing {otp} with the numeric code.
 *
 * @param {string} otp  The 4-digit OTP code.
 * @returns {string}
 */
function buildMessage(otp) {
  const template = process.env.NABIN_SMS_TEMPLATE || DEFAULT_TEMPLATE;
  return template.replace(/\{otp\}/g, otp);
}

// ---------------------------------------------------------------------------
// Provider implementations
// ---------------------------------------------------------------------------

/**
 * CONSOLE provider — logs to stdout, never sends network traffic.
 * Used in development and automated testing.
 */
async function _dispatchConsole(phone, otp) {
  const msg = buildMessage(otp);
  console.info(`[SmsGateway:CONSOLE] → ${phone}: ${msg}`);
  return { provider: 'CONSOLE', phone, delivered: true, messageId: `CONSOLE-${Date.now()}` };
}

/**
 * FAST2SMS provider — India DLT transactional route.
 * Requires: FAST2SMS_API_KEY, DLT_ENTITY_ID, DLT_TEMPLATE_ID
 * Docs: https://www.fast2sms.com/dev/transactional
 *
 * The DLT fields are mandatory; the carrier silently drops messages that omit them.
 */
async function _dispatchFast2Sms(phone, otp) {
  const apiKey     = requireEnv('FAST2SMS_API_KEY', 'FAST2SMS');
  const entityId   = requireEnv('DLT_ENTITY_ID', 'FAST2SMS');
  const templateId = requireEnv('DLT_TEMPLATE_ID', 'FAST2SMS');

  // Strip the country code prefix for FAST2SMS (it expects 10-digit Indian numbers)
  const bare10 = phone.replace(/^\+91/, '').replace(/\D/g, '');
  if (bare10.length !== 10) {
    const err = new Error(`FAST2SMS requires a 10-digit Indian mobile number; got "${bare10}" from "${phone}".`);
    err.code = 'SMS_INVALID_RECIPIENT';
    err.status = 400;
    throw err;
  }

  const body = JSON.stringify({
    authorization: apiKey,
    sender_id:     process.env.DLT_SENDER_ID || 'NABINM',
    message:       buildMessage(otp),
    variables_values: otp,
    route:         'dlt',
    numbers:       bare10,
    entity_id:     entityId,
    template_id:   templateId,
    flash:         '0'
  });

  const result = await _httpsPost(
    'www.fast2sms.com',
    '/dev/bulkV2',
    { Authorization: apiKey, 'Content-Type': 'application/json' },
    body
  );

  if (!result.return) {
    const err = new Error(`FAST2SMS dispatch failed: ${result.message || JSON.stringify(result)}`);
    err.code = 'SMS_DISPATCH_FAILED';
    err.status = 502;
    throw err;
  }

  return {
    provider: 'FAST2SMS',
    phone: bare10,
    delivered: true,
    messageId: (result.request_id || result.request_ids?.[0] || `FAST2SMS-${Date.now()}`).toString()
  };
}

/**
 * TWILIO provider — international / non-India fallback.
 * Requires: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER
 * Docs: https://www.twilio.com/docs/sms/api/message-resource#create-a-message-resource
 */
async function _dispatchTwilio(phone, otp) {
  const accountSid = requireEnv('TWILIO_ACCOUNT_SID', 'TWILIO');
  const authToken  = requireEnv('TWILIO_AUTH_TOKEN', 'TWILIO');
  const from       = requireEnv('TWILIO_FROM_NUMBER', 'TWILIO');

  const message = buildMessage(otp);

  // Twilio messages endpoint uses Basic-Auth and application/x-www-form-urlencoded
  const bodyParams = new URLSearchParams({ To: phone, From: from, Body: message });
  const bodyStr = bodyParams.toString();

  const basicAuth = Buffer.from(`${accountSid}:${authToken}`).toString('base64');

  const result = await _httpsPost(
    'api.twilio.com',
    `/2010-04-01/Accounts/${accountSid}/Messages.json`,
    {
      Authorization: `Basic ${basicAuth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(bodyStr).toString()
    },
    bodyStr
  );

  if (result.status === 'failed' || result.error_code) {
    const err = new Error(
      `Twilio dispatch failed (${result.error_code}): ${result.error_message || result.status}`
    );
    err.code = 'SMS_DISPATCH_FAILED';
    err.status = 502;
    throw err;
  }

  return {
    provider: 'TWILIO',
    phone,
    delivered: true,
    messageId: result.sid || `TWILIO-${Date.now()}`
  };
}

// ---------------------------------------------------------------------------
// Low-level HTTPS helper (avoids adding an npm dependency)
// ---------------------------------------------------------------------------

function _httpsPost(hostname, path, headers, body) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname,
      path,
      method: 'POST',
      headers: {
        ...headers,
        'Content-Length': headers['Content-Length'] || Buffer.byteLength(body).toString()
      }
    };

    const req = https.request(options, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        try {
          resolve(JSON.parse(raw));
        } catch {
          // Some providers return plain text on error
          resolve({ raw, return: false, message: raw });
        }
      });
    });

    req.on('error', (err) => {
      const wrapped = new Error(`SMS HTTP request failed (${hostname}): ${err.message}`);
      wrapped.code = 'SMS_NETWORK_ERROR';
      wrapped.status = 503;
      reject(wrapped);
    });

    req.setTimeout(10000, () => {
      req.destroy();
      const err = new Error(`SMS HTTP request timed out after 10 s (${hostname}).`);
      err.code = 'SMS_NETWORK_TIMEOUT';
      err.status = 503;
      reject(err);
    });

    req.write(body);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Returns the active SMS_PROVIDER resolved from env.
 * Defaults to CONSOLE outside production.
 * Production throws SMS_GATEWAY_NOT_CONFIGURED if the provider is missing, and
 * SMS_MOCK_PROVIDER_FORBIDDEN if it is the CONSOLE mock.
 */
function resolveProvider() {
  const declared = (process.env.SMS_PROVIDER || '').toUpperCase().trim();

  if (declared && !['CONSOLE', 'FAST2SMS', 'TWILIO'].includes(declared)) {
    const err = new Error(
      `SMS_PROVIDER "${declared}" is not a recognised provider. ` +
      'Valid values: CONSOLE, FAST2SMS, TWILIO.'
    );
    err.code = 'SMS_PROVIDER_UNKNOWN';
    err.status = 500;
    throw err;
  }

  if (declared === 'CONSOLE' && isProduction()) {
    const err = new Error(
      'SMS_PROVIDER=CONSOLE prints the code and sends nothing, so it is refused in production. ' +
      'Set SMS_PROVIDER=FAST2SMS (India DLT) or TWILIO (international) in the production environment.'
    );
    err.code = 'SMS_MOCK_PROVIDER_FORBIDDEN';
    err.status = 503;
    throw err;
  }

  if (!declared && isProduction()) {
    const err = new Error(
      'SMS_PROVIDER is not configured. ' +
      'Set SMS_PROVIDER=FAST2SMS (India DLT) or TWILIO (international) in the production environment.'
    );
    err.code = 'SMS_GATEWAY_NOT_CONFIGURED';
    err.status = 503;
    throw err;
  }

  // Default to CONSOLE in dev/test so no network traffic is sent
  return declared || 'CONSOLE';
}

/**
 * Dispatch an OTP SMS to the given phone number.
 *
 * @param {string} phone  E.164 phone number (e.g. "+919876543210")
 * @param {string} otp    4-digit numeric OTP code
 * @returns {Promise<{provider: string, phone: string, delivered: boolean, messageId: string}>}
 */
async function dispatch(phone, otp) {
  if (!phone || !otp) {
    const err = new Error('SmsGatewayService.dispatch requires phone and otp.');
    err.code = 'SMS_INVALID_ARGUMENTS';
    err.status = 500;
    throw err;
  }

  const provider = resolveProvider();

  switch (provider) {
    case 'FAST2SMS':
      return _dispatchFast2Sms(phone, otp);
    case 'TWILIO':
      return _dispatchTwilio(phone, otp);
    case 'CONSOLE':
    default:
      return _dispatchConsole(phone, otp);
  }
}

/**
 * Returns a brief configuration report suitable for health-check endpoints.
 * Does NOT reveal any credential values.
 */
function gatewayStatus() {
  try {
    const provider = resolveProvider();
    const configured = {
      CONSOLE:  true,
      FAST2SMS: !!(process.env.FAST2SMS_API_KEY && process.env.DLT_ENTITY_ID && process.env.DLT_TEMPLATE_ID),
      TWILIO:   !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM_NUMBER)
    };
    return {
      provider,
      ready: configured[provider] ?? false,
      dltCompliant: provider === 'FAST2SMS'
        ? !!(process.env.DLT_ENTITY_ID && process.env.DLT_TEMPLATE_ID && process.env.DLT_SENDER_ID)
        : null
    };
  } catch (err) {
    return { provider: null, ready: false, error: err.code || err.message };
  }
}

module.exports = { dispatch, resolveProvider, gatewayStatus, buildMessage };
