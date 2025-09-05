import cron from 'node-cron';
import User from '../models/User';

// Reset daily earnings at midnight
cron.schedule('0 0 * * *', async () => {
  try {
    await User.updateMany({}, { $set: { dailyEarnings: 0 } });
    console.log('Daily earnings reset successfully');
  } catch (error) {
    console.error('Error resetting daily earnings:', error);
  }
});

// Reset weekly earnings at midnight on Monday
cron.schedule('0 0 * * 1', async () => {
  try {
    await User.updateMany({}, { $set: { weeklyEarnings: 0 } });
    console.log('Weekly earnings reset successfully');
  } catch (error) {
    console.error('Error resetting weekly earnings:', error);
  }
});