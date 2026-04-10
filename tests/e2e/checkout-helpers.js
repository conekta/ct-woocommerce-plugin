/**
 * Shared helpers for E2E checkout tests (classic + blocks).
 */
const { chromium } = require('playwright');
const config = require('./e2e.config');

const STORE_URL = process.env.STORE_URL || 'http://localhost';
const CONEKTA_API_KEY = process.env.CONEKTA_API_KEY;
const WP_USER = process.env.WP_USER || 'user';
const WP_PASS = process.env.WP_PASS || 'bitnami';

const REGULAR_PRICE = (Math.random() * 900 + 100).toFixed(2);
const DISCOUNT_AMOUNT = (parseFloat(REGULAR_PRICE) / 2).toFixed(2);
const COUPON_AMOUNT = '50';
const TEST_CARD = {
  number: '5200000000001096',
  name: 'Test User',
  expMonth: String(Math.floor(Math.random() * 12) + 1).padStart(2, '0'),
  expYear: String((new Date().getFullYear() + 2) % 100).padStart(2, '0'),
  cvc: String(Math.floor(Math.random() * 900) + 100),
};
const BILLING = {
  first_name: 'Test',
  last_name: 'User',
  address_1: 'Calle Test 123',
  city: 'CDMX',
  state: 'DF',
  postcode: '11010',
  phone: '5555555555',
  email: 'test-e2e@example.com',
};

// -------------------------------------------------------
// Test runner state
// -------------------------------------------------------

let browser, page, productId, couponId, couponCode;
const counters = { passed: 0, failed: 0 };

const STATUS = { true: '\x1b[32m✓\x1b[0m', false: '\x1b[31m✗\x1b[0m' };
const COUNTER = { true: 'passed', false: 'failed' };

function assert(condition, label) {
  const key = Boolean(condition);
  console.log(`  ${STATUS[key]} ${label}`);
  counters[COUNTER[key]]++;
}

function getPage() { return page; }
function getCounters() { return counters; }

// -------------------------------------------------------
// WC REST API
// -------------------------------------------------------

async function wcApi(method, endpoint, body) {
  const currentUrl = page.url();
  const isAdmin = currentUrl.includes('/wp-admin');
  await (isAdmin ? Promise.resolve() : page.goto(`${STORE_URL}/wp-admin/`).then(() => page.waitForLoadState('networkidle')));

  return page.evaluate(async ({ baseUrl, method, endpoint, body }) => {
    const nonce = await (await fetch('/wp-admin/admin-ajax.php?action=rest-nonce')).text();
    const opts = { method, headers: { 'X-WP-Nonce': nonce, 'Content-Type': 'application/json' } };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(`${baseUrl}/wp-json/${endpoint}`, opts);
    return res.json();
  }, { baseUrl: STORE_URL, method, endpoint, body });
}

// -------------------------------------------------------
// Checkout page switcher
// -------------------------------------------------------

const CHECKOUT_CONTENT = {
  classic: '[woocommerce_checkout]',
  blocks: '<!-- wp:woocommerce/checkout {"align":"wide"} -->\n<div data-block-name="woocommerce/checkout" class="wp-block-woocommerce-checkout alignwide wc-block-checkout is-loading">\n<!-- wp:woocommerce/checkout-fields-block -->\n<div data-block-name="woocommerce/checkout-fields-block" class="wp-block-woocommerce-checkout-fields-block">\n<!-- wp:woocommerce/checkout-express-payment-block --><div data-block-name="woocommerce/checkout-express-payment-block" class="wp-block-woocommerce-checkout-express-payment-block"></div><!-- /wp:woocommerce/checkout-express-payment-block -->\n<!-- wp:woocommerce/checkout-contact-information-block --><div data-block-name="woocommerce/checkout-contact-information-block" class="wp-block-woocommerce-checkout-contact-information-block"></div><!-- /wp:woocommerce/checkout-contact-information-block -->\n<!-- wp:woocommerce/checkout-shipping-address-block --><div data-block-name="woocommerce/checkout-shipping-address-block" class="wp-block-woocommerce-checkout-shipping-address-block"></div><!-- /wp:woocommerce/checkout-shipping-address-block -->\n<!-- wp:woocommerce/checkout-billing-address-block --><div data-block-name="woocommerce/checkout-billing-address-block" class="wp-block-woocommerce-checkout-billing-address-block"></div><!-- /wp:woocommerce/checkout-billing-address-block -->\n<!-- wp:woocommerce/checkout-shipping-methods-block --><div data-block-name="woocommerce/checkout-shipping-methods-block" class="wp-block-woocommerce-checkout-shipping-methods-block"></div><!-- /wp:woocommerce/checkout-shipping-methods-block -->\n<!-- wp:woocommerce/checkout-payment-block --><div data-block-name="woocommerce/checkout-payment-block" class="wp-block-woocommerce-checkout-payment-block"></div><!-- /wp:woocommerce/checkout-payment-block -->\n<!-- wp:woocommerce/checkout-order-note-block --><div data-block-name="woocommerce/checkout-order-note-block" class="wp-block-woocommerce-checkout-order-note-block"></div><!-- /wp:woocommerce/checkout-order-note-block -->\n<!-- wp:woocommerce/checkout-actions-block --><div data-block-name="woocommerce/checkout-actions-block" class="wp-block-woocommerce-checkout-actions-block"></div><!-- /wp:woocommerce/checkout-actions-block -->\n</div>\n<!-- /wp:woocommerce/checkout-fields-block -->\n<!-- wp:woocommerce/checkout-totals-block -->\n<div data-block-name="woocommerce/checkout-totals-block" class="wp-block-woocommerce-checkout-totals-block">\n<!-- wp:woocommerce/checkout-order-summary-block --><div data-block-name="woocommerce/checkout-order-summary-block" class="wp-block-woocommerce-checkout-order-summary-block"></div><!-- /wp:woocommerce/checkout-order-summary-block -->\n</div>\n<!-- /wp:woocommerce/checkout-totals-block -->\n</div>\n<!-- /wp:woocommerce/checkout -->',
};

async function setCheckoutType(type) {
  const settings = await wcApi('GET', 'wc/v3/settings/advanced/woocommerce_checkout_page_id');
  await wcApi('PUT', `wp/v2/pages/${settings.value}`, { content: CHECKOUT_CONTENT[type] });
}

// -------------------------------------------------------
// Setup & Teardown
// -------------------------------------------------------

async function setup() {
  browser = await chromium.launch({ headless: config.headless });
  const context = await browser.newContext({ recordVideo: config.video });
  page = await context.newPage();

  console.log('Setup: Login...');
  await page.goto(`${STORE_URL}/wp-login.php`);
  await page.fill('#user_login', WP_USER);
  await page.fill('#user_pass', WP_PASS);
  await page.click('#wp-submit');
  await page.waitForLoadState('networkidle');

  await page.goto(`${STORE_URL}/wp-admin/`);
  await page.waitForLoadState('networkidle');

  console.log(`Setup: regular_price=$${REGULAR_PRICE}, discount=$${DISCOUNT_AMOUNT}`);

  const product = await wcApi('POST', 'wc/v3/products', {
    name: 'E2E Discount Test',
    type: 'simple',
    regular_price: REGULAR_PRICE,
    sale_price: DISCOUNT_AMOUNT,
    status: 'publish',
  });
  productId = product.id;
  console.log(`Setup: Product created (ID: ${productId})${product.id ? '' : ' ERROR: ' + JSON.stringify(product).substring(0, 200)}`);

  couponCode = 'e2e_' + Date.now();
  const coupon = await wcApi('POST', 'wc/v3/coupons', {
    code: couponCode,
    discount_type: 'fixed_product',
    amount: COUPON_AMOUNT,
    product_ids: [productId],
  });
  couponId = coupon.id;
  console.log(`Setup: Coupon created (${couponCode})`);

  await page.goto(`${STORE_URL}/?add-to-cart=${productId}`);
  await page.waitForLoadState('networkidle');

  await page.goto(`${STORE_URL}/cart/`);
  await page.waitForLoadState('networkidle');
  const couponApplied = await page.evaluate(async ({ code }) => {
    // Try multiple nonce sources
    const cartRes = await fetch('/wp-json/wc/store/v1/cart', { credentials: 'same-origin' });
    const nonce = cartRes.headers.get('Nonce')
      || cartRes.headers.get('X-WC-Store-API-Nonce')
      || (typeof wcBlocksMiddlewareConfig !== 'undefined' ? wcBlocksMiddlewareConfig.storeApiNonce : '')
      || '';

    const res = await fetch('/wp-json/wc/store/v1/cart/apply-coupon', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Nonce': nonce },
      credentials: 'same-origin',
      body: JSON.stringify({ code }),
    });
    const data = await res.json();
    return { status: res.status, coupons: data.coupons?.length || 0 };
  }, { code: couponCode });
  console.log(`Setup: Coupon apply status=${couponApplied.status} coupons=${couponApplied.coupons}`);
}

async function teardown() {
  console.log('\nTeardown...');
  try { await wcApi('DELETE', `wc/v3/coupons/${couponId}?force=true`); console.log(`  Deleted coupon ${couponCode}`); } catch (_) {}
  try { await wcApi('DELETE', `wc/v3/products/${productId}?force=true`); console.log(`  Deleted product ${productId}`); } catch (_) {}
  try { await browser.close(); } catch (_) {}
}

// -------------------------------------------------------
// Shared test: verify order status + Conekta API
// -------------------------------------------------------

async function testOrderStatus() {
  console.log('\n--- Order status ---');
  const currentUrl = page.url();
  assert(currentUrl.includes('order-received'), 'redirected to order-received page');

  const orderIdMatch = currentUrl.match(/order-received\/(\d+)/);
  assert(orderIdMatch !== null, 'order ID in URL');
  const wcOrderId = orderIdMatch[1];

  const order = await wcApi('GET', `wc/v3/orders/${wcOrderId}`);
  const statusOk = ['processing', 'completed', 'on-hold'].includes(order.status);
  assert(statusOk, `WC order status = ${order.status}`);

  const conektaMeta = order.meta_data.find(m => m.key === 'conekta-order-id');
  assert(conektaMeta !== undefined, `conekta-order-id meta = ${conektaMeta?.value}`);

  console.log('\n--- Conekta order verification ---');
  const conektaOrder = await page.evaluate(async ({ url, key }) => {
    const res = await fetch(url, {
      headers: { 'Authorization': 'Bearer ' + key, 'Accept': 'application/vnd.conekta-v2.2.0+json' },
    });
    return res.json();
  }, { url: `https://api.conekta.io/orders/${conektaMeta.value}`, key: CONEKTA_API_KEY });

  const conektaDiscounts = conektaOrder.discount_lines?.data || [];
  assert(conektaDiscounts.length > 0, `Conekta discount_lines count = ${conektaDiscounts.length}`);
  const conektaDynamic = conektaDiscounts.find(d => d.code === 'dynamic_pricing');
  assert(conektaDynamic !== undefined, 'Conekta has dynamic_pricing entry');
  assert(conektaDynamic.type === 'campaign', `Conekta dynamic_pricing type = ${conektaDynamic.type}`);
  assert(conektaDynamic.amount > 0, `Conekta dynamic_pricing amount = ${conektaDynamic.amount}`);
}

// -------------------------------------------------------
// Shared test: 3DS flow (same for classic and blocks)
// -------------------------------------------------------

async function test3dsFlow() {
  console.log('\n--- 3DS authentication ---');
  await page.waitForSelector('#conekta3dsContainer iframe', { timeout: config.timeouts.threeDs });
  assert(true, '3DS challenge iframe appeared');

  const threeDsFrame = page.frameLocator('#conekta3dsContainer iframe');
  const challengeFrame = threeDsFrame.frameLocator('#Cardinal-CCA-IFrame');
  await challengeFrame.locator('input[name="challengeDataEntry"]').waitFor({ state: 'visible', timeout: config.timeouts.threeDs });
  await challengeFrame.locator('input[name="challengeDataEntry"]').fill('1234');
  await challengeFrame.locator('input[value="SUBMIT"]').click();
  assert(true, '3DS token 1234 submitted');

  await page.waitForURL('**/order-received/**', { timeout: config.timeouts.navigation });
  assert(true, 'redirected to order-received');
}

// -------------------------------------------------------
// Runner
// -------------------------------------------------------

async function run(label, testFn) {
  console.log(`=== E2E: ${label} ===\n`);

  try {
    await setup();
    console.log('Setup: Ready\n');
    await testFn({ page, assert, counters, config, couponCode, STORE_URL, BILLING, TEST_CARD });
  } catch (error) {
    counters.failed++;
    console.error(`\n\x1b[31mError: ${error.message}\x1b[0m`);
    const screenshotPath = `${config.screenshot.dir}${config.screenshot.prefix}${label.toLowerCase().replace(/\s+/g, '-')}-error.png`;
    try { await page.screenshot({ path: screenshotPath, fullPage: true }); console.log(`Screenshot: ${screenshotPath}`); } catch (_) {}
  } finally {
    await teardown();
  }

  const RESULT = { true: '\x1b[32mAll passed!\x1b[0m', false: '\x1b[31mFailed!\x1b[0m' };
  const EXIT = { true: 0, false: 1 };
  const passed = counters.failed === 0;

  console.log(`\n=== ${counters.passed} passed, ${counters.failed} failed ===`);
  console.log(RESULT[passed]);
  return passed;
}

module.exports = {
  STORE_URL, CONEKTA_API_KEY, REGULAR_PRICE, DISCOUNT_AMOUNT, COUPON_AMOUNT,
  TEST_CARD, BILLING,
  assert, getPage, getCounters, wcApi, setCheckoutType,
  setup, teardown, testOrderStatus, test3dsFlow, run,
};
