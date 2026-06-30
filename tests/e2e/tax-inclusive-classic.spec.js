/**
 * E2E: Classic Checkout — tax-inclusive pricing + OVER-count rounding (BE-924)
 *
 * Two things at once on a tax-inclusive store:
 *  1) The IVA must be a tax_line, never a dynamic_pricing discount (the original
 *     bug), and the line item carries metadata.tax_included = true.
 *  2) A deterministic rounding OVER-count: gross $100.00 @ 16% IVA → net per unit
 *     86.2069, which rounds UP, so unit_price × 3 charges ~1¢ too much. That
 *     excess must surface as a `round_adjustment` DISCOUNT (not by shrinking the
 *     reported tax), and the charged amount must equal the WooCommerce total.
 *
 * Pays with the test card so we can compare the paid Conekta order vs WC.
 */
const h = require('./checkout-helpers');

h.run(
  'Classic Checkout — tax-inclusive + overcount → round_adjustment discount',
  { checkoutType: 'classic', taxInclusive: true, roundingPrice: '100.00', roundingQty: 3 },
  async () => {
    const orderId = await h.classicCheckoutCreateOrder();

    // Tax classification (no dynamic_pricing, IVA in tax_lines, tax_included).
    await h.verifyTaxInclusiveOrder(orderId);

    await h.payClassicCardOrder();

    // Paid order: status, tax classification unchanged, and amount == WC total
    // with the over-count reconciled as a round_adjustment discount.
    await h.testOrderStatus(orderId);
    await h.verifyTaxInclusiveOrder(orderId);
    await h.verifyConektaTotalMatchesWoo(orderId);
  }
).then(passed => process.exit(passed ? 0 : 1));
