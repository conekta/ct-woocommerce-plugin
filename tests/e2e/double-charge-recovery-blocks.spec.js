/**
 * E2E: Blocks Checkout — NO SECOND CHARGE after an orphaned payment (6.1.1)
 *
 * Blocks analogue of double-charge-recovery-classic.spec.js, but for the
 * trigger that is specific to this flow. On Blocks the SDK charges the card
 * INSIDE onPaymentSetup, and only then does WC POST /wc/store/v1/checkout to
 * complete the order. When that POST fails (network drop, validation, stock)
 * the payment is orphaned — and pre-6.1.1 the retry made it worse: the
 * pre-charge gate re-POSTed /checkout-request, `updateOrder` failed *because
 * Conekta rejects updates on a paid order*, the plugin created a REPLACEMENT
 * Conekta order, mounted a fresh payable iframe, and the next click charged the
 * card a second time.
 *
 * The spec:
 *   1) Mounts the Blocks checkout and captures the Conekta order id (A).
 *   2) ABORTS the Store API checkout POST and pays with the approved card. The
 *      card IS charged; the WooCommerce draft order is never completed —
 *      exactly the orphaned state seen in production.
 *   3) RETRIES "Realizar el pedido" with the Store API unblocked. Asserts the
 *      retry REUSES the already-charged Conekta order (the Store API POST
 *      carries conekta_order_id = A) instead of charging again, and that no
 *      replacement Conekta order was ever created.
 *   4) Asserts the customer was charged ONCE (a single paid charge on A) and
 *      that the payment completed the SAME WooCommerce order the charge was
 *      linked to — which for Blocks means the `checkout-draft` order was
 *      promoted and paid, not left invisible in the admin.
 *
 * Like the classic spec, it never calls h.waitForOrderReceivedWith3DS for the
 * orphaned charge: that helper waits for a navigation that cannot happen here.
 * The local driver below only touches the Conekta 3DS frames.
 */
const h = require('./checkout-helpers');

h.run('Blocks Checkout — an orphaned payment is reused on retry, never charged again',
  { checkoutType: 'blocks' },
  async ({ page, assert, config, STORE_URL, BILLING }) => {
    const checkoutRequests = [];   // conekta_checkout_request responses
    const storeApiPosts = [];      // Store API /checkout POST payloads

    // Network INSTRUMENTATION here is deliberately passive — listeners only, no
    // interception. Two sibling specs (decline-then-retry, duplicate-order)
    // charge successfully with the same helpers, so the interception this spec
    // adds is the one variable that can break a charge; the only route ever
    // installed is the Store API block below, and only for the single click
    // that must fail. Request bodies are readable from page.on('request')
    // without touching the request at all.
    const STORE_API_CHECKOUT = /\/wc\/store\/v1\/checkout(\?|$)/;

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

    // Every 4xx/5xx of the run, with a body preview. When the charge fails to
    // land, the answer is almost always in here (a checkout-request 400 such as
    // 'Cart is empty', or a Conekta API rejection) — and without it the spec
    // reports "not paid" with no way to tell why.
    const httpFailures = [];
    page.on('response', async (response) => {
      if (response.status() < 400) return;
      let preview = '';
      try { preview = (await response.text()).replace(/\s+/g, ' ').slice(0, 300); } catch (_) { /* body gone */ }
      httpFailures.push(`${response.status()} ${response.request().method()} ${response.url().slice(0, 160)} → ${preview}`);
    });

    /** conekta_order_id sent on a Store API checkout POST (payment_data is a key/value list). */
    const sentConektaOrderId = (payload) => {
      const data = payload && payload.payment_data;
      if (Array.isArray(data)) {
        const entry = data.find(d => d && d.key === 'conekta_order_id');
        return entry ? String(entry.value) : null;
      }
      if (data && typeof data === 'object' && data.conekta_order_id) return String(data.conekta_order_id);
      return null;
    };

    /** Paid charges on a Conekta order — Conekta returns lists as arrays or { data: [...] }. */
    const paidCharges = (order) => {
      const charges = Array.isArray(order && order.charges)
        ? order.charges
        : (order && order.charges && order.charges.data) || [];
      return charges.filter(c => c && c.status === 'paid');
    };

    /**
     * Answers the 3DS challenge (when the card triggers one) and returns as
     * soon as Conekta reports the order paid. Scoped to the Conekta 3DS frames
     * on purpose — see the note at the top of this file.
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
    // Read AFTER the iframe settles: an early POST can still be superseded
    // (e.g. the order is recreated once the real customer name arrives), and
    // only the last one is what the customer actually pays.
    const paidOrderId = checkoutRequests[checkoutRequests.length - 1].conekta_order_id;
    assert(typeof paidOrderId === 'string' && paidOrderId.length > 0,
      `mounted Conekta order = ${paidOrderId}`);

    // ---------------------------------------------------------------
    // (1) ORPHAN THE PAYMENT — charge succeeds, Store API checkout fails
    // ---------------------------------------------------------------
    console.log('\n--- (1) charge with the Store API checkout blocked ---');
    const requestsBeforeCharge = checkoutRequests.length;
    await h.fillIntegrationCard(h.SUCCESS_CARD);

    // Installed as late as possible and removed as soon as the charge lands, so
    // no interception is in place while the iframe mounts, while the pre-charge
    // gate runs, or during the retry. Only the POST is aborted; anything else on
    // that URL passes through untouched.
    await page.route(STORE_API_CHECKOUT, async (route) => (
      route.request().method() === 'POST' ? route.abort() : route.continue()
    ));

    await h.clickPlaceOrder();

    const charged = await driveThreeDsUntilPaid(paidOrderId);
    assert(h.conektaOrderPaid(charged),
      `Conekta order ${paidOrderId} is PAID (payment_status=${(charged && charged.payment_status) ?? 'unreachable'})`);

    // Everything below needs a real charge to exist. assert() only counts,
    // it does not throw, so stop here explicitly — with the evidence — instead
    // of cascading into meaningless failures (or a TypeError on a null order).
    if (!h.conektaOrderPaid(charged)) {
      const notice = await h.waitForPaymentError(5000);
      throw new Error([
        'The charge never landed, so the orphaned-payment scenario could not be set up.',
        `Conekta payment_status=${(charged && charged.payment_status) ?? 'unreachable'}`,
        `checkout notice="${notice.message}"`,
        `Store API checkout POSTs seen=${storeApiPosts.length}`,
        `last checkout-request=${JSON.stringify(checkoutRequests[checkoutRequests.length - 1] || null)}`,
        httpFailures.length
          ? `HTTP failures:\n    - ${httpFailures.join('\n    - ')}`
          : 'no HTTP failures observed',
      ].join('\n  '));
    }

    await page.unroute(STORE_API_CHECKOUT);

    assert(storeApiPosts.length >= 1,
      `the Store API checkout POST fired and was blocked (${storeApiPosts.length} POST(s) seen)`);
    assert(!page.url().includes('order-received'),
      'the customer never reached order-received (the Store API checkout was blocked)');

    // NOTHING that identifies the WC order is looked up here, on purpose:
    // h.wcApi() / h.findOrdersByConektaOrderId() navigate the page to
    // /wp-admin, which would destroy the in-page JS state (the remembered
    // charged order id) that the retry below exists to exercise. The orphaned
    // state is already established by the blocked POST + a paid Conekta order +
    // no order-received; the order itself is resolved after the retry.
    //
    // metadata.reference_id is NOT a reliable id source on blocks and is only
    // logged: the pre-charge gate requires mode='unchanged' to allow the
    // charge, and that short-circuit returns BEFORE the setMetadata() call, so
    // the last checkout-request before a charge never pushes reference_id. When
    // no earlier update ran while the Blocks draft existed, it stays null and
    // the reverse `conekta-order-id` order meta is the only link — which is
    // exactly what the assertions below rely on.
    console.log(`  metadata.reference_id on the Conekta order: ${(charged.metadata || {}).reference_id ?? 'null (blocks, expected)'}`);

    // ---------------------------------------------------------------
    // (2) RETRY — must reuse the payment, never charge again
    // ---------------------------------------------------------------
    console.log('\n--- (2) retry Place Order with the Store API unblocked ---');
    const postsBeforeRetry = storeApiPosts.length;

    await h.clickPlaceOrder();
    await h.waitForOrderReceivedWith3DS();
    assert(page.url().includes('order-received'), 'the retry reached order-received');

    const retryPosts = storeApiPosts.slice(postsBeforeRetry);
    assert(retryPosts.length > 0, `the retry POSTed the Store API checkout (${retryPosts.length})`);
    const retryOrderId = sentConektaOrderId(retryPosts[retryPosts.length - 1].payload);
    assert(retryOrderId === paidOrderId,
      `the retry reused the ALREADY-CHARGED Conekta order (sent ${retryOrderId}, charged ${paidOrderId})`);

    // No replacement order at any point after the charge: pre-fix the
    // pre-charge gate recreated one here and the next click charged it.
    const newIds = checkoutRequests
      .slice(requestsBeforeCharge)
      .map(r => r && r.conekta_order_id)
      .filter(id => id && id !== paidOrderId);
    assert(newIds.length === 0,
      `no replacement Conekta order was created after the charge (unexpected: ${newIds.join(', ') || 'none'})`);

    // ---------------------------------------------------------------
    // (3) CHARGED ONCE, AND THE DRAFT ORDER IS PAID
    // ---------------------------------------------------------------
    console.log('\n--- (3) exactly one charge, and the orphan completed ---');
    console.log(`  Conekta order: https://panel.conekta.com/transactions/payments/${paidOrderId}`);
    const settled = await h.waitForConektaPaid(paidOrderId);
    const paidCount = paidCharges(settled).length;
    assert(paidCount === 1, `the customer was charged exactly ONCE (paid charges: ${paidCount})`);

    // The WC order is resolved through the reverse link (the conekta-order-id
    // meta the plugin stamps on every checkout-request) — safe to navigate now,
    // the page work is done. A single paid order here is also what proves the
    // draft was promoted rather than left behind: an unpromoted 'checkout-draft'
    // is not a paid status, so it would not survive this filter.
    const orders = await h.findOrdersByConektaOrderId(paidOrderId);
    const ids = orders.map(o => `#${o.id}(${o.status})`).join(', ');
    console.log(`  orders carrying ${paidOrderId}: ${ids || 'none'}`);
    const paid = orders.filter(o => h.PAID_STATUSES.includes(o.status));
    assert(paid.length === 1,
      `exactly ONE paid WC order carries the payment (got ${paid.length}: ${ids || 'none'}) — no duplicate order, no duplicate charge`);

    const wcOrderId = String(paid[0].id);
    const finalOrder = await h.wcApi('GET', `wc/v3/orders/${wcOrderId}`);
    console.log(`  WC order #${wcOrderId} final status: ${finalOrder && finalOrder.status}`);
    assert(finalOrder && finalOrder.status !== 'checkout-draft',
      `WC order #${wcOrderId} is a real order (status=${finalOrder && finalOrder.status}), not a leftover draft`);

    // Conekta -> WooCommerce back-reference: completion stamps the WC order id
    // as reference_id on the card charge. In the production incident this was
    // the tell — only the SECOND charge carried a "Referencia", proving the
    // first payment had never completed an order. Informational: it is a
    // best-effort PUT that never blocks completion.
    const chargeReference = (paidCharges(settled)[0] || {}).reference_id;
    console.log(`  charge reference_id: ${chargeReference ?? 'none'} (WC order #${wcOrderId})`);
  }).then(passed => process.exit(passed ? 0 : 1));
