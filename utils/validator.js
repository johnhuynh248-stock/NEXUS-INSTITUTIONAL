const config = require('../config');

class Validator {
  static validateSymbol(symbol) {
    if (!symbol || typeof symbol !== 'string') {
      return { valid: false, error: 'Symbol must be a string' };
    }
    
    const cleanSymbol = symbol.toUpperCase().trim();
    
    // Basic validation (adjust based on your needs)
    if (cleanSymbol.length > 5 || cleanSymbol.length < 1) {
      return { valid: false, error: 'Symbol length invalid' };
    }
    
    if (!/^[A-Z]+$/.test(cleanSymbol)) {
      return { valid: false, error: 'Symbol must contain only letters' };
    }
    
    return { valid: true, symbol: cleanSymbol };
  }

  static validateFlowData(flowData) {
    if (!Array.isArray(flowData)) {
      return { valid: false, error: 'Flow data must be an array' };
    }
    
    const today = new Date().toISOString().split('T')[0];
    const violations = [];
    
    flowData.forEach((flow, index) => {
      // Check for required fields
      const required = ['timestamp', 'option_type', 'strike', 'notional'];
      required.forEach(field => {
        if (!flow[field]) {
          violations.push(`Flow ${index}: Missing ${field}`);
        }
      });
      
      // Check for same-day data
      if (flow.timestamp) {
        const flowDate = new Date(flow.timestamp).toISOString().split('T')[0];
        if (flowDate !== today) {
          violations.push(`Flow ${index}: Mixed trading day detected`);
        }
      }
      
      // Check for institutional minimum
      if (flow.notional < config.rules.minNotional) {
        violations.push(`Flow ${index}: Below institutional minimum ($${flow.notional})`);
      }
    });
    
    if (violations.length > 0) {
      return { valid: false, error: `Validation errors:\n${violations.join('\n')}` };
    }
    
    return { valid: true };
  }

  static validateDTETiers(tier1, tier2) {
    const tier1DtEs = tier1.map(f => f.dte).filter(dte => dte !== undefined);
    const tier2DtEs = tier2.map(f => f.dte).filter(dte => dte !== undefined);
    
    const overlap = tier1DtEs.filter(dte => tier2DtEs.includes(dte));
    
    if (overlap.length > 0) {
      return {
        valid: false,
        error: `DTE overlap detected: ${overlap.join(', ')}`
      };
    }
    
    // Check tier ranges
    const tier1Valid = tier1DtEs.every(dte => dte >= 0 && dte <= 3);
    const tier2Valid = tier2DtEs.every(dte => dte > 3 && dte <= 14);
    
    if (!tier1Valid) {
      return { valid: false, error: 'Tier-1 contains invalid DTE values' };
    }
    
    if (!tier2Valid) {
      return { valid: false, error: 'Tier-2 contains invalid DTE values' };
    }
    
    return { valid: true };
  }

  static isMarketHours(date = new Date()) {
    const nyTime = new Date(date.toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const hours = nyTime.getHours();
    const minutes = nyTime.getMinutes();
    const currentTime = hours * 60 + minutes;
    
    const [startHour, startMinute] = config.app.sessionStart.split(':').map(Number);
    const [endHour, endMinute] = config.app.sessionEnd.split(':').map(Number);
    
    const startTime = startHour * 60 + startMinute;
    const endTime = endHour * 60 + endMinute;
    
    return currentTime >= startTime && currentTime <= endTime;
  }

  static isTradingDay(date = new Date()) {
    const day = date.getDay();
    return day >= 1 && day <= 5; // Monday to Friday
  }
}

module.exports = Validator;
