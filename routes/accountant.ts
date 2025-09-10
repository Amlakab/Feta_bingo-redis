import express from 'express'; 
import Accountant from '../models/Accountant';
import { authenticate } from '../middleware/auth';

const router = express.Router();

// CREATE - Create a new accountant
router.post('/', authenticate, async (req, res) => {
  try {
    const { fullName, phoneNumber, accountNumber, bankName } = req.body;

    // Validate required fields
    if (!fullName || !phoneNumber || !accountNumber || !bankName) {
      return res.status(400).json({
        success: false,
        message: 'All fields (fullName, phoneNumber, accountNumber, bankName) are required'
      });
    }

    // Check if accountant with same account number already exists
    const existingAccountant = await Accountant.findOne({ accountNumber });
    if (existingAccountant) {
      return res.status(400).json({
        success: false,
        message: 'Accountant with this account number already exists'
      });
    }

    const accountant = new Accountant({
      fullName,
      phoneNumber,
      accountNumber,
      bankName
    });

    await accountant.save();

    res.status(201).json({
      success: true,
      message: 'Accountant created successfully',
      data: accountant
    });
  } catch (error: any) {
    console.error('Error creating accountant:', error);
    res.status(500).json({
      success: false,
      message: 'Error creating accountant',
      error: error.message
    });
  }
});

// READ - Get all accountants
router.get('/', authenticate, async (req, res) => {
  try {
    const { blocked } = req.query;
    let filter = {};
    
    if (blocked !== undefined) {
      filter = { isBlocked: blocked === 'true' };
    }

    const accountants = await Accountant.find(filter)
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      message: 'Accountants retrieved successfully',
      data: accountants
    });
  } catch (error: any) {
    console.error('Error fetching accountants:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching accountants',
      error: error.message
    });
  }
});

// READ - Get accountant by ID
router.get('/:id', authenticate, async (req, res) => {
  try {
    const accountant = await Accountant.findById(req.params.id);

    if (!accountant) {
      return res.status(404).json({
        success: false,
        message: 'Accountant not found'
      });
    }

    res.json({
      success: true,
      message: 'Accountant retrieved successfully',
      data: accountant
    });
  } catch (error: any) {
    console.error('Error fetching accountant:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching accountant',
      error: error.message
    });
  }
});

// READ - Get accountants by bank name
router.get('/bank/:bankName', authenticate, async (req, res) => {
  try {
    const { bankName } = req.params;

    const accountants = await Accountant.find({ 
      bankName: new RegExp(bankName, 'i') 
    }).sort({ createdAt: -1 });

    res.json({
      success: true,
      message: 'Accountants retrieved successfully',
      data: accountants
    });
  } catch (error: any) {
    console.error('Error fetching accountants by bank name:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching accountants',
      error: error.message
    });
  }
});

// UPDATE - Update accountant by ID
router.put('/:id', authenticate, async (req, res) => {
  try {
    const { fullName, phoneNumber, accountNumber, bankName, isBlocked } = req.body;

    // Check if account number is being changed to one that already exists
    if (accountNumber) {
      const existingAccountant = await Accountant.findOne({ 
        accountNumber, 
        _id: { $ne: req.params.id } 
      });
      
      if (existingAccountant) {
        return res.status(400).json({
          success: false,
          message: 'Another accountant with this account number already exists'
        });
      }
    }

    const updateData: any = {};
    if (fullName !== undefined) updateData.fullName = fullName;
    if (phoneNumber !== undefined) updateData.phoneNumber = phoneNumber;
    if (accountNumber !== undefined) updateData.accountNumber = accountNumber;
    if (bankName !== undefined) updateData.bankName = bankName;
    if (isBlocked !== undefined) updateData.isBlocked = isBlocked;

    const accountant = await Accountant.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true, runValidators: true }
    );

    if (!accountant) {
      return res.status(404).json({
        success: false,
        message: 'Accountant not found'
      });
    }

    res.json({
      success: true,
      message: 'Accountant updated successfully',
      data: accountant
    });
  } catch (error: any) {
    console.error('Error updating accountant:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating accountant',
      error: error.message
    });
  }
});

// UPDATE - Block/Unblock accountant by ID
router.patch('/:id/block', authenticate, async (req, res) => {
  try {
    const { isBlocked } = req.body;

    if (typeof isBlocked !== 'boolean') {
      return res.status(400).json({
        success: false,
        message: 'isBlocked field is required and must be a boolean'
      });
    }

    const accountant = await Accountant.findByIdAndUpdate(
      req.params.id,
      { isBlocked },
      { new: true, runValidators: true }
    );

    if (!accountant) {
      return res.status(404).json({
        success: false,
        message: 'Accountant not found'
      });
    }

    res.json({
      success: true,
      message: `Accountant ${isBlocked ? 'blocked' : 'unblocked'} successfully`,
      data: accountant
    });
  } catch (error: any) {
    console.error('Error blocking accountant:', error);
    res.status(500).json({
      success: false,
      message: 'Error blocking accountant',
      error: error.message
    });
  }
});

// DELETE - Delete accountant by ID
router.delete('/:id', authenticate, async (req, res) => {
  try {
    const accountant = await Accountant.findByIdAndDelete(req.params.id);

    if (!accountant) {
      return res.status(404).json({
        success: false,
        message: 'Accountant not found'
      });
    }

    res.json({
      success: true,
      message: 'Accountant deleted successfully',
      data: accountant
    });
  } catch (error: any) {
    console.error('Error deleting accountant:', error);
    res.status(500).json({
      success: false,
      message: 'Error deleting accountant',
      error: error.message
    });
  }
});

// DELETE - Delete all accountants
router.delete('/', authenticate, async (req, res) => {
  try {
    const result = await Accountant.deleteMany({});

    res.json({
      success: true,
      message: 'All accountants deleted successfully',
      data: {
        deletedCount: result.deletedCount
      }
    });
  } catch (error: any) {
    console.error('Error deleting all accountants:', error);
    res.status(500).json({
      success: false,
      message: 'Error deleting accountants',
      error: error.message
    });
  }
});

export default router;