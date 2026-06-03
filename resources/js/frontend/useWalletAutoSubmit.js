import { useEffect, useRef } from '@wordpress/element';
import { useDispatch } from '@wordpress/data';

/**
 * Wallet buttons (Apple Pay / Google Pay) inside the Conekta SDK iframe
 * complete the charge without ever going through WC Blocks' "Place Order"
 * button, so onPaymentSetup never fires for them. This hook bridges that
 * gap.
 *
 * Behavior:
 *   1. Subscribes a persistent listener to the OrderEmitter. When the SDK
 *      fires onFinalizePayment outside the card path, the resulting Conekta
 *      order is stashed in `walletOrderRef` and the WC checkout pipeline is
 *      triggered programmatically by dispatching the same store action the
 *      Place Order button uses internally.
 *   2. The caller's onPaymentSetup must:
 *        - short-circuit when `walletOrderRef.current` is non-null (the
 *          wallet already charged — return SUCCESS with that order id, do
 *          NOT re-call the SDK's submit).
 *        - set `expectingChargeRef.current = true` for the duration of the
 *          card path (around `orderEmitter.submit()` + the await). That
 *          tells the persistent listener "I'm driving this charge, stand
 *          down."
 *
 * Why __internalSetBeforeProcessing
 *   The public hook useCheckoutSubmit() lives in @woocommerce/base-context
 *   which is not exposed in the wc-blocks-checkout global. The Place Order
 *   button uses that hook, and the hook itself just dispatches
 *   __internalSetBeforeProcessing on the wc/store/checkout store. Calling
 *   it directly is what every payment extension that needs to start
 *   checkout programmatically does — stable since WC Blocks 5.x.
 *
 * @param {React.MutableRefObject} orderEmitterRef  Ref holding the OrderEmitter.
 * @param {*}                      iframeRebindKey  Pass the value that changes
 *                                                  when the SDK iframe is
 *                                                  remounted (e.g. checkoutRequestId)
 *                                                  so this hook rebinds its
 *                                                  listener after OrderEmitter
 *                                                  is reset by the iframe cleanup.
 *
 * @returns {{ walletOrderRef, expectingChargeRef }}
 */
export const useWalletAutoSubmit = (orderEmitterRef, iframeRebindKey) => {
    const walletOrderRef = useRef(null);
    const expectingChargeRef = useRef(false);
    const checkoutDispatch = useDispatch('wc/store/checkout');

    // Keep the latest dispatch in a ref so the listener-setup effect below
    // can stay stable. Putting checkoutDispatch (or a useCallback that
    // closes over it) in the effect's deps caused the effect to re-run on
    // every render in versions of @wordpress/data that hand back a fresh
    // object — between teardown and resetup there was a window with NO
    // listener on OrderEmitter, and an Apple Pay onFinalizePayment that
    // landed in that window was silently lost.
    const triggerRef = useRef(null);
    triggerRef.current = () => {
        checkoutDispatch?.__internalSetBeforeProcessing?.();
    };

    useEffect(() => {
        if (!orderEmitterRef?.current) return undefined;
        let active = true;

        const handleOrder = (order) => {
            if (!active) return;
            if (!expectingChargeRef.current) {
                walletOrderRef.current = order;
                try {
                    triggerRef.current?.();
                } catch (_) {
                    // WC surfaces its own error state if the dispatch can't
                    // run (e.g. validation pending) — nothing to do here.
                }
            }
            // OrderEmitter clears listeners after every dispatch; rebind for
            // the next round so subsequent wallet payments still work.
            setTimeout(() => {
                if (active && orderEmitterRef.current) {
                    orderEmitterRef.current.onOrder(handleOrder);
                    orderEmitterRef.current.onError(handleError);
                }
            }, 0);
        };
        const handleError = () => {
            // Card-path errors propagate through the orderPromise registered
            // inside onPaymentSetup; nothing extra needed here.
        };

        orderEmitterRef.current.onOrder(handleOrder);
        orderEmitterRef.current.onError(handleError);

        return () => {
            active = false;
        };
    }, [iframeRebindKey]);

    return { walletOrderRef, expectingChargeRef };
};
