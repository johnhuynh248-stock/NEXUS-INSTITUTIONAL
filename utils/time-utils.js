const moment = require('moment-timezone');

class TimeUtils {
  constructor(timezone = 'America/New_York') {
    this.timezone = timezone;
  }

  getMarketDate() {
    const now = moment().tz(this.timezone);
    const hour = now.hour();
    
    // If before market open, use previous day
    if (hour < 9 || (hour === 9 && now.minute() < 30)) {
      return now.subtract(1, 'day').format('YYYY-MM-DD');
    }
    
    return now.format('YYYY-MM-DD');
  }

  getSessionDuration(startTime = '09:30') {
    const now = moment().tz(this.timezone);
    const [startHour, startMinute] = startTime.split(':').map(Number);
    const sessionStart = moment().tz(this.timezone).set({ hour: startHour, minute: startMinute, second: 0 });
    
    if (now.isBefore(sessionStart)) {
      return '0.0';
    }
    
    return now.diff(sessionStart, 'hours', true).toFixed(1);
  }

  isMarketOpen() {
    const now = moment().tz(this.timezone);
    const hour = now.hour();
    const minute = now.minute();
    
    // Market hours: 9:30 AM - 4:00 PM ET
    if (hour < 9 || hour > 16) return false;
    if (hour === 9 && minute < 30) return false;
    if (hour === 16 && minute > 0) return false;
    
    return true;
  }

  getMarketCloseTime() {
    const today = moment().tz(this.timezone).format('YYYY-MM-DD');
    return moment.tz(`${today} 16:00`, this.timezone);
  }

  getTimeToClose() {
    if (!this.isMarketOpen()) return '0h 0m';
    
    const closeTime = this.getMarketCloseTime();
    const now = moment().tz(this.timezone);
    const duration = moment.duration(closeTime.diff(now));
    
    const hours = Math.floor(duration.asHours());
    const minutes = duration.minutes();
    
    return `${hours}h ${minutes}m`;
  }

  formatTimeRange(startHour, endHour) {
    const start = moment().tz(this.timezone).set({ hour: startHour, minute: 0, second: 0 });
    const end = moment().tz(this.timezone).set({ hour: endHour, minute: 0, second: 0 });
    
    return `${start.format('HH:mm')} - ${end.format('HH:mm')}`;
  }

  getCurrentET() {
    return moment().tz(this.timezone).format('HH:mm');
  }

  // For caching - determine if data is stale
  isDataStale(timestamp, maxAgeMinutes = 5) {
    const dataTime = moment(timestamp);
    const now = moment();
    return now.diff(dataTime, 'minutes') > maxAgeMinutes;
  }
}

module.exports = TimeUtils;
