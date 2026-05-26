import { registerPaymentMethod } from '@woocommerce/blocks-registry';
import { decodeEntities } from '@wordpress/html-entities';
import { getSetting } from '@woocommerce/settings';
import { useEffect, useRef, useState } from '@wordpress/element';
import { OrderEmitter } from './OrderEmitter';
import { loadConektaScript } from './loadConektaScript';
import { useWalletAutoSubmit } from './useWalletAutoSubmit';

const settings = getSetting('conekta_data', {});
const labelConekta = decodeEntities(settings.title);

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DEBOUNCE_MS = 500;

const pickSelectedShipping = (props) => {
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

    const billingAddress = props.billing?.billingAddress || {};
    const cartItems = props.cartData?.cartItems || [];
    const cartTotal = props.billing?.cartTotal?.value || 0;
    const currencyCode = props.billing?.currency?.code || 'MXN';

    const selectedShipping = pickSelectedShipping(props);
    const shippingRateId = selectedShipping?.id ?? '';
    const itemsHashSource = cartItems
        .map((i) => `${i.id}:${i.quantity}:${i.variation?.id ?? ''}`)
        .join('|');
    const billingEmail = billingAddress.email || '';
    // Address fields go in the hash so the checkout-request POST re-fires
    // when the address completes — the create call requires shipping_contact
    // and Conekta's update path can't backfill it.
    const addrHashSource = [
        billingAddress.first_name || '',
        billingAddress.last_name || '',
        billingAddress.address_1 || '',
        billingAddress.city || '',
        billingAddress.state || '',
        billingAddress.postcode || '',
        billingAddress.country || '',
    ].join('|');
    const hash = `${cartTotal}|${currencyCode}|${itemsHashSource}|${shippingRateId}|${billingEmail}|${addrHashSource}`;

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
                const response = await fetch(settings.checkout_request_url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'same-origin',
                    body: JSON.stringify({
                        nonce: settings.nonce,
                        email: billingEmail,
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
