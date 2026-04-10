/**
 * E2E: Classic Checkout — Discount + 3DS
 */
const h = require('./checkout-helpers');

h.run('Classic Checkout — Discount + 3DS', async ({ page, assert, config, couponCode, STORE_URL, BILLING, TEST_CARD }) => {
  // Switch to classic checkout
  await h.setCheckoutType('classic');

  // Navigate to checkout
  await page.goto(`${STORE_URL}/checkout/`);
  await page.waitForLoadState('networkidle');
  await page.waitForSelector('form.checkout', { timeout: config.timeouts.selector });
  await page.waitForTimeout(2000);

  // --- conekta_settings (before coupon) ---
  console.log('--- conekta_settings ---');
  const settings = await page.evaluate(() => window.conekta_settings);
  assert(settings !== undefined, 'conekta_settings exists');
  assert(settings.amount > 0, `amount = ${settings.amount}`);
  assert(settings.three_ds_enabled == 1 || settings.three_ds_enabled === 'yes', `3DS enabled = ${settings.three_ds_enabled}`);
  assert(settings.cart_items.length > 0, `cart_items count = ${settings.cart_items.length}`);

  // --- Apply coupon on checkout page (same session, no race condition) ---
  console.log('\n--- Apply coupon ---');
  await h.applyCheckoutCoupon(couponCode);

  // --- discount_lines (read from the PHP fragment — the authoritative source) ---
  console.log('\n--- discount_lines ---');
  const fragment = await page.$('#conekta-cart-data');
  assert(fragment !== null, '#conekta-cart-data exists');
  const fragData = JSON.parse(await fragment.evaluate(el => el.textContent));
  const dl = fragData.discount_lines;
  assert(dl.length >= 2, `discount_lines count = ${dl.length}`);
  assert(dl.find(d => d.code === 'dynamic_pricing')?.type === 'campaign', `dynamic_pricing type = campaign`);

  const couponEntry = dl.find(d => d.code === couponCode);
  assert(couponEntry?.type === 'coupon', `coupon type = ${couponEntry?.type || 'NOT APPLIED'}`);
  assert(couponEntry?.amount > 0, `coupon amount = ${couponEntry?.amount}`);

  // --- Double-counting guard ---
  console.log('\n--- Guard ---');
  assert(dl.filter(d => d.code === 'dynamic_pricing').length === 1, 'no duplicate dynamic_pricing');
  assert(dl.filter(d => d.code === couponCode).length === 1, `coupon entries = ${dl.filter(d => d.code === couponCode).length}`);

  // --- JS sync: conekta_settings should match fragment after updated_checkout ---
  console.log('\n--- JS sync ---');
  const synced = await page.evaluate(() => window.conekta_settings);
  assert(synced.discount_lines.length === dl.length, `conekta_settings synced = ${synced.discount_lines.length} discount_lines`);

  // --- Billing form ---
  console.log('\n--- Billing ---');
  await page.fill('#billing_first_name', BILLING.first_name);
  await page.fill('#billing_last_name', BILLING.last_name);
  await page.fill('#billing_address_1', BILLING.address_1);
  await page.fill('#billing_city', BILLING.city);
  await page.selectOption('#billing_state', BILLING.state);
  await page.fill('#billing_postcode', BILLING.postcode);
  await page.fill('#billing_phone', BILLING.phone);
  await page.fill('#billing_email', BILLING.email);
  await page.waitForTimeout(4000);

  // --- Tokenizer + pay ---
  console.log('\n--- Card + Place Order ---');
  await page.click('label[for="payment_method_conekta"]');
  await page.waitForTimeout(3000);

  const tokenizer = page.frameLocator('iframe[title*="tokenizer"]');
  await tokenizer.locator('#cardNumber').fill(TEST_CARD.number);
  await tokenizer.locator('#cardExpMonthYear').fill(`${TEST_CARD.expMonth}/${TEST_CARD.expYear}`);
  await tokenizer.locator('#cardVerificationValue').fill(TEST_CARD.cvc);
  await tokenizer.locator('#cardholderName').fill(TEST_CARD.name);
  assert(true, 'card filled');

  await page.click('button#place_order, input#place_order');
  assert(true, 'Place Order clicked');
  await page.waitForTimeout(5000);

  // --- 3DS + order verification ---
  await h.test3dsFlow();
  await h.testOrderStatus();
}).then(passed => process.exit(passed ? 0 : 1));
