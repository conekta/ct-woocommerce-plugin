const { chromium } = require('playwright');

const STORE_URL = process.env.STORE_URL || 'http://localhost';
const CONEKTA_API_KEY = process.env.CONEKTA_API_KEY;
const WP_USER = process.env.WP_USER || 'user';
const WP_PASS = process.env.WP_PASS || 'bitnami';
const REGULAR_PRICE = '1000';
const DISCOUNT_AMOUNT = '500';

if (!CONEKTA_API_KEY) {
  console.error('\x1b[31mUsage: CONEKTA_API_KEY=key_xxx npm run test:e2e\x1b[0m');
  process.exit(1);
}

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

let browser, page, wpNonce, productId;
const STATUS = { true: '\x1b[32m✓\x1b[0m', false: '\x1b[31m✗\x1b[0m' };
const COUNTER = { true: 'passed', false: 'failed' };
const counters = { passed: 0, failed: 0 };

function assert(condition, label) {
  const key = Boolean(condition);
  console.log(`  ${STATUS[key]} ${label}`);
  counters[COUNTER[key]]++;
}

async function wcApi(method, endpoint, body) {
  return page.evaluate(async ({ url, method, body, nonce }) => {
    const opts = { method, headers: { 'X-WP-Nonce': nonce, 'Content-Type': 'application/json' } };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(url, opts);
    return res.json();
  }, { url: `${STORE_URL}/wp-json/${endpoint}`, method, body, nonce: wpNonce });
}

// -------------------------------------------------------
// ADP Rule helpers — create/delete pricing rules via admin AJAX
// -------------------------------------------------------

async function getAdpNonce() {
  await page.goto(`${STORE_URL}/wp-admin/admin.php?page=wdp_settings`);
  await page.waitForLoadState('networkidle');
  return page.$eval('#security', el => el.value);
}

function buildAdpRule(productId) {
  return {
    id: null,
    deleted: false,
    enabled: 'on',
    exclusive: false,
    rule_type: 'common',
    title: 'E2E Test Discount',
    type: 'common',
    priority: 99,
    options: { repeat: '-1', apply_to: 'expensive' },
    conditions: [],
    filters: [{
      qty: '1',
      type: 'products',
      limitation: 'none',
      method: 'in_list',
      value: [String(productId)],
      excludes: [{ type: 'products' }],
    }],
    limits: [],
    cart_adjustments: [],
    product_adjustments: {
      type: 'total',
      total: { type: 'discount__amount', value: DISCOUNT_AMOUNT },
      split: [{ type: 'discount__amount', value: '' }],
      max_discount_sum: '',
      split_discount_by: 'cost',
    },
    sortable_blocks_priority: ['roles', 'bulk-adjustments'],
    bulk_adjustments: { type: 'bulk', table_message: '' },
    role_discounts: [],
    get_products: { repeat: '-1', repeat_subtotal: '' },
    auto_add_products: [],
    additional: {
      blocks: {
        productFilters: { isOpen: '1' },
        productDiscounts: { isOpen: '1' },
        roleDiscounts: { isOpen: '0' },
        bulkDiscounts: { isOpen: '0' },
        freeProducts: { isOpen: '0' },
        autoAddToCart: { isOpen: '0' },
        advertising: { isOpen: '0' },
        cartAdjustments: { isOpen: '0' },
        conditions: { isOpen: '0' },
        limits: { isOpen: '0' },
      },
      date_from: '', date_to: '', replace_name: '',
      sortable_apply_mode: 'consistently',
      free_products_replace_name: '',
      conditions_relationship: 'and',
    },
    advertising: [],
    condition_message: [],
  };
}

async function createAdpRule(productId) {
  const adpNonce = await getAdpNonce();
  const rule = buildAdpRule(productId);

  const result = await page.evaluate(async ({ url, nonce, rules }) => {
    const formData = new FormData();
    formData.append('action', 'wdp_ajax');
    formData.append('security', nonce);
    formData.append('data', JSON.stringify({ rules }));

    const res = await fetch(url, { method: 'POST', body: formData });
    return res.json();
  }, {
    url: `${STORE_URL}/wp-admin/admin-ajax.php`,
    nonce: adpNonce,
    rules: [rule],
  });

  return result?.data?.[0]?.id || result?.[0]?.id;
}

async function deleteAdpRule(ruleId) {
  const adpNonce = await getAdpNonce();

  // Load existing rules, mark ours as deleted, save
  const existingData = await page.evaluate(() => window.wdp_data);
  const rules = (existingData?.rules || []).map(r =>
    r.id === ruleId ? { ...r, deleted: true } : r
  );

  await page.evaluate(async ({ url, nonce, rules }) => {
    const formData = new FormData();
    formData.append('action', 'wdp_ajax');
    formData.append('security', nonce);
    formData.append('data', JSON.stringify({ rules }));

    await fetch(url, { method: 'POST', body: formData });
  }, {
    url: `${STORE_URL}/wp-admin/admin-ajax.php`,
    nonce: adpNonce,
    rules,
  });
}

// -------------------------------------------------------
// Setup & Teardown
// -------------------------------------------------------

let adpRuleId;

async function setup() {
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  page = await context.newPage();

  // Login
  console.log('Setup: Login...');
  await page.goto(`${STORE_URL}/wp-login.php`);
  await page.fill('#user_login', WP_USER);
  await page.fill('#user_pass', WP_PASS);
  await page.click('#wp-submit');
  await page.waitForLoadState('networkidle');

  // Get WP REST nonce
  await page.goto(`${STORE_URL}/wp-admin/`);
  await page.waitForLoadState('networkidle');
  wpNonce = await page.evaluate(async () => {
    const res = await fetch('/wp-admin/admin-ajax.php?action=rest-nonce');
    return res.text();
  });

  // Create test product
  console.log(`Setup: Creating product (regular_price=$${REGULAR_PRICE})...`);
  const product = await wcApi('POST', 'wc/v3/products', {
    name: 'E2E Discount Test Product',
    type: 'simple',
    regular_price: REGULAR_PRICE,
    status: 'publish',
    manage_stock: false,
  });
  productId = product.id;
  console.log(`Setup: Product created (ID: ${productId})`);

  // Create ADP pricing rule ($500 off this product)
  console.log(`Setup: Creating ADP pricing rule (-$${DISCOUNT_AMOUNT})...`);
  adpRuleId = await createAdpRule(productId);
  console.log(`Setup: ADP rule created (ID: ${adpRuleId})`);

  // Add product to cart
  await page.goto(`${STORE_URL}/?add-to-cart=${productId}`);
  await page.waitForLoadState('networkidle');
  console.log('Setup: Product added to cart\n');
}

async function teardown() {
  console.log('\nTeardown...');

  // Delete ADP rule
  if (adpRuleId) {
    await deleteAdpRule(adpRuleId);
    console.log(`  Deleted ADP rule ${adpRuleId}`);
  }

  // Delete product
  if (productId) {
    await wcApi('DELETE', `wc/v3/products/${productId}?force=true`);
    console.log(`  Deleted product ${productId}`);
  }

  await browser.close();
}

// -------------------------------------------------------
// Tests
// -------------------------------------------------------

async function testConektaSettings() {
  console.log('--- conekta_settings ---');
  await page.goto(`${STORE_URL}/checkout/`);
  await page.waitForLoadState('networkidle');
  await page.waitForSelector('form.checkout', { timeout: 10000 });
  await page.waitForTimeout(2000);

  const settings = await page.evaluate(() => window.conekta_settings);

  assert(settings !== undefined, 'conekta_settings exists');
  assert(settings.amount > 0, `amount = ${settings.amount} (cents)`);
  assert(settings.three_ds_enabled == 1 || settings.three_ds_enabled === 'yes', `3DS enabled = ${settings.three_ds_enabled}`);
  assert(settings.cart_items.length > 0, `cart_items count = ${settings.cart_items.length}`);
  assert(settings.cart_items[0].total > 0, `cart_items[0].total = ${settings.cart_items[0].total}`);

  return settings;
}

async function testDiscountLines(settings) {
  console.log('\n--- discount_lines ---');
  const discountLines = settings.discount_lines;

  assert(Array.isArray(discountLines), 'discount_lines is array');
  assert(discountLines.length > 0, `discount_lines count = ${discountLines.length}`);

  const dynamicEntry = discountLines.find(d => d.code === 'dynamic_pricing');
  assert(dynamicEntry !== undefined, 'dynamic_pricing entry present');
  assert(dynamicEntry.amount > 0, `dynamic_pricing amount = ${dynamicEntry.amount}`);
  assert(dynamicEntry.type === 'campaign', `dynamic_pricing type = ${dynamicEntry.type}`);
}

async function testNoDoubleCounting(settings) {
  console.log('\n--- Double-counting guard ---');
  const dynamicCount = settings.discount_lines.filter(d => d.code === 'dynamic_pricing').length;
  assert(dynamicCount === 1, `dynamic_pricing entries = ${dynamicCount} (expected 1)`);
}

async function testFragmentElement() {
  console.log('\n--- Fragment element ---');
  const fragmentEl = await page.$('#conekta-cart-data');
  assert(fragmentEl !== null, '#conekta-cart-data exists (id selector)');

  const fragmentJson = await fragmentEl.evaluate(el => el.textContent);
  const fragmentData = JSON.parse(fragmentJson);
  assert(fragmentData.amount > 0, `fragment amount = ${fragmentData.amount}`);

  const fragDynamic = fragmentData.discount_lines.filter(d => d.code === 'dynamic_pricing');
  assert(fragDynamic.length === 1, `fragment dynamic_pricing count = ${fragDynamic.length}`);
}

async function testBillingFormAndFragmentSync() {
  console.log('\n--- Billing form + fragment sync ---');
  await page.fill('#billing_first_name', BILLING.first_name);
  await page.fill('#billing_last_name', BILLING.last_name);
  await page.fill('#billing_address_1', BILLING.address_1);
  await page.fill('#billing_city', BILLING.city);
  await page.selectOption('#billing_state', BILLING.state);
  await page.fill('#billing_postcode', BILLING.postcode);
  await page.fill('#billing_phone', BILLING.phone);
  await page.fill('#billing_email', BILLING.email);

  await page.waitForTimeout(4000);

  const updatedSettings = await page.evaluate(() => window.conekta_settings);
  assert(updatedSettings.amount > 0, `post-update amount = ${updatedSettings.amount}`);
  assert(updatedSettings.discount_lines.length > 0, `post-update discount_lines count = ${updatedSettings.discount_lines.length}`);

  const postDynamic = updatedSettings.discount_lines.filter(d => d.code === 'dynamic_pricing');
  assert(postDynamic.length === 1, `post-update dynamic_pricing count = ${postDynamic.length} (no duplication)`);
}

async function testTokenizerIframe() {
  console.log('\n--- Conekta tokenizer ---');
  await page.click('label[for="payment_method_conekta"]');
  await page.waitForTimeout(3000);

  const iframe = await page.$('#conektaITokenizerframeContainer iframe');
  assert(iframe !== null, 'tokenizer iframe loaded');
}

// -------------------------------------------------------
// Runner
// -------------------------------------------------------

(async () => {
  console.log('=== E2E: Classic Checkout — Dynamic Pricing + 3DS ===\n');

  try {
    await setup();

    const settings = await testConektaSettings();
    await testDiscountLines(settings);
    await testNoDoubleCounting(settings);
    await testFragmentElement();
    await testBillingFormAndFragmentSync();
    await testTokenizerIframe();
  } catch (error) {
    console.error(`\n\x1b[31mError: ${error.message}\x1b[0m`);
    await page.screenshot({ path: '/tmp/e2e-checkout-error.png', fullPage: true });
    console.log('Screenshot: /tmp/e2e-checkout-error.png');
  } finally {
    await teardown();
  }

  const RESULT = { true: '\x1b[32mAll passed!\x1b[0m', false: '\x1b[31mFailed!\x1b[0m' };
  const EXIT = { true: 0, false: 1 };
  const passed = counters.failed === 0;

  console.log(`\n=== ${counters.passed} passed, ${counters.failed} failed ===`);
  console.log(RESULT[passed]);
  process.exit(EXIT[passed]);
})();
