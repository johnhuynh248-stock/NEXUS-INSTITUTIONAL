const moment = require('moment-timezone');

class Formatter {
  static formatCurrency(amount, decimals = 2) {
    if (amount === 0) return '$0';
    if (Math.abs(amount) >= 1000000000) {
      return `$${(amount / 1000000000).toFixed(decimals)}B`;
    } else if (Math.abs(amount) >= 1000000) {
      return `$${(amount / 1000000).toFixed(decimals)}M`;
    } else if (Math.abs(amount) >= 1000) {
      return `$${(amount / 1000).toFixed(decimals)}K`;
    }
    return `$${amount.toFixed(decimals)}`;
  }

  static formatPercentage(value, decimals = 1) {
    return `${value.toFixed(decimals)}%`;
  }

  static formatTime(date, includeSeconds = false) {
    return moment(date).tz('America/New_York').format(
      includeSeconds ? 'HH:mm:ss' : 'HH:mm'
    );
  }

  static formatDate(date) {
    return moment(date).tz('America/New_York').format('YYYY-MM-DD');
  }

  static formatDateTime(date) {
    return moment(date).tz('America/New_York').format('YYYY-MM-DD HH:mm:ss');
  }

  static formatDTE(dte) {
    if (dte === 0) return '0DTE';
    if (dte === 1) return '1DTE';
    return `${dte}DTE`;
  }

  static formatStrike(strike) {
    return `$${strike.toFixed(2)}`;
  }

  static getSentiment(netFlow, totalFlow) {
    const ratio = Math.abs(netFlow) / totalFlow;
    if (ratio < 0.1) return 'NEUTRAL';
    if (netFlow > 0) return 'BULLISH';
    return 'BEARISH';
  }

  static getEmoji(sentiment) {
    switch(sentiment) {
      case 'BULLISH': return '🐂';
      case 'BEARISH': return '🐻';
      default: return '⚪';
    }
  }
}

module.exports = Formatter;
