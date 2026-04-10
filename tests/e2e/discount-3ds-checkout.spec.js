const { chromium } = require('playwright');
const config = require('./e2e.config');

const STORE_URL = process.env.STORE_URL || 'http://localhost';
const CONEKTA_API_KEY = process.env.CONEKTA_API_KEY;
const WP_USER = process.env.WP_USER || 'user';
const WP_PASS = process.env.WP_PASS || 'bitnami';
const REGULAR_PRICE = '1000';
const DISCOUNT_AMOUNT = '500';
const TEST_CARD = {
  number: '5200000000001096',
  name: 'Test User',
  expMonth: String(Math.floor(Math.random() * 12) + 1).padStart(2, '0'),
  expYear: String((new Date().getFullYear() + 2) % 100).padStart(2, '0'),
  cvc: String(Math.floor(Math.random() * 900) + 100),
};

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

async function refreshNonce() {
  wpNonce = await page.evaluate(async () => {
    const res = await fetch('/wp-admin/admin-ajax.php?action=rest-nonce');
    return res.text();
  });
}

async function wcApi(method, endpoint, body) {
  await refreshNonce();
  return page.evaluate(async ({ url, method, body, nonce }) => {
    const opts = { method, headers: { 'X-WP-Nonce': nonce, 'Content-Type': 'application/json' } };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(url, opts);
    return res.json();
  }, { url: `${STORE_URL}/wp-json/${endpoint}`, method, body, nonce: wpNonce });
}

// -------------------------------------------------------
// ADP Rule helpers — verify existing rules via admin page
// -------------------------------------------------------

async function getAdpRuleProductIds() {
  await page.goto(`${STORE_URL}/wp-admin/admin.php?page=wdp_settings`);
  await page.waitForLoadState('networkidle');
  const data = await page.evaluate(() => window.wdp_data);
  const rules = (data?.rules || []).filter(r => r.enabled === 'on');
  return rules.flatMap(r => r.filters?.[0]?.value || []);
}

// -------------------------------------------------------
// Setup & Teardown
// -------------------------------------------------------

async function setup() {
  browser = await chromium.launch({ headless: config.headless });
  const context = await browser.newContext({
    recordVideo: config.video,
  });
  page = await context.newPage();

  // Login
  console.log('Setup: Login...');
  await page.goto(`${STORE_URL}/wp-login.php`);
  await page.fill('#user_login', WP_USER);
  await page.fill('#user_pass', WP_PASS);
  await page.click('#wp-submit');
  await page.waitForLoadState('networkidle');

  // Navigate to admin to establish session
  await page.goto(`${STORE_URL}/wp-admin/`);
  await page.waitForLoadState('networkidle');

  // Find a product that already has an ADP pricing rule
  console.log('Setup: Finding product with ADP discount rule...');
  const adpProductIds = await getAdpRuleProductIds();
  productId = Number(adpProductIds[0]);
  console.log(`Setup: Using product ${productId} (has active ADP rule)`);

  // Add product to cart
  await page.goto(`${STORE_URL}/?add-to-cart=${productId}`);
  await page.waitForLoadState('networkidle');
  console.log('Setup: Product added to cart\n');
}

async function teardown() {
  console.log('\nTeardown...');
  try { await browser.close(); } catch (_) { /* browser never launched */ }
}

// -------------------------------------------------------
// Tests
// -------------------------------------------------------

async function testConektaSettings() {
  console.log('--- conekta_settings ---');
  await page.goto(`${STORE_URL}/checkout/`);
  await page.waitForLoadState('networkidle');
  await page.waitForSelector('form.checkout', { timeout: config.timeouts.selector });
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

async function testFillCardAndPlaceOrder() {
  console.log('\n--- Fill card + Place order ---');

  // Fill card fields inside the Conekta tokenizer iframe (use title to pick the right one)
  const tokenizerFrame = page.frameLocator('iframe[title*="tokenizer"]');
  await tokenizerFrame.locator('#cardNumber').fill(TEST_CARD.number);
  await tokenizerFrame.locator('#cardExpMonthYear').fill(`${TEST_CARD.expMonth}/${TEST_CARD.expYear}`);
  await tokenizerFrame.locator('#cardVerificationValue').fill(TEST_CARD.cvc);
  await tokenizerFrame.locator('#cardholderName').fill(TEST_CARD.name);
  assert(true, 'card fields filled in tokenizer iframe');

  // Click Place Order
  await page.click('button#place_order, input#place_order');
  assert(true, 'Place Order clicked');

  // Wait for 3DS iframe to appear (strict mode)
  console.log('\n--- 3DS authentication ---');
  await page.waitForTimeout(5000);

  // Wait for 3DS challenge iframe
  await page.waitForSelector('#conekta3dsContainer iframe', { timeout: config.timeouts.threeDs });
  assert(true, '3DS challenge iframe appeared');

  // The 3DS form is in a nested iframe: conekta3dsContainer > conekta iframe > Cardinal iframe
  // Wait for the Cardinal challenge form to render (nested iframe with OTP input)
  const threeDsFrame = page.frameLocator('#conekta3dsContainer iframe');
  const challengeFrame = threeDsFrame.frameLocator('#Cardinal-CCA-IFrame');
  await challengeFrame.locator('input[name="challengeDataEntry"]').waitFor({ state: 'visible', timeout: config.timeouts.threeDs });
  await challengeFrame.locator('input[name="challengeDataEntry"]').fill('1234');
  await challengeFrame.locator('input[value="SUBMIT"]').click();
  assert(true, '3DS token 1234 submitted');

  // Wait for redirect to order-received
  await page.waitForURL('**/order-received/**', { timeout: config.timeouts.navigation });
  assert(true, 'redirected to order-received');
}

async function testOrderStatus() {
  console.log('\n--- Order status ---');

  const currentUrl = page.url();
  const isOrderReceived = currentUrl.includes('order-received');
  assert(isOrderReceived, `redirected to order-received page`);

  // Extract WC order ID from URL: /checkout/order-received/{id}/
  const orderIdMatch = currentUrl.match(/order-received\/(\d+)/);
  assert(orderIdMatch !== null, `order ID in URL`);
  const wcOrderId = orderIdMatch[1];

  // Verify WC order status via REST API
  const order = await wcApi('GET', `wc/v3/orders/${wcOrderId}`);
  const validStatuses = ['processing', 'completed', 'on-hold'];
  const statusOk = validStatuses.includes(order.status);
  assert(statusOk, `WC order status = ${order.status}`);

  // Verify Conekta order ID is stored in WC meta
  const conektaMeta = order.meta_data.find(m => m.key === 'conekta-order-id');
  assert(conektaMeta !== undefined, `conekta-order-id meta = ${conektaMeta?.value}`);

  // Verify discount_lines in Conekta order via API
  console.log('\n--- Conekta order verification ---');
  const conektaOrderId = conektaMeta.value;
  const conektaOrder = await page.evaluate(async ({ url, key }) => {
    const res = await fetch(url, {
      headers: { 'Authorization': 'Bearer ' + key, 'Accept': 'application/vnd.conekta-v2.2.0+json' },
    });
    return res.json();
  }, { url: `https://api.conekta.io/orders/${conektaOrderId}`, key: CONEKTA_API_KEY });

  const conektaDiscounts = conektaOrder.discount_lines?.data || [];
  assert(conektaDiscounts.length > 0, `Conekta discount_lines count = ${conektaDiscounts.length}`);

  const conektaDynamic = conektaDiscounts.find(d => d.code === 'dynamic_pricing');
  assert(conektaDynamic !== undefined, `Conekta has dynamic_pricing entry`);
  assert(conektaDynamic.type === 'campaign', `Conekta dynamic_pricing type = ${conektaDynamic.type}`);
  assert(conektaDynamic.amount > 0, `Conekta dynamic_pricing amount = ${conektaDynamic.amount}`);
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
    await testFillCardAndPlaceOrder();
    await testOrderStatus();
  } catch (error) {
    console.error(`\n\x1b[31mError: ${error.message}\x1b[0m`);
    const screenshotPath = `${config.screenshot.dir}${config.screenshot.prefix}checkout-error.png`;
    await page.screenshot({ path: screenshotPath, fullPage: true });
    console.log(`Screenshot: ${screenshotPath}`);
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
