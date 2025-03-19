export class TokenEmitter {
  constructor() {
      this.listeners = [];
      this.errorListeners = [];
      this.token = null;
  }

  setToken(newToken) {
      this.token = newToken;
      this.listeners.forEach((callback) => callback(newToken));
      this.resetStates();
  }

  onToken(callback) {
      this.listeners.push(callback);
      if (this.token) {
        callback(this.token);
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

  resetStates() {
      this.listeners = [];
      this.errorListeners = [];
      this.error = null;
      this.token = null;
  }
}