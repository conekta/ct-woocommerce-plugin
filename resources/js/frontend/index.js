import { registerPaymentMethod } from '@woocommerce/blocks-registry';
import { decodeEntities } from '@wordpress/html-entities';
import { getSetting } from '@woocommerce/settings';
import { useEffect, useRef } from '@wordpress/element';
const settings = getSetting('conekta_data', {});
const labelConekta = decodeEntities(settings.title);


/**
 * Content component
 */
const ContentConekta = (props) => {
	
	console.log(props)
	const conektaSubmitFunction = useRef(null);
	
	const { onCheckoutValidationBeforeProcessing	} = props.eventRegistration

    useEffect(() => {
        const unsubscribe = onCheckoutValidationBeforeProcessing(() => {
            if (conektaSubmitFunction.current) {
                conektaSubmitFunction.current();
            } else {
                console.error('Conekta submit function not available.');
            }
        });
        return unsubscribe;
    }, [onCheckoutValidationBeforeProcessing]);

    useEffect(() => {
        const script = document.createElement('script');
        script.src = "https://pay.stg.conekta.io/v1.0/js/conekta-checkout.min.js";
        script.async = true;
        script.onload = () => {
            const config = {
                targetIFrame: "#conektaIframeContainer",
                publicKey: settings.api_key,
                locale: 'es',
                useExternalSubmit: true,
            };
            const callbacks = {
                onCreateTokenSucceeded: function (token) {
                    console.log(token);
                },
                onCreateTokenError: function (error) {
                    console.log(error);
                },
                onGetInfoSuccess: function (loadingTime) {
                    console.log("loadingTime");
                },
                onUpdateSubmitTrigger: function (submitFunction) {
                    conektaSubmitFunction.current = submitFunction;
                },
            };
            if (window.ConektaCheckoutComponents) {
                window.ConektaCheckoutComponents.Card({
                    config,
                    callbacks,
                    allowTokenization: true,
                });
            }
        };
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
const SavedTokenComponent = (props) => {
	console.log(props)
	return (
        <>
           
        </>
    );
}
/**
 * conekta payment method config object.
 */
const conekta = {
    name: settings.name,
    label: <LabelConekta />,
    content: <ContentConekta />,
    edit: <ContentConekta />,
    canMakePayment: () => settings.is_enabled || false,
    ariaLabel: labelConekta,
    supports: {
		showSavedCards:true,
	},
    icons: [],
	savedTokenComponent: <SavedTokenComponent />,
};

registerPaymentMethod(conekta);