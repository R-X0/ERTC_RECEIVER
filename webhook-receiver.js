const express = require('express');
const bodyParser = require('body-parser');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const { generateExcelReport } = require('./excel-generator');
const app = express();
const PORT = process.env.PORT || 8000;

// Create directories for storing submissions, files, and reports
const submissionsDir = path.join(__dirname, 'submissions');
const uploadsDir = path.join(__dirname, 'uploads');
const reportsDir = path.join(__dirname, 'reports');

if (!fs.existsSync(submissionsDir)) {
  fs.mkdirSync(submissionsDir, { recursive: true });
}

if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

if (!fs.existsSync(reportsDir)) {
  fs.mkdirSync(reportsDir, { recursive: true });
}

// Configure multer for file storage
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
    
    // Handle received files
    const receivedFiles = [];
    if (req.files && req.files.length > 0) {
      console.log(`Received ${req.files.length} files:`);
      req.files.forEach(file => {
        console.log(`- ${file.originalname} (${file.size} bytes) saved to ${file.path}`);
        receivedFiles.push({
          originalName: file.originalname,
          savedPath: file.path,
          size: file.size,
          mimetype: file.mimetype
        });
      });
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
    
    // Save submission data to a JSON file
    const submissionFile = path.join(submissionsDir, `submission_${submissionId}.json`);
    fs.writeFileSync(submissionFile, JSON.stringify(finalSubmissionData, null, 2));
    
    console.log(`Submission data saved to ${submissionFile}`);
    
    // Generate Excel report
    let reportPath = null;
    try {
      reportPath = await generateExcelReport(finalSubmissionData, submissionId, reportsDir);
      console.log(`Excel report generated at ${reportPath}`);
    } catch (reportError) {
      console.error('Error generating Excel report:', reportError);
    }
    
    // Send confirmation response
    res.status(200).json({
      success: true,
      message: 'Webhook notification received and processed successfully',
      submissionId: submissionId,
      reportGenerated: !!reportPath
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

// Simple health check endpoint
app.get('/', (req, res) => {
  res.status(200).json({
    status: 'ERTC Form Webhook Receiver is running',
    message: 'Ready to receive webhook notifications'
  });
});

// Start the server
app.listen(PORT, () => {
  console.log(`Webhook receiver server running on port ${PORT}`);
  console.log(`Webhook endpoint: http://localhost:${PORT}/webhook`);
  console.log(`Submissions will be saved to: ${submissionsDir}`);
  console.log(`Uploaded files will be saved to: ${uploadsDir}`);
  console.log(`Excel reports will be saved to: ${reportsDir}`);
});