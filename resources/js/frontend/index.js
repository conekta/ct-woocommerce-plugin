import { registerPaymentMethod } from '@woocommerce/blocks-registry';
import { decodeEntities } from '@wordpress/html-entities';
import { getSetting } from '@woocommerce/settings';
import { useEffect, useRef, useState } from '@wordpress/element';
import { useSelect } from '@wordpress/data';
import { OrderEmitter } from './OrderEmitter';
import { loadConektaScript } from './loadConektaScript';
import { useWalletAutoSubmit } from './useWalletAutoSubmit';

const settings = getSetting('conekta_data', {});
const labelConekta = decodeEntities(settings.title);

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DEBOUNCE_MS = 500;
const ALREADY_PAID_MESSAGE =
    'Ya recibimos un pago de este pedido, así que no generamos un segundo cargo. Si tu pedido no aparece como pagado, contacta a la tienda.';

/**
 * Project an address object into a stable, pipe-joined string of the fields
 * we care about for change detection. Missing fields become empty strings so
 * a partial address still produces a stable hash with the right shape.
 */
export const addrFields = (a = {}) => [
    a.first_name || '',
    a.last_name  || '',
    a.address_1  || '',
    a.address_2  || '',
    a.city       || '',
    a.state      || '',
    a.postcode   || '',
    a.country    || '',
    a.phone      || '',
].join('|');

/**
 * Build the cache-key used by the /checkout-request useEffect. Both billing
 * AND shipping addresses are folded in so a "different shipping address"
 * edit always invalidates the cache — without it, a shipping-only change
 * with unchanged totals leaves the Conekta order with stale shipping_contact
 * (critical for wallet flows where Apple/Google Pay charges immediately
 * against the order at click time).
 */
export const buildCheckoutCacheHash = ({
    cartTotal,
    currencyCode,
    cartItems = [],
    shippingRateId = '',
    billingEmail = '',
    billingAddress = {},
    shippingAddress = {},
} = {}) => {
    const itemsHashSource = cartItems
        .map((i) => `${i.id}:${i.quantity}:${i.variation?.id ?? ''}`)
        .join('|');
    return [
        cartTotal,
        currencyCode,
        itemsHashSource,
        shippingRateId,
        billingEmail,
        addrFields(billingAddress),
        addrFields(shippingAddress),
    ].join('|');
};

export const pickSelectedShipping = (props) => {
    let shippingRates = props?.shippingData?.shippingRates || [];
    if (!shippingRates.length) {
        shippingRates = props?.shipping?.shippingRates || [];
    }
    if (!shippingRates.length && props?.cartData?.shippingRates) {
        shippingRates = props.cartData.shippingRates;
    }
    if (!shippingRates.length) return null;

    let selectedRate = shippingRates.find((rate) => rate.selected);
    if (!selectedRate) {
        for (const packageRates of shippingRates) {
            if (Array.isArray(packageRates.shipping_rates)) {
                selectedRate = packageRates.shipping_rates.find((rate) => rate.selected);
                if (selectedRate) break;
            }
        }
    }
    if (!selectedRate) return null;

    let cost = 0;
    if (selectedRate.cost !== undefined) cost = parseFloat(selectedRate.cost);
    else if (selectedRate.price !== undefined) cost = parseFloat(selectedRate.price);
    else if (selectedRate.rate_cost !== undefined) cost = parseFloat(selectedRate.rate_cost);

    return {
        id: selectedRate.id || selectedRate.rate_id || '',
        label: selectedRate.label || selectedRate.name || selectedRate.rate_label || '',
        cost,
    };
};

/**
 * The order-first post-checkout charge: the server answered "order placed and
 * linked, ready to charge" (payment_details.conekta_pending_payment). Fire the
 * SDK charge on the mounted iframe and complete the WC order through the
 * shared confirm endpoint (wc_ajax_conekta_confirm_order — the same one
 * classic uses). Exported for unit tests. Returns:
 *   { ok: true, redirect }                  — paid and confirmed
 *   { ok: false, declined: true,  message } — charge failed, $0 moved
 *   { ok: false, declined: false, message } — CHARGED but confirm failed: the
 *     order is already linked, so the order.paid webhook completes it;
 *     retrying only re-runs the (idempotent) confirm, never the charge.
 */
export const chargeAndConfirm = async (
    { orderEmitter, chargedOrderIdRef, expectingChargeRef, confirmUrl, nonce },
    { conektaOrderId, wcOrderId, wcOrderKey }
) => {
    // Only charge if this page hasn't charged yet — a retry after a confirm
    // failure must re-confirm, never re-charge.
    if (!chargedOrderIdRef.current) {
        // Tell the wallet bridge this charge is ours: it treats unsolicited
        // onOrder events as wallet payments and would re-click Place Order.
        expectingChargeRef.current = true;
        try {
            const orderPromise = new Promise((resolve, reject) => {
                orderEmitter.onOrder((o) => resolve(o));
                orderEmitter.onError((e) => reject(e));
            });
            orderEmitter.submit();
            const order = await orderPromise;
            // The money moved: remember it so nothing on this page can charge
            // again for this purchase.
            if (order?.id) chargedOrderIdRef.current = String(order.id);
        } catch (error) {
            // Declined / SDK error — nothing was charged. The WC order stays
            // pending and the iframe stays mounted for the retry.
            return {
                ok: false,
                declined: true,
                message: error?.message || 'El cargo fue rechazado. Revisa los datos e intenta de nuevo.',
            };
        } finally {
            expectingChargeRef.current = false;
        }
    }

    const CONFIRM_PENDING_MESSAGE =
        'Tu pago fue recibido pero la confirmación falló. No se generará un segundo cargo; tu pedido se actualizará automáticamente.';
    try {
        const response = await fetch(confirmUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify({
                nonce,
                order_id: wcOrderId,
                order_key: wcOrderKey,
                conekta_order_id: chargedOrderIdRef.current || conektaOrderId,
            }),
        });
        const data = await response.json().catch(() => ({}));
        if (response.ok && data?.success) {
            return { ok: true, redirect: data.redirect };
        }
        return { ok: false, declined: false, message: data?.message || CONFIRM_PENDING_MESSAGE };
    } catch (err) {
        return { ok: false, declined: false, message: CONFIRM_PENDING_MESSAGE };
    }
};

const ContentConekta = (props) => {
    const locale = settings.locale ?? 'es';
    const { eventRegistration, emitResponse } = props;
    const { onPaymentSetup } = eventRegistration;

    const [checkoutRequestId, setCheckoutRequestId] = useState(null);
    const [mountToken, setMountToken] = useState(0);
    const [refreshing, setRefreshing] = useState(false);
    const [errorMessage, setErrorMessage] = useState('');
    // Set after the checkout POST succeeded but the charge failed (decline,
    // SDK error, confirm lost): the WC order exists as pending and the retry
    // must NOT go through the Store API again (the cart may already be empty)
    // — the "Reintentar pago" button re-runs charge+confirm directly.
    const [pendingPayment, setPendingPayment] = useState(null);
    const [retrying, setRetrying] = useState(false);

    const scriptRef = useRef(null);
    const orderEmitterRef = useRef(null);
    if (orderEmitterRef.current === null) {
        orderEmitterRef.current = new OrderEmitter();
    }
    // Mirrors `refreshing` so onPaymentSetup (registered once) sees the latest value.
    const refreshingRef = useRef(false);
    const checkoutRequestIdRef = useRef(null);
    // Conekta order backing the MOUNTED iframe — what onPaymentSetup hands to
    // the server so process_payment_api prepares (and amount-checks) exactly
    // the order the customer is looking at.
    const conektaOrderIdRef = useRef(null);
    // Conekta order the SDK reported as CHARGED. Never cleared: once the money
    // moved we must not mount — or charge — a different Conekta order, which is
    // how the same cart ended up paid twice (charge succeeds, the Store API
    // checkout fails, the customer edits the form, the Conekta order gets
    // recreated, and the new payable iframe takes a second payment).
    const chargedOrderIdRef = useRef(null);
    // Frozen from "Place order" until the payment settles: a late cart update
    // (Blocks clears the cart after a successful checkout) must not re-fire
    // /checkout-request and tear down the iframe we are about to charge.
    // Unfrozen by onCheckoutFail (checkout rejected — pre-charge, nothing
    // paid); on success the page navigates away.
    const payingRef = useRef(false);
    refreshingRef.current = refreshing;
    checkoutRequestIdRef.current = checkoutRequestId;

    // Bridges Apple/Google Pay completion (which fires inside the SDK iframe,
    // bypassing WC's Place Order button) to WC's checkout pipeline. See
    // useWalletAutoSubmit for the full contract.
    const { walletOrderRef, expectingChargeRef } = useWalletAutoSubmit(
        orderEmitterRef,
        checkoutRequestId
    );

    // Read both addresses from the wc/store/cart store via getCustomerData()
    // — WC Blocks does NOT expose getBillingAddress / getShippingAddress as
    // top-level selectors; the addresses live inside the customerData blob
    // and that selector IS subscribed, so useSelect re-renders this
    // component every time blocks commits an address change (on blur, save,
    // or the "use same as billing" toggle). That re-render is what bumps
    // the hash below and re-fires the /checkout-request POST, which is the
    // only path that pushes the new shipping_contact to Conekta before a
    // wallet button (Apple/Google Pay) charges against the order.
    const customerData = useSelect((select) => {
        const store = select?.('wc/store/cart');
        return store?.getCustomerData?.() || null;
    }, []);
    const billingAddress  = customerData?.billingAddress  || props.billing?.billingAddress || {};
    const shippingAddress = customerData?.shippingAddress || {};
    const cartItems = props.cartData?.cartItems || [];
    const cartTotal = props.billing?.cartTotal?.value || 0;
    const currencyCode = props.billing?.currency?.code || 'MXN';

    const selectedShipping = pickSelectedShipping(props);
    const shippingRateId = selectedShipping?.id ?? '';
    const billingEmail = billingAddress.email || '';

    const hash = buildCheckoutCacheHash({
        cartTotal,
        currencyCode,
        cartItems,
        shippingRateId,
        billingEmail,
        billingAddress,
        shippingAddress,
    });

    useEffect(() => {
        if (!billingEmail || !EMAIL_REGEX.test(billingEmail)) {
            setCheckoutRequestId(null);
            setErrorMessage('');
            return undefined;
        }

        let cancelled = false;
        const timer = setTimeout(async () => {
            // Never refresh/remount while a payment is in flight: the iframe
            // must stay bound to the Conekta order the server just prepared.
            if (payingRef.current) return;
            setRefreshing(true);
            try {
                // Send billing + shipping in the body so the server doesn't
                // have to rely on WC()->customer being already-synced. WC
                // Blocks debounces its own `wc/store/v1/cart/update-customer`
                // sync, so our POST can hit the server BEFORE Blocks has
                // pushed the latest address — and build_snapshot would then
                // read the stale address, produce the same shipping_hash as
                // before, and return mode=unchanged (silently leaving the
                // old address on the Conekta order).
                const response = await fetch(settings.checkout_request_url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'same-origin',
                    body: JSON.stringify({
                        nonce: settings.nonce,
                        email: billingEmail,
                        billing:  billingAddress,
                        shipping: shippingAddress,
                        woocommerce_checkout_type: 'blocks',
                    }),
                });

                if (cancelled) return;

                const data = await response.json().catch(() => ({}));

                if (!response.ok) {
                    if (data?.code === 'missing_customer_email') {
                        setErrorMessage('');  // expected while the user is still filling the form
                    } else if (data?.code === 'payment_verification_unavailable') {
                        // Checked before the generic 5xx branch: this 503 means a
                        // previous payment could not be verified, so the server
                        // refused to hand us anything payable. Its message says
                        // no second charge was made — much better than "server
                        // error, try again".
                        setErrorMessage(data.message);
                    } else if (response.status >= 500) {
                        setErrorMessage('Error del servidor al preparar el pago. Intenta de nuevo.');
                    } else {
                        setErrorMessage(data?.message || 'No se pudo preparar el pago.');
                    }
                    return;
                }

                // The Conekta order backing this checkout is already PAID and the
                // server refused to create a replacement. Unmount instead of
                // showing a payable form to a customer who already paid.
                if (data?.mode === 'already_paid') {
                    setCheckoutRequestId(null);
                    setErrorMessage(data.message || ALREADY_PAID_MESSAGE);
                    if (data.redirect) window.location.href = data.redirect;
                    return;
                }

                // Client-side twin of the same guard.
                if (
                    chargedOrderIdRef.current &&
                    data?.conekta_order_id &&
                    data.conekta_order_id !== chargedOrderIdRef.current
                ) {
                    setCheckoutRequestId(null);
                    setErrorMessage(ALREADY_PAID_MESSAGE);
                    return;
                }

                if (data?.checkout_request_id) {
                    // Track the Conekta order the iframe will be bound to —
                    // onPaymentSetup hands this to process_payment_api.
                    if (data.conekta_order_id) {
                        conektaOrderIdRef.current = String(data.conekta_order_id);
                    }
                    setCheckoutRequestId(data.checkout_request_id);
                    // Only remount when the Conekta order actually changed.
                    // mode === 'unchanged' means the amount is the same as the
                    // last sync, so the iframe is already showing the right total.
                    if (data.mode !== 'unchanged') {
                        setMountToken((t) => t + 1);
                    }
                    setErrorMessage('');
                } else {
                    setErrorMessage('Respuesta inválida del servidor.');
                }
            } catch (err) {
                if (!cancelled) {
                    setErrorMessage(err?.message || 'Error de red al preparar el pago.');
                }
            } finally {
                if (!cancelled) {
                    setRefreshing(false);
                }
            }
        }, DEBOUNCE_MS);

        return () => {
            cancelled = true;
            clearTimeout(timer);
        };
    }, [hash]);

    useEffect(() => {
        if (!checkoutRequestId) {
            return undefined;
        }

        if (scriptRef.current && document.body.contains(scriptRef.current)) {
            document.body.removeChild(scriptRef.current);
            scriptRef.current = null;
        }

        const container = document.querySelector('#conektaITokenizerframeContainer');
        if (container) container.innerHTML = '';

        const onScriptError = (err) => {
            setErrorMessage(err?.message || 'No se pudo cargar el componente de pago.');
        };

        const script = loadConektaScript(
            settings.api_key,
            checkoutRequestId,
            locale,
            orderEmitterRef.current,
            onScriptError
        );
        document.body.appendChild(script);
        scriptRef.current = script;

        return () => {
            if (scriptRef.current && document.body.contains(scriptRef.current)) {
                document.body.removeChild(scriptRef.current);
            }
            scriptRef.current = null;
            orderEmitterRef.current.resetStates();
            orderEmitterRef.current.clearSubmit();
        };
    }, [checkoutRequestId, mountToken]);

    useEffect(() => {
        const unsubscribe = onPaymentSetup(async () => {
            if (refreshingRef.current) {
                return {
                    type: emitResponse.responseTypes.ERROR,
                    message: 'Actualizando importe, intenta de nuevo en un momento',
                };
            }
            if (!checkoutRequestIdRef.current) {
                return {
                    type: emitResponse.responseTypes.ERROR,
                    message: 'Completa tu correo para ver el formulario de pago.',
                };
            }

            // Short-circuit when a wallet button (Apple Pay / Google Pay)
            // already charged: return the existing Conekta order id so WC
            // proceeds to process_payment_api without asking the SDK to
            // charge again.
            if (walletOrderRef.current) {
                const order = walletOrderRef.current;
                walletOrderRef.current = null;
                // A wallet order is charged by definition — remember it so a
                // failed checkout afterwards can never charge a second time.
                if (order?.id) chargedOrderIdRef.current = String(order.id);
                return {
                    type: emitResponse.responseTypes.SUCCESS,
                    meta: {
                        paymentMethodData: {
                            conekta_order_id: String(order.id),
                        },
                    },
                };
            }

            // Bail if WC's validation store has any errors — that's WC's own
            // generic record of "checkout fields are not valid yet". This avoids
            // calling Conekta (and charging the customer) for a checkout that
            // WC will reject anyway.
            const validationStore = window.wp?.data?.select?.('wc/store/validation');
            const validationErrors = validationStore?.getValidationErrors?.() || {};
            if (Object.keys(validationErrors).length > 0) {
                return {
                    type: emitResponse.responseTypes.ERROR,
                    message: 'Completa los campos requeridos del formulario antes de pagar.',
                };
            }

            // A charge already succeeded on this page but the checkout that
            // followed it failed (validation, network, stock). Never charge
            // again: hand WC the SAME Conekta order id so process_payment_api
            // completes the order from the existing payment — it re-verifies
            // paid + amount server-side before doing so.
            if (chargedOrderIdRef.current) {
                return {
                    type: emitResponse.responseTypes.SUCCESS,
                    meta: {
                        paymentMethodData: {
                            conekta_order_id: chargedOrderIdRef.current,
                        },
                    },
                };
            }

            // ORDER-FIRST: no charge here. Hand WC the id of the (unpaid)
            // Conekta order backing the mounted iframe; the Store API creates
            // and validates the WooCommerce order, and process_payment_api
            // amount-checks + links the two BEFORE any money moves. The actual
            // charge fires in the onCheckoutSuccess observer below — so a
            // checkout WooCommerce rejects can never cost the customer money.
            if (!conektaOrderIdRef.current) {
                return {
                    type: emitResponse.responseTypes.ERROR,
                    message: 'No se pudo preparar el pago. Intenta de nuevo.',
                };
            }
            payingRef.current = true;
            return {
                type: emitResponse.responseTypes.SUCCESS,
                meta: {
                    paymentMethodData: {
                        conekta_order_id: conektaOrderIdRef.current,
                    },
                },
            };
        });

        return () => unsubscribe();
    }, [onPaymentSetup, emitResponse.responseTypes.SUCCESS, emitResponse.responseTypes.ERROR]);

    // Post-checkout charge driver (see the exported chargeAndConfirm above).
    // Kept in a ref because the checkout observers are registered once.
    const chargeAndConfirmRef = useRef(null);
    chargeAndConfirmRef.current = (attempt) =>
        chargeAndConfirm(
            {
                orderEmitter: orderEmitterRef.current,
                chargedOrderIdRef,
                expectingChargeRef,
                confirmUrl: settings.confirm_url,
                nonce: settings.nonce,
            },
            attempt
        );

    // Order-first observers. onCheckoutSuccess fires AFTER the Store API
    // created/validated the order and process_payment_api prepared the Conekta
    // order — this is where the money moves now. onCheckoutFail means WC
    // rejected the checkout pre-charge: unfreeze the refresh loop, nothing
    // was paid. The legacy aliases cover WooCommerce Blocks < 9.7.
    useEffect(() => {
        const onSuccess =
            eventRegistration.onCheckoutSuccess ||
            eventRegistration.onCheckoutAfterProcessingWithSuccess;
        const onFail =
            eventRegistration.onCheckoutFail ||
            eventRegistration.onCheckoutAfterProcessingWithError;

        const unsubFail = onFail
            ? onFail(() => {
                  payingRef.current = false;
                  return true;
              })
            : undefined;

        if (!onSuccess) {
            // Very old Blocks without the observer: process_payment_api's
            // redirect fallback lands the customer on order-received with the
            // order pending — nothing charged, recoverable by hand.
            return () => {
                if (unsubFail) unsubFail();
            };
        }

        const unsubSuccess = onSuccess(async (payload = {}) => {
            const details = payload.processingResponse?.paymentDetails || {};
            if (!details.conekta_pending_payment) {
                // Post-charge path (wallet / resubmit-after-charge): the
                // server already completed the order — follow its redirect.
                return true;
            }

            const attempt = {
                conektaOrderId: details.conekta_order_id,
                wcOrderId: details.wc_order_id,
                wcOrderKey: details.wc_order_key,
            };
            const outcome = await chargeAndConfirmRef.current(attempt);

            if (outcome.ok) {
                if (outcome.redirect) window.location.href = outcome.redirect;
                return true;
            }

            // Both failure kinds keep the retry available: a decline re-runs
            // charge+confirm; a confirm failure re-runs only the confirm
            // (chargedOrderIdRef short-circuits the charge).
            setPendingPayment(attempt);
            setErrorMessage(outcome.message);
            return {
                type: emitResponse.responseTypes.ERROR,
                message: outcome.message,
                retry: true,
            };
        });

        return () => {
            if (unsubSuccess) unsubSuccess();
            if (unsubFail) unsubFail();
        };
    }, [eventRegistration, emitResponse.responseTypes.ERROR]);

    // In-page retry after a failed charge/confirm. Deliberately does NOT go
    // through the Store API again: the WC order already exists (pending) and
    // the cart may already be empty — re-posting the checkout would fail or,
    // worse, create a second order. The iframe is still mounted on the same
    // (unpaid) Conekta order, so retrying is just charge+confirm again.
    const handleRetryPayment = async () => {
        if (!pendingPayment || retrying) return;
        setRetrying(true);
        setErrorMessage('');
        const outcome = await chargeAndConfirmRef.current(pendingPayment);
        if (outcome.ok) {
            if (outcome.redirect) window.location.href = outcome.redirect;
            return;
        }
        setErrorMessage(outcome.message);
        setRetrying(false);
    };

    const showEmailPlaceholder = !billingEmail || !EMAIL_REGEX.test(billingEmail);

    return (
        <div>
            <p>{decodeEntities(settings.description)}</p>
            {showEmailPlaceholder && (
                <p>Completa tu correo para ver el formulario de pago.</p>
            )}
            {errorMessage && <p style={{ color: 'red' }}>{errorMessage}</p>}
            {pendingPayment && (
                <button
                    type="button"
                    className="components-button wc-block-components-button conekta-retry-payment"
                    onClick={handleRetryPayment}
                    disabled={retrying}
                >
                    {retrying ? 'Procesando…' : 'Reintentar pago'}
                </button>
            )}
            <div id="conektaITokenizerframeContainer" style={{ height: 600 }}></div>
        </div>
    );
};

const LabelConekta = (props) => {
    const { PaymentMethodLabel } = props.components;

    const Icons = () => (
        <div style={{ display: 'flex', alignItems: 'center' }}>
            <img src="https://assets.conekta.com/cpanel/statics/assets/brands/logos/visa.svg" alt="Visa" style={{ marginLeft: '8px', width: '32px', height: 'auto' }} />
            <img src="https://assets.conekta.com/cpanel/statics/assets/brands/logos/amex.svg" alt="Amex" style={{ marginLeft: '8px', width: '32px', height: 'auto' }} />
            <img src="https://assets.conekta.com/cpanel/statics/assets/brands/logos/mastercard.svg" alt="MasterCard" style={{ marginLeft: '8px', width: '32px', height: 'auto' }} />
        </div>
    );

    return (
        <div style={{ display: 'flex', width: '99%', justifyContent: 'space-between', alignItems: 'center' }}>
            <PaymentMethodLabel text={labelConekta} />
            <Icons />
        </div>
    );
};

/**
  * conekta payment method config object.
 */
const conekta = {
    name: settings.name,
    label: <LabelConekta />,
    edit: <ContentConekta />,
    content: <ContentConekta />,
    canMakePayment: () => settings.is_enabled || false,
    ariaLabel: labelConekta,
    supports: {
        showSavedCards: true,
    },
    icons: []
};

registerPaymentMethod(conekta);
