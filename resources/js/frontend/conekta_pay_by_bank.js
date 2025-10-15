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
    // Explicit whitelist of allowed redirect URI paths/names for security.
    // Example: only allow redirects to these internal routes or official deep links.
    const ALLOWED_REDIRECT_URIS = [
        '/order-received/', // Internal success page
        '/checkout/order-received/', // WooCommerce typical page
        '/thank-you/', // Internal
        // You can add more allowed internal paths here.
    ];
    const ALLOWED_DEEP_LINK_PREFIXES = [
        'bankapp://',
        'intent://'
        // Add any additional trusted deep-link prefixes here.
    ];

    function isAllowedRedirectUrl(url) {
        try {
            // Only allow relative URLs that exactly match known safe endpoints.
            if (/^[a-zA-Z][a-zA-Z0-9+\-.]*:/.test(url)) {
                // URI with protocol: allow deep links only if prefix matches whitelist
                for (const prefix of ALLOWED_DEEP_LINK_PREFIXES) {
                    if (url.startsWith(prefix)) return true;
                }
                // Absolute http(s), allow *only* same-origin AND only if pathname matches allowed list
                const parsed = new URL(url, window.location.origin);
                if ((parsed.protocol === 'https:' || parsed.protocol === 'http:') && parsed.origin === window.location.origin) {
                    // Check if path starts with an allowed entry
                    return ALLOWED_REDIRECT_URIS.some((allowed) => parsed.pathname.startsWith(allowed));
                }
                return false;
            } else {
                // Relative URL, allow only if starts with allowed redirect entries
                return ALLOWED_REDIRECT_URIS.some((allowed) => url.startsWith(allowed));
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
            } else {
                // Optionally, inform the user if a redirect was blocked
                // alert('Untrusted or unsupported redirect URL. Please contact support if you believe this is an error.');
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

