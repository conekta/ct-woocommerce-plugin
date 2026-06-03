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

/**
 * Project an address object into a stable, pipe-joined string of the fields
 * we care about for change detection. Missing fields become empty strings so
 * a partial address still produces a stable hash with the right shape.
 */
export const addrFields = (a = {}) => [
    a.first_name || '',
    a.last_name  || '',
    a.address_1  || '',
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

const ContentConekta = (props) => {
    const locale = settings.locale ?? 'es';
    const { eventRegistration, emitResponse } = props;
    const { onPaymentSetup } = eventRegistration;

    const [checkoutRequestId, setCheckoutRequestId] = useState(null);
    const [mountToken, setMountToken] = useState(0);
    const [refreshing, setRefreshing] = useState(false);
    const [errorMessage, setErrorMessage] = useState('');

    const scriptRef = useRef(null);
    const orderEmitterRef = useRef(null);
    if (orderEmitterRef.current === null) {
        orderEmitterRef.current = new OrderEmitter();
    }
    // Mirrors `refreshing` so onPaymentSetup (registered once) sees the latest value.
    const refreshingRef = useRef(false);
    const checkoutRequestIdRef = useRef(null);
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
                    }),
                });

                if (cancelled) return;

                const data = await response.json().catch(() => ({}));

                if (!response.ok) {
                    if (data?.code === 'missing_customer_email') {
                        setErrorMessage('');  // expected while the user is still filling the form
                    } else if (response.status >= 500) {
                        setErrorMessage('Error del servidor al preparar el pago. Intenta de nuevo.');
                    } else {
                        setErrorMessage(data?.message || 'No se pudo preparar el pago.');
                    }
                    return;
                }

                if (data?.checkout_request_id) {
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

            expectingChargeRef.current = true;
            try {
                const orderPromise = new Promise((resolve, reject) => {
                    orderEmitterRef.current.onOrder((o) => resolve(o));
                    orderEmitterRef.current.onError((e) => reject(e));
                });
                orderEmitterRef.current.submit();
                const order = await orderPromise;

                return {
                    type: emitResponse.responseTypes.SUCCESS,
                    meta: {
                        paymentMethodData: {
                            conekta_order_id: String(order.id),
                        },
                    },
                };
            } catch (error) {
                return {
                    type: emitResponse.responseTypes.ERROR,
                    message: error?.message || 'Error procesando el pago',
                };
            } finally {
                expectingChargeRef.current = false;
            }
        });

        return () => unsubscribe();
    }, [onPaymentSetup, emitResponse.responseTypes.SUCCESS, emitResponse.responseTypes.ERROR]);

    const showEmailPlaceholder = !billingEmail || !EMAIL_REGEX.test(billingEmail);

    return (
        <div>
            <p>{decodeEntities(settings.description)}</p>
            {showEmailPlaceholder && (
                <p>Completa tu correo para ver el formulario de pago.</p>
            )}
            {errorMessage && <p style={{ color: 'red' }}>{errorMessage}</p>}
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
