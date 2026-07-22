/**
 * E2E: Classic Checkout — confirm endpoint DOWN: the webhook completes the
 * pending order (the safety net for "paid in Conekta but not in Woo").
 *
 * Reproduces exactly the manual staging test: the charge succeeds but the
 * synchronous confirm call never reaches the server (network drop, tab close,
 * plugin conflict). Under the order-first flow the WC order already exists
 * (pending) with the conekta-order-id meta and reference_id stamped
 * pre-charge, so the order.paid webhook must find it and complete it — the
 * customer money and the store can never disagree.
 *
 * This spec:
 *   1) Blocks every request to the conekta_confirm_order endpoint (route
 *      abort — same as DevTools "Block request URL").
 *   2) Pays with the approved card. Asserts the checkout shows an error and
 *      never reaches order-received (the confirm failed client-side).
 *   3) Asserts the wc-ajax=checkout response proves the WC order was created
 *      BEFORE the charge (conekta_pending_payment + order_id).
 *   4) Waits for the Conekta order to be paid, then polls WooCommerce until
 *      the webhook flips that SAME order to a paid status.
 *   5) Invariant: exactly ONE paid WC order for the conekta-order-id.
 */
const h = require('./checkout-helpers');

h.run('Classic Checkout — confirm blocked: webhook completes the pending order',
  { checkoutType: 'classic' },
  async ({ page, assert, config, STORE_URL, BILLING }) => {
    // (0) Block the confirm endpoint — the same experiment run manually with
    // DevTools "Block request URL" on wc-ajax=conekta_confirm_order.
    await page.route((url) => url.href.includes('conekta_confirm_order'), (route) => route.abort());
    console.log('--- (0) conekta_confirm_order is BLOCKED for this session ---');

    const checkoutRequests = [];
    const checkoutResponses = [];
    page.on('response', async (response) => {
      if (response.request().method() !== 'POST') return;
      const url = response.url();
      if (url.includes('conekta_checkout_request')) {
        try { checkoutRequests.push(await response.json()); } catch (_) { /* body unavailable */ }
      } else if (url.includes('wc-ajax=checkout')) {
        try { checkoutResponses.push(await response.json()); } catch (_) { /* body unavailable */ }
      }
    });
    const waitFor = async (arr, n, label, timeoutMs = 30000) => {
      const start = Date.now();
      while (arr.length < n && Date.now() - start < timeoutMs) {
        await page.waitForTimeout(100);
      }
      if (arr.length < n) throw new Error(`Timeout waiting for ${n} ${label} (got ${arr.length})`);
    };

    // (1) Mount and pay with the approved (non-3DS) card.
    console.log('--- (1) mount + pay with the approved card ---');
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

    await waitFor(checkoutRequests, 1, 'checkout-request POSTs');
    const conektaOrderId = checkoutRequests[checkoutRequests.length - 1].conekta_order_id;
    assert(typeof conektaOrderId === 'string' && conektaOrderId.length > 0,
      `conekta_order_id created = ${conektaOrderId}`);

    await h.waitForIntegrationIframe();
    await h.fillIntegrationCard(h.SUCCESS_CARD);
    await h.clickPlaceOrder();

    // (2) The charge succeeds but the confirm is blocked → error notice, no
    // navigation. Generous timeout: charge + blocked-fetch failure.
    const outcome = await h.waitForPaymentError(90000);
    console.log(`  outcome: errored=${outcome.errored} message="${outcome.message}"`);
    assert(outcome.errored, `blocked confirm surfaced an error on the checkout (${outcome.message})`);
    assert(!page.url().includes('order-received'), 'customer did NOT reach order-received (confirm blocked)');

    // (3) Order-first evidence: the WC order was created before the charge.
    await waitFor(checkoutResponses, 1, 'wc-ajax=checkout responses');
    const first = checkoutResponses[0];
    assert(first && first.result === 'success' && first.conekta_pending_payment === true,
      'checkout response carried conekta_pending_payment (order created pre-charge)');
    const wcOrderId = first && first.order_id;
    assert(!!wcOrderId, `WC order #${wcOrderId} existed before the charge`);

    // (4) Conekta got paid…
    console.log('\n--- (2) Conekta paid, WooCommerce pending → webhook must heal it ---');
    const conektaOrder = await h.waitForConektaPaid(conektaOrderId);
    assert(h.conektaOrderPaid(conektaOrder),
      `Conekta order paid (payment_status=${conektaOrder.payment_status})`);

    // …and the order.paid webhook must complete the SAME pre-charge WC order.
    // Poll for up to 2 minutes: webhook delivery + retries are asynchronous.
    let paidOrders = [];
    let lastSeen = '';
    const start = Date.now();
    while (Date.now() - start < 120000) {
      const orders = await h.findOrdersByConektaOrderId(conektaOrderId);
      lastSeen = orders.map(o => `#${o.id}(${o.status})`).join(', ');
      paidOrders = orders.filter(o => h.PAID_STATUSES.includes(o.status));
      if (paidOrders.length > 0) break;
      console.log(`  waiting for webhook… orders: ${lastSeen || 'none'}`);
      await new Promise(r => setTimeout(r, 5000));
    }

    console.log(`  final orders carrying ${conektaOrderId}: ${lastSeen || 'none'}`);
    assert(paidOrders.length === 1,
      `webhook completed exactly ONE WC order (got ${paidOrders.length}: ${lastSeen})`);
    assert(String(paidOrders[0].id) === String(wcOrderId),
      `the completed order IS the pre-charge order #${wcOrderId} (no duplicate was created)`);
  }).then(passed => process.exit(passed ? 0 : 1));
