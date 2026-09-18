/**
 * E2E: Blocks Checkout — duplicate-order guard (BE-879)
 *
 * Blocks analogue of duplicate-order-classic.spec.js. Same bug: one paid
 * Conekta order completing more than one WooCommerce order. The Blocks path
 * differs from classic — it submits through the Store API
 * (/wc/store/v1/checkout) with conekta_order_id on payment_data, which drives
 * process_payment_api() instead of process_payment().
 *
 * This spec:
 *   1) Drives a real payment through the Integration iframe on the Blocks
 *      checkout -> WC order #1 paid, with conekta_order_id X.
 *   2) Re-adds the product and submits the Store API checkout AGAIN, forcing
 *      the same conekta_order_id X (the resubmission).
 *   3) Asserts the invariant: exactly ONE WC order carries conekta-order-id X
 *      in a paid status; the duplicate is cancelled and flagged
 *      `_conekta_duplicate_order` (mutes its emails).
 *
 * Checks out a VARIATION of the staging product "pegallinas" (color: rojo) so
 * the Conekta line item metadata is verified too: it must carry the variation
 * attribute and product_id, and none of Advanced Dynamic Pricing's `adp_*`.
 */
const h = require('./checkout-helpers');

h.run('Blocks Checkout — duplicate-order guard', { checkoutType: 'blocks', product: h.STAGING_VARIABLE_PRODUCT }, async ({ page, assert, config, STORE_URL, BILLING, TEST_CARD }) => {
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
  // (1) HAPPY PATH — first real payment on Blocks checkout
  // ---------------------------------------------------------------
  console.log('--- (1) first payment (happy path) ---');
  const createResponse = page.waitForResponse(r =>
    r.url().includes('conekta_checkout_request') && r.request().method() === 'POST'
  );
  // Handled at creation so an earlier failure can't leave it unhandled — an
  // unhandled rejection here kills the node process after teardown (see the
  // longer note in discount-blocks).
  createResponse.catch(() => {});

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
  await h.fillIntegrationCard(TEST_CARD);
  await h.clickPlaceOrder();
  await h.waitForOrderReceivedWith3DS();
  assert(page.url().includes('order-received'), 'first order reached order-received');

  const product = h.getProduct();
  await h.verifyConektaLineItemMetadata(conektaOrderId, {
    color: product.attributes.attribute_color,
    product_id: String(product.variationId),
  });

  // ---------------------------------------------------------------
  // (2) RESUBMISSION — Store API checkout reusing the SAME conekta_order_id
  // ---------------------------------------------------------------
  console.log('\n--- (2) resubmission via Store API with the same conekta_order_id ---');
  await page.goto(h.addToCartUrl(h.QUANTITY));
  await page.waitForLoadState('networkidle');

  const resubmit = await h.submitBlocksCheckoutRaw(conektaOrderId, BILLING);
  console.log(`  resubmission response: status=${resubmit.status} code=${resubmit.json && resubmit.json.code}`);
  assert(resubmit.json !== null, 'resubmission returned a Store API response');

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

  // The duplicate is cancelled and flagged so it never emails the customer.
  const duplicates = orders.filter(o => !h.PAID_STATUSES.includes(o.status));
  assert(duplicates.length === 1, `exactly ONE duplicate order was created (got ${duplicates.length})`);
  for (const dup of duplicates) {
    const flag = (dup.meta_data || []).find(m => m.key === '_conekta_duplicate_order');
    assert(dup.status === 'cancelled', `duplicate #${dup.id} is cancelled (status=${dup.status})`);
    assert(flag && String(flag.value) === 'yes', `duplicate #${dup.id} carries _conekta_duplicate_order=yes`);
  }
}).then(passed => process.exit(passed ? 0 : 1));
