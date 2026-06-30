/**
 * E2E: Classic Checkout — tax-inclusive pricing (BE-924)
 *
 * Regression for the bug where, on stores that enter prices WITH tax, the IVA
 * was reported to Conekta as a `dynamic_pricing` discount instead of a tax
 * line (e.g. a $2,610 tax-inclusive item showed a phantom -$360 "Descuento").
 *
 * The impuesto-vs-descuento classification is decided when the Conekta order
 * is CREATED (checkout-request -> build_snapshot -> createOrder), before any
 * payment. So this spec drives the checkout only far enough to mint the order,
 * captures its conekta_order_id, then asserts against the live Conekta API:
 *   - NO dynamic_pricing discount line (the bug),
 *   - the IVA is present as a tax_line,
 *   - the line item carries metadata.tax_included = true (when echoed).
 *
 * No 3DS payment is needed (and it's flaky headless), so we stop after the
 * order is created.
 */
const h = require('./checkout-helpers');

h.run('Classic Checkout — tax-inclusive not reported as discount', { checkoutType: 'classic', taxInclusive: true }, async ({ page, assert, config, STORE_URL, BILLING }) => {
  console.log('--- tax-inclusive order creation ---');

  // Classic fires many update_order_review AJAX calls; snapshot the
  // checkout-request bodies at arrival time via a global listener (same
  // technique as discount-classic.spec.js).
  const captured = [];
  page.on('response', async (response) => {
    if (response.url().includes('conekta_checkout_request') && response.request().method() === 'POST') {
      try { captured.push(await response.json()); } catch (_) { /* body unavailable */ }
    }
  });
  const waitForCapture = async (n, timeoutMs = 30000) => {
    const start = Date.now();
    while (captured.length < n && Date.now() - start < timeoutMs) {
      await page.waitForTimeout(100);
    }
    if (captured.length < n) throw new Error(`Timeout waiting for ${n} captured POSTs (got ${captured.length})`);
  };

  await page.goto(`${STORE_URL}/checkout/`);
  await page.waitForLoadState('networkidle');
  await page.waitForSelector('form.checkout', { timeout: config.timeouts.selector });

  await page.fill('#billing_first_name', BILLING.first_name);
  await page.fill('#billing_last_name', BILLING.last_name);
  await page.fill('#billing_address_1', BILLING.address_1);
  await page.fill('#billing_city', BILLING.city);
  await page.selectOption('#billing_state', BILLING.state);
  await page.fill('#billing_postcode', BILLING.postcode);
  await page.fill('#billing_phone', BILLING.phone);
  await page.fill('#billing_email', BILLING.email);

  // Flush the email through update_order_review so WC()->customer is synced
  // before checkout-request fires (otherwise it races with a stale email).
  await page.locator('#billing_email').blur().catch(() => {});
  await page.waitForResponse(
    r => r.url().includes('wc-ajax=update_order_review'),
    { timeout: 10000 }
  ).catch(() => {});
  await page.waitForTimeout(500);

  await page.click('label[for="payment_method_conekta"]');

  await waitForCapture(1);
  const body = captured[0];
  assert(typeof body.conekta_order_id === 'string' && body.conekta_order_id.length > 0,
    `checkout-request returned conekta_order_id = ${body.conekta_order_id}`);

  // Core regression assertions against the real Conekta order, BEFORE paying,
  // so they always run even if the 3DS happy path below flakes.
  await h.verifyTaxInclusiveOrder(body.conekta_order_id);

  // ---------------------------------------------------------------
  // Happy path — pay with the test card so the order is fully charged
  // and we can compare the paid Conekta order against WooCommerce.
  // ---------------------------------------------------------------
  console.log('\n--- happy path (pay with card) ---');
  await h.waitForIntegrationIframe();
  await h.fillIntegrationCard(h.TEST_CARD);
  assert(true, 'card filled inside Conekta iframe');

  await h.clickPlaceOrder();
  await h.waitForOrderReceivedWith3DS();
  assert(true, 'redirected to order-received');

  // Confirms the Conekta order reached payment_status = paid. Re-verifies the
  // tax classification on the now-paid order (structure must be unchanged).
  await h.testOrderStatus(body.conekta_order_id);
  await h.verifyTaxInclusiveOrder(body.conekta_order_id);

  // The amount Conekta charged must equal the WooCommerce order total to the
  // cent (no rounding drift). Runs last: it re-authenticates as admin.
  await h.verifyConektaTotalMatchesWoo(body.conekta_order_id);
}).then(passed => process.exit(passed ? 0 : 1));
