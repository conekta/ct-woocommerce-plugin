
import { registerPaymentMethod } from '@woocommerce/blocks-registry';
import { decodeEntities } from '@wordpress/html-entities';
import { getSetting } from '@woocommerce/settings';

const settings = getSetting( 'conekta_data', {} );
const labelConekta = decodeEntities( settings.title ) ||  'Pago con Conekta';
/**
 * Content component
 */

const ContentConekta = () => {
	return decodeEntities(  '' );
};


const LabelConekta = ( props ) => {
	const { PaymentMethodLabel } = props.components;

	// Componente para mostrar los íconos
	const Icons = () => (
			<div style={{ display: 'flex',  alignItems: 'center' }}>
					<img src={`https://assets.conekta.com/checkout/img/logos/visa.svg`} alt="Visa" style={{ marginLeft: '8px', width: '32px', height: 'auto' }} />
					<img src={`https://assets.conekta.com/checkout/img/logos/amex.svg`} alt="amex" style={{ marginLeft: '8px', width: '32px', height: 'auto' }} />
					<img src={`https://assets.conekta.com/checkout/img/logos/master-card.svg`} alt="master" style={{ marginLeft: '8px', width: '32px', height: 'auto' }} />
					<img src={`https://assets.conekta.com/checkout/img/icons/cash.svg`} alt="cash" style={{ marginLeft: '8px', width: '32px', height: 'auto' }} />
					<img src={`https://assets.conekta.com/cpanel/statics/assets/brands/logos/spei-24px.svg`} alt="bank" style={{ marginLeft: '8px', width: '32px', height: 'auto' }} />
			</div>
	);

	return (
			<div style={{ display: 'flex', width: '99%', justifyContent: 'space-between',alignItems: 'center' }}>
					<PaymentMethodLabel text={ labelConekta } />
					<Icons />
			</div>
	);
};


/**
 * conekta payment method config object.
 */
const conekta = {
	name: "conekta",
	label: <LabelConekta />,
	content: <ContentConekta />,
	edit: <ContentConekta />,
	canMakePayment: () => true,
	ariaLabel: labelConekta,
	supports: {},
	icons: [],
};



registerPaymentMethod( conekta );
