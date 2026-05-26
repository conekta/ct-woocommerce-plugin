const CONEKTA_SDK_URL = 'https://pay.conekta.com/v1.0/js/conekta-checkout.min.js';
const DEFAULT_TARGET_IFRAME = '#conektaITokenizerframeContainer';

/**
 * Mounts the Conekta Integration component. Shared by Blocks checkout
 * (resources/js/frontend/index.js) and Classic checkout
 * (resources/js/frontend/classic-checkout.js) — all SDK callback wiring
 * lives here so behavior stays identical across both flows.
 *
 * Returns the <script> element so the caller can append it to the DOM and
 * remove it on cleanup.
 */
export const loadConektaScript = (
  publicKey,
  checkoutRequestId,
  locale,
  orderEmitter,
  onScriptError,
  targetIFrame = DEFAULT_TARGET_IFRAME
) => {
  const script = document.createElement('script');
  script.src = CONEKTA_SDK_URL;
  script.async = true;
  script.onload = () => {
    if (!window.ConektaCheckoutComponents) {
      onScriptError?.(new Error('Conekta SDK not available'));
      return;
    }
    const config = {
      targetIFrame,
      publicKey,
      locale,
      checkoutRequestId,
      useExternalSubmit: true,
    };
    const callbacks = {
      onGetInfoSuccess: () => {},
      onUpdateSubmitTrigger: (fn) => orderEmitter.setSubmit(fn),
      onFinalizePayment: (order) => orderEmitter.setOrder(order),
      // onErrorPayment  = SDK/integration errors (tokenization, network).
      // onChargeFailed  = backend declines (insufficient funds, fraud).
      // onFormError     = SDK-side form validation failure (empty card, CVV).
      // Without all three the place_order button can spin indefinitely
      // because no callback ever settles the orderPromise.
      onErrorPayment: (error) => orderEmitter.setError(error),
      onChargeFailed: (error) => orderEmitter.setError(error),
      onFormError: (error) => {
        orderEmitter.setError(error || new Error('Revisa los datos de tu tarjeta'));
      },
    };
    window.ConektaCheckoutComponents.Integration({ config, callbacks });
  };
  script.onerror = () => {
    onScriptError?.(new Error('Failed to load Conekta SDK'));
  };
  return script;
};
