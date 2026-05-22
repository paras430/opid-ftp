const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// Ensure uploads directory exists
const UPLOADS_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR);
}

// Ensure metadata file exists
const METADATA_FILE = path.join(UPLOADS_DIR, 'metadata.json');
if (!fs.existsSync(METADATA_FILE)) {
  fs.writeFileSync(METADATA_FILE, JSON.stringify([]));
}

// Multer configuration
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, UPLOADS_DIR);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + '-' + file.originalname);
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 50 * 1024 * 1024 // 50 MB
  }
});

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Helper to read metadata
function readMetadata() {
  try {
    const data = fs.readFileSync(METADATA_FILE, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error('Error reading metadata:', error);
    return [];
  }
}

// Helper to write metadata
function writeMetadata(data) {
  try {
    fs.writeFileSync(METADATA_FILE, JSON.stringify(data, null, 2));
  } catch (error) {
    console.error('Error writing metadata:', error);
  }
}

// API Endpoints

// Get list of files
app.get('/api/files', (req, res) => {
  const metadata = readMetadata();
  res.json(metadata);
});

// Upload a file
app.post('/api/upload', upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded or file exceeds 50MB limit.' });
  }

  const { projectId, year, remarks } = req.body;
  
  // Extract format from extension
  const ext = path.extname(req.file.originalname).toLowerCase().replace('.', '');
  const format = ext || 'unknown';

  const fileData = {
    id: Date.now().toString(),
    filename: req.file.filename,
    originalname: req.file.originalname,
    size: req.file.size,
    format: format,
    projectId: projectId || '',
    year: year || '',
    remarks: remarks || '',
    uploadDate: new Date().toISOString()
  };

  const metadata = readMetadata();
  metadata.push(fileData);
  writeMetadata(metadata);

  res.json({ message: 'File uploaded successfully', file: fileData });
});

// Download a file
app.get('/api/download/:filename', (req, res) => {
  const filename = req.params.filename;
  const filePath = path.join(UPLOADS_DIR, filename);
  
  const metadata = readMetadata();
  const fileData = metadata.find(m => m.filename === filename);

  if (fs.existsSync(filePath)) {
    if (fileData) {
      // Use original name for download if metadata is found
      res.download(filePath, fileData.originalname);
    } else {
      res.download(filePath);
    }
  } else {
    res.status(404).json({ error: 'File not found' });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
