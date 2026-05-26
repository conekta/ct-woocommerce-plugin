/**
 * @jest-environment jsdom
 */
const { loadConektaScript } = require('../../resources/js/frontend/loadConektaScript');

describe('loadConektaScript', () => {
  let orderEmitter;
  let integrationSpy;
  let capturedConfig;
  let capturedCallbacks;

  beforeEach(() => {
    orderEmitter = {
      setSubmit: jest.fn(),
      setOrder: jest.fn(),
      setError: jest.fn(),
    };
    capturedConfig = null;
    capturedCallbacks = null;
    integrationSpy = jest.fn(({ config, callbacks }) => {
      capturedConfig = config;
      capturedCallbacks = callbacks;
    });
    window.ConektaCheckoutComponents = { Integration: integrationSpy };
  });

  afterEach(() => {
    delete window.ConektaCheckoutComponents;
  });

  test('returns a script element pointed at the Conekta SDK', () => {
    const script = loadConektaScript('pk_test', 'cr_123', 'es', orderEmitter, jest.fn());
    expect(script.tagName).toBe('SCRIPT');
    expect(script.src).toContain('pay.conekta.com');
    expect(script.src).toContain('conekta-checkout.min.js');
    expect(script.async).toBe(true);
  });

  test('initializes Integration with the supplied config on script load', () => {
    const script = loadConektaScript('pk_test', 'cr_123', 'es', orderEmitter, jest.fn());
    script.onload();
    expect(integrationSpy).toHaveBeenCalledTimes(1);
    expect(capturedConfig).toMatchObject({
      publicKey: 'pk_test',
      checkoutRequestId: 'cr_123',
      locale: 'es',
      useExternalSubmit: true,
      targetIFrame: '#conektaITokenizerframeContainer',
    });
  });

  test('honors a custom targetIFrame selector', () => {
    const script = loadConektaScript('pk', 'cr', 'es', orderEmitter, jest.fn(), '#custom-target');
    script.onload();
    expect(capturedConfig.targetIFrame).toBe('#custom-target');
  });

  test('invokes onScriptError when the SDK global is missing at load time', () => {
    delete window.ConektaCheckoutComponents;
    const onScriptError = jest.fn();
    const script = loadConektaScript('pk', 'cr', 'es', orderEmitter, onScriptError);
    script.onload();
    expect(onScriptError).toHaveBeenCalledWith(expect.any(Error));
    expect(integrationSpy).not.toHaveBeenCalled();
  });

  test('invokes onScriptError when the <script> tag fails to load', () => {
    const onScriptError = jest.fn();
    const script = loadConektaScript('pk', 'cr', 'es', orderEmitter, onScriptError);
    script.onerror();
    expect(onScriptError).toHaveBeenCalledWith(expect.any(Error));
  });

  describe('SDK callback wiring', () => {
    beforeEach(() => {
      const script = loadConektaScript('pk', 'cr', 'es', orderEmitter, jest.fn());
      script.onload();
    });

    test('onUpdateSubmitTrigger → orderEmitter.setSubmit', () => {
      const fn = jest.fn();
      capturedCallbacks.onUpdateSubmitTrigger(fn);
      expect(orderEmitter.setSubmit).toHaveBeenCalledWith(fn);
    });

    test('onFinalizePayment → orderEmitter.setOrder', () => {
      const order = { id: 'order_x' };
      capturedCallbacks.onFinalizePayment(order);
      expect(orderEmitter.setOrder).toHaveBeenCalledWith(order);
    });

    test('onErrorPayment → orderEmitter.setError', () => {
      const err = new Error('sdk');
      capturedCallbacks.onErrorPayment(err);
      expect(orderEmitter.setError).toHaveBeenCalledWith(err);
    });

    test('onChargeFailed → orderEmitter.setError', () => {
      const err = new Error('decline');
      capturedCallbacks.onChargeFailed(err);
      expect(orderEmitter.setError).toHaveBeenCalledWith(err);
    });

    // Regression for the WC spinner that spun forever when the user clicked
    // Place Order with empty card fields — the SDK shows errors in the iframe
    // but only signals via onFormError, so without this wiring orderPromise
    // never settled.
    test('onFormError → orderEmitter.setError with the SDK payload', () => {
      const err = { message: 'card required' };
      capturedCallbacks.onFormError(err);
      expect(orderEmitter.setError).toHaveBeenCalledWith(err);
    });

    test('onFormError without payload falls back to a default Error', () => {
      capturedCallbacks.onFormError(null);
      expect(orderEmitter.setError).toHaveBeenCalledWith(expect.any(Error));
      const arg = orderEmitter.setError.mock.calls[0][0];
      expect(arg.message).toMatch(/tarjeta/i);
    });
  });
});
