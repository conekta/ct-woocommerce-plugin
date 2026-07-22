/**
 * E2E: Classic Checkout — ORDER-FIRST contract (6.1.0 redesign)
 *
 * The 6.1.0 flow inversion: "Place order" creates the WooCommerce order
 * (pending) BEFORE any charge; the SDK charge fires only after the server
 * answers `conekta_pending_payment`, and the confirm endpoint completes it.
 * This spec pins the whole new contract with a decline-then-retry in the
 * middle (the shape that used to produce "paid in Conekta, nothing in Woo"):
 *
 *   1) Mounts the classic checkout (with an address line 2 / colonia) and
 *      captures the Conekta order id.
 *   2) DECLINE: pays with the insufficient-funds card. Asserts the
 *      wc-ajax=checkout response that preceded the charge carries
 *      result=success + conekta_pending_payment + order_id — the WC order
 *      existed BEFORE the card was ever charged.
 *   3) RETRY: pays with the approved card. Asserts the second checkout
 *      response reuses the SAME WC order id (order_awaiting_payment).
 *   4) INVARIANTS on the paid Conekta order: metadata.reference_id is the WC
 *      order id, customer_info carries the real shopper name (no 'Cliente'
 *      placeholder), shipping_contact.address.street2 carries the colonia,
 *      and exactly ONE paid WC order holds the conekta-order-id meta.
 *   5) The order notes persist the order-first evidence: the "esperando el
 *      cobro" note (pre-charge) exists alongside the confirmation note.
 */
const h = require('./checkout-helpers');

const ADDRESS_2 = 'Depto 4 Colonia Centro';

h.run('Classic Checkout — order-first contract (order before charge, retry reuse, real data in Conekta)',
  { checkoutType: 'classic' },
  async ({ page, assert, config, STORE_URL, BILLING }) => {
    // Capture every checkout-request (Conekta order sync) and wc-ajax=checkout
    // (WC order creation) response. NOTE: 'wc-ajax=checkout' does NOT match
    // 'wc-ajax=conekta_checkout_request' — different query values.
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

    // ---------------------------------------------------------------
    // (0) MOUNT — classic checkout with a colonia in address line 2
    // ---------------------------------------------------------------
    console.log('--- (0) mount classic checkout (with address_2) ---');
    await page.goto(`${STORE_URL}/checkout/`);
    await page.waitForLoadState('networkidle');
    await page.waitForSelector('form.checkout', { timeout: config.timeouts.selector });

    await page.fill('#billing_first_name', BILLING.first_name);
    await page.fill('#billing_last_name', BILLING.last_name);
    await page.fill('#billing_address_1', BILLING.address_1);
    const address2 = page.locator('#billing_address_2');
    if (await address2.isVisible().catch(() => false)) {
      await address2.fill(ADDRESS_2);
    }
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

    // ---------------------------------------------------------------
    // (1) DECLINE — the WC order must exist BEFORE the failed charge
    // ---------------------------------------------------------------
    console.log('\n--- (1) decline: insufficient funds card ---');
    await h.fillIntegrationCard(h.DECLINE_CARD);
    await h.clickPlaceOrder();

    const declineOutcome = await h.waitForPaymentError();
    console.log(`  decline outcome: errored=${declineOutcome.errored} message="${declineOutcome.message}"`);
    assert(declineOutcome.errored, `declined charge surfaced an error (${declineOutcome.message})`);
    assert(!page.url().includes('order-received'), 'declined charge did NOT reach order-received');

    // ORDER-FIRST: the checkout POST resolved BEFORE the charge even ran —
    // its response must say "order created, fire the charge".
    await waitFor(checkoutResponses, 1, 'wc-ajax=checkout responses');
    const first = checkoutResponses[0];
    assert(first && first.result === 'success', 'checkout POST succeeded before the charge');
    assert(first && first.conekta_pending_payment === true,
      'checkout response carries conekta_pending_payment (charge gated on order creation)');
    const wcOrderId = first && first.order_id;
    assert(!!wcOrderId, `WC order #${wcOrderId} was created BEFORE the (failed) charge`);
    assert(typeof first.order_key === 'string' && first.order_key.length > 0,
      'checkout response carries the order_key for the confirm endpoint');

    // ---------------------------------------------------------------
    // (2) RETRY — approved card must reuse the SAME WC order
    // ---------------------------------------------------------------
    console.log('\n--- (2) retry: approved card on the same checkout ---');
    // Give Conekta a beat to settle the declined charge before the retry.
    await page.waitForTimeout(5000);
    await h.fillIntegrationCard(h.SUCCESS_CARD);
    await h.clickPlaceOrder();
    await h.waitForOrderReceivedWith3DS();
    assert(page.url().includes('order-received'), 'retry reached order-received');

    const last = checkoutResponses[checkoutResponses.length - 1];
    assert(checkoutResponses.length >= 2, `retry posted the checkout again (${checkoutResponses.length} POSTs)`);
    assert(String(last && last.order_id) === String(wcOrderId),
      `retry REUSED WC order #${wcOrderId} (got #${last && last.order_id}) — no duplicate order`);

    // ---------------------------------------------------------------
    // (3) INVARIANTS — real data + two-way link on the paid Conekta order
    // ---------------------------------------------------------------
    console.log('\n--- (3) paid Conekta order carries real data + reference_id ---');
    const conektaOrder = await h.waitForConektaPaid(conektaOrderId);
    assert(h.conektaOrderPaid(conektaOrder), `Conekta order paid (payment_status=${conektaOrder.payment_status})`);

    const metadata = conektaOrder.metadata || {};
    assert(String(metadata.reference_id) === String(wcOrderId),
      `metadata.reference_id = WC order id (${metadata.reference_id} === ${wcOrderId})`);

    const customerName = (conektaOrder.customer_info && conektaOrder.customer_info.name) || '';
    assert(customerName.includes(BILLING.first_name),
      `customer_info.name is the real shopper ("${customerName}"), not the 'Cliente' placeholder`);
    assert(customerName !== 'Cliente', 'customer_info.name is not the placeholder');

    const shippingAddress = (conektaOrder.shipping_contact && conektaOrder.shipping_contact.address) || {};
    assert(shippingAddress.street1 && shippingAddress.street1.includes(BILLING.address_1),
      `shipping_contact.address.street1 = "${shippingAddress.street1}"`);
    assert(shippingAddress.street2 === ADDRESS_2,
      `shipping_contact.address.street2 carries the colonia ("${shippingAddress.street2}")`);

    const orders = await h.findOrdersByConektaOrderId(conektaOrderId);
    const ids = orders.map(o => `#${o.id}(${o.status})`).join(', ');
    console.log(`  orders carrying ${conektaOrderId}: ${ids || 'none'}`);
    const paid = orders.filter(o => h.PAID_STATUSES.includes(o.status));
    assert(paid.length === 1, `exactly ONE paid WC order (got ${paid.length}: ${ids})`);
    assert(String(paid[0].id) === String(wcOrderId), `the paid order IS the pre-charge order #${wcOrderId}`);

    // ---------------------------------------------------------------
    // (4) PERSISTED EVIDENCE — order notes prove pending-before-charge
    // ---------------------------------------------------------------
    console.log('\n--- (4) order notes: order-first evidence ---');
    const notes = await h.wcApi('GET', `wc/v3/orders/${wcOrderId}/notes`);
    const noteTexts = Array.isArray(notes) ? notes.map(n => n.note) : [];
    assert(noteTexts.some(n => n.includes('esperando el cobro')),
      'order has the pre-charge "esperando el cobro" note (order existed before the charge)');
    assert(noteTexts.some(n => n.includes('Pago confirmado con Conekta') || n.includes('notification of payment received')),
      'order has a payment confirmation note (confirm endpoint or webhook)');
  }).then(passed => process.exit(passed ? 0 : 1));
