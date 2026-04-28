export const useComponentScript = () => {
  /**
   * Mounts the Conekta Integration component into #conektaITokenizerframeContainer.
   * Returns the <script> element so the caller can append it to the DOM and remove it on cleanup.
   */
  const loadScript = (publicKey, checkoutRequestId, locale, orderEmitter, onScriptError) => {
    const script = document.createElement('script');
    script.src = "https://pay.conekta.com/v1.0/js/conekta-checkout.min.js";
    script.async = true;
    script.onload = () => {
      if (!window.ConektaCheckoutComponents) {
        onScriptError?.(new Error('Conekta SDK not available'));
        return;
      }
      const config = {
        targetIFrame: '#conektaITokenizerframeContainer',
        publicKey,
        locale,
        checkoutRequestId,
        useExternalSubmit: true,
      };
      const callbacks = {
        onGetInfoSuccess: () => {},
        onUpdateSubmitTrigger: (fn) => orderEmitter.setSubmit(fn),
        onFinalizePayment: (order) => orderEmitter.setOrder(order),
        onErrorPayment: (error) => orderEmitter.setError(error),
      };
      window.ConektaCheckoutComponents.Integration({
        config,
        callbacks,
      });
    };
    return script;
  };
  return { loadScript };
};
