/**
 * @jest-environment jsdom
 */
const path = require('path');

const SCRIPT_PATH = path.resolve(__dirname, '../../resources/js/frontend/classic-checkout.js');

/**
 * Load classic-checkout.js (and its ES module deps) into the current jsdom
 * context and trigger DOMContentLoaded so the event listeners are registered.
 * isolateModules forces re-evaluation per call so listeners and emitter state
 * don't leak between tests.
 */
function loadScript() {
  jest.isolateModules(() => {
    require(SCRIPT_PATH);
  });
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

  // -------------------------------------------------------
  // Validated-snapshot guarantee (regression: paid-but-no-order)
  //
  // Reproduces the production bug: a third-party plugin mutates a required
  // field during the SDK charge window (between validation and the final
  // wc-ajax=checkout submit). The fix snapshots the form at validation time
  // and submits THAT, so the wiped field must NOT reach WooCommerce empty.
  // If someone reverts to re-reading the form in onOrder, this test fails.
  // -------------------------------------------------------

  describe('validated form snapshot', () => {
    // jsdom doesn't implement scrollIntoView (used by notice rendering).
    beforeAll(() => {
      window.HTMLElement.prototype.scrollIntoView = function () {};
    });

    // Minimal jQuery shim: submitInterceptor binds the place-order event via
    // $(form).on(...); the test fires it via $(form).trigger(...). Handlers are
    // keyed by element in a shared registry so attach + trigger line up.
    function makeJQueryShim() {
      const reg = new WeakMap();
      return (target) => {
        const el = typeof target === 'string' ? document.querySelector(target) : target;
        return {
          on(event, a, b) {
            const fn = typeof a === 'function' ? a : b;
            if (!el) return this;
            if (!reg.has(el)) reg.set(el, {});
            const m = reg.get(el);
            (m[event] = m[event] || []).push(fn);
            return this;
          },
          trigger(event) {
            if (!el) return this;
            const m = reg.get(el) || {};
            (m[event] || []).forEach((fn) => fn.call(el, { type: event }));
            return this;
          },
        };
      };
    }

    function buildClassicForm() {
      const form = document.createElement('form');
      form.className = 'checkout';

      const radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = 'payment_method';
      radio.value = 'conekta';
      radio.checked = true;
      form.appendChild(radio);

      const email = document.createElement('input');
      email.type = 'email';
      email.id = 'billing_email';
      email.name = 'billing_email';
      email.value = 'cliente@example.com';
      form.appendChild(email);

      const address = document.createElement('input');
      address.type = 'text';
      address.name = 'billing_address_1';
      address.value = 'Calle Real 123';
      form.appendChild(address);

      const hidden = document.createElement('input');
      hidden.type = 'hidden';
      hidden.name = 'conekta_order_id';
      form.appendChild(hidden);

      const container = document.createElement('div');
      container.id = 'conektaITokenizerframeContainer';
      form.appendChild(container);

      document.body.appendChild(form);
      return form;
    }

    const flush = async () => {
      for (let i = 0; i < 8; i++) {
        // eslint-disable-next-line no-await-in-loop
        await Promise.resolve();
      }
    };

    test('submits the value validated pre-charge, not the field mutated mid-charge', async () => {
      const $ = makeJQueryShim();
      global.jQuery = $;

      // fetch: requestCheckout -> validation -> final checkout submit.
      let capturedCheckoutBody = null;
      global.fetch = jest.fn((url, opts) => {
        if (url === conekta_settings.checkout_url) {
          // Final wc-ajax=checkout submit: capture the posted FormData.
          capturedCheckoutBody = opts.body;
          return Promise.resolve({ ok: true, json: () => Promise.resolve({ result: 'failure' }) });
        }
        const body = JSON.parse(opts.body);
        if (body.validate) {
          return Promise.resolve({ ok: true, json: () => Promise.resolve({ errors: [] }) });
        }
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ success: true, checkout_request_id: 'cr_1', mode: 'create' }),
        });
      });

      const form = buildClassicForm();
      loadScript();

      // DOMContentLoaded sets a 100ms poll that attaches the interceptor and
      // runs the first refresh (creates the Conekta order, mounts the SDK).
      await jest.advanceTimersByTimeAsync(150);
      await flush();

      // Wire the SDK: fire the injected <script>'s onload with a mocked
      // ConektaCheckoutComponents so loadConektaScript captures the callbacks.
      let sdkCallbacks = null;
      global.ConektaCheckoutComponents = {
        Integration: ({ callbacks }) => { sdkCallbacks = callbacks; },
      };
      const sdkScript = document.querySelector('script[src*="conekta-checkout.min.js"]');
      expect(sdkScript).not.toBeNull();
      sdkScript.onload();
      expect(sdkCallbacks).not.toBeNull();

      // The SDK hands us the submit trigger (fires the charge). Stub it.
      const chargeSpy = jest.fn();
      sdkCallbacks.onUpdateSubmitTrigger(chargeSpy);

      // Customer clicks "Realizar el pedido" → validation runs, snapshot is
      // taken, charge is triggered.
      $('form.checkout').trigger('checkout_place_order_conekta');
      await flush();
      expect(chargeSpy).toHaveBeenCalled(); // validation passed, charge started

      // PLUGIN MUTATION during the charge window: wipe the required field.
      form.querySelector('[name="billing_address_1"]').value = '';

      // SDK finishes the charge → onOrder posts the WC checkout.
      sdkCallbacks.onFinalizePayment({ id: 'ord_test_123' });
      await flush();

      // The submit must carry the VALIDATED value, not the wiped field.
      expect(capturedCheckoutBody).toBeInstanceOf(FormData);
      expect(capturedCheckoutBody.get('billing_address_1')).toBe('Calle Real 123');
      expect(capturedCheckoutBody.get('conekta_order_id')).toBe('ord_test_123');
      expect(capturedCheckoutBody.get('wc-ajax')).toBe('checkout');
    });

    afterEach(() => {
      delete global.fetch;
    });
  });
});
