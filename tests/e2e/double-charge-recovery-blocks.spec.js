/**
 * E2E: Blocks Checkout — ORDER-FIRST (6.2.0): a failed checkout costs $0 and
 * a lost confirm never double-charges.
 *
 * The 2026-08-04 production double charge happened because Blocks charged the
 * card INSIDE onPaymentSetup, BEFORE the Store API /checkout POST created and
 * validated the WooCommerce order. When that POST died, the money had already
 * moved with no WC order linked to it; the webhook fabricated a degraded guest
 * order for the payment, and the customer — still on the checkout — paid a
 * fresh Conekta order 7 minutes later.
 *
 * 6.2.0 inverts the flow (mirror of classic's 6.1.0 order-first): the charge
 * fires in onCheckoutSuccess, AFTER the WC order exists, passed validation and
 * carries the conekta-order-id meta + reference_id. This spec pins the two
 * structural guarantees that buys:
 *
 *   1) THE PRODUCTION FAILURE NOW COSTS $0: with the Store API checkout POST
 *      blocked, "Realizar el pedido" moves NO money — the Conekta order stays
 *      unpaid, because the charge only fires after a successful checkout.
 *   2) A LOST CONFIRM CANNOT DOUBLE-CHARGE: with the confirm endpoint blocked,
 *      the charge lands on an order that is ALREADY linked two-way. The
 *      in-page "Reintentar pago" re-runs ONLY the idempotent confirm (never
 *      the charge), and the payment completes the SAME WooCommerce order —
 *      exactly one paid charge, exactly one paid WC order, reference_id
 *      stamped (the link the incident's first charge never had).
 */
const h = require('./checkout-helpers');

h.run('Blocks Checkout — order-first: failed checkout costs $0, lost confirm never double-charges',
  { checkoutType: 'blocks' },
  async ({ page, assert, config, STORE_URL, BILLING }) => {
    const checkoutRequests = [];   // conekta_checkout_request responses
    const storeApiPosts = [];      // Store API /checkout POST payloads

    const STORE_API_CHECKOUT = /\/wc\/store\/v1\/checkout(\?|$)/;
    const CONFIRM_ENDPOINT = /wc-ajax=conekta_confirm_order/;

    page.on('response', async (response) => {
      if (response.request().method() !== 'POST') return;
      if (!response.url().includes('conekta_checkout_request')) return;
      try { checkoutRequests.push(await response.json()); } catch (_) { /* body unavailable */ }
    });

    page.on('request', (request) => {
      if (request.method() !== 'POST' || !STORE_API_CHECKOUT.test(request.url())) return;
      let payload = null;
      try { payload = JSON.parse(request.postData() || 'null'); } catch (_) { /* not JSON */ }
      storeApiPosts.push({ payload });
    });

    // Every 4xx/5xx of the run, with a body preview — the first place to look
    // when a step fails without an obvious reason.
    const httpFailures = [];
    page.on('response', async (response) => {
      if (response.status() < 400) return;
      let preview = '';
      try { preview = (await response.text()).replace(/\s+/g, ' ').slice(0, 300); } catch (_) { /* body gone */ }
      httpFailures.push(`${response.status()} ${response.request().method()} ${response.url().slice(0, 160)} → ${preview}`);
    });

    /** Paid charges on a Conekta order — Conekta returns lists as arrays or { data: [...] }. */
    const paidCharges = (order) => {
      const charges = Array.isArray(order && order.charges)
        ? order.charges
        : (order && order.charges && order.charges.data) || [];
      return charges.filter(c => c && c.status === 'paid');
    };

    /**
     * Answers the 3DS challenge (when the card triggers one) and returns as
     * soon as Conekta reports the order paid. Scoped to the Conekta 3DS frames.
     */
    const driveThreeDsUntilPaid = async (conektaOrderId, timeoutMs = 90000) => {
      const otpSelector = [
        'input[name*="otp" i]', 'input[id*="otp" i]',
        'input[name*="code" i]', 'input[id*="code" i]',
        'input[autocomplete*="one-time"]', 'input[type="tel"]',
      ].join(', ');
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        for (const frame of page.frames()) {
          let host = '';
          try { host = new URL(frame.url()).hostname; } catch (_) { continue; }
          if (host !== '3ds-pay.conekta.com' && host !== '3ds-acs.conekta.com') continue;
          const otp = frame.locator(otpSelector).first();
          if (!(await otp.isVisible({ timeout: 200 }).catch(() => false))) continue;
          if (!(await otp.inputValue().catch(() => ''))) await otp.fill('1234').catch(() => {});
          await otp.press('Enter').catch(() => {});
          const submit = frame.locator('button').filter({ hasText: /submit|enviar|confirmar|continuar|pagar/i }).first();
          if (await submit.isVisible({ timeout: 200 }).catch(() => false)) {
            await submit.click({ force: true, timeout: 1500 }).catch(() => {});
          }
          await page.waitForTimeout(1000);
        }
        const order = await h.fetchConektaOrder(conektaOrderId).catch(() => null);
        if (h.conektaOrderPaid(order)) return order;
        await page.waitForTimeout(2000);
      }
      return null;
    };

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
    // (0) MOUNT
    // ---------------------------------------------------------------
    console.log('--- (0) mount blocks checkout ---');
    await page.goto(`${STORE_URL}/checkout/`);
    await page.waitForLoadState('networkidle');
    await page.waitForSelector('.wc-block-checkout', { timeout: config.timeouts.selector });

    await fillBlocksAddress();
    await page.locator('label:has-text("Tarjeta")').first().click();

    const waitFor = async (arr, n, label, timeoutMs = 30000) => {
      const start = Date.now();
      while (arr.length < n && Date.now() - start < timeoutMs) {
        await page.waitForTimeout(100);
      }
      if (arr.length < n) throw new Error(`Timeout waiting for ${n} ${label} (got ${arr.length})`);
    };
    await waitFor(checkoutRequests, 1, 'checkout-request POSTs');
    await h.waitForIntegrationIframe();
    await h.fillIntegrationCard(h.SUCCESS_CARD);

    // ---------------------------------------------------------------
    // (1) THE PRODUCTION FAILURE, NOW FREE — checkout blocked ⇒ $0 charged
    // ---------------------------------------------------------------
    console.log('\n--- (1) Place Order with the Store API checkout BLOCKED ---');
    // The last mounted order is what a charge would land on.
    const mountedBeforeBlock = checkoutRequests[checkoutRequests.length - 1].conekta_order_id;
    assert(typeof mountedBeforeBlock === 'string' && mountedBeforeBlock.length > 0,
      `mounted Conekta order = ${mountedBeforeBlock}`);

    await page.route(STORE_API_CHECKOUT, async (route) => (
      route.request().method() === 'POST' ? route.abort() : route.continue()
    ));
    await h.clickPlaceOrder();

    // Pre-6.2.0 the money was ALREADY gone at this point (the charge fired in
    // onPaymentSetup, before the blocked POST). Under order-first the charge
    // only fires after a successful checkout — give it ample time to prove no
    // late charge lands.
    await page.waitForTimeout(10000);
    const afterBlockedCheckout = await h.fetchConektaOrder(mountedBeforeBlock).catch(() => null);
    assert(!h.conektaOrderPaid(afterBlockedCheckout),
      `NO money moved on a failed checkout (payment_status=${(afterBlockedCheckout && afterBlockedCheckout.payment_status) ?? 'unreachable'})`);
    assert(!page.url().includes('order-received'),
      'the blocked checkout never reached order-received');
    await page.unroute(STORE_API_CHECKOUT);

    // ---------------------------------------------------------------
    // (2) LOST CONFIRM — charge lands on an already-linked order
    // ---------------------------------------------------------------
    console.log('\n--- (2) Place Order with the CONFIRM endpoint blocked ---');
    const requestsBeforeCharge = checkoutRequests.length;
    await page.route(CONFIRM_ENDPOINT, async (route) => (
      route.request().method() === 'POST' ? route.abort() : route.continue()
    ));

    await h.clickPlaceOrder();

    // The checkout POST goes through now; the charge fires in
    // onCheckoutSuccess. The order it lands on is whatever the last
    // checkout-request mounted (normally the same as step 1).
    await waitFor(storeApiPosts, 1, 'Store API checkout POSTs');
    const paidOrderId = checkoutRequests[checkoutRequests.length - 1].conekta_order_id || mountedBeforeBlock;
    const charged = await driveThreeDsUntilPaid(paidOrderId);
    if (!h.conektaOrderPaid(charged)) {
      const notice = await h.waitForPaymentError(5000);
      throw new Error([
        'The charge never landed, so the lost-confirm scenario could not be set up.',
        `Conekta payment_status=${(charged && charged.payment_status) ?? 'unreachable'}`,
        `checkout notice="${notice.message}"`,
        `Store API checkout POSTs seen=${storeApiPosts.length}`,
        `last checkout-request=${JSON.stringify(checkoutRequests[checkoutRequests.length - 1] || null)}`,
        httpFailures.length
          ? `HTTP failures:\n    - ${httpFailures.join('\n    - ')}`
          : 'no HTTP failures observed',
      ].join('\n  '));
    }
    assert(h.conektaOrderPaid(charged), `Conekta order ${paidOrderId} is PAID`);
    assert(!page.url().includes('order-received'),
      'the customer did NOT reach order-received (the confirm was blocked)');

    // Order-first stamps reference_id on the pre-charge PUT — the link whose
    // absence let the incident's first charge orphan. It must exist NOW,
    // while the confirm is still blocked: nothing after the charge is needed.
    const referenceId = (charged.metadata || {}).reference_id;
    assert(!!referenceId,
      `the charged Conekta order carries metadata.reference_id=${referenceId} BEFORE any completion ran`);

    // The in-page retry is offered instead of a payable iframe remount.
    const retryButton = page.locator('.conekta-retry-payment');
    const retryVisible = await retryButton.isVisible({ timeout: 15000 }).catch(() => false);
    assert(retryVisible, 'the "Reintentar pago" button is shown after the lost confirm');

    await page.unroute(CONFIRM_ENDPOINT);

    // ---------------------------------------------------------------
    // (3) RETRY — re-confirms WITHOUT re-charging
    // ---------------------------------------------------------------
    console.log('\n--- (3) click "Reintentar pago" with the confirm unblocked ---');
    await retryButton.click();

    const deadline = Date.now() + 60000;
    while (!page.url().includes('order-received') && Date.now() < deadline) {
      await page.waitForTimeout(500);
    }
    assert(page.url().includes('order-received'), 'the retry reached order-received');

    // No replacement Conekta order after the charge: the retry never goes
    // back through checkout-request.
    const newIds = checkoutRequests
      .slice(requestsBeforeCharge)
      .map(r => r && r.conekta_order_id)
      .filter(id => id && id !== paidOrderId);
    assert(newIds.length === 0,
      `no replacement Conekta order was created after the charge (unexpected: ${newIds.join(', ') || 'none'})`);

    // ---------------------------------------------------------------
    // (4) CHARGED ONCE, AND THE LINKED ORDER IS THE ONE PAID
    // ---------------------------------------------------------------
    console.log('\n--- (4) exactly one charge, applied to the pre-linked WC order ---');
    console.log(`  Conekta order: https://panel.conekta.com/transactions/payments/${paidOrderId}`);
    const settled = await h.waitForConektaPaid(paidOrderId);
    const paidCount = paidCharges(settled).length;
    assert(paidCount === 1, `the customer was charged exactly ONCE (paid charges: ${paidCount})`);

    // Resolved through the reverse link stamped PRE-charge by
    // process_payment_api — safe to navigate now, the page work is done.
    const orders = await h.findOrdersByConektaOrderId(paidOrderId);
    const ids = orders.map(o => `#${o.id}(${o.status})`).join(', ');
    console.log(`  orders carrying ${paidOrderId}: ${ids || 'none'}`);
    const paid = orders.filter(o => h.PAID_STATUSES.includes(o.status));
    assert(paid.length === 1,
      `exactly ONE paid WC order carries the payment (got ${paid.length}: ${ids || 'none'})`);

    const wcOrderId = String(paid[0].id);
    assert(String(referenceId) === wcOrderId,
      `metadata.reference_id (${referenceId}) points at the paid WC order #${wcOrderId} — the two-way link exists`);

    const finalOrder = await h.wcApi('GET', `wc/v3/orders/${wcOrderId}`);
    console.log(`  WC order #${wcOrderId} final status: ${finalOrder && finalOrder.status}`);
    assert(finalOrder && finalOrder.status !== 'checkout-draft',
      `WC order #${wcOrderId} is a real order (status=${finalOrder && finalOrder.status}), not a leftover draft`);
  }).then(passed => process.exit(passed ? 0 : 1));
