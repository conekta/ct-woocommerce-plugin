/**
 * E2E: Classic Checkout — duplicate-order guard (BE-879)
 *
 * Regression for the bug where a SINGLE paid Conekta order completed MORE THAN
 * ONE WooCommerce order. It was observed live in staging where WC orders #6360
 * and #6361 both carried the same conekta-order-id (ord_319UXUo5yhiaSU52B),
 * both in "Procesando", same amount — one Conekta charge, two paid WC orders.
 *
 * Root cause: on classic checkout a resubmission (double-click on "Place
 * order", AJAX timeout, browser retry) creates a second WC order while the
 * hidden conekta_order_id stays the same; complete_wc_order_from_conekta() did
 * not check whether that Conekta order was already applied to another WC order.
 *
 * This spec:
 *   1) Drives a real payment through the Integration iframe -> WC order #1 paid,
 *      with conekta_order_id X.
 *   2) Re-adds the product and submits the classic checkout form AGAIN, forcing
 *      the same conekta_order_id X (the resubmission).
 *   3) Asserts the invariant: exactly ONE WC order carries conekta-order-id X in
 *      a paid status. With the guard the duplicate stays unpaid; without it a
 *      second paid order appears (the #6360/#6361 case).
 */
const h = require('./checkout-helpers');

h.run('Classic Checkout — duplicate-order guard', { checkoutType: 'classic' }, async ({ page, assert, config, STORE_URL, BILLING, TEST_CARD }) => {
  // Capture the conekta_order_id the SDK creates via /conekta_checkout_request.
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

  // ---------------------------------------------------------------
  // (1) HAPPY PATH — first real payment
  // ---------------------------------------------------------------
  console.log('--- (1) first payment (happy path) ---');
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

  await waitForCapture(1);
  const conektaOrderId = captured[captured.length - 1].conekta_order_id;
  assert(typeof conektaOrderId === 'string' && conektaOrderId.length > 0,
    `conekta_order_id created = ${conektaOrderId}`);

  await h.waitForIntegrationIframe();
  await h.fillIntegrationCard(TEST_CARD);
  await h.clickPlaceOrder();
  await h.waitForOrderReceivedWith3DS();
  assert(page.url().includes('order-received'), 'first order reached order-received');

  // ---------------------------------------------------------------
  // (2) RESUBMISSION — second checkout reusing the SAME conekta_order_id
  // ---------------------------------------------------------------
  console.log('\n--- (2) resubmission with the same conekta_order_id ---');
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

  const resubmit = await h.submitClassicCheckoutRaw(conektaOrderId);
  console.log(`  resubmission response: status=${resubmit.status} result=${resubmit.json && resubmit.json.result}`);
  // The guard makes the gateway treat this as already-paid and redirect to the
  // existing order, so the WC AJAX result is still "success" (not an error the
  // shopper sees) — but no NEW paid order is created. We assert the real
  // invariant on the order set below rather than on this response shape.
  assert(resubmit.json !== null, 'resubmission returned a WC AJAX response');

  // ---------------------------------------------------------------
  // (3) INVARIANT — exactly one paid WC order for this conekta-order-id
  // ---------------------------------------------------------------
  console.log('\n--- (3) assert single paid order per conekta-order-id ---');
  const orders = await h.findOrdersByConektaOrderId(conektaOrderId);
  const ids = orders.map(o => `#${o.id}(${o.status})`).join(', ');
  console.log(`  orders carrying ${conektaOrderId}: ${ids || 'none'}`);

  const paid = orders.filter(o => h.PAID_STATUSES.includes(o.status));
  assert(paid.length === 1,
    `exactly ONE paid order carries conekta-order-id ${conektaOrderId} (got ${paid.length}: ${ids})`);
}).then(passed => process.exit(passed ? 0 : 1));
