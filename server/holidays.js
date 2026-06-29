/**
 * holidays.js — NSE Trading Holiday Calendar 2025-2026
 * Source: NSE India official holiday list (updated annually)
 */

const HOLIDAYS_2025 = [
  { date: '2025-01-26', name: 'Republic Day' },
  { date: '2025-02-26', name: 'Mahashivratri' },
  { date: '2025-03-14', name: 'Holi' },
  { date: '2025-03-31', name: 'Id-Ul-Fitr (Ramzan Id)' },
  { date: '2025-04-10', name: 'Shri Ram Navami' },
  { date: '2025-04-14', name: 'Dr. Baba Saheb Ambedkar Jayanti' },
  { date: '2025-04-18', name: 'Good Friday' },
  { date: '2025-05-01', name: 'Maharashtra Day' },
  { date: '2025-08-15', name: 'Independence Day' },
  { date: '2025-08-27', name: 'Ganesh Chaturthi' },
  { date: '2025-10-02', name: 'Gandhi Jayanti' },
  { date: '2025-10-02', name: 'Dussehra' },
  { date: '2025-10-20', name: 'Diwali (Laxmi Pujan)' },
  { date: '2025-10-21', name: 'Diwali (Balipratipada)' },
  { date: '2025-11-05', name: 'Prakash Gurpurb Sri Guru Nanak Dev Ji' },
  { date: '2025-12-25', name: 'Christmas' },
];

const HOLIDAYS_2026 = [
  { date: '2026-01-26', name: 'Republic Day' },
  { date: '2026-02-18', name: 'Mahashivratri' },
  { date: '2026-03-20', name: 'Holi' },
  { date: '2026-03-20', name: 'Id-Ul-Fitr (Ramzan Id)' },
  { date: '2026-04-02', name: 'Ram Navami' },
  { date: '2026-04-03', name: 'Good Friday' },
  { date: '2026-04-14', name: 'Dr. Baba Saheb Ambedkar Jayanti' },
  { date: '2026-05-01', name: 'Maharashtra Day' },
  { date: '2026-08-15', name: 'Independence Day' },
  { date: '2026-09-16', name: 'Ganesh Chaturthi' },
  { date: '2026-10-02', name: 'Gandhi Jayanti' },
  { date: '2026-10-08', name: 'Dussehra' },
  { date: '2026-11-08', name: 'Diwali (Laxmi Pujan)' },
  { date: '2026-11-09', name: 'Diwali (Balipratipada)' },
  { date: '2026-11-24', name: 'Prakash Gurpurb Sri Guru Nanak Dev Ji' },
  { date: '2026-12-25', name: 'Christmas' },
];

const ALL_HOLIDAYS = [...HOLIDAYS_2025, ...HOLIDAYS_2026];

/**
 * Check if a given date is an NSE market holiday
 * @param {Date|string} date
 * @returns {boolean}
 */
function isMarketHoliday(date) {
  const d = date instanceof Date ? date : new Date(date);
  const dateStr = d.toISOString().split('T')[0]; // YYYY-MM-DD
  return ALL_HOLIDAYS.some(h => h.date === dateStr);
}

/**
 * Check if a given date is a valid trading day (not weekend and not holiday)
 * @param {Date|string} date
 * @returns {boolean}
 */
function isTradingDay(date) {
  const d = date instanceof Date ? date : new Date(date);
  const day = d.getDay(); // 0 = Sunday, 6 = Saturday
  if (day === 0 || day === 6) return false;
  return !isMarketHoliday(d);
}

/**
 * Get today's holiday name if it is one, else null
 * @returns {string|null}
 */
function getTodayHolidayName() {
  const today = new Date().toISOString().split('T')[0];
  const holiday = ALL_HOLIDAYS.find(h => h.date === today);
  return holiday ? holiday.name : null;
}

module.exports = { isMarketHoliday, isTradingDay, getTodayHolidayName, ALL_HOLIDAYS };
