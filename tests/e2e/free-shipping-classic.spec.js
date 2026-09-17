/**
 * E2E: Classic Checkout — FREE SHIPPING must not break the Conekta order (6.2.4)
 *
 * Regression: Conekta requires `shipping_lines` whenever `shipping_contact` is
 * sent, and the card (order-first) checkout always sends shipping_contact. With
 * a $0 shipping rate the plugin used to send `shipping_lines: []`, so the
 * checkout-request create/update was rejected and the shopper could not pay
 * (seen on a merchant store with "Envío gratuito").
 *
 *   0) setup adds a free_shipping method next to the store's paid flat_rate.
 *   1) Fills the classic checkout and SELECTS the free rate (shipping total 0).
 *   2) Selecting Conekta fires checkout-request: every response must be
 *      success=true with a conekta_order_id (before the fix: 422).
 *   3) Conekta API: shipping_lines has exactly ONE line with amount 0 and the
 *      shipping_contact carries the real address.
 *   4) Pays with the test card; the WC order has shipping_total 0 on a
 *      free_shipping line, the Conekta order is paid, its shipping line is
 *      still the single amount-0 entry and its amount equals the WC total.
 */
const h = require('./checkout-helpers');

const list = (field) => (Array.isArray(field) ? field : (field && field.data) || []);

h.run('Classic Checkout — free shipping sends shipping_lines [{amount: 0}] and pays',
  { checkoutType: 'classic', freeShipping: true },
  async ({ page, assert, config, STORE_URL, BILLING }) => {
    const checkoutRequests = [];
    page.on('response', async (response) => {
      if (response.request().method() !== 'POST') return;
      if (response.url().includes('conekta_checkout_request')) {
        let body = null;
        try { body = await response.json(); } catch (_) { /* body unavailable */ }
        checkoutRequests.push({ status: response.status(), body });
      }
    });
    const waitFor = async (arr, n, label, timeoutMs = 30000) => {
      const start = Date.now();
      while (arr.length < n && Date.now() - start < timeoutMs) {
        await page.waitForTimeout(100);
      }
      if (arr.length < n) throw new Error(`Timeout waiting for ${n} ${label} (got ${arr.length})`);
    };
    const waitOrderReview = () => page
      .waitForResponse(r => r.url().includes('wc-ajax=update_order_review'), { timeout: 10000 })
      .catch(() => {});

    // ---------------------------------------------------------------
    // (1) MOUNT — classic checkout with the FREE shipping rate selected
    // ---------------------------------------------------------------
    console.log('--- (1) classic checkout: select the free shipping rate ---');
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
    await waitOrderReview();
    await page.waitForTimeout(500);

    // WooCommerce renders one radio per rate (name shipping_method[0]); when a
    // single rate exists it's a hidden input already selected. Pick the free one.
    const freeRate = page.locator('input[name^="shipping_method"][value^="free_shipping:"]').first();
    await freeRate.waitFor({ state: 'attached', timeout: config.timeouts.selector });
    if (!(await freeRate.isChecked())) {
      const pending = waitOrderReview();
      await freeRate.check({ force: true });
      await pending;
      await page.waitForTimeout(500);
    }
    const chosen = await page.evaluate(() => {
      const el = document.querySelector('input[name^="shipping_method"]:checked')
        || document.querySelector('input[name^="shipping_method"][type="hidden"]');
      return el ? el.value : null;
    });
    assert(typeof chosen === 'string' && chosen.startsWith('free_shipping:'),
      `free shipping rate selected (${chosen})`);

    const shippingCell = (await page.locator('.woocommerce-shipping-totals td').first().innerText().catch(() => '')).trim();
    console.log(`  shipping row: "${shippingCell.replace(/\s+/g, ' ')}"`);
    assert(/gratis|gratuito|free|0[.,]00/i.test(shippingCell), 'order review shows a $0 / free shipping total');

    // ---------------------------------------------------------------
    // (2) checkout-request must succeed with an empty-cost shipping
    // ---------------------------------------------------------------
    console.log('\n--- (2) checkout-request accepted by Conekta ---');
    await page.click('label[for="payment_method_conekta"]');
    await waitFor(checkoutRequests, 1, 'checkout-request POSTs');
    // Let the debounced refreshes (updated_checkout) settle so we judge the
    // final create/update, not just the first one.
    await h.waitForCheckoutStable();

    for (const r of checkoutRequests) {
      console.log(`  checkout-request -> HTTP ${r.status} mode=${r.body && r.body.mode} success=${r.body && r.body.success} ${r.body && r.body.message ? `message="${r.body.message}"` : ''}`);
    }
    assert(checkoutRequests.every(r => r.status === 200 && r.body && r.body.success === true),
      `every checkout-request succeeded (${checkoutRequests.length} POSTs) — Conekta accepted the free-shipping order`);
    const last = checkoutRequests[checkoutRequests.length - 1].body || {};
    const conektaOrderId = last.conekta_order_id;
    assert(typeof conektaOrderId === 'string' && conektaOrderId.length > 0,
      `conekta_order_id = ${conektaOrderId}`);

    // ---------------------------------------------------------------
    // (3) Conekta order carries ONE shipping line with amount 0
    // ---------------------------------------------------------------
    const assertFreeShippingLine = async (label) => {
      const order = await h.fetchConektaOrder(conektaOrderId);
      const lines = list(order.shipping_lines);
      console.log(`  ${label} shipping_lines=${JSON.stringify(lines.map(l => ({ amount: l.amount, carrier: l.carrier, method: l.method })))}`);
      assert(lines.length === 1, `${label}: exactly one shipping line (got ${lines.length})`);
      assert(lines.length === 1 && Number(lines[0].amount) === 0, `${label}: shipping line amount is 0`);
      return order;
    };

    if (h.CONEKTA_API_KEY) {
      console.log('\n--- (3) Conekta API: shipping_lines + shipping_contact ---');
      const order = await assertFreeShippingLine('pre-charge');
      const street1 = (order.shipping_contact && order.shipping_contact.address && order.shipping_contact.address.street1) || '';
      assert(street1.includes(BILLING.address_1), `shipping_contact.address.street1 = "${street1}"`);
    } else {
      console.log(`\n  CONEKTA_API_KEY not set — skipped API inspection of ${conektaOrderId} (check it in the panel)`);
    }

    // ---------------------------------------------------------------
    // (4) PAY — the order completes end to end with free shipping
    // ---------------------------------------------------------------
    console.log('\n--- (4) pay with card ---');
    await h.waitForIntegrationIframe();
    await h.fillIntegrationCard(h.TEST_CARD);
    await h.clickPlaceOrder();
    await h.waitForOrderReceivedWith3DS();
    assert(page.url().includes('order-received'), 'reached order-received');

    const wcOrders = await h.findOrdersByConektaOrderId(conektaOrderId); // logs in as admin
    assert(wcOrders.length >= 1, `found the WooCommerce order for ${conektaOrderId}`);
    const wcOrder = wcOrders[0];
    if (wcOrder) {
      const wcShipping = Array.isArray(wcOrder.shipping_lines) ? wcOrder.shipping_lines : [];
      console.log(`  WC order #${wcOrder.id} status=${wcOrder.status} shipping_total=${wcOrder.shipping_total} shipping_lines=${JSON.stringify(wcShipping.map(l => ({ method_id: l.method_id, total: l.total })))}`);
      assert(Math.round(parseFloat(wcOrder.shipping_total) * 100) === 0, `WC order shipping_total is 0 (${wcOrder.shipping_total})`);
      assert(wcShipping.some(l => l.method_id === 'free_shipping'), 'WC order shipping line is free_shipping');
      assert(h.PAID_STATUSES.includes(wcOrder.status), `WC order #${wcOrder.id} is paid (${wcOrder.status})`);
    }

    if (h.CONEKTA_API_KEY) {
      const paidOrder = await h.waitForConektaPaid(conektaOrderId);
      assert(h.conektaOrderPaid(paidOrder), `Conekta order paid (payment_status=${paidOrder.payment_status})`);
      await assertFreeShippingLine('paid');
      await h.verifyConektaTotalMatchesWoo(conektaOrderId);
    }
  }).then(passed => process.exit(passed ? 0 : 1));
