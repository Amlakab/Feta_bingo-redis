// routes/feedback.ts
import express from 'express';
import Feedback, { IFeedback } from '../models/Feedback';
import { authenticate } from '../middleware/auth';

const router = express.Router();

// Create feedback (public)
router.post('/', async (req, res) => {
  try {
    const { phone, email, name, subject, message } = req.body;
    
    // Validate that at least one contact method is provided
    if (!phone && !email) {
      return res.status(400).json({ 
        error: 'Either phone or email is required' 
      });
    }

    const feedback = new Feedback({
      phone,
      email,
      name,
      subject,
      message
    });

    await feedback.save();
    res.status(201).json(feedback);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// Get feedback by phone or email (protected)
router.get('/search', async (req, res) => {
  try {
    const { phone, email } = req.query;
    
    if (!phone && !email) {
      return res.status(400).json({ 
        error: 'Phone or email query parameter is required' 
      });
    }

    let query: any = {};
    if (phone) query.phone = phone;
    if (email) query.email = email;

    const feedbacks = await Feedback.find(query).sort({ createdAt: -1 });
    res.json(feedbacks);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Get all feedback (admin only)
router.get('/', authenticate, async (req, res) => {
  try {
    const { subject, status } = req.query;
    let query: any = {};
    
    if (subject) query.subject = subject;
    if (status) query.status = status;

    const feedbacks = await Feedback.find(query).sort({ createdAt: -1 });
    res.json(feedbacks);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Update feedback response (admin only)
router.patch('/:id/response', authenticate, async (req, res) => {
  try {
    const { response } = req.body;
    const feedback = await Feedback.findByIdAndUpdate(
      req.params.id,
      { response, status: 'responded', respondedAt: new Date() },
      { new: true, runValidators: true }
    );

    if (!feedback) {
      return res.status(404).json({ error: 'Feedback not found' });
    }

    res.json(feedback);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// Delete feedback (admin only)
router.delete('/:id', authenticate, async (req, res) => {
  try {
    const feedback = await Feedback.findByIdAndDelete(req.params.id);
    
    if (!feedback) {
      return res.status(404).json({ error: 'Feedback not found' });
    }

    res.json({ message: 'Feedback deleted successfully' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
