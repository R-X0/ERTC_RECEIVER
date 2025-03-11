const express = require('express');
const bodyParser = require('body-parser');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 8000;

// Create directories for storing submissions and files
const submissionsDir = path.join(__dirname, 'submissions');
const uploadsDir = path.join(__dirname, 'uploads');

if (!fs.existsSync(submissionsDir)) {
  fs.mkdirSync(submissionsDir, { recursive: true });
}

if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
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
app.post('/webhook', upload.any(), (req, res) => {
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
    
    // Send confirmation response
    res.status(200).json({
      success: true,
      message: 'Webhook notification received and processed successfully',
      submissionId: submissionId
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

// Add a route to view submissions
app.get('/submissions', (req, res) => {
  try {
    const files = fs.readdirSync(submissionsDir);
    const submissions = files
      .filter(file => file.endsWith('.json'))
      .sort((a, b) => {
        // Sort by timestamp (newest first)
        return fs.statSync(path.join(submissionsDir, b)).mtime.getTime() - 
               fs.statSync(path.join(submissionsDir, a)).mtime.getTime();
      })
      .map(file => {
        const filePath = path.join(submissionsDir, file);
        try {
          const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
          return {
            id: data.id || file.replace('submission_', '').replace('.json', ''),
            receivedAt: data.receivedAt,
            fileCount: (data.receivedFiles || []).length,
            filePath
          };
        } catch (e) {
          return {
            id: file,
            error: 'Could not parse submission file'
          };
        }
      });
    
    res.send(`
      <html>
        <head>
          <title>ERTC Submissions</title>
          <style>
            body { font-family: Arial, sans-serif; margin: 2rem; }
            table { border-collapse: collapse; width: 100%; }
            th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
            tr:nth-child(even) { background-color: #f2f2f2; }
            th { background-color: #4CAF50; color: white; }
          </style>
        </head>
        <body>
          <h1>ERTC Form Submissions</h1>
          <p>${submissions.length} submissions found</p>
          <table>
            <tr>
              <th>ID</th>
              <th>Received At</th>
              <th>Files</th>
              <th>Actions</th>
            </tr>
            ${submissions.map(sub => `
              <tr>
                <td>${sub.id}</td>
                <td>${sub.receivedAt || 'N/A'}</td>
                <td>${sub.fileCount || 0} files</td>
                <td><a href="/submission/${sub.id}">View Details</a></td>
              </tr>
            `).join('')}
          </table>
        </body>
      </html>
    `);
  } catch (error) {
    res.status(500).send(`Error listing submissions: ${error.message}`);
  }
});

// Add a route to view a specific submission
app.get('/submission/:id', (req, res) => {
  try {
    const submissionFile = path.join(submissionsDir, `submission_${req.params.id}.json`);
    if (!fs.existsSync(submissionFile)) {
      return res.status(404).send('Submission not found');
    }
    
    const submissionData = JSON.parse(fs.readFileSync(submissionFile, 'utf8'));
    
    res.send(`
      <html>
        <head>
          <title>Submission ${req.params.id}</title>
          <style>
            body { font-family: Arial, sans-serif; margin: 2rem; }
            pre { background-color: #f5f5f5; padding: 1rem; overflow: auto; }
            .files { margin-top: 2rem; }
            .file-item { margin-bottom: 1rem; padding: 0.5rem; border: 1px solid #ddd; }
          </style>
        </head>
        <body>
          <h1>Submission Details: ${req.params.id}</h1>
          <a href="/submissions">← Back to all submissions</a>
          
          <h2>Received At</h2>
          <p>${submissionData.receivedAt}</p>
          
          <h2>Files (${(submissionData.receivedFiles || []).length})</h2>
          <div class="files">
            ${(submissionData.receivedFiles || []).map(file => `
              <div class="file-item">
                <strong>${file.originalName}</strong> (${file.size} bytes)<br>
                Path: ${file.savedPath}<br>
                Type: ${file.mimetype}
              </div>
            `).join('') || 'No files received'}
          </div>
          
          <h2>Full Submission Data</h2>
          <pre>${JSON.stringify(submissionData, null, 2)}</pre>
        </body>
      </html>
    `);
  } catch (error) {
    res.status(500).send(`Error viewing submission: ${error.message}`);
  }
});

// Simple health check endpoint
app.get('/', (req, res) => {
  res.send(`
    <html>
      <head>
        <title>ERTC Form Webhook Receiver</title>
        <style>
          body { font-family: Arial, sans-serif; margin: 2rem; line-height: 1.6; }
          .container { max-width: 800px; margin: 0 auto; }
          .status { padding: 1rem; background-color: #d4edda; border: 1px solid #c3e6cb; border-radius: 4px; }
          h1 { color: #333; }
          a { display: inline-block; margin-top: 1rem; padding: 0.5rem 1rem; background: #007bff; color: white; text-decoration: none; border-radius: 4px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="status">
            <h1>ERTC Form Webhook Receiver is running</h1>
            <p>This server is ready to receive webhook notifications from your ERTC Form application.</p>
          </div>
          <div>
            <h2>Server Information</h2>
            <p>Webhook endpoint: <code>http://localhost:${PORT}/webhook</code></p>
            <p>Submissions saved to: <code>${submissionsDir}</code></p>
            <p>Uploaded files saved to: <code>${uploadsDir}</code></p>
          </div>
          <a href="/submissions">View Submissions</a>
        </div>
      </body>
    </html>
  `);
});

// Start the server
app.listen(PORT, () => {
  console.log(`Webhook receiver server running on port ${PORT}`);
  console.log(`Webhook endpoint: http://localhost:${PORT}/webhook`);
  console.log(`Submissions will be saved to: ${submissionsDir}`);
  console.log(`Uploaded files will be saved to: ${uploadsDir}`);
});