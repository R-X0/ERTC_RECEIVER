// db-connection.js
require('dotenv').config();
const mongoose = require('mongoose');

// MongoDB connection string from .env file
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/ertc-submissions';

// Connect to MongoDB
const connectToDatabase = async () => {
  try {
    await mongoose.connect(MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true
    });
    console.log('Connected to MongoDB successfully');
    return true;
  } catch (error) {
    console.error('Error connecting to MongoDB:', error.message);
    return false;
  }
};

// Define schemas

// Submission schema
const submissionSchema = new mongoose.Schema({
  submissionId: {
    type: String,
    required: true,
    unique: true
  },
  userId: {
    type: String,
    index: true
  },
  userEmail: {
    type: String,
    sparse: true, // Sparse index for potentially missing emails
    index: true
  },
  receivedAt: {
    type: Date,
    default: Date.now
  },
  originalData: {
    type: mongoose.Schema.Types.Mixed,
    required: true
  },
  // Store metadata about files
  receivedFiles: [{
    originalName: String,
    savedPath: String,
    size: Number,
    mimetype: String
  }],
  // Store report information
  report: {
    generated: Boolean,
    path: String
  }
});

// Create models
const Submission = mongoose.model('Submission', submissionSchema);

// Export models and connection function
module.exports = {
  connectToDatabase,
  Submission
};