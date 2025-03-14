export class TokenEmitter {
    constructor() {
      this.listeners = [];
      this.token = null;
    }
  
    setToken(newToken) {
      this.token = newToken;
      this.listeners.forEach((callback) => callback(newToken));
    }
  
    onToken(callback) {
      this.listeners.push(callback);
      if (this.token) callback(this.token);
    }
  }  