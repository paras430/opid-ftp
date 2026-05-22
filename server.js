const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// Ensure base uploads directory exists
const UPLOADS_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

// Ensure metadata file exists
const METADATA_FILE = path.join(UPLOADS_DIR, 'metadata.json');
if (!fs.existsSync(METADATA_FILE)) {
  fs.writeFileSync(METADATA_FILE, JSON.stringify([]));
}

// Map frontend folder names to safe physical directory names
const FOLDER_MAP = {
  'Contract/PAT docs': 'Contract_PAT_docs',
  'Network': 'Network',
  'Equipment': 'Equipment',
  'Letter/MOMs/Reports': 'Letter_MOMs_Reports',
  'Images': 'Images',
  'Misc': 'Misc'
};

// Multer configuration
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const rawFolder = req.body.folder || 'Misc';
    const safeFolder = FOLDER_MAP[rawFolder] || 'Misc';
    const folderPath = path.join(UPLOADS_DIR, safeFolder);
    
    if (!fs.existsSync(folderPath)) {
      fs.mkdirSync(folderPath, { recursive: true });
    }
    cb(null, folderPath);
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
// Serve uploads directory for the "View" button functionality
app.use('/uploads', express.static(UPLOADS_DIR));

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

  const { projectId, year, remarks, folder } = req.body;
  const rawFolder = folder || 'Misc';
  const safeFolder = FOLDER_MAP[rawFolder] || 'Misc';
  
  // Extract format from extension
  const ext = path.extname(req.file.originalname).toLowerCase().replace('.', '');
  const format = ext || 'unknown';

  const fileData = {
    id: Date.now().toString(),
    filename: req.file.filename,
    originalname: req.file.originalname,
    size: req.file.size,
    format: format,
    folder: rawFolder, // The user-friendly name
    safeFolder: safeFolder, // The physical folder name
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
  const metadata = readMetadata();
  const fileData = metadata.find(m => m.filename === filename);

  if (fileData) {
    const filePath = path.join(UPLOADS_DIR, fileData.safeFolder || '', filename);
    if (fs.existsSync(filePath)) {
      res.download(filePath, fileData.originalname);
    } else {
      res.status(404).json({ error: 'File not found on disk' });
    }
  } else {
    res.status(404).json({ error: 'File metadata not found' });
  }
});

// Edit file metadata (Project ID, Year, Remarks, Folder)
app.put('/api/files/:filename', (req, res) => {
  const filename = req.params.filename;
  const { projectId, year, remarks, folder } = req.body;
  
  const metadata = readMetadata();
  const fileIndex = metadata.findIndex(m => m.filename === filename);
  
  if (fileIndex !== -1) {
    const currentData = metadata[fileIndex];
    let newSafeFolder = currentData.safeFolder || '';
    let newFolder = currentData.folder || 'Misc';

    // Handle Folder Change / Physical Move
    if (folder && folder !== currentData.folder) {
      newFolder = folder;
      newSafeFolder = FOLDER_MAP[folder] || 'Misc';
      
      const oldPath = path.join(UPLOADS_DIR, currentData.safeFolder || '', filename);
      const newDirPath = path.join(UPLOADS_DIR, newSafeFolder);
      const newPath = path.join(newDirPath, filename);

      try {
        if (!fs.existsSync(newDirPath)) {
          fs.mkdirSync(newDirPath, { recursive: true });
        }
        if (fs.existsSync(oldPath)) {
          fs.renameSync(oldPath, newPath);
        }
      } catch (err) {
        console.error("Error moving file:", err);
        return res.status(500).json({ error: 'Failed to move physical file.' });
      }
    }

    metadata[fileIndex] = {
      ...currentData,
      projectId: projectId !== undefined ? projectId : currentData.projectId,
      year: year !== undefined ? year : currentData.year,
      remarks: remarks !== undefined ? remarks : currentData.remarks,
      folder: newFolder,
      safeFolder: newSafeFolder
    };
    
    writeMetadata(metadata);
    res.json({ message: 'Metadata updated successfully', file: metadata[fileIndex] });
  } else {
    res.status(404).json({ error: 'File metadata not found' });
  }
});

// Clean up orphaned files and metadata
function cleanUpResidue() {
  console.log('Running residue cleanup...');
  const metadata = readMetadata();
  let metadataModified = false;
  
  // 1. Remove metadata for physical files that don't exist
  const validMetadata = [];
  for (const m of metadata) {
    const filePath = path.join(UPLOADS_DIR, m.safeFolder || '', m.filename);
    if (fs.existsSync(filePath)) {
      validMetadata.push(m);
    } else {
      console.log(`Removing orphaned metadata for missing file: ${m.filename}`);
      metadataModified = true;
    }
  }
  
  if (metadataModified) {
    writeMetadata(validMetadata);
  }

  // 2. Remove physical files that aren't in metadata
  const metadataFilenames = new Set(validMetadata.map(m => m.filename));
  const foldersToScan = Object.values(FOLDER_MAP);
  foldersToScan.push('Misc'); // Ensure Misc is checked if it was somehow skipped
  
  // Create a Set of unique folders
  const uniqueFolders = [...new Set(foldersToScan)];
  
  for (const folder of uniqueFolders) {
    const folderPath = path.join(UPLOADS_DIR, folder);
    if (fs.existsSync(folderPath)) {
      const files = fs.readdirSync(folderPath);
      for (const file of files) {
        if (!metadataFilenames.has(file)) {
          const filePath = path.join(folderPath, file);
          console.log(`Removing orphaned physical file: ${filePath}`);
          try {
            fs.unlinkSync(filePath);
          } catch (e) {
            console.error(`Failed to remove orphaned file ${filePath}:`, e);
          }
        }
      }
    }
  }
  
  // Also scan the root UPLOADS_DIR for old files not in subfolders
  const rootFiles = fs.readdirSync(UPLOADS_DIR).filter(item => {
    const fullPath = path.join(UPLOADS_DIR, item);
    return fs.statSync(fullPath).isFile() && item !== 'metadata.json';
  });
  
  for (const file of rootFiles) {
    if (!metadataFilenames.has(file)) {
      const filePath = path.join(UPLOADS_DIR, file);
      console.log(`Removing orphaned physical file in root: ${filePath}`);
      try {
        fs.unlinkSync(filePath);
      } catch (e) {
        console.error(`Failed to remove orphaned file ${filePath}:`, e);
      }
    }
  }
  console.log('Residue cleanup finished.');
}

// Call on startup
cleanUpResidue();

// Endpoint to manually trigger cleanup
app.post('/api/cleanup', (req, res) => {
  cleanUpResidue();
  res.json({ message: 'Cleanup complete' });
});

// Delete a file
app.delete('/api/files/:filename', (req, res) => {
  const filename = req.params.filename;
  const metadata = readMetadata();
  const fileIndex = metadata.findIndex(m => m.filename === filename);
  
  if (fileIndex !== -1) {
    const fileData = metadata[fileIndex];
    const filePath = path.join(UPLOADS_DIR, fileData.safeFolder || '', filename);
    
    // Remove from disk if exists, wrap in try-catch so metadata is still removed if physical delete fails
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } catch (err) {
      console.error(`Failed to delete physical file ${filePath} but removing metadata anyway:`, err);
    }
    
    // Remove from metadata unconditionally so UI stays clean
    metadata.splice(fileIndex, 1);
    writeMetadata(metadata);
    
    res.json({ message: 'File processed for deletion successfully' });
  } else {
    res.status(404).json({ error: 'File metadata not found' });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
