// ✅ SECURITY UTILITIES FOR FRONTEND

// Input validation functions
export const validators = {
  // Email validation
  isValidEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email) && email.length <= 100;
  },
  
  // Password validation (strong)
  isValidPassword(password) {
    const minLength = parseInt(import.meta.env.VITE_PASSWORD_MIN_LENGTH) || 8;
    const hasUpperCase = /[A-Z]/.test(password);
    const hasLowerCase = /[a-z]/.test(password);
    const hasNumbers = /\d/.test(password);
    
    return password.length >= minLength && 
           hasUpperCase && 
           hasLowerCase && 
           hasNumbers;
  },
  
  // UPI validation
  isValidUPI(upi) {
    const upiRegex = /^[a-zA-Z0-9.\-_]{3,}@[a-zA-Z]{3,}$/;
    return upiRegex.test(upi) && upi.length <= 100;
  },
  
  // Sanitize input to prevent XSS
  sanitize(input) {
    if (typeof input !== 'string') return '';
    return input
      .trim()
      .substring(0, 500)
      .replace(/[<>"']/g, '')
      .replace(/javascript:/gi, '')
      .replace(/on\w+=/gi, '');
  }
};

// ✅ RATE LIMITING
export class RateLimiter {
  constructor() {
    this.attempts = {};
  }
  
  isAllowed(key) {
    const now = Date.now();
    const windowSize = parseInt(import.meta.env.VITE_RATE_LIMIT_WINDOW) || 3600000;
    const maxAttempts = parseInt(import.meta.env.VITE_RATE_LIMIT_ATTEMPTS) || 5;
    
    if (!this.attempts[key]) {
      this.attempts[key] = [];
    }
    
    // Remove old attempts outside the window
    this.attempts[key] = this.attempts[key].filter(time => now - time < windowSize);
    
    if (this.attempts[key].length >= maxAttempts) {
      return false;
    }
    
    this.attempts[key].push(now);
    return true;
  }
  
  getRemainingTime(key) {
    const now = Date.now();
    const windowSize = parseInt(import.meta.env.VITE_RATE_LIMIT_WINDOW) || 3600000;
    
    if (!this.attempts[key] || this.attempts[key].length === 0) {
      return 0;
    }
    
    const oldestAttempt = Math.min(...this.attempts[key]);
    return Math.ceil((windowSize - (now - oldestAttempt)) / 1000);
  }
}

// ✅ CSRF PROTECTION (Token generation)
export function generateCSRFToken() {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
}

// Store CSRF token
export function storeCSRFToken(token) {
  sessionStorage.setItem('csrf_token', token);
}

// Verify CSRF token
export function verifyCSRFToken(token) {
  return sessionStorage.getItem('csrf_token') === token;
}

// ✅ SECURE STORAGE (encrypted localStorage)
export class SecureStorage {
  static set(key, value) {
    try {
      // Simple obfuscation (not true encryption, but better than plaintext)
      const encoded = btoa(JSON.stringify(value));
      localStorage.setItem(`secure_${key}`, encoded);
    } catch (e) {
      console.error('Storage error:', e);
    }
  }
  
  static get(key) {
    try {
      const encoded = localStorage.getItem(`secure_${key}`);
      return encoded ? JSON.parse(atob(encoded)) : null;
    } catch (e) {
      console.error('Retrieval error:', e);
      return null;
    }
  }
  
  static remove(key) {
    localStorage.removeItem(`secure_${key}`);
  }
  
  static clear() {
    Object.keys(localStorage)
      .filter(key => key.startsWith('secure_'))
      .forEach(key => localStorage.removeItem(key));
  }
}

// ✅ ERROR HANDLING
export const errorHandler = {
  getUserMessage(error) {
    const errorMessages = {
      'auth/email-already-in-use': 'यह ईमेल पहले से रजिस्टर्ड है',
      'auth/weak-password': 'पासवर्ड बहुत कमजोर है। कम से कम 8 अक्षर, 1 बड़ा अक्षर, 1 छोटा अक्षर, 1 नंबर',
      'auth/user-not-found': 'यूजर खाता नहीं मिला',
      'auth/wrong-password': 'गलत पासवर्ड',
      'auth/invalid-email': 'ईमेल की जानकारी गलत है',
      'permission-denied': 'आपको इस ऑपरेशन की अनुमति नहीं है',
      'not-found': 'डेटा नहीं मिला',
      'failed-precondition': 'ऑपरेशन के लिए शर्तें पूरी नहीं हुईं',
      'already-exists': 'यह आइटम पहले से मौजूद है',
      'unauthenticated': 'कृपया पहले लॉगिन करें'
    };
    
    return errorMessages[error.code] || error.message || 'कोई त्रुटि हुई';
  }
};

// ✅ LOGGING (client-side tracking)
export class Logger {
  static log(action, details) {
    const timestamp = new Date().toISOString();
    const entry = {
      timestamp,
      action,
      details,
      userAgent: navigator.userAgent.substring(0, 200)
    };
    
    console.log(`[${timestamp}] ${action}:`, details);
    
    // Store in sessionStorage (cleared on logout)
    const logs = JSON.parse(sessionStorage.getItem('app_logs') || '[]');
    logs.push(entry);
    if (logs.length > 100) logs.shift(); // Keep only last 100 logs
    sessionStorage.setItem('app_logs', JSON.stringify(logs));
  }
  
  static error(action, error) {
    const timestamp = new Date().toISOString();
    console.error(`[${timestamp}] ERROR - ${action}:`, error);
    
    const logs = JSON.parse(sessionStorage.getItem('app_errors') || '[]');
    logs.push({
      timestamp,
      action,
      error: error.message,
      code: error.code
    });
    if (logs.length > 50) logs.shift();
    sessionStorage.setItem('app_errors', JSON.stringify(logs));
  }
}

// ✅ API CALL WRAPPER (with error handling)
export async function callCloudFunction(functionName, data) {
  try {
    const response = await fetch(
      `https://${import.meta.env.VITE_FIREBASE_PROJECT_ID}.cloudfunctions.net/${functionName}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      }
    );
    
    const result = await response.json();
    
    if (!response.ok) {
      throw new Error(result.error?.message || 'Function call failed');
    }
    
    return result.result;
  } catch (error) {
    Logger.error(functionName, error);
    throw error;
  }
}

// ✅ DUPLICATE REQUEST PREVENTION
export class DuplicateRequestPreventer {
  constructor() {
    this.pendingRequests = new Map();
  }
  
  async executeOnce(key, fn) {
    if (this.pendingRequests.has(key)) {
      return this.pendingRequests.get(key);
    }
    
    const promise = Promise.resolve(fn()).finally(() => {
      this.pendingRequests.delete(key);
    });
    
    this.pendingRequests.set(key, promise);
    return promise;
  }
}
