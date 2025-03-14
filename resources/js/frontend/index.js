import { registerPaymentMethod } from '@woocommerce/blocks-registry';
import { decodeEntities } from '@wordpress/html-entities';
import { getSetting } from '@woocommerce/settings';
import { useEffect, useRef } from '@wordpress/element';
import { TokenEmitter } from './TokenEmitter';
import { useComponentScript } from './useComponentScript';

const settings = getSetting('conekta_data', {});
const labelConekta = decodeEntities(settings.title);
const tokenEmitter = new TokenEmitter();
/**
 * Content component
 */
const ContentConekta = (props) => {
	
	const { eventRegistration, emitResponse } = props;
	const conektaSubmitFunction = useRef(null);
	const { onPaymentSetup	} = eventRegistration;
    const {loadScript} = useComponentScript();

    useEffect(() => {
		const waitAndReturnMessage =() =>{
            return new Promise((resolve) => {
                tokenEmitter.onToken((token) => {
                    resolve(token);
                  });
            });
          }
          
        const unsubscribe = onPaymentSetup(async () => {
            if (conektaSubmitFunction.current) {
                conektaSubmitFunction.current();
				const token = await waitAndReturnMessage();
                return {
					type: emitResponse.responseTypes.SUCCESS,
					meta: {
						paymentMethodData: {
							"conekta_token" : token
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
		onPaymentSetup]);

    useEffect(() => {
        const script = loadScript(settings.api_key, conektaSubmitFunction, tokenEmitter);
        document.body.appendChild(script);

        return () => {
            document.body.removeChild(script);
        };
    }, []);

    return (
        <div>
            <p>{decodeEntities(settings.description)}</p>
            <input type="hidden" id="conekta-token"/>
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