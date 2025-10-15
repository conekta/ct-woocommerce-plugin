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
    // Helper to validate allowed redirect URLs.
    // Only allow specific schemes (https, http, app-specific deep links), or relative URLs.
    function isAllowedRedirectUrl(url) {
        try {
            // Allow (a) absolute URLs with http/https, pointing to the same origin, or (b) specific deep-link schemes
            const allowedSchemes = ['https:', 'http:', 'bankapp:', 'intent:'];
            // URLs like bankapp://..., intent://..., or https://<current-host>/...
            if (/^[a-zA-Z][a-zA-Z0-9+\-.]*:/.test(url)) {
                // Has a protocol, check if it is allowed
                const parsed = new URL(url, window.location.origin);
                // If http(s), ensure it's current origin; if deep-link, allow if in allowedSchemes
                if (['https:', 'http:'].includes(parsed.protocol)) {
                    return parsed.origin === window.location.origin;
                } else {
                    return allowedSchemes.includes(parsed.protocol);
                }
            } else {
                // No scheme = relative URL, consider safe (optional: further restrict if desired)
                return true;
            }
        } catch (e) {
            return false;
        }
    }
    
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

                // Validate decodedUrl before navigation.
                if (!isAllowedRedirectUrl(decodedUrl)) {
                    // Optionally show error, alert, or just silently ignore
                    console.warn('Blocked untrusted redirect URL:', decodedUrl);
                    return;
                }

                if (isMobile) {
                    // Para CUALQUIER mobile: ejecutar inmediatamente sin timeout
                    try {
                        const newWindow = window.open(decodedUrl, '_blank');
                        if (!newWindow || newWindow.closed || typeof newWindow.closed === 'undefined') {
                            // Si window.open falla, intentar con link.click()
                            const link = document.createElement('a');
                            link.href = decodedUrl;
                            link.target = '_blank';
                            link.rel = 'noopener noreferrer';
                            document.body.appendChild(link);
                            link.click();
                            document.body.removeChild(link);
                        }
                    } catch(e) {
                        // Si hay error, usar link como fallback
                        const link = document.createElement('a');
                        link.href = decodedUrl;
                        link.target = '_blank';
                        link.rel = 'noopener noreferrer';
                        document.body.appendChild(link);
                        link.click();
                        document.body.removeChild(link);
                    }
                } else {
                    // Para desktop
                    window.open(decodedUrl, '_blank', 'noopener,noreferrer');
                }
                
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

