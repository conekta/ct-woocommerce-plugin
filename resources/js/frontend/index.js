import { registerPaymentMethod } from '@woocommerce/blocks-registry';
import { decodeEntities } from '@wordpress/html-entities';
import { getSetting } from '@woocommerce/settings';
import { useEffect, useRef } from '@wordpress/element';
import { TokenEmitter } from './TokenEmitter';
import { useComponentScript } from './useComponentScript';
import { TRANSLATIONS_FILES } from './translations';

const settings = getSetting('conekta_data', {});
const labelConekta = decodeEntities(settings.title);
const tokenEmitter = new TokenEmitter();

const waitGetToken = () => {
    return new Promise((resolve, reject) => {
        tokenEmitter.resetStates();

        let timeout = setTimeout(() => {
            reject(new Error("Timeout esperando token"));
        }, 30000);

        tokenEmitter.onToken((token) => {
            clearTimeout(timeout);
            resolve(token);
        });

        tokenEmitter.onError((error) => {
            clearTimeout(timeout);
            reject(error);
        });
    });
};

const ContentConekta = (props) => {
    const locale = settings.locale ?? 'es';
    const { eventRegistration, emitResponse } = props;
    const conektaSubmitFunction = useRef(null);
    const { onPaymentSetup } = eventRegistration;
    const { loadScript } = useComponentScript();

    useEffect(() => {
        const unsubscribe = onPaymentSetup(async () => {
            if (!conektaSubmitFunction.current) {
                console.error("Conekta submit function no disponible.");
                return {
                    type: emitResponse.responseTypes.ERROR,
                    message: "There was an error",
                };
            }

            try {
                conektaSubmitFunction.current();

                const token = await waitGetToken();
                console.log("Pago exitoso con token:", token);

                return {
                    type: emitResponse.responseTypes.SUCCESS,
                    meta: {
                        paymentMethodData: {
                            conekta_token: token
                        },
                    }
                };
            } catch (error) {
                console.error("Error en el pago:", error);
                return {
                    type: emitResponse.responseTypes.ERROR,
                    message: error.isFormError ? TRANSLATIONS_FILES[locale].form_error : "There was an error",
                };
            }
        });

        return () => unsubscribe();
    }, []);

    useEffect(() => {
        const script = loadScript(settings.api_key, locale, conektaSubmitFunction, tokenEmitter);
        document.body.appendChild(script);

        return () => {
            document.body.removeChild(script);
        };
    }, []);

    return (
        <div>
            <p>{decodeEntities(settings.description)}</p>
            <div id="conektaIframeContainer" style={{ height: '500px' }}></div>
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