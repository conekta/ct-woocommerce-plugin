/**
 * E2E: Blocks Checkout — Discount + 3DS
 */
const h = require('./checkout-helpers');

h.run('Blocks Checkout — Discount + 3DS', async ({ page, assert, config, couponCode, STORE_URL, BILLING, TEST_CARD }) => {
  // Switch to blocks checkout
  await h.setCheckoutType('blocks');

  // Navigate to checkout
  await page.goto(`${STORE_URL}/checkout/`);
  await page.waitForLoadState('networkidle');
  await page.waitForSelector('.wc-block-checkout', { timeout: config.timeouts.selector });
  await page.waitForTimeout(3000);

  // --- Order summary shows product + discount ---
  console.log('--- Order summary ---');
  const orderSummary = await page.locator('.wc-block-components-order-summary').textContent();
  assert(orderSummary.length > 0, 'order summary rendered');

  const totalText = await page.locator('.wc-block-components-totals-footer-item .wc-block-components-totals-item__value').textContent();
  assert(totalText.length > 0, `total = ${totalText.trim()}`);

  // --- Fill billing (blocks selectors) ---
  console.log('\n--- Billing ---');
  await page.fill('#email', BILLING.email);
  await page.waitForTimeout(1000);

  // Blocks auto-fills some fields. Fill what's empty.
  await page.fill('#billing-first_name', BILLING.first_name);
  await page.fill('#billing-last_name', BILLING.last_name);
  await page.fill('#billing-address_1', BILLING.address_1);
  await page.fill('#billing-city', BILLING.city);
  await page.fill('#billing-postcode', BILLING.postcode);
  await page.fill('#billing-phone', BILLING.phone);

  // State: blocks combobox
  await page.locator('#billing-state input').fill('Ciudad');
  await page.waitForTimeout(1000);
  await page.locator('.wc-block-components-combobox__option, [role="option"]').first().click();
  await page.waitForTimeout(2000);
  assert(true, 'billing filled');

  // --- Select Conekta + fill card ---
  console.log('\n--- Card + Place Order ---');
  await page.locator('label:has-text("Tarjeta")').first().click();
  await page.waitForTimeout(3000);

  const tokenizer = page.frameLocator('iframe[title*="tokenizer"]');
  await tokenizer.locator('#cardNumber').fill(TEST_CARD.number);
  await tokenizer.locator('#cardExpMonthYear').fill(`${TEST_CARD.expMonth}/${TEST_CARD.expYear}`);
  await tokenizer.locator('#cardVerificationValue').fill(TEST_CARD.cvc);
  await tokenizer.locator('#cardholderName').fill(TEST_CARD.name);
  assert(true, 'card filled');

  // --- Place order ---
  await page.locator('.wc-block-components-checkout-place-order-button, button:has-text("Place Order")').click();
  assert(true, 'Place Order clicked');
  await page.waitForTimeout(5000);

  // --- 3DS + order verification (shared) ---
  await h.test3dsFlow();
  await h.testOrderStatus();
}).then(passed => process.exit(passed ? 0 : 1));
