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
    three_ds_enabled: 'yes',
    three_ds_mode: 'smart',
    nonce: 'test_nonce',
    amount: 150000,
    currency: 'MXN',
    cart_items: [{ id: 10, name: 'Producto', quantity: 2, total: 150000 }],
    discount_lines: [{ code: 'dynamic_pricing', amount: 20000, type: 'campaign' }],
    locale: 'es',
    create_3ds_order_url: '/test-3ds',
    checkout_url: '/test-checkout',
    rest_url: '/wp-json/conekta/v1/',
    enable_msi: 'no',
    available_msi_options: [],
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

function createFragmentElement(data) {
  const script = document.createElement('script');
  script.id = 'conekta-cart-data';
  script.type = 'application/json';
  script.textContent = typeof data === 'string' ? data : JSON.stringify(data);
  document.body.appendChild(script);
  return script;
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
  // Fragment sync: updated_checkout reads #conekta-cart-data
  // -------------------------------------------------------

  describe('updated_checkout fragment sync', () => {
    test('updates conekta_settings from fragment element', () => {
      createCheckoutForm();
      loadScript();

      createFragmentElement({
        amount: 80000,
        cart_items: [{ id: 20, quantity: 1, total: 80000 }],
        discount_lines: [{ code: 'CUPON', amount: 5000, type: 'coupon' }],
      });

      document.body.dispatchEvent(new Event('updated_checkout'));

      expect(conekta_settings.amount).toBe(80000);
      expect(conekta_settings.cart_items[0].id).toBe(20);
      expect(conekta_settings.discount_lines[0].code).toBe('CUPON');
    });

    test('does not crash when fragment element is missing', () => {
      createCheckoutForm();
      loadScript();

      expect(() => {
        document.body.dispatchEvent(new Event('updated_checkout'));
      }).not.toThrow();

      expect(conekta_settings.amount).toBe(150000);
    });

    test('does not crash on invalid JSON in fragment', () => {
      createCheckoutForm();
      loadScript();

      createFragmentElement('{broken json');

      expect(() => {
        document.body.dispatchEvent(new Event('updated_checkout'));
      }).not.toThrow();

      expect(conekta_settings.amount).toBe(150000);
    });

    test('partial fragment only updates present fields', () => {
      createCheckoutForm();
      loadScript();

      const originalItems = conekta_settings.cart_items;
      const originalDiscounts = conekta_settings.discount_lines;

      createFragmentElement({ amount: 99000 });

      document.body.dispatchEvent(new Event('updated_checkout'));

      expect(conekta_settings.amount).toBe(99000);
      expect(conekta_settings.cart_items).toBe(originalItems);
      expect(conekta_settings.discount_lines).toBe(originalDiscounts);
    });

    test('multiple fragment updates keep latest values', () => {
      createCheckoutForm();
      loadScript();

      createFragmentElement({ amount: 50000 });
      document.body.dispatchEvent(new Event('updated_checkout'));
      expect(conekta_settings.amount).toBe(50000);

      // Update fragment content
      document.getElementById('conekta-cart-data').textContent = JSON.stringify({ amount: 30000 });
      document.body.dispatchEvent(new Event('updated_checkout'));
      expect(conekta_settings.amount).toBe(30000);
    });
  });

  // -------------------------------------------------------
  // 3DS enabled detection
  // -------------------------------------------------------

  describe('3DS enabled detection', () => {
    test.each([
      [true],
      ['yes'],
      ['1'],
      [false],
      ['no'],
      [null],
      [undefined],
    ])('three_ds_enabled=%p loads without error', (value) => {
      setupGlobals({ three_ds_enabled: value });
      createCheckoutForm();
      expect(() => loadScript()).not.toThrow();
    });
  });

  // -------------------------------------------------------
  // CONEKTA_TRANSLATIONS
  // -------------------------------------------------------

  describe('translations', () => {
    test('adds 3ds_error translation if missing', () => {
      global.CONEKTA_TRANSLATIONS = { es: { token_error: 'Error' } };
      createCheckoutForm();
      loadScript();

      expect(global.CONEKTA_TRANSLATIONS.es['3ds_error']).toBe('Autenticación 3D Secure fallida');
    });

    test('does not overwrite existing 3ds_error translation', () => {
      global.CONEKTA_TRANSLATIONS = { es: { '3ds_error': 'Custom error' } };
      createCheckoutForm();
      loadScript();

      expect(global.CONEKTA_TRANSLATIONS.es['3ds_error']).toBe('Custom error');
    });

    test('handles missing CONEKTA_TRANSLATIONS gracefully', () => {
      global.CONEKTA_TRANSLATIONS = undefined;
      createCheckoutForm();

      expect(() => loadScript()).not.toThrow();
    });
  });

  // -------------------------------------------------------
  // Settings shape: discount_lines present in conekta_settings
  // -------------------------------------------------------

  describe('discount_lines in settings', () => {
    test('conekta_settings.discount_lines is available for 3DS requests', () => {
      createCheckoutForm();
      loadScript();

      expect(conekta_settings.discount_lines).toBeDefined();
      expect(conekta_settings.discount_lines).toHaveLength(1);
      expect(conekta_settings.discount_lines[0]).toEqual({
        code: 'dynamic_pricing',
        amount: 20000,
        type: 'campaign',
      });
    });

    test('discount_lines updated after fragment sync', () => {
      createCheckoutForm();
      loadScript();

      createFragmentElement({
        amount: 80000,
        discount_lines: [
          { code: 'CUPON50', amount: 5000, type: 'coupon' },
          { code: 'dynamic_pricing', amount: 10000, type: 'campaign' },
        ],
      });

      document.body.dispatchEvent(new Event('updated_checkout'));

      expect(conekta_settings.discount_lines).toHaveLength(2);
      expect(conekta_settings.discount_lines[0].code).toBe('CUPON50');
      expect(conekta_settings.discount_lines[1].code).toBe('dynamic_pricing');
    });
  });
});
