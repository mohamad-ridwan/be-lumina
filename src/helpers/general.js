const dayjs = require('dayjs');
require('dayjs/locale/id');
const isToday = require('dayjs/plugin/isToday');
const isYesterday = require('dayjs/plugin/isYesterday');
const weekOfYear = require('dayjs/plugin/weekOfYear');
const weekday = require('dayjs/plugin/weekday');

dayjs.extend(isToday);
dayjs.extend(isYesterday);
dayjs.extend(weekOfYear);
dayjs.extend(weekday);

const formatDate = (date) => {
    const today = dayjs().startOf('day')
    const yesterday = dayjs().subtract(1, 'day').startOf('day')
    // const now = dayjs();
    const dateToCheck = dayjs(date)
    const oneWeekAgo = today.subtract(7, 'day')
  
    if (dateToCheck.isSame(today, 'day')) {
      return 'Today'
    } else if (dateToCheck.isSame(yesterday, 'day')) {
      return 'Yesterday'
    } else if (dateToCheck.isAfter(oneWeekAgo)) {
      return dateToCheck.format('dddd')
    } else {
      return dateToCheck.format('DD MMMM YYYY')
    }
  }

  module.exports = { formatDate }