export class OrderEmitter {
  constructor() {
      this.listeners = [];
      this.errorListeners = [];
      this.order = null;
      this.error = null;
      this.submitFn = null;
  }

  setOrder(newOrder) {
      this.order = newOrder;
      this.listeners.forEach((callback) => callback(newOrder));
      this.resetStates();
  }

  onOrder(callback) {
      this.listeners.push(callback);
      if (this.order) {
        callback(this.order);
        this.resetStates();
      }
  }

  setError(newError) {
      this.error = newError;
      this.errorListeners.forEach((callback) => callback(newError));
      this.resetStates();
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
