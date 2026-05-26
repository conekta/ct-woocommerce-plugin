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
    () => ({ useDispatch: () => ({ __internalSetBeforeProcessing: jest.fn() }) }),
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
const { pickSelectedShipping } = require('../../resources/js/frontend/index.js');

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
});
