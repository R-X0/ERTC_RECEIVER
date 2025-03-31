require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const { generateExcelReport } = require('./excel-generator');
const { connectToDatabase, Submission } = require('./db-connection');
const mongoose = require('mongoose');
const { GridFSBucket } = require('mongodb');
const stream = require('stream');
const app = express();
const PORT = process.env.PORT || 8000;

// Create directories for storing files and reports (temporary storage)
const submissionsDir = path.join(__dirname, 'submissions');
const uploadsDir = path.join(__dirname, 'uploads');

// Ensure directories exist
[submissionsDir, uploadsDir].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

// Configure multer for temporary file storage before moving to GridFS
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    // Create a directory for this submission
    const submissionId = Date.now().toString();
    const submissionDir = path.join(uploadsDir, submissionId);
    
    if (!fs.existsSync(submissionDir)) {
      fs.mkdirSync(submissionDir, { recursive: true });
    }
    
    cb(null, submissionDir);
  },
  filename: function (req, file, cb) {
    // Use original filename
    cb(null, file.originalname);
  }
});

const upload = multer({ storage: storage });

// Configure express middleware
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '50mb' }));

// Connect to MongoDB when the server starts
connectToDatabase().then(connected => {
  if (!connected) {
    console.error('Failed to connect to MongoDB. The server will continue, but data won\'t be stored in MongoDB.');
  }
});

// Function to store a file in GridFS
async function storeFileInGridFS(filePath, fileName, mimeType, metadata) {
  return new Promise((resolve, reject) => {
    const bucket = new GridFSBucket(mongoose.connection.db, {
      bucketName: 'clientFiles'
    });

    const fileStream = fs.createReadStream(filePath);
    const uploadStream = bucket.openUploadStream(fileName, {
      metadata: {
        ...metadata,
        contentType: mimeType,
        uploadedAt: new Date()
      }
    });

    const fileId = uploadStream.id;

    fileStream.pipe(uploadStream);

    uploadStream.on('error', (error) => {
      console.error('Error uploading file to GridFS:', error);
      reject(error);
    });

    uploadStream.on('finish', () => {
      console.log(`File ${fileName} saved to GridFS with ID: ${fileId}`);
      resolve(fileId);
    });
  });
}

// Webhook endpoint
app.post('/webhook', upload.any(), async (req, res) => {
  try {
    console.log('Received webhook notification');
    
    const submissionId = Date.now().toString();
    let parsedData = {};
    
    // Parse the stringified JSON in submissionData if it exists
    if (req.body.submissionData) {
      try {
        console.log('Found submissionData field, attempting to parse');
        parsedData = JSON.parse(req.body.submissionData);
        console.log('Successfully parsed submissionData JSON');
      } catch (parseError) {
        console.error('Error parsing submissionData:', parseError.message);
        console.error('Raw submissionData:', req.body.submissionData.substring(0, 200) + '...');
        // Fall back to using the raw body
        parsedData = req.body;
      }
    } else {
      console.log('No submissionData field found, using raw body');
      parsedData = req.body;
    }
    
    // Handle received files and store them in GridFS
    const receivedFiles = [];
    const gridFSFiles = [];
    
    if (req.files && req.files.length > 0) {
      console.log(`Received ${req.files.length} files - storing in GridFS:`);
      
      for (const file of req.files) {
        try {
          // Determine file category from the request
          let fileCategory = 'unknown';
          if (parsedData.formData && parsedData.formData.uploadedFiles) {
            // Try to find the category based on file name
            Object.entries(parsedData.formData.uploadedFiles).forEach(([category, files]) => {
              if (files && files.some(f => f.name === file.originalname)) {
                fileCategory = category;
              }
            });
          }
          
          // Store file in GridFS
          const fileId = await storeFileInGridFS(
            file.path, 
            file.originalname, 
            file.mimetype, 
            {
              submissionId,
              fileCategory,
              originalSize: file.size
            }
          );
          
          // Store both local path (temporary) and GridFS info
          receivedFiles.push({
            originalName: file.originalname,
            savedPath: file.path,
            size: file.size,
            mimetype: file.mimetype
          });
          
          gridFSFiles.push({
            originalName: file.originalname,
            fileId: fileId,
            size: file.size,
            mimetype: file.mimetype,
            category: fileCategory
          });
          
          console.log(`- ${file.originalname} (${file.size} bytes) stored in GridFS with ID: ${fileId}`);
        } catch (fileError) {
          console.error(`Error storing file ${file.originalname} in GridFS:`, fileError);
        }
      }
    } else {
      console.log('No files received with this submission');
    }
    
    // Create a clean structure for our submission data
    const finalSubmissionData = {
      id: submissionId,
      receivedAt: new Date().toISOString(),
      originalData: parsedData,
      receivedFiles: receivedFiles
    };
    
    // Save submission data to a JSON file (keeping this for backward compatibility)
    const submissionFile = path.join(submissionsDir, `submission_${submissionId}.json`);
    fs.writeFileSync(submissionFile, JSON.stringify(finalSubmissionData, null, 2));
    console.log(`Submission data saved to ${submissionFile}`);
    
    // Generate Excel report and store in MongoDB GridFS
    let fileId = null;
    let filename = null;
    let qualificationData = null;
    try {
      // Now the function saves to GridFS instead of filesystem
      const reportResult = await generateExcelReport(finalSubmissionData, submissionId);
      fileId = reportResult.fileId;
      filename = reportResult.filename;
      qualificationData = reportResult.qualificationData;
      console.log(`Excel report stored in GridFS with ID: ${fileId}`);
      if (qualificationData && qualificationData.qualifyingQuarters) {
        console.log(`Qualifying quarters: ${qualificationData.qualifyingQuarters.join(', ') || 'None'}`);
      }
    } catch (reportError) {
      console.error('Error generating Excel report:', reportError);
    }
    
    // Store in MongoDB
    let mongoResult = { success: false, message: 'MongoDB storage not attempted' };
    try {
      // Extract user information for better organization
      let userEmail = null;
      let userId = null;
      
      // Try to get the user email from the submission data
      if (parsedData.formData && parsedData.formData.userEmail) {
        userEmail = parsedData.formData.userEmail;
      } else if (parsedData.originalData && parsedData.originalData.formData && parsedData.originalData.formData.userEmail) {
        userEmail = parsedData.originalData.formData.userEmail;
      }
      
      // Use a unique ID from the data if available, or generate one
      if (parsedData.id) {
        userId = parsedData.id;
      } else if (parsedData.originalData && parsedData.originalData.id) {
        userId = parsedData.originalData.id;
      } else {
        // If no user ID is available, use the submission ID
        userId = submissionId;
      }
      
      // Create a new submission document with GridFS references for all files
      const submission = new Submission({
        submissionId: submissionId,
        userId: userId,
        userEmail: userEmail,
        receivedAt: new Date(),
        originalData: parsedData,
        receivedFiles: receivedFiles,
        // Add GridFS file references
        gridFSFiles: gridFSFiles,
        report: {
          generated: !!fileId,
          fileId: fileId,
          filename: filename,
          qualificationData: qualificationData
        }
      });
      
      // Save to MongoDB
      await submission.save();
      console.log(`Submission data saved to MongoDB with ID: ${submissionId}`);
      mongoResult = {
        success: true,
        message: 'Data saved to MongoDB successfully',
        submissionId: submissionId
      };
    } catch (mongoError) {
      console.error('Error saving to MongoDB:', mongoError);
      mongoResult = {
        success: false,
        error: mongoError.message,
        message: 'Error saving data to MongoDB'
      };
    }
    
    // Send confirmation response with qualification data
    res.status(200).json({
      success: true,
      message: 'Webhook notification received and processed successfully',
      submissionId: submissionId,
      reportGenerated: !!fileId,
      filesStoredInGridFS: gridFSFiles.length,
      mongoDbStorage: mongoResult.success,
      mongoDetails: mongoResult,
      // Include qualifying quarters information if available
      qualifyingQuarters: qualificationData?.qualifyingQuarters || []
    });
  } catch (error) {
    console.error('Error processing webhook:', error);
    res.status(500).json({
      success: false,
      message: 'Error processing webhook notification',
      error: error.message
    });
  }
});

// Add a route to get submissions for a specific user
app.get('/submissions/:userEmail', async (req, res) => {
  try {
    const userEmail = req.params.userEmail;
    
    if (!userEmail) {
      return res.status(400).json({
        success: false,
        message: 'User email is required'
      });
    }
    
    // Find all submissions for this user, now including qualification data
    const submissions = await Submission.find({ userEmail: userEmail })
      .select('submissionId receivedAt originalData.formData.qualifyingQuestions report.generated report.qualificationData gridFSFiles')
      .sort({ receivedAt: -1 });
    
    res.status(200).json({
      success: true,
      count: submissions.length,
      submissions: submissions
    });
  } catch (error) {
    console.error('Error retrieving submissions:', error);
    res.status(500).json({
      success: false,
      message: 'Error retrieving submissions',
      error: error.message
    });
  }
});

// Add a route to get a specific submission
app.get('/submission/:submissionId', async (req, res) => {
  try {
    const submissionId = req.params.submissionId;
    
    if (!submissionId) {
      return res.status(400).json({
        success: false,
        message: 'Submission ID is required'
      });
    }
    
    // Find the submission
    const submission = await Submission.findOne({ submissionId: submissionId });
    
    if (!submission) {
      return res.status(404).json({
        success: false,
        message: 'Submission not found'
      });
    }
    
    res.status(200).json({
      success: true,
      submission: submission
    });
  } catch (error) {
    console.error('Error retrieving submission:', error);
    res.status(500).json({
      success: false,
      message: 'Error retrieving submission',
      error: error.message
    });
  }
});

// Add an endpoint to download a file from GridFS
app.get('/download/file/:fileId', async (req, res) => {
  try {
    const fileId = new mongoose.Types.ObjectId(req.params.fileId);
    const bucket = new GridFSBucket(mongoose.connection.db, {
      bucketName: 'clientFiles'
    });
    
    // First, get the file info to set the correct headers
    const files = await bucket.find({ _id: fileId }).toArray();
    
    if (!files || files.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'File not found'
      });
    }
    
    const file = files[0];
    
    // Set appropriate headers
    res.set('Content-Type', file.metadata?.contentType || 'application/octet-stream');
    res.set('Content-Disposition', `attachment; filename="${file.filename}"`);
    
    // Stream the file from GridFS to the response
    const downloadStream = bucket.openDownloadStream(fileId);
    downloadStream.pipe(res);
    
    downloadStream.on('error', (error) => {
      console.error('Error streaming file from GridFS:', error);
      if (!res.headersSent) {
        res.status(500).json({
          success: false,
          message: 'Error downloading file',
          error: error.message
        });
      }
    });
  } catch (error) {
    console.error('Error downloading file:', error);
    res.status(500).json({
      success: false,
      message: 'Error downloading file',
      error: error.message
    });
  }
});

// Add an endpoint to download Excel report from GridFS
app.get('/download/report/:fileId', async (req, res) => {
  try {
    const fileId = new mongoose.Types.ObjectId(req.params.fileId);
    const bucket = new GridFSBucket(mongoose.connection.db, {
      bucketName: 'excelReports'
    });
    
    // First, get the file info to set the correct headers
    const files = await bucket.find({ _id: fileId }).toArray();
    
    if (!files || files.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Report not found'
      });
    }
    
    const file = files[0];
    
    // Set appropriate headers
    res.set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.set('Content-Disposition', `attachment; filename="${file.filename}"`);
    
    // Stream the file from GridFS to the response
    const downloadStream = bucket.openDownloadStream(fileId);
    downloadStream.pipe(res);
    
    downloadStream.on('error', (error) => {
      console.error('Error streaming report from GridFS:', error);
      if (!res.headersSent) {
        res.status(500).json({
          success: false,
          message: 'Error downloading report',
          error: error.message
        });
      }
    });
  } catch (error) {
    console.error('Error downloading report:', error);
    res.status(500).json({
      success: false,
      message: 'Error downloading report',
      error: error.message
    });
  }
});

// Simple health check endpoint
app.get('/', (req, res) => {
  res.status(200).json({
    status: 'ERTC Form Webhook Receiver is running with MongoDB storage',
    message: 'Ready to receive webhook notifications',
    features: {
      fileStorage: true,
      excelReports: true,
      mongoDbStorage: true,
      qualificationData: true,
      gridFS: true,
      fileDownloads: true
    }
  });
});

// Start the server
app.listen(PORT, () => {
  console.log(`Webhook receiver server running on port ${PORT}`);
  console.log(`Webhook endpoint: http://localhost:${PORT}/webhook`);
  console.log(`Files and reports are stored in MongoDB GridFS`);
});