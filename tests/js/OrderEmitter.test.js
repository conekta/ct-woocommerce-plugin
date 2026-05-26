const { OrderEmitter } = require('../../resources/js/frontend/OrderEmitter');

describe('OrderEmitter', () => {
  let emitter;
  beforeEach(() => {
    emitter = new OrderEmitter();
  });

  describe('setOrder / onOrder', () => {
    test('dispatches order to subscribed listeners', () => {
      const spy = jest.fn();
      emitter.onOrder(spy);
      emitter.setOrder({ id: 'order_abc' });
      expect(spy).toHaveBeenCalledWith({ id: 'order_abc' });
    });

    test('is one-shot — subsequent setOrder does not re-fire prior listeners', () => {
      const spy = jest.fn();
      emitter.onOrder(spy);
      emitter.setOrder({ id: 'a' });
      emitter.setOrder({ id: 'b' });
      expect(spy).toHaveBeenCalledTimes(1);
    });

    test('does NOT recurse when a listener re-subscribes synchronously', () => {
      // Regression: setOrder used to dispatch BEFORE clearing this.order, so a
      // listener that called onOrder(self) saw the pending order and re-fired,
      // blowing the stack. setOrder now clears state before dispatching.
      const spy = jest.fn();
      const self = (order) => {
        spy(order);
        emitter.onOrder(self);
      };
      emitter.onOrder(self);
      expect(() => emitter.setOrder({ id: 'x' })).not.toThrow();
      expect(spy).toHaveBeenCalledTimes(1);
    });
  });

  describe('setError / onError', () => {
    test('dispatches error to subscribed listeners', () => {
      const spy = jest.fn();
      const err = new Error('boom');
      emitter.onError(spy);
      emitter.setError(err);
      expect(spy).toHaveBeenCalledWith(err);
    });

    test('is one-shot — subsequent setError does not re-fire prior listeners', () => {
      const spy = jest.fn();
      emitter.onError(spy);
      emitter.setError(new Error('a'));
      emitter.setError(new Error('b'));
      expect(spy).toHaveBeenCalledTimes(1);
    });

    test('does NOT recurse when a listener re-subscribes synchronously', () => {
      // Regression for the infinite-recursion bug that crashed classic-checkout
      // when the SDK reported a form error and wireOrderListeners re-bound the
      // handler inside the dispatch.
      const spy = jest.fn();
      const self = (err) => {
        spy(err);
        emitter.onError(self);
      };
      emitter.onError(self);
      expect(() => emitter.setError(new Error('boom'))).not.toThrow();
      expect(spy).toHaveBeenCalledTimes(1);
    });
  });

  describe('submit / setSubmit / clearSubmit', () => {
    test('submit() invokes the registered submit fn', () => {
      const fn = jest.fn().mockReturnValue('ok');
      emitter.setSubmit(fn);
      expect(emitter.submit()).toBe('ok');
      expect(fn).toHaveBeenCalled();
    });

    test('submit() throws when no submit fn is registered', () => {
      expect(() => emitter.submit()).toThrow('Conekta submit not ready');
    });

    test('clearSubmit drops the submit fn', () => {
      emitter.setSubmit(jest.fn());
      emitter.clearSubmit();
      expect(() => emitter.submit()).toThrow();
    });

    test('submitFn survives resetStates (lifecycle is iframe-bound)', () => {
      const fn = jest.fn();
      emitter.setSubmit(fn);
      emitter.setOrder({ id: 'a' }); // resetStates() runs inside setOrder
      emitter.submit();
      expect(fn).toHaveBeenCalled();
    });

    test('setSubmit rejects non-function input', () => {
      emitter.setSubmit('not a function');
      expect(() => emitter.submit()).toThrow();
    });
  });
});
