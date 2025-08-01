import { registerPaymentMethod } from '@woocommerce/blocks-registry';
import { decodeEntities } from '@wordpress/html-entities';
import { getSetting } from '@woocommerce/settings';
import { useEffect, useRef, useState } from '@wordpress/element';
import { TokenEmitter } from './TokenEmitter';
import { CONEKTA_MSI_OPTION_KEY, DEFAULT_MSI_OPTION, useComponentScript } from './useComponentScript';
import { TRANSLATIONS_FILES } from './translations';

const settings = getSetting('conekta_data', {});
const labelConekta = decodeEntities(settings.title);
const tokenEmitter = new TokenEmitter();

// Process 3DS if enabled
const is3dsEnabled = settings.three_ds_enabled || false;

const waitGetToken = () => {
    return new Promise((resolve, reject) => {
        tokenEmitter.resetStates();

        let timeout = setTimeout(() => {
            reject(new Error("Timeout esperando token"));
        }, 30000);

        tokenEmitter.onToken((token) => {
            clearTimeout(timeout);
            resolve(token);
        });

        tokenEmitter.onError((error) => {
            clearTimeout(timeout);
            reject(error);
        });
    });
};

// Create Conekta order with 3DS
const create3dsOrder = async (token, orderId, msiOption, props) => {
    try {
        const headers = {
            'Content-Type': 'application/json',
        };
        
        // Add nonce if available
        if (settings.wpApiNonce) {
            headers['X-WP-Nonce'] = settings.wpApiNonce;
        }
        
        const requestData = {
            token,
            msi_option: msiOption
        };
        
        // Add order_id if provided
        if (orderId) {
            requestData.order_id = orderId;
        } else {
            // Add blocks-specific data
            requestData.is_blocks_context = true;
            
            // Extract cart items from props.cartData
            const cartItems = props?.cartData?.cartItems || [];
            
            // Extract cart total from props.billing
            const cartTotal = props?.billing?.cartTotal?.value || 0;
            const currencyCode = props?.billing?.currency?.code || 'MXN';
            
            // Process cart data
            const cartData = {
                total: cartTotal,
                currency: currencyCode
            };
            
            // Format cart items
            if (cartItems && cartItems.length > 0) {
                cartData.items = cartItems.map(item => {
                    // Ensure numeric values
                    const quantity = parseInt(item.quantity, 10);
                    // Try to get item total from different possible locations
                    let total = 0;
                    if (item.totals && item.totals.line_total) {
                        total = parseFloat(item.totals.line_total);
                    } else if (item.prices && item.prices.price) {
                        total = parseFloat(item.prices.price) * quantity;
                    }
                    
                    return {
                        id: parseInt(item.id, 10),
                        name: item.name || 'Product',
                        quantity: quantity,
                        total: total,
                        variation_id: item.variation && item.variation.id ? parseInt(item.variation.id, 10) : null
                    };
                });
            }
            
            requestData.cart_data = cartData;
            
            // Process billing data - use billingAddress or billingData
            const billingData = props?.billing?.billingAddress || props?.billing?.billingData;
            
            if (billingData) {
                requestData.billing_data = {
                    first_name: billingData.first_name || '',
                    last_name: billingData.last_name || '',
                    company: billingData.company || '',
                    address_1: billingData.address_1 || '',
                    address_2: billingData.address_2 || '',
                    city: billingData.city || '',
                    state: billingData.state || '',
                    postcode: billingData.postcode || '',
                    country: billingData.country || 'MX',
                    email: billingData.email || '',
                    phone: billingData.phone || ''
                };
            }
        }
        
        const response = await fetch('/wp-json/conekta/v1/create-3ds-order', {
            method: 'POST',
            headers,
            body: JSON.stringify(requestData),
            credentials: 'same-origin'
        });
        
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Error creating 3DS order (${response.status}): ${errorText}`);
        }
        
        return await response.json();
    } catch (error) {
        console.error('Error creating 3DS order:', error);
        throw error;
    }
};

// Tiempo máximo esperando carga de 3DS (1 minuto)
const THREE_DS_TIMEOUT = 60 * 1000; // 60 000 ms

// Create iframe for 3DS authentication
const create3dsIframe = (url) => {
    return new Promise((resolve, reject) => {
        try {
            // Remove any existing iframe
            const existingIframe = document.getElementById('conekta3dsIframe');
            const existingContainer = document.getElementById('conekta3dsContainer');
            
            if (existingContainer) {
                existingContainer.parentNode.removeChild(existingContainer);
            }
            
            // Usa contenedor existente para 3DS
            const conekta3dsContainer = document.getElementById('conektaIThreeDsframeContainer');
            if (!conekta3dsContainer) {
                console.error('3DS container not found');
                reject(new Error('No se encontró el contenedor para 3DS'));
                return;
            }
            conekta3dsContainer.innerHTML = '';
            conekta3dsContainer.style.display = 'flex';
            
            conekta3dsContainer.style.display = 'flex';
            conekta3dsContainer.style.flexDirection = 'column';
            conekta3dsContainer.style.justifyContent = 'center';
            conekta3dsContainer.style.alignItems = 'center';
 
            const parentContainer = document.getElementById('conektaITokenizerframeContainer');
            if (!parentContainer) {
                console.error('Target container for 3DS not found');
                reject(new Error('No se encontró el contenedor para 3DS'));
                return;
            }

            // Animar ocultar tokenizer
            parentContainer.classList.remove('conekta-slide-in');
            parentContainer.classList.add('conekta-slide-out');
            setTimeout(() => {
                parentContainer.style.display = 'none';
                parentContainer.classList.remove('conekta-slide-out');
            }, 300);

            if (getComputedStyle(parentContainer).position === 'static') {
                parentContainer.style.position = 'relative';
            }



            const header = document.createElement('div');
            header.style.backgroundColor = 'white';
            header.style.padding = '15px';
            header.style.borderRadius = '8px 8px 0 0';
            header.style.width = '100%';
            header.style.maxWidth = '600px';
            header.style.borderBottom = '1px solid #ddd';
            header.style.textAlign = 'center';

            const title = document.createElement('h3');
            title.textContent = 'Autenticación 3D Secure';
            title.style.margin = '0';
            title.style.padding = '0';
            title.style.fontWeight = 'bold';

            header.appendChild(title);
            conekta3dsContainer.appendChild(header);

            const iframe = document.createElement('iframe');
            iframe.id = 'conekta3dsIframe';
            iframe.src = `${url}?source=embedded`;
            iframe.style.width = '100%';
            const updateIframeHeight = () => {
                const isMobile = window.innerWidth <= 768;
                iframe.style.height = isMobile ? '600px' : '700px';
            };
            
            updateIframeHeight();
            
            const resizeListener = () => updateIframeHeight();
            window.addEventListener('resize', resizeListener);
            
            iframe.style.border = 'none';
            iframe.style.backgroundColor = 'white';
            iframe.style.borderRadius = '0 0 8px 8px';
            
            const loadingDiv = document.createElement('div');
            loadingDiv.textContent = 'Cargando autenticación 3D Secure...';
            loadingDiv.style.padding = '20px';
            loadingDiv.style.backgroundColor = 'white';
            loadingDiv.style.textAlign = 'center';
            loadingDiv.id = 'conekta3dsLoading';
            conekta3dsContainer.appendChild(loadingDiv);

            iframe.onload = function() {
                loadingDiv.style.display = 'none';
            };

            conekta3dsContainer.appendChild(iframe);
            conekta3dsContainer.classList.add('conekta-slide-in'); 
            
            setTimeout(() => {
                requestAnimationFrame(() => {
                    if (conekta3dsContainer && conekta3dsContainer.offsetParent !== null) {
                        const containerRect = conekta3dsContainer.getBoundingClientRect();
                        const currentScroll = window.pageYOffset || document.documentElement.scrollTop;
                        const containerTop = containerRect.top + currentScroll;
                        
                        const targetPosition = Math.max(0, containerTop - 400);
                        
                        console.log('Scroll automático:', {
                            containerTop: containerTop,
                            currentScroll: currentScroll,
                            targetPosition: targetPosition
                        });
                        
                        window.scrollTo({
                            top: targetPosition,
                            behavior: 'smooth'
                        });
                    }
                });
            }, 1000); 
            
            setTimeout(() => {
                const containerRect = conekta3dsContainer.getBoundingClientRect();
                if (containerRect.top > 100) {
                    console.log('Aplicando scroll de respaldo...');
                    conekta3dsContainer.scrollIntoView({
                        behavior: 'smooth',
                        block: 'start'
                    });
                }
            }, 2500);
            

            
            // Add timeout to reject if iframe doesn't load
            const timeoutId = setTimeout(() => {
                window.removeEventListener('resize', resizeListener);
                reject(new Error('Tiempo de espera agotado para la autenticación 3D Secure'));
                if (conekta3dsContainer.parentNode && conekta3dsContainer.parentNode.contains(conekta3dsContainer)) {
                    conekta3dsContainer.classList.remove('conekta-slide-in');
                            conekta3dsContainer.classList.add('conekta-slide-out');
                            setTimeout(()=>{
                                conekta3dsContainer.innerHTML='';
                                conekta3dsContainer.style.display='none';
                                conekta3dsContainer.classList.remove('conekta-slide-out');
                                // mostrar tokenizer con animación
                                parentContainer.style.display='';
                                parentContainer.classList.add('conekta-slide-in');
                            },300);
                }
            }, THREE_DS_TIMEOUT); // timeout 3DS
            
            // Listen for message event from iframe
            const messageHandler = (event) => {
                try {
                    if (event.origin === 'https://3ds-pay.conekta.com') {
                        window.removeEventListener('message', messageHandler);
                        window.removeEventListener('resize', resizeListener);
                        clearTimeout(timeoutId);
                        
                        if (conekta3dsContainer.parentNode && conekta3dsContainer.parentNode.contains(conekta3dsContainer)) {
                            conekta3dsContainer.classList.remove('conekta-slide-in');
                            conekta3dsContainer.classList.add('conekta-slide-out');
                            setTimeout(()=>{
                                conekta3dsContainer.innerHTML='';
                                conekta3dsContainer.style.display='none';
                                conekta3dsContainer.classList.remove('conekta-slide-out');
                                // mostrar tokenizer con animación
                                parentContainer.style.display='';
                                parentContainer.classList.add('conekta-slide-in');
                            },300);
                        }
                        
                        if (event.data.error || event.data.payment_status !== 'paid') {
                            reject(new Error('La autenticación 3D Secure ha fallado'));
                        } else {
                            resolve({
                                order_id: event.data.order_id,
                                payment_status: event.data.payment_status
                            });
                        }
                    }
                } catch (msgError) {
                    console.error('Error processing 3DS message:', msgError);
                    clearTimeout(timeoutId);
                    window.removeEventListener('resize', resizeListener);
                    if (conekta3dsContainer.parentNode && conekta3dsContainer.parentNode.contains(conekta3dsContainer)) {
                        conekta3dsContainer.classList.remove('conekta-slide-in');
                            conekta3dsContainer.classList.add('conekta-slide-out');
                            setTimeout(()=>{
                                conekta3dsContainer.innerHTML='';
                                conekta3dsContainer.style.display='none';
                                conekta3dsContainer.classList.remove('conekta-slide-out');
                                // mostrar tokenizer con animación
                                parentContainer.style.display='';
                                parentContainer.classList.add('conekta-slide-in');
                            },300);
                    }
                    reject(new Error('Error en el procesamiento de la respuesta 3D Secure'));
                }
            };
            
            window.addEventListener('message', messageHandler);
            
            // Add escape key handler to close modal
            const keyHandler = (keyEvent) => {
                if (keyEvent.key === 'Escape' || keyEvent.keyCode === 27) {
                    window.removeEventListener('keydown', keyHandler);
                    window.removeEventListener('resize', resizeListener);
                    clearTimeout(timeoutId);
                    if (conekta3dsContainer.parentNode && conekta3dsContainer.parentNode.contains(conekta3dsContainer)) {
                        conekta3dsContainer.classList.remove('conekta-slide-in');
                            conekta3dsContainer.classList.add('conekta-slide-out');
                            setTimeout(()=>{
                                conekta3dsContainer.innerHTML='';
                                conekta3dsContainer.style.display='none';
                                conekta3dsContainer.classList.remove('conekta-slide-out');
                                // mostrar tokenizer con animación
                                parentContainer.style.display='';
                                parentContainer.classList.add('conekta-slide-in');
                            },300);
                    }
                    reject(new Error('Autenticación 3D Secure cancelada por el usuario'));
                }
            };
            
            window.addEventListener('keydown', keyHandler);
            
        } catch (error) {
            console.error('Error creating 3DS iframe:', error);
            reject(new Error('Error al crear la ventana de autenticación 3D Secure'));
        }
    });
};

const ContentConekta = (props) => {
    const locale = settings.locale ?? 'es';
    const { eventRegistration, emitResponse } = props;
    const conektaSubmitFunction = useRef(null);
    const { onPaymentSetup } = eventRegistration;
    const { loadScript } = useComponentScript();
    const [processing, setProcessing] = useState(false);
    const [errorMessage, setErrorMessage] = useState('');

    // Añadir clase al bloque de métodos de pago durante el proceso 3DS/tokenización
    useEffect(() => {
        const paymentMethodContainer = document.querySelector('.wc-block-checkout__payment-method');
        if (paymentMethodContainer) {
            if (processing) {
                paymentMethodContainer.classList.add('three-ds-process');
            } else {
                paymentMethodContainer.classList.remove('three-ds-process');
            }
        }
    }, [processing]);

    useEffect(() => {
        const unsubscribe = onPaymentSetup(async () => {
            if (!conektaSubmitFunction.current) {
                console.error("Conekta submit function no disponible.");
                return {
                    type: emitResponse.responseTypes.ERROR,
                    message: "Error: Componente de pago no inicializado",
                };
            }

            try {
                // Prevent multiple submissions
                if (processing) {
                    return { 
                        type: emitResponse.responseTypes.ERROR, 
                        message: "Procesando pago, por favor espere" 
                    };
                }
                
                setProcessing(true);
                setErrorMessage('');
                
                try {
                    // Get token from Conekta Component
                    conektaSubmitFunction.current();
                    const token = await waitGetToken();
                    
                    // If 3DS is enabled, create 3DS order
                    if (is3dsEnabled) {
                        try {
                            const msiOption = sessionStorage.getItem(CONEKTA_MSI_OPTION_KEY) || DEFAULT_MSI_OPTION;
                            
                            const orderResponse = await create3dsOrder(token, null, msiOption, props);
                            
                            if (orderResponse.next_action) {
                                const redirectUrl = orderResponse.next_action.redirect_url;
                                const authResult = await create3dsIframe(redirectUrl);
                                
                                // Verify order status
                                if (authResult.payment_status === 'paid') {
                                    return {
                                        type: emitResponse.responseTypes.SUCCESS,
                                        meta: {
                                            paymentMethodData: {
                                                conekta_token: token,
                                                conekta_msi_option: String(msiOption),
                                                conekta_order_id: String(orderResponse.order_id),
                                                conekta_woo_order_id: String(orderResponse.woo_order_id),
                                                conekta_3ds_completed: true
                                            },
                                        }
                                    };
                                } else {
                                    throw new Error('3DS authentication failed');
                                }
                            }
                            
                            // If we get here, order was created but no 3DS needed
                            return {
                                type: emitResponse.responseTypes.SUCCESS,
                                meta: {
                                    paymentMethodData: {
                                        conekta_token: token,
                                        conekta_msi_option: String(msiOption),
                                        conekta_order_id: String(orderResponse.order_id),
                                        conekta_woo_order_id: String(orderResponse.woo_order_id)
                                    },
                                }
                            };
                        } catch (error) {
                            console.error('3DS error:', error);
                            setErrorMessage(error.message || 'Error en la autenticación 3DS');
                            return { 
                                type: emitResponse.responseTypes.ERROR,
                                message: "Error en autenticación 3DS: " + (error.message || 'Error desconocido')
                            };
                        }
                    }
                    
                    // Standard non-3DS flow
                    return {
                        type: emitResponse.responseTypes.SUCCESS,
                        meta: {
                            paymentMethodData: {
                                conekta_token: token,
                                conekta_msi_option: String(sessionStorage.getItem(CONEKTA_MSI_OPTION_KEY) || DEFAULT_MSI_OPTION),
                            },
                        }
                    };
                } catch (error) {
                    console.error("Error en el pago:", error);
                    setErrorMessage(error.message || 'Error procesando el pago');
                    return {
                        type: emitResponse.responseTypes.ERROR,
                        message: error.isFormError ? 
                            (TRANSLATIONS_FILES[locale]?.form_error || "Por favor completa el formulario") : 
                            "Error procesando el pago: " + (error.message || 'Error desconocido'),
                    };
                } finally {
                    setProcessing(false);
                }
            } catch (outerError) {
                console.error("Error inesperado:", outerError);
                setProcessing(false);
                setErrorMessage(outerError.message || 'Error inesperado');
                return {
                    type: emitResponse.responseTypes.ERROR,
                    message: "Error inesperado: " + (outerError.message || 'Error desconocido'),
                };
            }
        });

        return () => unsubscribe();
    }, []);

    useEffect(() => {
        const script = loadScript(settings.api_key, locale, conektaSubmitFunction, tokenEmitter, 
            settings.msi_enabled, settings.available_msi_options, props.billing?.cartTotal?.value || 0);
        document.body.appendChild(script);

        return () => {
            if (document.body.contains(script)) {
                document.body.removeChild(script);
            }
        };
    }, [props.billing.cartTotal.value]);

    return (
        <div>
            <p>{decodeEntities(settings.description)}</p>
            {errorMessage && <p style={{color: 'red'}}>{errorMessage}</p>}
            <div key={props.billing.cartTotal.value} id="conektaITokenizerframeContainer"></div>
            <div  id="conektaIThreeDsframeContainer"></div>
            {processing && <p>Procesando su pago...</p>}
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
    edit: <ContentConekta />,
    content: <ContentConekta />,
    canMakePayment: () => settings.is_enabled || false,
    ariaLabel: labelConekta,
    supports: {
        showSavedCards: true,
    },
    icons: []
};

registerPaymentMethod(conekta);