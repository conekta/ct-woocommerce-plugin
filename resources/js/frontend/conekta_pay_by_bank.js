import {registerPaymentMethod} from '@woocommerce/blocks-registry';
import {decodeEntities} from '@wordpress/html-entities';
import {getSetting} from '@woocommerce/settings';

const settings = getSetting('conekta_pay_by_bank_data', {});
const labelConekta = decodeEntities(settings.title);
/**
* Content component
*/

const ContentConekta = () => {
    return decodeEntities(settings.description);
};


const LabelConekta = (props) => {
    const {PaymentMethodLabel} = props.components;

    const Icons = () => (
        <div style={{display: 'flex', alignItems: 'center'}}>
            <img src={`https://assets.conekta.com/cpanel/statics/assets/brands/logos/bbva.svg`} alt="bank"
                 style={{marginLeft: '8px', width: '32px', height: 'auto'}}/>
        </div>
    );

    return (
        <div style={{display: 'flex', width: '99%', justifyContent: 'space-between', alignItems: 'center'}}>
            <PaymentMethodLabel text={labelConekta}/>
            <Icons/>
        </div>
    );
};


/**
* conekta payment method config object.
*/
const conekta_pay_by_bank = {
    name: settings.name,
    label: <LabelConekta/>,
    content: <ContentConekta/>,
    edit: <ContentConekta/>,
    canMakePayment: () => {
        return settings.is_enabled || false;
    },
    ariaLabel: labelConekta,
    supports: {},
    icons: [],
};


registerPaymentMethod(conekta_pay_by_bank);

if (typeof window !== 'undefined') {
    const handleRedirect = () => {
        const urlParams = new URLSearchParams(window.location.search);
        const redirectUrl = urlParams.get('redirect_url');
        const deepLink = urlParams.get('deep_link');
        const autoRedirect = urlParams.get('auto_redirect');
        
        if ((redirectUrl || deepLink) && autoRedirect === '1') {
            const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
            const paymentUrl = isMobile ? deepLink : redirectUrl;
            
            if (paymentUrl) {
                const decodedUrl = decodeURIComponent(paymentUrl);
                window.open(decodedUrl, '_blank', 'noopener,noreferrer');
                
                ['redirect_url', 'deep_link', 'auto_redirect'].forEach(param => urlParams.delete(param));
                const cleanUrl = `${window.location.pathname}${urlParams.toString() ? `?${urlParams.toString()}` : ''}`;
                window.history.replaceState({}, document.title, cleanUrl);
            }
        }
    };
    
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', handleRedirect);
    } else {
        handleRedirect();
    }
}

