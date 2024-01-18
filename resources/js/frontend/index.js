
import { registerPaymentMethod } from '@woocommerce/blocks-registry';
import { decodeEntities } from '@wordpress/html-entities';
import { getSetting } from '@woocommerce/settings';

const settings = getSetting( 'conekta_data', {} );
console.log( settings );
const labelConekta = decodeEntities( settings.title ) ||  'Pago con Conekta';
/**
 * Content component
 */

const ContentCard = () => {
	return decodeEntities(  '' );
};


const LabelConekta = ( props ) => {
	const { PaymentMethodLabel } = props.components;

	// Componente para mostrar los íconos
	const Icons = () => (
			<div style={{ display: 'inline-flex', alignItems: 'center' }}>
					<img src={`https://assets.conekta.com/checkout/img/logos/visa.svg`} alt="Visa" style={{ marginLeft: '8px', width: '32px', height: 'auto' }} />
					<img src={`https://assets.conekta.com/checkout/img/logos/amex.svg`} alt="amex" style={{ marginLeft: '8px', width: '32px', height: 'auto' }} />
					<img src={`https://assets.conekta.com/checkout/img/logos/master-card.svg`} alt="master" style={{ marginLeft: '8px', width: '32px', height: 'auto' }} />
					<img src={`https://assets.conekta.com/checkout/img/icons/cash.svg`} alt="cash" style={{ marginLeft: '8px', width: '32px', height: 'auto' }} />
					<img src={`https://assets.conekta.com/checkout/img/icons/bankTransfer.svg`} alt="bank" style={{ marginLeft: '8px', width: '32px', height: 'auto' }} />
			</div>
	);

	return (
			<div style={{ display: 'flex', alignItems: 'center' }}>
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
	content: <ContentCard />,
	edit: <ContentCard />,
	canMakePayment: () => true,
	ariaLabel: labelConekta,
	supports: {},
	icons: [],
};



registerPaymentMethod( conekta );
