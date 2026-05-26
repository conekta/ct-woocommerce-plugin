import { useCallback, useEffect, useRef } from '@wordpress/element';
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

    const triggerCheckoutSubmit = useCallback(() => {
        checkoutDispatch?.__internalSetBeforeProcessing?.();
    }, [checkoutDispatch]);

    useEffect(() => {
        if (!orderEmitterRef?.current) return undefined;
        let active = true;

        const handleOrder = (order) => {
            if (!active) return;
            if (!expectingChargeRef.current) {
                walletOrderRef.current = order;
                try {
                    triggerCheckoutSubmit();
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
    }, [triggerCheckoutSubmit, iframeRebindKey, orderEmitterRef]);

    return { walletOrderRef, expectingChargeRef };
};
