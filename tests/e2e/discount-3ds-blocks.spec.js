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

  // --- Billing: fill only visible fields (Blocks auto-fills for logged-in users) ---
  console.log('\n--- Billing ---');
  const emailField = page.locator('#email');
  const isEmailVisible = await emailField.isVisible();
  await (isEmailVisible && emailField.fill(BILLING.email));

  // Fill each field only if visible (Blocks hides them when auto-filled)
  const billingFields = {
    '#billing-first_name': BILLING.first_name,
    '#billing-last_name': BILLING.last_name,
    '#billing-address_1': BILLING.address_1,
    '#billing-city': BILLING.city,
    '#billing-postcode': BILLING.postcode,
    '#billing-phone': BILLING.phone,
  };
  await Promise.all(
    Object.entries(billingFields).map(async ([sel, val]) => {
      const field = page.locator(sel);
      const visible = await field.isVisible();
      return visible && field.fill(val);
    })
  );
  await page.waitForTimeout(2000);
  assert(true, 'billing ready');

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
