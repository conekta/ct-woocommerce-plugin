/**
 * @jest-environment jsdom
 *
 * Tests the wallet-button → place-order bridge that lets Apple/Google Pay
 * orders ride through WC Blocks' checkout pipeline. Mocks @wordpress/element
 * so useEffect / useRef / useCallback run synchronously in plain JS — the
 * hook is then a normal function we can call and assert on.
 */

const mockInternalSetBeforeProcessing = jest.fn();

jest.mock(
    '@wordpress/element',
    () => ({
        useEffect: (fn) => fn(),
        useRef: (init) => ({ current: init }),
    }),
    { virtual: true }
);

jest.mock(
    '@wordpress/data',
    () => ({
        useDispatch: () => ({ __internalSetBeforeProcessing: mockInternalSetBeforeProcessing }),
    }),
    { virtual: true }
);

const { OrderEmitter } = require('../../resources/js/frontend/OrderEmitter');
const { useWalletAutoSubmit } = require('../../resources/js/frontend/useWalletAutoSubmit');

describe('useWalletAutoSubmit', () => {
    let emitter;
    let emitterRef;

    beforeEach(() => {
        jest.useFakeTimers();
        mockInternalSetBeforeProcessing.mockReset();
        emitter = new OrderEmitter();
        emitterRef = { current: emitter };
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    test('returns walletOrderRef and expectingChargeRef refs', () => {
        const { walletOrderRef, expectingChargeRef } = useWalletAutoSubmit(emitterRef, 'cr_1');
        expect(walletOrderRef).toEqual({ current: null });
        expect(expectingChargeRef).toEqual({ current: false });
    });

    test('subscribes a listener that stashes the order AND triggers checkout when expectingChargeRef=false', () => {
        // The "wallet button charged" path: nobody set expectingChargeRef to
        // true (no Place Order click in flight), so we recognize this as a
        // wallet flow and have to start the checkout pipeline ourselves.
        const { walletOrderRef, expectingChargeRef } = useWalletAutoSubmit(emitterRef, 'cr_1');

        expectingChargeRef.current = false;
        emitter.setOrder({ id: 'ord_wallet' });

        expect(walletOrderRef.current).toEqual({ id: 'ord_wallet' });
        expect(mockInternalSetBeforeProcessing).toHaveBeenCalledTimes(1);
    });

    test('subscribed listener stands down when expectingChargeRef=true (card path)', () => {
        // The card path already drove orderEmitter.submit() from
        // onPaymentSetup — its own orderPromise will resolve and we must
        // NOT also click the Place Order button or we charge twice.
        const { walletOrderRef, expectingChargeRef } = useWalletAutoSubmit(emitterRef, 'cr_1');

        expectingChargeRef.current = true;
        emitter.setOrder({ id: 'ord_card' });

        expect(walletOrderRef.current).toBeNull();
        expect(mockInternalSetBeforeProcessing).not.toHaveBeenCalled();
    });

    test('rebinds after each event so subsequent wallet payments still get caught', () => {
        // OrderEmitter clears listeners after every setOrder. Without the
        // rebind, a customer who clicks Apple Pay twice (e.g. retry after
        // a failed 3DS) on the same iframe instance would silently not
        // trigger checkout the second time.
        const { walletOrderRef, expectingChargeRef } = useWalletAutoSubmit(emitterRef, 'cr_1');

        expectingChargeRef.current = false;
        emitter.setOrder({ id: 'ord_first' });
        expect(mockInternalSetBeforeProcessing).toHaveBeenCalledTimes(1);

        // Flush the setTimeout(rebind, 0) so the listener is wired again.
        jest.runAllTimers();

        emitter.setOrder({ id: 'ord_second' });
        expect(walletOrderRef.current).toEqual({ id: 'ord_second' });
        expect(mockInternalSetBeforeProcessing).toHaveBeenCalledTimes(2);
    });

    test('swallows errors thrown by mockInternalSetBeforeProcessing', () => {
        // WC blocks throws when checkout state isn't ready (e.g. validation
        // pending). We let WC surface that error in its own UI rather than
        // crashing the iframe listener — failure to swallow used to leave
        // the customer charged but stranded.
        mockInternalSetBeforeProcessing.mockImplementationOnce(() => {
            throw new Error('blocks not ready');
        });

        const { walletOrderRef, expectingChargeRef } = useWalletAutoSubmit(emitterRef, 'cr_1');

        expectingChargeRef.current = false;
        expect(() => emitter.setOrder({ id: 'ord_x' })).not.toThrow();
        // Order is still stashed so onPaymentSetup can short-circuit on it
        // once blocks recovers.
        expect(walletOrderRef.current).toEqual({ id: 'ord_x' });
    });

    test('no-op when orderEmitterRef.current is null', () => {
        // Defensive: the parent component may render before OrderEmitter is
        // constructed. The hook should bail cleanly instead of crashing.
        const refs = useWalletAutoSubmit({ current: null }, 'cr_1');
        expect(refs.walletOrderRef.current).toBeNull();
        expect(refs.expectingChargeRef.current).toBe(false);
        // And it should NOT fire anything that depends on the emitter.
        expect(mockInternalSetBeforeProcessing).not.toHaveBeenCalled();
    });

    test('refs are independent between hook invocations (no module-level leak)', () => {
        // Each iframe mount creates a fresh OrderEmitter and a fresh set of
        // refs. A stale walletOrderRef from a previous order would short-
        // circuit onPaymentSetup with the WRONG conekta_order_id.
        const a = useWalletAutoSubmit(emitterRef, 'cr_a');
        const b = useWalletAutoSubmit(emitterRef, 'cr_b');
        a.walletOrderRef.current = { id: 'ord_a' };
        expect(b.walletOrderRef.current).toBeNull();
    });

    test('listener survives unrelated parent re-renders (no teardown window)', () => {
        // Regression: useDispatch from @wordpress/data used to return a new
        // object on every render in some versions. If the effect's deps
        // included that object (directly or via useCallback) the listener
        // got torn down + re-subscribed each render — and an Apple Pay
        // onFinalizePayment that landed between teardown and resetup was
        // silently lost. The effect now keeps the trigger in a ref so it
        // only re-runs when iframeRebindKey changes.
        const { walletOrderRef, expectingChargeRef } = useWalletAutoSubmit(emitterRef, 'cr_1');

        // Simulate parent re-render that does NOT remount the iframe by
        // calling the hook again with the SAME key. With the bug, the
        // effect would re-run and (in this test setup) re-subscribe the
        // SAME handler twice — but the critical regression is that during
        // the teardown window between renders, setOrder events were lost.
        // We can at least assert the live refs continue to work.
        useWalletAutoSubmit(emitterRef, 'cr_1');

        expectingChargeRef.current = false;
        emitter.setOrder({ id: 'ord_after_rerender' });

        expect(walletOrderRef.current).toEqual({ id: 'ord_after_rerender' });
        expect(mockInternalSetBeforeProcessing).toHaveBeenCalled();
    });
});
