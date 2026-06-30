/**
 * E2E: Classic Checkout — tax-inclusive pricing + UNDER-count rounding (BE-924)
 *
 * Sibling of tax-inclusive-classic.spec.js for the opposite rounding direction.
 * Deterministic UNDER-count: gross $50.00 @ 16% IVA → net per unit 43.1034,
 * which rounds DOWN, so unit_price × 3 charges ~1¢ too little. That shortfall
 * must be added to the TAX line (NOT a discount), and the charged amount must
 * still equal the WooCommerce total. The IVA stays a tax_line (never a
 * dynamic_pricing discount) and the line item keeps tax_included = true.
 *
 * Pays with the test card so we can compare the paid Conekta order vs WC.
 */
const h = require('./checkout-helpers');

h.run(
  'Classic Checkout — tax-inclusive + undercount → tax adjustment',
  { checkoutType: 'classic', taxInclusive: true, roundingPrice: '50.00', roundingQty: 3 },
  async () => {
    const orderId = await h.classicCheckoutCreateOrder();

    await h.verifyTaxInclusiveOrder(orderId);

    await h.payClassicCardOrder();

    await h.testOrderStatus(orderId);
    await h.verifyTaxInclusiveOrder(orderId);
    // Under-count: no round_adjustment discount; the drift is absorbed in tax,
    // and amount must equal the WooCommerce total.
    await h.verifyConektaTotalMatchesWoo(orderId);
  }
).then(passed => process.exit(passed ? 0 : 1));
