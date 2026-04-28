/**
 * @jest-environment jsdom
 */
const fs = require('fs');
const path = require('path');

const SCRIPT_PATH = path.resolve(__dirname, '../../resources/js/frontend/classic-checkout.js');
const scriptSource = fs.readFileSync(SCRIPT_PATH, 'utf-8');

/**
 * Load classic-checkout.js into the current jsdom context and trigger
 * DOMContentLoaded so the event listeners are registered.
 */
function loadScript() {
  const fn = new Function(scriptSource);
  fn();
  // The script registers listeners inside DOMContentLoaded — fire it
  document.dispatchEvent(new Event('DOMContentLoaded'));
}

function setupGlobals(overrides = {}) {
  const defaults = {
    public_key: 'key_public_test',
    nonce: 'test_nonce',
    locale: 'es',
    checkout_url: '/test-checkout',
    checkout_request_url: '/wp-json/conekta/v1/checkout-request',
  };

  global.conekta_settings = { ...defaults, ...overrides };
  global.jQuery = undefined;
  global.ConektaCheckoutComponents = undefined;
  global.CONEKTA_TRANSLATIONS = {
    es: { token_error: 'Error de token', form_error: 'Error', '3ds_error': 'Error 3DS' },
  };
}

function createCheckoutForm() {
  const form = document.createElement('form');
  form.className = 'checkout';

  const radio = document.createElement('input');
  radio.type = 'radio';
  radio.name = 'payment_method';
  radio.value = 'conekta';
  radio.checked = true;
  form.appendChild(radio);

  const tokenInput = document.createElement('input');
  tokenInput.name = 'conekta_token';
  tokenInput.type = 'hidden';
  form.appendChild(tokenInput);

  const msiInput = document.createElement('input');
  msiInput.name = 'conekta_msi_option';
  msiInput.type = 'hidden';
  form.appendChild(msiInput);

  document.body.appendChild(form);
  return form;
}

function triggerNativeUpdatedCheckout() {
  document.body.dispatchEvent(new Event('updated_checkout'));
}

// -------------------------------------------------------
// Tests
// -------------------------------------------------------

describe('classic-checkout.js', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    document.body.innerHTML = '';
    setupGlobals();
  });

  afterEach(() => {
    jest.useRealTimers();
    delete global.conekta_settings;
    delete global.jQuery;
    delete global.ConektaCheckoutComponents;
    delete global.CONEKTA_TRANSLATIONS;
  });

  // -------------------------------------------------------
  // updated_checkout triggers debounced SDK refresh
  // -------------------------------------------------------

  describe('updated_checkout event', () => {
    test('schedules a debounced refresh on native event', () => {
      createCheckoutForm();
      loadScript();

      expect(() => triggerNativeUpdatedCheckout()).not.toThrow();
      // The debounce timer is set — verify it doesn't fire synchronously.
      expect(jest.getTimerCount()).toBeGreaterThan(0);
    });

    test('does not throw when form is missing', () => {
      loadScript();

      expect(() => triggerNativeUpdatedCheckout()).not.toThrow();
    });

    test('multiple calls debounce into one', () => {
      createCheckoutForm();
      loadScript();

      triggerNativeUpdatedCheckout();
      const timerCount = jest.getTimerCount();

      triggerNativeUpdatedCheckout();
      triggerNativeUpdatedCheckout();
      // Each scheduleRefresh call clears the previous timer and sets a new one.
      expect(jest.getTimerCount()).toBe(timerCount);
    });
  });

  // -------------------------------------------------------
  // Settings shape
  // -------------------------------------------------------

  describe('conekta_settings shape', () => {
    test('contains all keys required by the Integration SDK flow', () => {
      createCheckoutForm();
      loadScript();

      expect(conekta_settings.public_key).toBe('key_public_test');
      expect(conekta_settings.locale).toBe('es');
      expect(conekta_settings.checkout_url).toBe('/test-checkout');
      expect(conekta_settings.checkout_request_url).toBe('/wp-json/conekta/v1/checkout-request');
      expect(conekta_settings.nonce).toBe('test_nonce');
    });
  });

  // -------------------------------------------------------
  // CONEKTA_TRANSLATIONS
  // -------------------------------------------------------

  describe('translations', () => {
    test('handles missing CONEKTA_TRANSLATIONS gracefully', () => {
      global.CONEKTA_TRANSLATIONS = undefined;
      createCheckoutForm();
      loadScript();

      expect(() => loadScript()).not.toThrow();
    });
  });

  // -------------------------------------------------------
  // Missing settings resilience
  // -------------------------------------------------------

  describe('resilience', () => {
    test('loads without conekta_settings (globals accessed lazily)', () => {
      delete global.conekta_settings;
      createCheckoutForm();
      expect(() => loadScript()).not.toThrow();
    });
  });
});
