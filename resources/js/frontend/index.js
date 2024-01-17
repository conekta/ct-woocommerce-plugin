
import { registerPaymentMethod } from '@woocommerce/blocks-registry';
import { decodeEntities } from '@wordpress/html-entities';

const labelCard =  'Pago con Conekta';
/**
 * Content component
 */

const ContentCard = () => {
	return decodeEntities(  '' );
};


const LabelCard = ( props ) => {
	const { PaymentMethodLabel } = props.components;
	return <PaymentMethodLabel text={ labelCard } />;
};

const CadIcon = () => (
	<img src={`${window.location.origin}/images/spei.png`} alt="Pago con SPEI" />
);


/**
 * card payment method config object.
 */
const Card = {
	name: "conekta",
	label: <LabelCard />,
	content: <ContentCard />,
	edit: <ContentCard />,
	canMakePayment: () => true,
	ariaLabel: labelCard,
	supports: {},
	icons: [<CadIcon />],
};



registerPaymentMethod( Card );
