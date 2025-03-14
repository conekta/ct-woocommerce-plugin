import { registerPaymentMethod } from '@woocommerce/blocks-registry';
import { decodeEntities } from '@wordpress/html-entities';
import { getSetting } from '@woocommerce/settings';
import { useEffect, useRef } from '@wordpress/element';
const settings = getSetting('conekta_data', {});
const labelConekta = decodeEntities(settings.title);


/**
 * Content component
 */
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const ContentConekta = (props) => {
	
	const { eventRegistration, emitResponse } = props;
	console.log(props)
	const conektaSubmitFunction = useRef(null);
	
	const { onPaymentProcessing	} = eventRegistration;

    useEffect(() => {
		const waitAndReturnMessage = async () => {
			await delay(10000);
			return "Frank 10 segundos";
		  };
		console.error('epale 1');
        const unsubscribe = onPaymentProcessing(async () => {
		console.error('epale 2');

            if (conektaSubmitFunction.current) {
				console.error('epale 3');
                //await conektaSubmitFunction.current();
				const message = await waitAndReturnMessage();
				console.error('epale 4', message);
                
                return {
					type: emitResponse.responseTypes.SUCCESS,
					meta: {
						paymentMethodData: {
							token: 'tok_test_visa_4242',
						},
					}
				};
            } else {
                console.error('Conekta submit function not available.');
                return {
                    type: emitResponse.responseTypes.ERROR,
                    message: 'There was an error',
                };
            }
        });
		return () => {
			unsubscribe();
		};
    }, [emitResponse.responseTypes.ERROR,
		emitResponse.responseTypes.SUCCESS,
		onPaymentProcessing]);

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
                onUpdateSubmitTrigger: function (triggerSubmitFromExternalFunction) {
                    conektaSubmitFunction.current = async () => {
                        console.log("Conekta submit function called");
                        try {
                            const result = await triggerSubmitFromExternalFunction();
                            console.log("Conekta submit function result:", result);
                            return result;
                        } catch (error) {
                            console.error("Error in submit function:", error);
                            throw error;
                        }
                    };
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

/**
 * conekta payment method config object.
 */
const conekta = {
    name: settings.name,
    label: <LabelConekta />,
	edit:<ContentConekta />,
    content: <ContentConekta />,
    canMakePayment: () => settings.is_enabled || false,
    ariaLabel: labelConekta,
    supports: {
		showSavedCards:true,
	},
    icons: []
};

registerPaymentMethod(conekta);