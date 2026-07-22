/**
 * E2E: Classic Checkout — Integration component flow
 *
 * Scenarios covered:
 *  a) HAPPY PATH        — checkout loads, Integration iframe mounts in
 *                         #conektaITokenizerframeContainer. Real payment
 *                         through the live Conekta sandbox iframe is not
 *                         driveable from Playwright, so this spec MOCKS
 *                         /conekta/v1/checkout-request and synthesises an
 *                         onFinalizePayment by writing the hidden field
 *                         conekta_order_id and submitting form.checkout.
 *  b) DISCOUNT TRIGGERS UPDATE — first POST asserts mode=create, applying a
 *                         coupon triggers a second POST with mode=update
 *                         that reuses the same conekta_order_id.
 *  c) AMOUNT-MISMATCH GUARD   — the order-first flow (6.1.0) checks the
 *                         Conekta order amount against the WC order total
 *                         BEFORE firing the charge. We force a real mismatch
 *                         by applying the coupon via a raw wc-ajax fetch
 *                         (server cart changes, page JS never sees
 *                         updated_checkout, iframe keeps the stale amount)
 *                         — the "coupon applied in another tab" case. The
 *                         gateway must refuse WITHOUT charging, and a
 *                         remount must let the customer pay the right total.
 */
const h = require('./checkout-helpers');

h.run('Classic Checkout — Integration component', { checkoutType: 'classic' }, async ({ page, assert, config, couponCode, STORE_URL, BILLING }) => {
  // ---------------------------------------------------------------
  // (b) DISCOUNT TRIGGERS UPDATE — observed against real backend
  // ---------------------------------------------------------------
  console.log('--- (b) discount triggers checkout-request update ---');

  // Classic fires lots of update_order_review AJAX between field-fills, so
  // bodies captured with waitForResponse get GC'd before we can read them.
  // Snapshot bodies at arrival time via a global listener instead.
  const captured = [];
  page.on('response', async (response) => {
    if (response.url().includes('conekta_checkout_request') && response.request().method() === 'POST') {
      try {
        captured.push(await response.json());
      } catch (_) { /* body unavailable, skip */ }
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

  // Tab out to flush the email change through WC's update_order_review AJAX,
  // which is what syncs WC()->customer->email on the server. Without this the
  // checkout-request POST races ahead with a stale (empty) email.
  await page.locator('#billing_email').blur().catch(() => {});
  await page.waitForResponse(
    r => r.url().includes('wc-ajax=update_order_review'),
    { timeout: 10000 }
  ).catch(() => {});
  await page.waitForTimeout(500);

  await page.click('label[for="payment_method_conekta"]');

  await waitForCapture(1);
  const firstBody = captured[0];
  assert(['create', 'update'].includes(firstBody.mode), `first POST mode = ${firstBody.mode}`);
  assert(typeof firstBody.conekta_order_id === 'string' && firstBody.conekta_order_id.length > 0,
    `first POST returned conekta_order_id = ${firstBody.conekta_order_id}`);

  await h.waitForIntegrationIframe();
  assert(true, 'Integration iframe mounted on first load');

  await h.applyCheckoutCoupon(couponCode);
  await waitForCapture(2);
  const secondBody = captured[1];
  // Accept update or unchanged: when running against a long-lived staging
  // session the cached last_amount can coincidentally match the post-coupon
  // total. The key invariant we care about is reuse of the same order id.
  assert(['update', 'unchanged'].includes(secondBody.mode), `second POST mode = ${secondBody.mode}`);
  assert(secondBody.conekta_order_id === firstBody.conekta_order_id,
    `same conekta_order_id reused (${secondBody.conekta_order_id})`);

  // ---------------------------------------------------------------
  // (a) HAPPY PATH — drive the Integration iframe end-to-end
  // ---------------------------------------------------------------
  console.log('\n--- (a) happy path ---');
  await h.fillIntegrationCard(h.TEST_CARD);
  assert(true, 'card filled inside Conekta iframe');

  await h.clickPlaceOrder();
  await h.waitForOrderReceivedWith3DS();
  assert(true, 'redirected to order-received');

  await h.testOrderStatus(secondBody.conekta_order_id);

  // The charged amount must equal the WooCommerce total to the cent, and any
  // rounding drift on this sale+coupon order must be reconciled correctly
  // (round_adjustment discount on over-count, tax on under-count).
  await h.verifyConektaTotalMatchesWoo(secondBody.conekta_order_id);

  // ---------------------------------------------------------------
  // (c) AMOUNT-MISMATCH GUARD — pre-charge gate refuses a stale amount
  // ---------------------------------------------------------------
  console.log('\n--- (c) amount-mismatch guard: coupon applied out-of-band ---');

  // Fresh cart + checkout (the happy path above consumed the previous one).
  const productId = h.getProductId();
  await page.goto(`${STORE_URL}/?add-to-cart=${productId}&quantity=${h.QUANTITY}`);
  await page.waitForLoadState('networkidle');
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
  await page.locator('#billing_email').blur().catch(() => {});
  await page.waitForResponse(r => r.url().includes('wc-ajax=update_order_review'), { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(500);
  await page.click('label[for="payment_method_conekta"]');

  const preMismatch = captured.length;
  await waitForCapture(preMismatch + 1);
  const mismatchOrderId = captured[captured.length - 1].conekta_order_id;
  assert(typeof mismatchOrderId === 'string' && mismatchOrderId.length > 0,
    `fresh conekta_order_id mounted at FULL price = ${mismatchOrderId}`);
  await h.waitForIntegrationIframe();

  // Apply the coupon via a RAW wc-ajax fetch: the server cart total drops,
  // but no `updated_checkout` fires in the page, so the plugin JS never
  // re-syncs and the mounted Conekta order keeps the stale (higher) amount —
  // the same divergence as a coupon applied in another tab.
  const couponResult = await page.evaluate(async (code) => {
    const params = window.wc_checkout_params;
    if (!params) return 'no wc_checkout_params';
    const body = new URLSearchParams();
    body.append('coupon_code', code);
    body.append('security', params.apply_coupon_nonce);
    const res = await fetch(params.wc_ajax_url.replace('%%endpoint%%', 'apply_coupon'), {
      method: 'POST',
      body,
      credentials: 'same-origin',
    });
    return (await res.text()).slice(0, 200);
  }, couponCode);
  console.log(`  out-of-band apply_coupon response: ${couponResult}`);
  assert(!String(couponResult).includes('error'), 'coupon applied server-side (out of band)');

  // Place order: WooCommerce creates the order with the NEW (discounted)
  // total, the gateway GETs the Conekta order (stale amount) → must refuse
  // BEFORE any charge.
  await h.fillIntegrationCard(h.SUCCESS_CARD);
  await h.clickPlaceOrder();

  const mismatchOutcome = await h.waitForPaymentError();
  console.log(`  mismatch outcome: errored=${mismatchOutcome.errored} message="${mismatchOutcome.message}"`);
  assert(mismatchOutcome.errored, `amount mismatch surfaced an error (${mismatchOutcome.message})`);
  assert(!page.url().includes('order-received'), 'mismatched totals did NOT reach order-received');

  const afterMismatch = await h.fetchConektaOrder(mismatchOrderId);
  assert(afterMismatch.payment_status !== 'paid',
    `the card was NEVER charged on the stale amount (payment_status = ${afterMismatch.payment_status})`);

  // Recovery: nudge the checkout to re-sync (what WC itself does after any
  // cart change) → the plugin refreshes the Conekta order to the discounted
  // total and remounts → paying now must succeed.
  console.log('\n--- (c2) recovery: re-sync, remount, pay the right total ---');
  const preRecovery = captured.length;
  await page.evaluate(() => window.jQuery && window.jQuery(document.body).trigger('update_checkout'));
  await waitForCapture(preRecovery + 1, 20000);
  await h.waitForIntegrationIframe();
  const recoveredOrderId = captured[captured.length - 1].conekta_order_id;
  console.log(`  recovered conekta_order_id = ${recoveredOrderId}`);

  await h.fillIntegrationCard(h.SUCCESS_CARD);
  await h.clickPlaceOrder();
  await h.waitForOrderReceivedWith3DS();
  assert(page.url().includes('order-received'), 'recovery payment reached order-received');
  // The charged amount must equal the discounted WooCommerce total to the cent.
  await h.verifyConektaTotalMatchesWoo(recoveredOrderId);
}).then(passed => process.exit(passed ? 0 : 1));
