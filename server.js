const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();
const archiver = require('archiver');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Ensure base uploads directory exists
const UPLOADS_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

// Parse Authentication Config
const USERS_DB = {};
if (process.env.APP_USERS) {
  const pairs = process.env.APP_USERS.split(',');
  for (const pair of pairs) {
    const [u, p, r] = pair.split(':');
    if (u && p) {
      USERS_DB[u.trim()] = {
        password: p.trim(),
        role: r ? r.trim() : 'Viewer' // Default to Viewer if not specified
      };
    }
  }
} else if (process.env.APP_USERNAME && process.env.APP_PASSWORD) {
  USERS_DB[process.env.APP_USERNAME.trim()] = {
    password: process.env.APP_PASSWORD.trim(),
    role: 'Viewer' // Default to Viewer if not specified
  };
}

const configuredUsers = Object.keys(USERS_DB);
if (configuredUsers.length > 0) {
  const userString = configuredUsers.map(u => `${u} (${USERS_DB[u].role})`).join(', ');
  console.log(`Basic Authentication is ENABLED for users: ${userString}`);
} else {
  console.log(`WARNING: Basic Authentication is DISABLED. No credentials found in .env`);
}

// Map frontend folder names to safe physical directory names
const FOLDER_MAP = {
  'Contract/PAT docs': 'Contract_PAT_docs',
  'Network': 'Network',
  'Equipment': 'Equipment',
  'Letter/MOM/Report': 'Letter_MOM_Report',
  'KMLs': 'KMLs',
  'As-Built Reports': 'As-Built_Reports',
  'Reference Docs': 'Reference_Docs',
  'Images': 'Reference_Docs',
  'Misc': 'Misc'
};

// Initialize SQLite Database
const DB_FILE = path.join(UPLOADS_DIR, 'metadata.sqlite');
const db = new sqlite3.Database(DB_FILE, (err) => {
  if (err) {
    console.error('Error opening database:', err.message);
  } else {
    console.log('Connected to the SQLite database.');
    db.run(`CREATE TABLE IF NOT EXISTS files (
      id TEXT PRIMARY KEY,
      filename TEXT UNIQUE,
      originalname TEXT,
      size INTEGER,
      format TEXT,
      folder TEXT,
      safeFolder TEXT,
      projectId TEXT,
      year TEXT,
      remarks TEXT,
      uploadDate TEXT,
      uploader TEXT
    )`, (err) => {
      if (err) {
        console.error('Error creating table:', err.message);
      } else {
        // Attempt to add uploader and subfolder columns if they don't exist
        db.run("ALTER TABLE files ADD COLUMN uploader TEXT DEFAULT 'Unknown'", () => {});
        db.run("ALTER TABLE files ADD COLUMN subfolder TEXT DEFAULT ''", () => {});
        
        db.run("UPDATE files SET projectId = ''", (err) => {
           if (err) console.error("Error wiping projectId:", err.message);
        });
        migrateJsonToSqlite()
          .then(() => migrateToSubfolders())
          .catch(err => console.error("Migration error:", err));
      }
    });
  }
});

// Helper for database queries
function runQuery(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

function getQuery(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

function allQuery(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

// Migrate old metadata.json if it exists
async function migrateJsonToSqlite() {
  const METADATA_FILE = path.join(UPLOADS_DIR, 'metadata.json');
  if (fs.existsSync(METADATA_FILE)) {
    console.log('Found legacy metadata.json. Starting migration to SQLite...');
    try {
      const data = fs.readFileSync(METADATA_FILE, 'utf8');
      if (data.trim()) {
        const metadata = JSON.parse(data);
        for (const m of metadata) {
          // Check if it already exists
          const exists = await getQuery(`SELECT filename FROM files WHERE filename = ?`, [m.filename]);
          if (!exists) {
            // Re-map folder name if it was the old one
            let folder = m.folder || 'Misc';
            if (folder === 'Letter/MOMs/Reports') folder = 'Letter/MOM/Report';
            
            const safeFolder = FOLDER_MAP[folder] || m.safeFolder || '';
            
            await runQuery(`INSERT INTO files (id, filename, originalname, size, format, folder, safeFolder, projectId, year, remarks, uploadDate) 
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, 
              [m.id || Date.now().toString(), m.filename, m.originalname, m.size, m.format, folder, safeFolder, m.projectId, m.year, m.remarks, m.uploadDate]
            );
          }
        }
      }
      // Backup old JSON to prevent re-migration and avoid cleanup script crash
      fs.renameSync(METADATA_FILE, METADATA_FILE + '.bak');
      console.log('Migration complete. Renamed metadata.json to metadata.json.bak.');
    } catch (e) {
      console.error('Error during migration:', e);
    }
  }
}

// Migrate existing files into year-based subfolders
async function migrateToSubfolders() {
  try {
    await runQuery(`UPDATE files SET folder = 'Reference Docs' WHERE folder = 'Images'`);
    const files = await allQuery(`SELECT * FROM files`);
    for (const f of files) {
      if (!f.uploadDate) continue;
      const uploadYear = new Date(f.uploadDate).getFullYear();
      if (isNaN(uploadYear)) continue;

      const folder = f.folder || 'Misc';
      const baseSafeFolder = FOLDER_MAP[folder] || 'Misc';
      const subfolderName = folder.replace(/\s+/g, '') + '_' + uploadYear;
      const targetSafeFolder = `${baseSafeFolder}/${subfolderName}`;

      if (f.safeFolder !== targetSafeFolder) {
        const oldSafeFolder = f.safeFolder || baseSafeFolder;
        const oldPath = path.join(UPLOADS_DIR, oldSafeFolder, f.filename);
        const newDirPath = path.join(UPLOADS_DIR, baseSafeFolder, subfolderName);
        const newPath = path.join(newDirPath, f.filename);

        if (fs.existsSync(oldPath)) {
          if (!fs.existsSync(newDirPath)) {
            fs.mkdirSync(newDirPath, { recursive: true });
          }
          fs.renameSync(oldPath, newPath);
          console.log(`Migrated file ${f.filename} to ${targetSafeFolder}`);
        }
        await runQuery(`UPDATE files SET safeFolder = ? WHERE filename = ?`, [targetSafeFolder, f.filename]);
      }
    }
  } catch (err) {
    console.error('Error in migrateToSubfolders:', err);
  }
}

// Multer configuration
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    // Save to root uploads dir temporarily because req.body is not fully parsed yet
    cb(null, UPLOADS_DIR);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + '-' + file.originalname);
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 100 * 1024 * 1024 } // 100 MB
});

// Basic Authentication Middleware
function basicAuth(req, res, next) {
  // Allow login endpoint to bypass auth
  if (req.path === '/api/login') return next();

  // If no credentials configured, skip auth
  if (Object.keys(USERS_DB).length === 0) {
    return next();
  }

  let b64auth = req.headers['x-auth-token'] || req.query.token || '';
  if (b64auth.startsWith('Basic ')) {
    b64auth = b64auth.split(' ')[1];
  }
  const [login, password] = Buffer.from(b64auth, 'base64').toString().split(':');

  if (login && password && USERS_DB[login] && USERS_DB[login].password === password) {
    req.user = login; // Attach user to request
    req.userRole = USERS_DB[login].role; // Attach role to request
    return next();
  }

  res.status(401).json({ error: 'Authentication required' });
}

// Role Verification Middleware
function requireRole(role) {
  return (req, res, next) => {
    // If no credentials configured, allow all
    if (Object.keys(USERS_DB).length === 0) {
      return next();
    }
    if (req.userRole === role) {
      return next();
    }
    res.status(403).json({ error: `Forbidden: ${role} role required` });
  };
}

// Serve frontend UI without authentication
app.use(express.static(path.join(__dirname, 'public')));

// Middleware
app.use(express.json());
app.use(basicAuth);
app.use('/uploads', express.static(UPLOADS_DIR));

// Login Endpoint
app.post('/api/login', express.json(), (req, res) => {
  const { username, password } = req.body;

  if (Object.keys(USERS_DB).length === 0) {
    return res.json({ success: true, message: 'Auth disabled', role: 'Master' });
  }

  if (username && password && USERS_DB[username] && USERS_DB[username].password === password) {
    res.json({ success: true, username, role: USERS_DB[username].role });
  } else {
    res.status(401).json({ error: 'Invalid credentials' });
  }
});

// API Endpoints

app.get('/api/files', async (req, res) => {
  try {
    const rows = await allQuery(`SELECT * FROM files ORDER BY uploadDate DESC`);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/upload', upload.any(), async (req, res) => {
  const uploadedFilesList = req.files || (req.file ? [req.file] : []);
  if (!uploadedFilesList || uploadedFilesList.length === 0) {
    return res.status(400).json({ error: 'No files uploaded or file size limit exceeded.' });
  }

  const year = req.body.year || '';
  if (year && !/^\d{4}$/.test(year)) {
    try {
      for (const f of uploadedFilesList) {
        if (fs.existsSync(f.path)) {
          fs.unlinkSync(f.path);
        }
      }
    } catch (err) {
      console.error('Failed to clean up temp file:', err);
    }
    return res.status(400).json({ error: 'Year must be a 4-digit integer' });
  }

  let folder = req.body.folder || 'Misc';
  if (folder === 'Letter/MOMs/Reports') folder = 'Letter/MOM/Report';
  const baseSafeFolder = FOLDER_MAP[folder] || 'Misc';
  const uploadDate = new Date().toISOString();
  const uploadYear = new Date(uploadDate).getFullYear();

  let reqSubfolder = (req.body.subfolder || '').trim();
  let subfolderName = '';
  if (reqSubfolder) {
    subfolderName = reqSubfolder.replace(/[/\\?%*:|"<>]/g, '_');
  }
  if (!subfolderName) {
    subfolderName = folder.replace(/\s+/g, '') + '_' + uploadYear;
  }

  const safeFolder = `${baseSafeFolder}/${subfolderName}`;
  const folderPath = path.join(UPLOADS_DIR, baseSafeFolder, subfolderName);
  if (!fs.existsSync(folderPath)) {
    fs.mkdirSync(folderPath, { recursive: true });
  }

  const savedFiles = [];
  try {
    for (let index = 0; index < uploadedFilesList.length; index++) {
      const file = uploadedFilesList[index];
      const tempPath = file.path;
      const finalPath = path.join(folderPath, file.filename);
      fs.renameSync(tempPath, finalPath);

      const ext = path.extname(file.originalname).toLowerCase().replace('.', '');
      const format = ext || 'unknown';
      const fileId = (Date.now() + index).toString();

      const fileData = {
        id: fileId,
        filename: file.filename,
        originalname: file.originalname,
        size: file.size,
        format: format,
        folder: folder,
        subfolder: subfolderName,
        safeFolder: safeFolder,
        projectId: req.body.projectId || '',
        year: req.body.year || '',
        remarks: req.body.remarks || '',
        uploadDate: uploadDate,
        uploader: req.user || 'Unknown'
      };

      await runQuery(`INSERT INTO files (id, filename, originalname, size, format, folder, safeFolder, projectId, year, remarks, uploadDate, uploader, subfolder) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, 
        [fileData.id, fileData.filename, fileData.originalname, fileData.size, fileData.format, fileData.folder, fileData.safeFolder, fileData.projectId, fileData.year, fileData.remarks, fileData.uploadDate, fileData.uploader, fileData.subfolder]
      );

      savedFiles.push(fileData);
    }

    const message = savedFiles.length === 1 
      ? 'File uploaded successfully' 
      : `${savedFiles.length} files uploaded successfully`;

    res.json({ message, files: savedFiles, file: savedFiles[0] });
  } catch (err) {
    console.error('Error saving uploaded files:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/move-subfolder', requireRole('Master'), async (req, res) => {
  const { currentFolder, subfolder, targetFolder } = req.body;
  if (!currentFolder || !subfolder || !targetFolder) {
    return res.status(400).json({ error: 'Missing currentFolder, subfolder, or targetFolder' });
  }

  if (currentFolder === targetFolder) {
    return res.status(400).json({ error: 'Target folder must be different from current folder' });
  }

  const oldBaseSafe = FOLDER_MAP[currentFolder] || 'Misc';
  const newBaseSafe = FOLDER_MAP[targetFolder] || 'Misc';
  const sanitizedSubfolder = subfolder.replace(/[/\\?%*:|"<>]/g, '_');

  const oldDirPath = path.join(UPLOADS_DIR, oldBaseSafe, sanitizedSubfolder);
  const newParentDirPath = path.join(UPLOADS_DIR, newBaseSafe);
  const newDirPath = path.join(newParentDirPath, sanitizedSubfolder);

  try {
    // 1. Move directory on disk if it exists
    if (fs.existsSync(oldDirPath)) {
      if (!fs.existsSync(newParentDirPath)) {
        fs.mkdirSync(newParentDirPath, { recursive: true });
      }
      if (fs.existsSync(newDirPath)) {
        const files = fs.readdirSync(oldDirPath);
        for (const file of files) {
          const srcFile = path.join(oldDirPath, file);
          const destFile = path.join(newDirPath, file);
          fs.renameSync(srcFile, destFile);
        }
        try { fs.rmdirSync(oldDirPath); } catch (e) {}
      } else {
        fs.renameSync(oldDirPath, newDirPath);
      }
    }

    // 2. Update files in SQLite DB
    const newSafeFolder = `${newBaseSafe}/${sanitizedSubfolder}`;
    await runQuery(
      `UPDATE files SET folder = ?, safeFolder = ?, subfolder = ? WHERE folder = ? AND (subfolder = ? OR safeFolder = ? OR safeFolder LIKE ?)`,
      [targetFolder, newSafeFolder, sanitizedSubfolder, currentFolder, subfolder, `${oldBaseSafe}/${subfolder}`, `%/${subfolder}`]
    );

    res.json({ success: true, message: `Moved subfolder '${subfolder}' from '${currentFolder}' to '${targetFolder}'` });
  } catch (err) {
    console.error('Error moving subfolder:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/backup-zip', async (req, res) => {
  const folderFilter = req.query.folder;
  const subfolderFilter = req.query.subfolder;
  const yearFilter = req.query.year;
  try {
    let query = `SELECT * FROM files`;
    let params = [];
    let conditions = [];
    if (folderFilter) {
      conditions.push(`folder = ?`);
      params.push(folderFilter);
    }
    if (subfolderFilter) {
      conditions.push(`(subfolder = ? OR safeFolder LIKE ?)`);
      params.push(subfolderFilter, `%/${subfolderFilter}`);
    } else if (yearFilter) {
      conditions.push(`uploadDate LIKE ?`);
      params.push(`${yearFilter}%`);
    }
    if (conditions.length > 0) {
      query += ` WHERE ` + conditions.join(' AND ');
    }

    const files = await allQuery(query, params);
    if (files.length === 0) {
      return res.status(404).json({ error: 'No files to backup' });
    }

    const zipSubfolderName = subfolderFilter || (folderFilter ? (folderFilter.replace(/\s+/g, '') + (yearFilter ? `_${yearFilter}` : '')) : 'all');
    const safeFolderName = zipSubfolderName.replace(/[^a-zA-Z0-9_\-]/g, '_');
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename=ftp_files_backup_${safeFolderName}.zip`);

    const archive = archiver('zip', {
      zlib: { level: 9 }
    });

    archive.on('error', (err) => {
      throw err;
    });

    archive.pipe(res);

    for (const file of files) {
      const filePath = path.join(UPLOADS_DIR, file.safeFolder || '', file.filename);
      if (fs.existsSync(filePath)) {
        const fileSubfolder = file.subfolder || (file.safeFolder && file.safeFolder.includes('/') ? file.safeFolder.split('/')[1] : (file.folder || 'Misc').replace(/\s+/g, ''));
        const zipPath = path.join(fileSubfolder, file.originalname);
        archive.file(filePath, { name: zipPath });
      }
    }

    await archive.finalize();
  } catch (err) {
    console.error('Error creating zip:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: err.message });
    }
  }
});

app.get('/api/download/:filename', async (req, res) => {
  const filename = req.params.filename;
  try {
    const fileData = await getQuery(`SELECT * FROM files WHERE filename = ?`, [filename]);
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
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/view/:filename', async (req, res) => {
  const filename = req.params.filename;
  try {
    const fileData = await getQuery(`SELECT * FROM files WHERE filename = ?`, [filename]);
    if (fileData) {
      const filePath = path.join(UPLOADS_DIR, fileData.safeFolder || '', filename);
      if (fs.existsSync(filePath)) {
        // Set content disposition to inline to force browser viewing instead of downloading
        res.setHeader('Content-Disposition', `inline; filename="${fileData.originalname}"`);
        res.sendFile(filePath);
      } else {
        res.status(404).json({ error: 'File not found on disk' });
      }
    } else {
      res.status(404).json({ error: 'File metadata not found' });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/files/:filename', async (req, res) => {
  const filename = req.params.filename;
  const { projectId, year, remarks, folder } = req.body;

  if (year !== undefined && year !== '') {
    if (!/^\d{4}$/.test(year)) {
      return res.status(400).json({ error: 'Year must be a 4-digit integer' });
    }
  }
  
  try {
    const currentData = await getQuery(`SELECT * FROM files WHERE filename = ?`, [filename]);
    if (currentData) {
      let newFolder = currentData.folder;
      let newSafeFolder = currentData.safeFolder || '';

      // Handle Folder Change / Physical Move
      if (folder && folder !== currentData.folder) {
        newFolder = folder;
        if (newFolder === 'Letter/MOMs/Reports') newFolder = 'Letter/MOM/Report';
        const uploadYear = new Date(currentData.uploadDate || new Date()).getFullYear();
        const subfolderName = newFolder.replace(/\s+/g, '') + '_' + uploadYear;
        const baseSafeFolder = FOLDER_MAP[newFolder] || 'Misc';
        newSafeFolder = `${baseSafeFolder}/${subfolderName}`;
        
        const oldPath = path.join(UPLOADS_DIR, currentData.safeFolder || '', filename);
        const newDirPath = path.join(UPLOADS_DIR, baseSafeFolder, subfolderName);
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

      const pId = projectId !== undefined ? projectId : currentData.projectId;
      const yr = year !== undefined ? year : currentData.year;
      const rm = remarks !== undefined ? remarks : currentData.remarks;
      const updatedUploadDate = remarks !== undefined ? new Date().toISOString().split('T')[0] : (currentData.uploadDate || new Date().toISOString().split('T')[0]);

      await runQuery(`UPDATE files SET projectId = ?, year = ?, remarks = ?, folder = ?, safeFolder = ?, uploadDate = ? WHERE filename = ?`, 
        [pId, yr, rm, newFolder, newSafeFolder, updatedUploadDate, filename]
      );
      
      res.json({ message: 'Metadata updated successfully' });
    } else {
      res.status(404).json({ error: 'File metadata not found' });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/files/:filename', requireRole('Master'), async (req, res) => {
  const filename = req.params.filename;
  try {
    const fileData = await getQuery(`SELECT * FROM files WHERE filename = ?`, [filename]);
    if (fileData) {
      const filePath = path.join(UPLOADS_DIR, fileData.safeFolder || '', filename);
      
      try {
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      } catch (err) {
        console.error(`Failed to delete physical file ${filePath} but removing metadata anyway:`, err);
      }
      
      await runQuery(`DELETE FROM files WHERE filename = ?`, [filename]);
      res.json({ message: 'File processed for deletion successfully' });
    } else {
      res.status(404).json({ error: 'File metadata not found' });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
