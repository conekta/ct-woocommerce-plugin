export class OrderEmitter {
  constructor() {
      this.listeners = [];
      this.errorListeners = [];
      this.order = null;
      this.error = null;
      this.submitFn = null;
  }

  // Reset state BEFORE dispatching so listeners that re-subscribe
  // synchronously (e.g. classic-checkout's wireOrderListeners) don't
  // re-trigger via the `if (this.order)` / `if (this.error)` branch
  // in onOrder/onError — that path used to recurse infinitely and blew
  // the stack on SDK error.
  setOrder(newOrder) {
      const listeners = this.listeners;
      this.resetStates();
      listeners.forEach((callback) => callback(newOrder));
  }

  onOrder(callback) {
      this.listeners.push(callback);
      if (this.order) {
        callback(this.order);
        this.resetStates();
      }
  }

  setError(newError) {
      const listeners = this.errorListeners;
      this.resetStates();
      listeners.forEach((callback) => callback(newError));
  }

  onError(callback) {
      this.errorListeners.push(callback);
      if (this.error) {
        callback(this.error);
        this.resetStates();
      }
  }

  // Captured from the SDK's onUpdateSubmitTrigger callback. Survives
  // resetStates() because it's bound to the iframe's lifetime, not to
  // the request/response cycle of a single payment attempt.
  setSubmit(fn) {
      this.submitFn = typeof fn === 'function' ? fn : null;
  }

  submit() {
      if (typeof this.submitFn !== 'function') {
          throw new Error('Conekta submit not ready');
      }
      return this.submitFn();
  }

  clearSubmit() {
      this.submitFn = null;
  }

  resetStates() {
      this.listeners = [];
      this.errorListeners = [];
      this.error = null;
      this.order = null;
  }
}
