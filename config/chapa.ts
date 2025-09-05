const Chapa = require('chapa');

export const chapa = new Chapa(process.env.CHAPA_SECRET_KEY || '');

export const verifyWebhookSignature = (req: any): boolean => {
  const signature = req.headers['x-chapa-signature'];
  if (!signature) return false;
  
  // In a real implementation, you would verify the webhook signature
  // For now, we'll return true for development
  return true;
};

export const generateTxRef = (userId: string, type: string): string => {
  return `${type}-${userId}-${Date.now()}`;
};