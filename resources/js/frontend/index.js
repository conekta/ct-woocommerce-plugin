
import { registerPaymentMethod } from '@woocommerce/blocks-registry';
import { decodeEntities } from '@wordpress/html-entities';



const label =  'Pago con SPEI';
/**
 * Content component
 */
const Content = () => {
	return decodeEntities(  'Por favor realiza el pago en el portal de tu banco utilizando los datos que te enviamos por correo.' );
};
/**
 * Label component
 *
 * @param {*} props Props from payment API.
 */
const Label = ( props ) => {
	const { PaymentMethodLabel } = props.components;
	return <PaymentMethodLabel text={ label } />;
};
const SpeiIcon = () => (
	<img src={`${window.location.origin}/images/spei.png`} alt="Pago con SPEI" />
);

/**
 * Dummy payment method config object.
 */
const Dummy = {
	name: "conektaspei",
	label: <Label />,
	content: <Content />,
	edit: <Content />,
	canMakePayment: () => true,
	ariaLabel: label,
	supports: {

	},
	icons: [<SpeiIcon />],
};

registerPaymentMethod( Dummy );
