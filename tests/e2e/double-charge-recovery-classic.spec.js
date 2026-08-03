/**
 * E2E: Classic Checkout — NO SECOND CHARGE after an orphaned payment (6.1.1)
 *
 * The bug: two PAID Conekta orders for a single cart. It happened when the
 * charge succeeded but the WooCommerce order was never completed (the confirm
 * call lost, a 3DS challenge navigating the top window away, the customer
 * reloading /checkout/). Our checkout-state transient was gone — or updateOrder
 * failed because Conekta rejects updates on a paid order — so /checkout-request
 * created a REPLACEMENT Conekta order, the JS mounted a fresh payable iframe,
 * and the customer paid again. Unit tests can pin the guard, but only e2e can
 * reproduce the trigger: a real charge, a real page reload, a real transient.
 *
 * The spec:
 *   1) Mounts the classic checkout and captures the Conekta order id (A).
 *   2) ABORTS the confirm endpoint (wc-ajax=conekta_confirm_order) and pays
 *      with the approved card. The card IS charged; the WC order stays pending
 *      — exactly the orphaned state seen in production.
 *   3) RELOADS /checkout/ — which clears the checkout-state transient
 *      (reset_session_on_checkout_entry), the state the customer's browser was
 *      in when it paid a second time.
 *   4) Asserts the recovery instead of a replacement: /checkout-request answers
 *      mode='already_paid' with the SAME Conekta order id (A) and a redirect,
 *      NEVER a new order id. Pre-fix this returned mode='create' with a brand
 *      new payable order — the second charge.
 *   5) Asserts the orphan got reconciled: the browser lands on order-received,
 *      the pre-charge WC order is now paid, and exactly ONE paid WC order
 *      carries A.
 *
 * Being the only spec that must observe an INCOMPLETE payment, it never calls
 * h.waitForOrderReceivedWith3DS: that helper waits for a navigation which
 * cannot happen here, and it scans the MAIN frame for OTP-looking inputs (the
 * billing phone is type="tel"), pressing Enter inside the checkout form and
 * re-submitting it — which would complete the order and mask the scenario. The
 * local driver below only touches the Conekta 3DS frames.
 */
const h = require('./checkout-helpers');

h.run('Classic Checkout — an orphaned payment is recovered, never charged again',
  { checkoutType: 'classic' },
  async ({ page, assert, config, STORE_URL, BILLING }) => {
    const checkoutRequests = [];   // conekta_checkout_request responses
    const checkoutResponses = [];  // wc-ajax=checkout responses

    // checkout-request bodies are captured through a ROUTE, not page.on
    // ('response'): the already_paid answer makes the JS navigate immediately,
    // and reading a body after its page navigated away intermittently fails —
    // which would silently drop the single response this spec exists to assert.
    // Fetching inside the route stores the body before the page ever sees it.
    await page.route('**/*conekta_checkout_request*', async (route) => {
      const response = await route.fetch();
      const body = await response.text();
      try { checkoutRequests.push(JSON.parse(body)); } catch (_) { /* not JSON */ }
      await route.fulfill({ response, body });
    });

    page.on('response', async (response) => {
      if (response.request().method() !== 'POST') return;
      if (!response.url().includes('wc-ajax=checkout')) return;
      try { checkoutResponses.push(await response.json()); } catch (_) { /* body unavailable */ }
    });
    const waitFor = async (arr, n, label, timeoutMs = 30000) => {
      const start = Date.now();
      while (arr.length < n && Date.now() - start < timeoutMs) {
        await page.waitForTimeout(100);
      }
      if (arr.length < n) throw new Error(`Timeout waiting for ${n} ${label} (got ${arr.length})`);
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

    const fillBilling = async () => {
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
    };

    // ---------------------------------------------------------------
    // (0) MOUNT
    // ---------------------------------------------------------------
    console.log('--- (0) mount classic checkout ---');
    await page.goto(`${STORE_URL}/checkout/`);
    await page.waitForLoadState('networkidle');
    await page.waitForSelector('form.checkout', { timeout: config.timeouts.selector });
    await fillBilling();
    await page.click('label[for="payment_method_conekta"]');

    await waitFor(checkoutRequests, 1, 'checkout-request POSTs');
    await h.waitForIntegrationIframe();
    // The id backing the MOUNTED iframe — the one about to be charged. Read
    // after the iframe settles: an early POST can still be superseded (e.g. the
    // order is recreated once the real customer name arrives), and only the
    // last one is what the customer actually pays.
    const paidOrderId = checkoutRequests[checkoutRequests.length - 1].conekta_order_id;
    assert(typeof paidOrderId === 'string' && paidOrderId.length > 0,
      `mounted Conekta order = ${paidOrderId}`);

    // ---------------------------------------------------------------
    // (1) ORPHAN THE PAYMENT — charge succeeds, confirm never lands
    // ---------------------------------------------------------------
    console.log('\n--- (1) charge with the confirm endpoint blocked ---');
    await page.route('**/*conekta_confirm_order*', route => route.abort());

    const requestsBeforeCharge = checkoutRequests.length;
    await h.fillIntegrationCard(h.SUCCESS_CARD);
    await h.clickPlaceOrder();

    await waitFor(checkoutResponses, 1, 'wc-ajax=checkout responses');
    const preCharge = checkoutResponses[0];
    assert(preCharge && preCharge.conekta_pending_payment === true,
      'the WC order was created BEFORE the charge (conekta_pending_payment)');
    const wcOrderId = preCharge && preCharge.order_id;
    assert(!!wcOrderId, `pre-charge WC order = #${wcOrderId}`);

    const charged = await driveThreeDsUntilPaid(paidOrderId);
    assert(h.conektaOrderPaid(charged),
      `Conekta order ${paidOrderId} is PAID (payment_status=${charged && charged.payment_status})`);
    assert(!page.url().includes('order-received'),
      'the customer never reached order-received (the confirm was blocked)');

    // Via findOrdersByConektaOrderId, not a raw wcApi GET: it re-logins first,
    // and the admin REST nonce is observably flaky right after the checkout
    // flow (rest_cookie_invalid_nonce on every retry). Same assertion either
    // way — the payment is real but no order has collected it yet.
    const beforeRecovery = await h.findOrdersByConektaOrderId(paidOrderId);
    const beforeIds = beforeRecovery.map(o => `#${o.id}(${o.status})`).join(', ');
    console.log(`  orders carrying ${paidOrderId} after the blocked confirm: ${beforeIds || 'none'}`);
    assert(beforeRecovery.every(o => !h.PAID_STATUSES.includes(o.status)),
      `the payment is orphaned — no order has collected it yet (${beforeIds || 'none'})`);

    await page.unroute('**/*conekta_confirm_order*');

    // ---------------------------------------------------------------
    // (2) RELOAD — wipes the checkout state, the double-charge trigger
    // ---------------------------------------------------------------
    console.log('\n--- (2) reload /checkout/ (clears the checkout-state transient) ---');
    await page.goto(`${STORE_URL}/checkout/`);
    await page.waitForLoadState('networkidle');
    await page.waitForSelector('form.checkout', { timeout: config.timeouts.selector });
    // The cart survives (nothing was completed), so the checkout renders again.
    // Re-fill in case the reload came back with empty fields, then select the
    // gateway — this is the point where the plugin used to create a NEW payable
    // Conekta order and the customer paid a second time.
    if (!(await page.inputValue('#billing_email').catch(() => ''))) {
      await fillBilling();
    }
    await page.click('label[for="payment_method_conekta"]').catch(() => {});

    await waitFor(checkoutRequests, requestsBeforeCharge + 1, 'post-reload checkout-request POSTs', 45000);
    const afterReload = checkoutRequests.slice(requestsBeforeCharge);

    // ---------------------------------------------------------------
    // (3) RECOVERY, NOT A REPLACEMENT
    // ---------------------------------------------------------------
    console.log('\n--- (3) checkout-request recovers the payment instead of replacing it ---');
    const newIds = afterReload
      .map(r => r && r.conekta_order_id)
      .filter(id => id && id !== paidOrderId);
    assert(newIds.length === 0,
      `no replacement Conekta order was created after the charge (unexpected: ${newIds.join(', ') || 'none'})`);

    const recovered = afterReload.find(r => r && r.mode === 'already_paid');
    console.log(`  post-reload modes: ${afterReload.map(r => r && r.mode).join(', ')}`);
    assert(!!recovered, 'checkout-request answered mode="already_paid"');
    assert(recovered.conekta_order_id === paidOrderId,
      `already_paid points at the order that was actually paid (${recovered.conekta_order_id})`);
    assert(typeof recovered.redirect === 'string' && recovered.redirect.includes('order-received'),
      `already_paid carries the order-received redirect (${recovered.redirect})`);
    assert(!recovered.checkout_request_id,
      'no checkout_request_id in the response — there is nothing payable left to mount');

    // ---------------------------------------------------------------
    // (4) THE ORPHAN IS RECONCILED
    // ---------------------------------------------------------------
    console.log('\n--- (4) the orphaned payment completed its WC order ---');
    await page.waitForURL(/order-received/, { timeout: config.timeouts.navigation }).catch(() => {});
    assert(page.url().includes('order-received'),
      `the customer was sent to their paid order (${page.url()})`);

    const orders = await h.findOrdersByConektaOrderId(paidOrderId);
    const ids = orders.map(o => `#${o.id}(${o.status})`).join(', ');
    console.log(`  orders carrying ${paidOrderId}: ${ids || 'none'}`);
    const paid = orders.filter(o => h.PAID_STATUSES.includes(o.status));
    assert(paid.length === 1, `exactly ONE paid WC order (got ${paid.length}: ${ids})`);
    assert(String(paid[0].id) === String(wcOrderId),
      `the paid order IS the pre-charge order #${wcOrderId} — no duplicate order, no duplicate charge`);
  }).then(passed => process.exit(passed ? 0 : 1));
