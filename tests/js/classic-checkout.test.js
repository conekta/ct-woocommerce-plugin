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
    confirm_url: '/test-confirm',
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
  // Order-first flow (regression: paid-but-no-order)
  //
  // The structural guarantee: the wc-ajax=checkout POST (which creates the
  // WC order) happens BEFORE the SDK charge, and the charge only fires when
  // the server answered success + conekta_pending_payment. If someone
  // reorders this back to charge-first, these tests fail.
  // -------------------------------------------------------

  describe('order-first flow', () => {
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

    // jsdom only implements hash navigation, so redirects in these tests use
    // fragment URLs ('http://localhost/#gracias') — assigning them to
    // window.location.href works and is observable, while a full navigation
    // would throw "Not implemented".
    afterEach(() => {
      delete global.fetch;
    });

    /**
     * Boots the script against a mocked fetch + SDK and returns the wired
     * pieces. `responses.checkout` / `responses.confirm` control what the
     * server answers; every request is recorded in `calls`.
     */
    async function bootFlow(responses) {
      const $ = makeJQueryShim();
      global.jQuery = $;

      const calls = [];
      global.fetch = jest.fn((url, opts) => {
        if (url === conekta_settings.checkout_url) {
          calls.push({ url, body: opts.body });
          return Promise.resolve({ ok: true, json: () => Promise.resolve(responses.checkout) });
        }
        if (url === conekta_settings.confirm_url) {
          calls.push({ url, body: JSON.parse(opts.body) });
          return Promise.resolve({ ok: true, json: () => Promise.resolve(responses.confirm || {}) });
        }
        calls.push({ url, body: JSON.parse(opts.body) });
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            success: true,
            conekta_order_id: 'ord_mounted_1',
            checkout_request_id: 'cr_1',
            mode: 'create',
          }),
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
      // Stale module instances from earlier tests in this file also mount
      // their own script tags when DOMContentLoaded re-fires — ours is the
      // LAST one appended (our instance's listener registers last), so wire
      // that one to bind the callbacks to the live instance's OrderEmitter.
      let sdkCallbacks = null;
      global.ConektaCheckoutComponents = {
        Integration: ({ callbacks }) => { sdkCallbacks = callbacks; },
      };
      const sdkScripts = document.querySelectorAll('script[src*="conekta-checkout.min.js"]');
      expect(sdkScripts.length).toBeGreaterThan(0);
      sdkScripts[sdkScripts.length - 1].onload();
      expect(sdkCallbacks).not.toBeNull();

      const chargeSpy = jest.fn();
      sdkCallbacks.onUpdateSubmitTrigger(chargeSpy);

      return { $, form, calls, chargeSpy, sdkCallbacks };
    }

    // NOTE on counting: loadScript() re-evaluates the module per test but the
    // shared `document` keeps DOMContentLoaded listeners from earlier tests
    // in this file, so stale instances may also react to a trigger. All
    // checkout-count assertions are therefore DELTAS against a baseline, and
    // body assertions read the LAST captured POST (ours).
    const checkoutCalls = (calls) => calls.filter((c) => c.url === conekta_settings.checkout_url);
    const confirmCalls  = (calls) => calls.filter((c) => c.url === conekta_settings.confirm_url);
    const last = (arr) => arr[arr.length - 1];

    test('full happy path: checkout creates the order BEFORE charging → charge → confirm → redirect', async () => {
      const flow = await bootFlow({
        checkout: {
          result: 'success',
          conekta_pending_payment: true,
          order_id: 123,
          order_key: 'wc_order_key_abc',
        },
        confirm: { success: true, redirect: 'http://localhost/#gracias' },
      });

      // Customer clicks "Realizar el pedido" → the wc-ajax=checkout POST
      // fires FIRST; no charge until the server confirms the order exists.
      const baseline = checkoutCalls(flow.calls).length;
      flow.$('form.checkout').trigger('checkout_place_order_conekta');
      expect(flow.chargeSpy).not.toHaveBeenCalled();
      await flush();

      const wcPosts = checkoutCalls(flow.calls);
      expect(wcPosts.length).toBeGreaterThan(baseline);
      const post = last(wcPosts);
      expect(post.body).toBeInstanceOf(FormData);
      expect(post.body.get('wc-ajax')).toBe('checkout');
      // Card path posts the MOUNTED (unpaid) Conekta order id as a fallback
      // for the server-side session state (guest-creates-account case). The
      // server branches on the order's real paid status, so an unpaid id
      // still routes to the order-first path — no charge has happened yet.
      expect(post.body.get('conekta_order_id')).toBe('ord_mounted_1');

      // Server said success + pending payment → NOW the charge fires (exactly
      // once: only the live instance holds the SDK submit trigger).
      expect(flow.chargeSpy).toHaveBeenCalledTimes(1);

      flow.sdkCallbacks.onFinalizePayment({ id: 'ord_test_123' });
      await flush();

      const confirmed = confirmCalls(flow.calls);
      expect(confirmed).toHaveLength(1);
      expect(confirmed[0].body.order_id).toBe(123);
      expect(confirmed[0].body.order_key).toBe('wc_order_key_abc');
      expect(confirmed[0].body.conekta_order_id).toBe('ord_test_123');
      expect(window.location.href).toBe('http://localhost/#gracias');
    });

    test('WC validation failure means the card is NEVER charged', async () => {
      const flow = await bootFlow({
        checkout: {
          result: 'failure',
          messages: '<div class="woocommerce-error">Falta la dirección</div>',
        },
      });

      const baseline = checkoutCalls(flow.calls).length;
      flow.$('form.checkout').trigger('checkout_place_order_conekta');
      await flush();

      const afterFirst = checkoutCalls(flow.calls).length;
      expect(afterFirst).toBeGreaterThan(baseline);
      expect(flow.chargeSpy).not.toHaveBeenCalled();
      expect(document.querySelector('.woocommerce-error')).not.toBeNull();

      // The customer can fix the form and retry — a new checkout POST fires.
      flow.$('form.checkout').trigger('checkout_place_order_conekta');
      await flush();
      expect(checkoutCalls(flow.calls).length).toBeGreaterThan(afterFirst);
      expect(flow.chargeSpy).not.toHaveBeenCalled();
    });

    test('wallet charge (no place-order click) still posts the legacy checkout with conekta_order_id', async () => {
      const flow = await bootFlow({
        checkout: { result: 'success', redirect: 'http://localhost/#gracias-wallet' },
      });

      // No place-order click: the wallet button inside the iframe charged
      // directly, so onFinalizePayment arrives with payingInProgress=false.
      const baseline = checkoutCalls(flow.calls).length;
      flow.sdkCallbacks.onFinalizePayment({ id: 'ord_wallet_1' });
      await flush();

      const wcPosts = checkoutCalls(flow.calls);
      expect(wcPosts.length).toBeGreaterThan(baseline);
      const post = last(wcPosts);
      expect(post.body.get('conekta_order_id')).toBe('ord_wallet_1');
      expect(post.body.get('wc-ajax')).toBe('checkout');
      expect(window.location.href).toBe('http://localhost/#gracias-wallet');
      expect(flow.chargeSpy).not.toHaveBeenCalled();
    });

    test('confirm failure keeps the customer on the page with an error (order stays pending server-side)', async () => {
      const flow = await bootFlow({
        checkout: {
          result: 'success',
          conekta_pending_payment: true,
          order_id: 55,
          order_key: 'wc_key_55',
        },
        confirm: { success: false, message: 'Conekta order is not paid (status: pending_payment)' },
      });

      const hrefBefore = window.location.href;
      flow.$('form.checkout').trigger('checkout_place_order_conekta');
      await flush();
      flow.sdkCallbacks.onFinalizePayment({ id: 'ord_fail_1' });
      await flush();

      expect(confirmCalls(flow.calls)).toHaveLength(1);
      // No navigation happened.
      expect(window.location.href).toBe(hrefBefore);
      expect(document.querySelector('.woocommerce-error')).not.toBeNull();
    });
  });
});
