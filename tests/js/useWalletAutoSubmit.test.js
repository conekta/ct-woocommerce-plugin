/**
 * @jest-environment jsdom
 *
 * Tests the wallet-button → place-order bridge for blocks. Uses real React
 * via @testing-library/react so useEffect dependency arrays, useRef
 * stability, and cleanup ordering all behave exactly as they will in
 * production.
 *
 * Why not stub @wordpress/element hooks: a hand-rolled mock can't replicate
 * React's deps-aware effect scheduling or ref-identity-across-renders. A
 * stale-trigger regression like "effect re-runs every render, opening a
 * teardown window where Apple Pay events get lost" passes a naive mock
 * but breaks under real React.
 */

const mockInternalSetBeforeProcessing = jest.fn();

// @wordpress/element is a webpack external in production. Map it to real
// React in tests so useEffect / useRef / useCallback have full semantics.
jest.mock(
    '@wordpress/element',
    () => {
        const React = require('react');
        return {
            useEffect:   React.useEffect,
            useRef:      React.useRef,
            useCallback: React.useCallback,
        };
    },
    { virtual: true }
);

jest.mock(
    '@wordpress/data',
    () => ({
        // Return a NEW dispatch object on every call — this is the exact
        // shape of the production bug we're guarding against. If the hook's
        // useEffect deps include this object (directly or via useCallback)
        // the effect will re-run on every render and leak a teardown window.
        useDispatch: () => ({ __internalSetBeforeProcessing: mockInternalSetBeforeProcessing }),
    }),
    { virtual: true }
);

const React = require('react');
const { render, act } = require('@testing-library/react');

const { OrderEmitter } = require('../../resources/js/frontend/OrderEmitter');
const { useWalletAutoSubmit } = require('../../resources/js/frontend/useWalletAutoSubmit');

/**
 * Renders a harness component that exercises useWalletAutoSubmit and
 * surfaces the returned refs to the test. Each call to rerender() drives
 * React through a real commit — the same way blocks would re-render
 * ContentConekta when its parent state changes.
 */
const renderHarness = ({ initialKey = 'cr_1', emitter } = {}) => {
    const emitterRef = { current: emitter };
    const captured = { refs: null, renderCount: 0 };

    const Harness = ({ rebindKey }) => {
        captured.renderCount++;
        captured.refs = useWalletAutoSubmit(emitterRef, rebindKey);
        return null;
    };

    const result = render(React.createElement(Harness, { rebindKey: initialKey }));

    return {
        get refs() { return captured.refs; },
        get renderCount() { return captured.renderCount; },
        update: (newKey) => result.rerender(React.createElement(Harness, { rebindKey: newKey })),
        unmount: () => result.unmount(),
    };
};

describe('useWalletAutoSubmit', () => {
    let emitter;

    beforeEach(() => {
        jest.useFakeTimers();
        mockInternalSetBeforeProcessing.mockReset();
        emitter = new OrderEmitter();
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    test('exposes walletOrderRef and expectingChargeRef initialised to null/false', () => {
        const h = renderHarness({ emitter });
        expect(h.refs.walletOrderRef.current).toBeNull();
        expect(h.refs.expectingChargeRef.current).toBe(false);
        h.unmount();
    });

    test('captures wallet-button charges and triggers checkout when expectingChargeRef=false', () => {
        const h = renderHarness({ emitter });

        h.refs.expectingChargeRef.current = false;
        act(() => emitter.setOrder({ id: 'ord_wallet' }));

        expect(h.refs.walletOrderRef.current).toEqual({ id: 'ord_wallet' });
        expect(mockInternalSetBeforeProcessing).toHaveBeenCalledTimes(1);
        h.unmount();
    });

    test('stands down on the card path (expectingChargeRef=true)', () => {
        // The Place Order button is driving the SDK charge — our listener
        // must NOT double-trigger checkout or the customer charges twice.
        const h = renderHarness({ emitter });

        h.refs.expectingChargeRef.current = true;
        act(() => emitter.setOrder({ id: 'ord_card' }));

        expect(h.refs.walletOrderRef.current).toBeNull();
        expect(mockInternalSetBeforeProcessing).not.toHaveBeenCalled();
        h.unmount();
    });

    test('rebinds after each event so a retry-after-failure also gets caught', () => {
        // OrderEmitter clears listeners on every setOrder; the setTimeout
        // rebind keeps us alive for the next wallet click.
        const h = renderHarness({ emitter });
        h.refs.expectingChargeRef.current = false;

        act(() => emitter.setOrder({ id: 'ord_first' }));
        act(() => jest.runAllTimers());
        act(() => emitter.setOrder({ id: 'ord_second' }));

        expect(h.refs.walletOrderRef.current).toEqual({ id: 'ord_second' });
        expect(mockInternalSetBeforeProcessing).toHaveBeenCalledTimes(2);
        h.unmount();
    });

    test('swallows errors thrown by __internalSetBeforeProcessing', () => {
        // WC throws when checkout state isn't ready (e.g. mid-validation).
        // We let WC surface its own UI rather than crashing the listener
        // — but still stash the order so onPaymentSetup can replay it
        // when blocks recovers.
        mockInternalSetBeforeProcessing.mockImplementationOnce(() => {
            throw new Error('blocks not ready');
        });

        const h = renderHarness({ emitter });
        h.refs.expectingChargeRef.current = false;

        expect(() => act(() => emitter.setOrder({ id: 'ord_x' }))).not.toThrow();
        expect(h.refs.walletOrderRef.current).toEqual({ id: 'ord_x' });
        h.unmount();
    });

    test('effect runs exactly once across multiple re-renders with same iframeRebindKey', () => {
        // Regression test for the production bug: useDispatch returns a
        // fresh object on every render in some @wordpress/data versions.
        // The earlier implementation included that object (via useCallback)
        // in the effect's deps, so each re-render tore the listener down
        // and re-subscribed it. The narrow window between cleanup and
        // setup was where Apple Pay onFinalizePayment events got lost.
        //
        // The fix keeps the dispatch in a mutable ref and depends only on
        // iframeRebindKey. We count subscriptions: with the bug we'd see
        // N+1 (initial + N re-renders); with the fix we see exactly 1.
        const onOrderSpy = jest.spyOn(emitter, 'onOrder');

        const h = renderHarness({ emitter });
        const subsAfterMount = onOrderSpy.mock.calls.length;
        expect(subsAfterMount).toBe(1);

        h.update('cr_1');
        h.update('cr_1');
        h.update('cr_1');

        expect(onOrderSpy.mock.calls.length).toBe(subsAfterMount);

        // Sanity check: events still get caught after the re-render storm.
        h.refs.expectingChargeRef.current = false;
        act(() => emitter.setOrder({ id: 'ord_after_rerenders' }));
        expect(h.refs.walletOrderRef.current).toEqual({ id: 'ord_after_rerenders' });
        expect(mockInternalSetBeforeProcessing).toHaveBeenCalledTimes(1);

        h.unmount();
    });

    test('listener re-subscribes when iframeRebindKey changes (iframe remount)', () => {
        // The legitimate reason to tear down: the SDK iframe got
        // remounted with a fresh checkoutRequestId. OrderEmitter is
        // reset by the iframe cleanup, so our listener must re-subscribe
        // against the live emitter.
        const onOrderSpy = jest.spyOn(emitter, 'onOrder');

        const h = renderHarness({ emitter });
        const subsAfterMount = onOrderSpy.mock.calls.length;

        h.update('cr_2'); // simulates iframe remount

        // A real remount must produce a fresh subscription.
        expect(onOrderSpy.mock.calls.length).toBeGreaterThan(subsAfterMount);

        h.refs.expectingChargeRef.current = false;
        act(() => emitter.setOrder({ id: 'ord_after_remount' }));

        expect(h.refs.walletOrderRef.current).toEqual({ id: 'ord_after_remount' });
        expect(mockInternalSetBeforeProcessing).toHaveBeenCalledTimes(1);
        h.unmount();
    });

    test('cleanup deactivates the listener on unmount', () => {
        // If the component unmounts (e.g. customer navigates away from
        // checkout) the persistent listener must not keep firing — it
        // would write to refs that the next mount no longer owns.
        const h = renderHarness({ emitter });
        h.refs.expectingChargeRef.current = false;
        h.unmount();

        // After unmount, dispatching an order through the emitter must
        // NOT trigger any wallet logic.
        act(() => emitter.setOrder({ id: 'ord_after_unmount' }));

        expect(mockInternalSetBeforeProcessing).not.toHaveBeenCalled();
    });

    test('no-op when orderEmitterRef.current is null (defensive)', () => {
        // The parent may render before the OrderEmitter is constructed.
        const captured = { refs: null };
        const NullHarness = () => {
            captured.refs = useWalletAutoSubmit({ current: null }, 'cr_1');
            return null;
        };
        const { unmount } = render(React.createElement(NullHarness));

        expect(captured.refs.walletOrderRef.current).toBeNull();
        expect(captured.refs.expectingChargeRef.current).toBe(false);
        expect(mockInternalSetBeforeProcessing).not.toHaveBeenCalled();

        unmount();
    });
});
