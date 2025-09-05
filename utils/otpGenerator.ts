// In-memory store for OTPs (use Redis in production)
const otpStore = new Map<string, { otp: string; expires: number }>();

export const generateOTP = (length: number = 6): string => {
  const digits = '0123456789';
  let OTP = '';
  
  for (let i = 0; i < length; i++) {
    OTP += digits[Math.floor(Math.random() * 10)];
  }
  
  return OTP;
};

export const storeOTP = (phone: string, otp: string, expiresInMinutes: number = 5): void => {
  const expires = Date.now() + expiresInMinutes * 60 * 1000;
  otpStore.set(phone, { otp, expires });
};

export const verifyOTP = (phone: string, otp: string): boolean => {
  const storedOtp = otpStore.get(phone);
  
  if (!storedOtp || storedOtp.otp !== otp || Date.now() > storedOtp.expires) {
    return false;
  }
  
  // Remove OTP after verification
  otpStore.delete(phone);
  return true;
};

export const cleanupExpiredOTPs = (): void => {
  const now = Date.now();
  for (const [phone, { expires }] of otpStore.entries()) {
    if (now > expires) {
      otpStore.delete(phone);
    }
  }
};

// Clean up expired OTPs every hour
setInterval(cleanupExpiredOTPs, 60 * 60 * 1000);