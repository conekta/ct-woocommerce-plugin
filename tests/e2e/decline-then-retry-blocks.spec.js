/**
 * E2E: Blocks Checkout — declined charge, then a successful retry on the SAME
 * checkout must leave the order PAID in Conekta AND in WooCommerce.
 *
 * Regression for the recurring "paid in Conekta but not in Woo" desync (seen
 * again in 6.0.5). The dangerous shape is a retry after a decline: the shopper
 * enters a bad card, the charge is declined, then they retry with a good card
 * on the same mounted Conekta order. The good charge must drive WC's
 * process_payment_api and mark the WooCommerce order paid — never leave Conekta
 * paid while Woo stays pending/failed.
 *
 * This spec:
 *   1) Mounts the Blocks checkout and captures the Conekta order id.
 *   2) DECLINE: pays with 4000000000000127 (insufficient funds). Asserts the
 *      checkout shows an error, never reaches order-received, and the Conekta
 *      order is NOT paid.
 *   3) RETRY: pays with 4242424242424242 on the same iframe. Asserts we reach
 *      order-received.
 *   4) INVARIANT: the Conekta order is `paid` AND exactly one WooCommerce order
 *      carrying that conekta-order-id is in a paid status.
 */
const h = require('./checkout-helpers');

h.run('Blocks Checkout — decline then successful retry stays paid in Conekta AND Woo',
  { checkoutType: 'blocks' },
  async ({ page, assert, config, STORE_URL, BILLING }) => {
    const fillBlocksAddress = async () => {
      const emailField = page.locator('#email');
      if (await emailField.isVisible().catch(() => false)) await emailField.fill(BILLING.email);

      const shippingFields = {
        '#shipping-first_name': BILLING.first_name,
        '#shipping-last_name': BILLING.last_name,
        '#shipping-address_1': BILLING.address_1,
        '#shipping-city': BILLING.city,
        '#shipping-postcode': BILLING.postcode,
        '#shipping-phone': BILLING.phone,
      };
      for (const [sel, val] of Object.entries(shippingFields)) {
        const field = page.locator(sel);
        if (await field.isVisible().catch(() => false)) await field.fill(val);
      }
      const stateSel = page.locator('#shipping-state').first();
      if (await stateSel.isVisible().catch(() => false)) {
        await stateSel.selectOption({ value: BILLING.state }).catch(() => {});
      }
      // Let Blocks push the address to the Store API so WC()->customer is synced.
      await page.waitForTimeout(1500);
    };

    // ---------------------------------------------------------------
    // (0) MOUNT — open the Blocks checkout and capture the Conekta order id
    // ---------------------------------------------------------------
    console.log('--- (0) mount blocks checkout ---');
    const createResponse = page.waitForResponse(r =>
      r.url().includes('conekta_checkout_request') && r.request().method() === 'POST'
    );

    await page.goto(`${STORE_URL}/checkout/`);
    await page.waitForLoadState('networkidle');
    await page.waitForSelector('.wc-block-checkout', { timeout: config.timeouts.selector });

    await fillBlocksAddress();
    await page.locator('label:has-text("Tarjeta")').first().click();

    const firstBody = await (await createResponse).json();
    const conektaOrderId = firstBody.conekta_order_id;
    assert(typeof conektaOrderId === 'string' && conektaOrderId.length > 0,
      `conekta_order_id created = ${conektaOrderId}`);

    await h.waitForIntegrationIframe();

    // ---------------------------------------------------------------
    // (1) DECLINE — insufficient-funds card must fail, no order-received
    // ---------------------------------------------------------------
    console.log('\n--- (1) decline: pay with 4000000000000127 (insufficient funds) ---');
    await h.fillIntegrationCard(h.DECLINE_CARD);
    await h.clickPlaceOrder();

    const declineOutcome = await h.waitForPaymentError();
    console.log(`  decline outcome: errored=${declineOutcome.errored} message="${declineOutcome.message}"`);
    assert(declineOutcome.errored, `declined charge surfaced an error (${declineOutcome.message})`);
    assert(!page.url().includes('order-received'), 'declined charge did NOT reach order-received');

    const afterDecline = await h.fetchConektaOrder(conektaOrderId);
    assert(afterDecline.payment_status !== 'paid',
      `Conekta order NOT paid after decline (payment_status = ${afterDecline.payment_status})`);

    // ---------------------------------------------------------------
    // (2) RETRY — good card on the SAME iframe must succeed
    // ---------------------------------------------------------------
    console.log('\n--- (2) retry: pay with 4242424242424242 (approved) ---');
    // Give Conekta a beat to settle the declined charge before the retry, so
    // the second attempt charges cleanly instead of racing the first.
    await page.waitForTimeout(5000);
    await h.fillIntegrationCard(h.SUCCESS_CARD);
    await h.clickPlaceOrder();
    await h.waitForOrderReceivedWith3DS();
    assert(page.url().includes('order-received'), 'retry reached order-received');

    // ---------------------------------------------------------------
    // (3) INVARIANT — paid in Conekta AND exactly one paid WooCommerce order
    // ---------------------------------------------------------------
    console.log('\n--- (3) assert paid in Conekta AND in WooCommerce ---');
    console.log(`  Conekta order id: ${conektaOrderId}  (https://panel.conekta.com/transactions/payments/${conektaOrderId})`);
    // Poll: after a decline-then-retry the order carries a declined + a paid
    // charge, and getOrderById can lag its own paid state by several seconds
    // (observed ~9s in staging, past the order.paid webhook). A single read
    // right after order-received is racy — wait for it to settle to 'paid'.
    const conektaOrder = await h.waitForConektaPaid(conektaOrderId);
    // The order counts as paid if the aggregate payment_status is 'paid' OR any
    // charge is 'paid' — Conekta sometimes leaves the order-level status at
    // 'declined' (from the first failed charge) even though the retry charge
    // succeeded and the customer was charged. See conektaOrderPaid.
    const charges = Array.isArray(conektaOrder.charges)
      ? conektaOrder.charges
      : (conektaOrder.charges && conektaOrder.charges.data) || [];
    const chargeStatuses = charges.map(c => c && c.status).join(',');
    assert(h.conektaOrderPaid(conektaOrder),
      `Conekta order paid (payment_status=${conektaOrder.payment_status}, charges=[${chargeStatuses}])`);

    const orders = await h.findOrdersByConektaOrderId(conektaOrderId);
    const ids = orders.map(o => `#${o.id}(${o.status})`).join(', ');
    console.log(`  orders carrying ${conektaOrderId}: ${ids || 'none'}`);

    const paid = orders.filter(o => h.PAID_STATUSES.includes(o.status));
    assert(paid.length === 1,
      `exactly ONE paid WooCommerce order carries conekta-order-id ${conektaOrderId} (got ${paid.length}: ${ids})`);
  }).then(passed => process.exit(passed ? 0 : 1));
