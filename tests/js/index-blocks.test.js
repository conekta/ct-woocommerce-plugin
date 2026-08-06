/**
 * @jest-environment jsdom
 */

// External WP/WC packages aren't installed locally (they're webpack externals
// at build time). Mock them so the module evaluates under jest.
jest.mock(
    '@woocommerce/blocks-registry',
    () => ({ registerPaymentMethod: jest.fn() }),
    { virtual: true }
);

jest.mock(
    '@woocommerce/settings',
    () => ({
        getSetting: jest.fn(() => ({
            name: 'conekta',
            title: 'Conekta',
            description: 'Paga con tarjeta',
            api_key: 'pk_test',
            locale: 'es',
            is_enabled: true,
            nonce: 'test_nonce',
            checkout_request_url: '/wp-json/conekta/v1/checkout-request',
        })),
    }),
    { virtual: true }
);

jest.mock(
    '@wordpress/element',
    () => {
        const React = require('react');
        return {
            useEffect: React.useEffect,
            useRef: React.useRef,
            useState: React.useState,
            createElement: React.createElement,
        };
    },
    { virtual: true }
);

jest.mock(
    '@wordpress/html-entities',
    () => ({ decodeEntities: (s) => s }),
    { virtual: true }
);

jest.mock(
    '@wordpress/data',
    () => ({
        useDispatch: () => ({ __internalSetBeforeProcessing: jest.fn() }),
        useSelect: jest.fn(() => ({ billing: null, shipping: null })),
    }),
    { virtual: true }
);

// The real loadConektaScript appends a <script src=pay.conekta.com>; not what
// we want in a unit test. Stub it to a no-op that returns a plain object —
// jest.mock factories run before jsdom globals are wired, so don't touch
// `document` here.
jest.mock('../../resources/js/frontend/loadConektaScript', () => ({
    loadConektaScript: jest.fn(() => ({ tagName: 'SCRIPT' })),
}));

const { registerPaymentMethod } = require('@woocommerce/blocks-registry');
const {
    pickSelectedShipping,
    addrFields,
    buildCheckoutCacheHash,
    chargeAndConfirm,
} = require('../../resources/js/frontend/index.js');

describe('index.js (Blocks)', () => {
    describe('registerPaymentMethod', () => {
        test('registers the conekta payment method on module load', () => {
            expect(registerPaymentMethod).toHaveBeenCalledTimes(1);
            const config = registerPaymentMethod.mock.calls[0][0];
            expect(config.name).toBe('conekta');
            expect(config.ariaLabel).toBe('Conekta');
            expect(config.supports).toEqual({ showSavedCards: true });
            expect(config.content).toBeDefined();
            expect(config.edit).toBeDefined();
            expect(config.label).toBeDefined();
        });

        test('canMakePayment reflects the is_enabled setting from PHP', () => {
            const config = registerPaymentMethod.mock.calls[0][0];
            expect(config.canMakePayment()).toBe(true);
        });
    });

    describe('pickSelectedShipping', () => {
        test('returns null when there are no shipping rates in any prop path', () => {
            expect(pickSelectedShipping({})).toBeNull();
            expect(pickSelectedShipping({ shippingData: {} })).toBeNull();
            expect(pickSelectedShipping({ cartData: { shippingRates: [] } })).toBeNull();
        });

        test('returns null when rates exist but none are selected', () => {
            const props = {
                shippingData: {
                    shippingRates: [
                        { shipping_rates: [{ id: 'flat', selected: false, cost: '50' }] },
                    ],
                },
            };
            expect(pickSelectedShipping(props)).toBeNull();
        });

        test('reads the selected rate from shippingData.shippingRates packages', () => {
            const props = {
                shippingData: {
                    shippingRates: [
                        {
                            shipping_rates: [
                                { rate_id: 'flat', label: 'Flat', cost: '99', selected: true },
                            ],
                        },
                    ],
                },
            };
            const result = pickSelectedShipping(props);
            expect(result).toEqual({ id: 'flat', label: 'Flat', cost: 99 });
        });

        test('falls back to props.shipping.shippingRates when shippingData is empty', () => {
            const props = {
                shippingData: { shippingRates: [] },
                shipping: {
                    shippingRates: [
                        {
                            shipping_rates: [
                                { rate_id: 'priority', label: 'Priority', cost: '199', selected: true },
                            ],
                        },
                    ],
                },
            };
            expect(pickSelectedShipping(props)).toEqual({ id: 'priority', label: 'Priority', cost: 199 });
        });

        test('falls back to cartData.shippingRates when the other paths are empty', () => {
            const props = {
                cartData: {
                    shippingRates: [
                        {
                            shipping_rates: [
                                { rate_id: 'cart_rate', label: 'Cart Rate', cost: '50', selected: true },
                            ],
                        },
                    ],
                },
            };
            expect(pickSelectedShipping(props)).toEqual({ id: 'cart_rate', label: 'Cart Rate', cost: 50 });
        });

        test('accepts price or rate_cost as cost source when cost is missing', () => {
            const rateWithPrice = {
                shippingData: {
                    shippingRates: [{ shipping_rates: [{ id: 'r1', label: 'R1', price: '75', selected: true }] }],
                },
            };
            expect(pickSelectedShipping(rateWithPrice).cost).toBe(75);

            const rateWithRateCost = {
                shippingData: {
                    shippingRates: [{ shipping_rates: [{ id: 'r2', label: 'R2', rate_cost: '88', selected: true }] }],
                },
            };
            expect(pickSelectedShipping(rateWithRateCost).cost).toBe(88);
        });

        test('defaults to cost=0 when no price field is present', () => {
            const props = {
                shippingData: {
                    shippingRates: [{ shipping_rates: [{ id: 'free', label: 'Free', selected: true }] }],
                },
            };
            expect(pickSelectedShipping(props).cost).toBe(0);
        });

        test('accepts the flat shippingRates shape (no shipping_rates nesting)', () => {
            const props = {
                shippingData: {
                    shippingRates: [
                        { id: 'flat', label: 'Flat', cost: '120', selected: true },
                    ],
                },
            };
            expect(pickSelectedShipping(props)).toEqual({ id: 'flat', label: 'Flat', cost: 120 });
        });

        test('uses rate_label / name fallbacks when label is missing', () => {
            const props = {
                shippingData: {
                    shippingRates: [
                        { shipping_rates: [{ id: 'r1', name: 'By Name', cost: '50', selected: true }] },
                    ],
                },
            };
            expect(pickSelectedShipping(props).label).toBe('By Name');

            const props2 = {
                shippingData: {
                    shippingRates: [
                        { shipping_rates: [{ id: 'r1', rate_label: 'By Rate Label', cost: '50', selected: true }] },
                    ],
                },
            };
            expect(pickSelectedShipping(props2).label).toBe('By Rate Label');
        });
    });

    describe('addrFields', () => {
        // 9 projected fields → join('|') yields 8 separators.
        test('returns 8 pipes (9 empty slots) for an empty address', () => {
            expect(addrFields({})).toBe('||||||||');
        });

        test('handles missing address argument', () => {
            expect(addrFields()).toBe('||||||||');
        });

        test('joins all 9 fields in fixed order, phone last', () => {
            const result = addrFields({
                first_name: 'Test',
                last_name:  'User',
                address_1:  'Calle Test 123',
                address_2:  'condesa',
                city:       'CDMX',
                state:      'DF',
                postcode:   '11010',
                country:    'MX',
                phone:      '3143159054',
            });
            expect(result).toBe('Test|User|Calle Test 123|condesa|CDMX|DF|11010|MX|3143159054');
        });

        test('partial address fills missing slots with empty strings', () => {
            // 9 fields, 8 separators. Slots in order:
            // first_name | last_name | address_1 | address_2 | city | state | postcode | country | phone
            //   "A"      |    ""     |    ""     |    ""     |  ""  |  ""   |    ""    |  "MX"   |   ""
            // → "A|||||||MX|"
            expect(addrFields({ first_name: 'A', country: 'MX' })).toBe('A|||||||MX|');
        });

        test('different addresses produce different output', () => {
            const a = { address_1: 'Calle 1', city: 'CDMX' };
            const b = { address_1: 'Calle 2', city: 'CDMX' };
            expect(addrFields(a)).not.toBe(addrFields(b));
        });

        // address_2 (colonia) is part of the fingerprint: editing only the
        // colonia must re-fire /checkout-request so the Conekta order gets
        // the new street2 before a wallet button charges against it.
        test('different address_2 produces different output', () => {
            const a = { address_1: 'Calle 1', address_2: 'condesa' };
            const b = { address_1: 'Calle 1', address_2: 'roma norte' };
            expect(addrFields(a)).not.toBe(addrFields(b));
        });

        // Phone is part of the change-detection fingerprint so a customer
        // who changes only their shipping phone (different delivery contact)
        // still bumps the hash and re-fires /checkout-request before the
        // wallet button charges against a stale Conekta order.
        test('different phone produces different output', () => {
            const a = { phone: '5555555555' };
            const b = { phone: '3143159054' };
            expect(addrFields(a)).not.toBe(addrFields(b));
        });
    });

    describe('buildCheckoutCacheHash', () => {
        const baseInput = {
            cartTotal: 100,
            currencyCode: 'MXN',
            cartItems: [{ id: 7, quantity: 1, variation: { id: 0 } }],
            shippingRateId: 'flat_rate:1',
            billingEmail: 'test@example.com',
            billingAddress: { first_name: 'Bill', address_1: 'Calle Bill 1' },
            shippingAddress: { first_name: 'Ship', address_1: 'Calle Ship 1' },
        };

        test('produces the same hash for equal inputs (cache hit)', () => {
            expect(buildCheckoutCacheHash(baseInput))
                .toBe(buildCheckoutCacheHash({ ...baseInput }));
        });

        // This is the regression test for the actual bug the user hit:
        // changing only the shipping address (everything else identical,
        // including cart total) MUST invalidate the cache so the checkout
        // -request POST re-fires and Conekta receives the new
        // shipping_contact before Apple/Google Pay charges.
        test('shipping address change invalidates the cache when total is unchanged', () => {
            const before = buildCheckoutCacheHash(baseInput);
            const after  = buildCheckoutCacheHash({
                ...baseInput,
                shippingAddress: { first_name: 'Ship', address_1: 'Calle Ship 2 (edited)' },
            });
            expect(after).not.toBe(before);
        });

        test('billing address change invalidates the cache', () => {
            const before = buildCheckoutCacheHash(baseInput);
            const after  = buildCheckoutCacheHash({
                ...baseInput,
                billingAddress: { ...baseInput.billingAddress, address_1: 'Calle Bill 2' },
            });
            expect(after).not.toBe(before);
        });

        test('cart total change invalidates the cache (coupon applied, etc.)', () => {
            const before = buildCheckoutCacheHash(baseInput);
            const after  = buildCheckoutCacheHash({ ...baseInput, cartTotal: 80 });
            expect(after).not.toBe(before);
        });

        test('item set change invalidates the cache', () => {
            const before = buildCheckoutCacheHash(baseInput);
            const after  = buildCheckoutCacheHash({
                ...baseInput,
                cartItems: [{ id: 7, quantity: 2, variation: { id: 0 } }],
            });
            expect(after).not.toBe(before);
        });

        test('shipping method change invalidates the cache', () => {
            const before = buildCheckoutCacheHash(baseInput);
            const after  = buildCheckoutCacheHash({ ...baseInput, shippingRateId: 'free_shipping:1' });
            expect(after).not.toBe(before);
        });

        test('email change invalidates the cache', () => {
            const before = buildCheckoutCacheHash(baseInput);
            const after  = buildCheckoutCacheHash({ ...baseInput, billingEmail: 'other@example.com' });
            expect(after).not.toBe(before);
        });

        test('billing and shipping with same fields produce DIFFERENT hashes than swapping them', () => {
            // Ensures the two address blocks are positional and not summed —
            // swapping billing<->shipping must yield a different hash so
            // "shipping moved to billing slot" is observed as a change.
            const swapped = buildCheckoutCacheHash({
                ...baseInput,
                billingAddress: baseInput.shippingAddress,
                shippingAddress: baseInput.billingAddress,
            });
            expect(swapped).not.toBe(buildCheckoutCacheHash(baseInput));
        });

        test('empty input still produces a deterministic string', () => {
            expect(buildCheckoutCacheHash()).toBe(buildCheckoutCacheHash());
            expect(typeof buildCheckoutCacheHash()).toBe('string');
        });
    });

    // -------------------------------------------------------
    // chargeAndConfirm — the order-first post-checkout charge driver.
    // The charge now fires AFTER the Store API created/validated/linked the
    // WC order (onCheckoutSuccess), and completion goes through the shared
    // confirm endpoint. These tests pin the money-safety invariants.
    // -------------------------------------------------------
    describe('chargeAndConfirm (order-first)', () => {
        // Emitter stand-in the driver charges through. `outcome` decides what
        // submit() dispatches: {order} resolves onOrder, {error} rejects.
        const makeEmitter = (outcome) => {
            const emitter = {
                submitCalls: 0,
                _order: null,
                _error: null,
                onOrder(cb) { this._order = cb; },
                onError(cb) { this._error = cb; },
                submit() {
                    this.submitCalls += 1;
                    if (outcome.error) this._error(outcome.error);
                    else this._order(outcome.order);
                },
            };
            return emitter;
        };

        const makeDeps = (emitter, overrides = {}) => ({
            orderEmitter: emitter,
            chargedOrderIdRef: { current: null },
            expectingChargeRef: { current: false },
            confirmUrl: '/?wc-ajax=conekta_confirm_order',
            nonce: 'test_nonce',
            ...overrides,
        });

        const attempt = {
            conektaOrderId: 'ord_prepared_1',
            wcOrderId: '3401',
            wcOrderKey: 'wc_order_key_3401',
        };

        afterEach(() => {
            delete global.fetch;
        });

        test('charges once, confirms with the CHARGED order id and returns the redirect', async () => {
            const emitter = makeEmitter({ order: { id: 'ord_prepared_1' } });
            const deps = makeDeps(emitter);
            global.fetch = jest.fn().mockResolvedValue({
                ok: true,
                json: async () => ({ success: true, redirect: 'https://shop.test/order-received/3401/' }),
            });

            const result = await chargeAndConfirm(deps, attempt);

            expect(result).toEqual({ ok: true, redirect: 'https://shop.test/order-received/3401/' });
            expect(emitter.submitCalls).toBe(1);
            // The money moved: the page-level guard must remember it.
            expect(deps.chargedOrderIdRef.current).toBe('ord_prepared_1');
            const body = JSON.parse(global.fetch.mock.calls[0][1].body);
            expect(body).toEqual({
                nonce: 'test_nonce',
                order_id: '3401',
                order_key: 'wc_order_key_3401',
                conekta_order_id: 'ord_prepared_1',
            });
        });

        test('stands the wallet bridge down during the charge (expectingChargeRef)', async () => {
            let expectingDuringSubmit = null;
            const deps = makeDeps(null);
            const emitter = {
                submitCalls: 0,
                onOrder(cb) { this._order = cb; },
                onError() {},
                submit() {
                    this.submitCalls += 1;
                    // Captured mid-charge: the wallet hook would otherwise
                    // treat this onOrder as an Apple/Google Pay payment and
                    // re-click Place Order.
                    expectingDuringSubmit = deps.expectingChargeRef.current;
                    this._order({ id: 'ord_prepared_1' });
                },
            };
            deps.orderEmitter = emitter;
            global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true }) });

            await chargeAndConfirm(deps, attempt);

            expect(expectingDuringSubmit).toBe(true);
            expect(deps.expectingChargeRef.current).toBe(false);
        });

        test('a decline moves no money: no confirm call, chargedOrderIdRef stays null, declined=true', async () => {
            const emitter = makeEmitter({ error: new Error('Fondos insuficientes') });
            const deps = makeDeps(emitter);
            global.fetch = jest.fn();

            const result = await chargeAndConfirm(deps, attempt);

            expect(result.ok).toBe(false);
            expect(result.declined).toBe(true);
            expect(result.message).toBe('Fondos insuficientes');
            expect(global.fetch).not.toHaveBeenCalled();
            expect(deps.chargedOrderIdRef.current).toBeNull();
        });

        test('NEVER charges twice: with a charge already recorded it goes straight to confirm', async () => {
            // The scenario behind the 2026-08-04 refund: a successful charge
            // whose confirmation failed. The retry must re-run ONLY the
            // idempotent confirm — a second submit() is a second payment.
            const emitter = makeEmitter({ order: { id: 'ord_should_not_charge' } });
            const deps = makeDeps(emitter, { chargedOrderIdRef: { current: 'ord_already_charged' } });
            global.fetch = jest.fn().mockResolvedValue({
                ok: true,
                json: async () => ({ success: true, redirect: 'https://shop.test/order-received/3401/' }),
            });

            const result = await chargeAndConfirm(deps, attempt);

            expect(emitter.submitCalls).toBe(0);
            expect(result.ok).toBe(true);
            // The confirm carries the id of the order that actually charged.
            const body = JSON.parse(global.fetch.mock.calls[0][1].body);
            expect(body.conekta_order_id).toBe('ord_already_charged');
        });

        test('charged but confirm fails: declined=false so the retry re-confirms without re-charging', async () => {
            const emitter = makeEmitter({ order: { id: 'ord_prepared_1' } });
            const deps = makeDeps(emitter);
            global.fetch = jest.fn().mockRejectedValue(new Error('network down'));

            const first = await chargeAndConfirm(deps, attempt);

            expect(first.ok).toBe(false);
            expect(first.declined).toBe(false);
            expect(first.message).toMatch(/No se generará un segundo cargo/);
            expect(deps.chargedOrderIdRef.current).toBe('ord_prepared_1');

            // Retry with the same deps (what the "Reintentar pago" button does):
            global.fetch = jest.fn().mockResolvedValue({
                ok: true,
                json: async () => ({ success: true, redirect: 'https://shop.test/order-received/3401/' }),
            });
            const second = await chargeAndConfirm(deps, attempt);

            expect(second.ok).toBe(true);
            expect(emitter.submitCalls).toBe(1); // ONE charge total, ever
        });

        test('a confirm rejection surfaces the server message', async () => {
            const emitter = makeEmitter({ order: { id: 'ord_prepared_1' } });
            const deps = makeDeps(emitter);
            global.fetch = jest.fn().mockResolvedValue({
                ok: false,
                json: async () => ({ success: false, message: 'Order not found' }),
            });

            const result = await chargeAndConfirm(deps, attempt);

            expect(result.ok).toBe(false);
            expect(result.declined).toBe(false);
            expect(result.message).toBe('Order not found');
        });
    });
});
