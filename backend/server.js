const express = require('express')
const cors = require('cors')
const fs = require('fs')
const path = require('path')
const Papa = require('papaparse')
const crypto = require('crypto')
const Database = require('better-sqlite3')
const bcrypt = require('bcryptjs')
const multer = require('multer')

const app = express()
app.use(cors())
app.use(express.json({ limit: '50mb' }))

// Config
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, '../data sample.txt')
const PORT = process.env.PORT || 3457
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'dashboard.db')
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123'
const DEMO_PASSWORD = process.env.DEMO_PASSWORD || 'demo123'
const NODE_ENV = process.env.NODE_ENV || 'development'
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || ''
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '../data')

// Serve static frontend in production
if (NODE_ENV === 'production') {
  const frontendPath = path.join(__dirname, '../frontend/dist')
  app.use(express.static(frontendPath))
}

// Initialize SQLite database
const db = new Database(DB_PATH)
db.pragma('journal_mode = WAL')

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true })
}

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, DATA_DIR),
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9)
    cb(null, uniqueSuffix + '-' + file.originalname)
  }
})
const upload = multer({ 
  storage,
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB max
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase()
    if (['.csv', '.tsv', '.txt'].includes(ext)) {
      cb(null, true)
    } else {
      cb(new Error('Only CSV, TSV, and TXT files allowed'))
    }
  }
})

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    email TEXT UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT DEFAULT 'user',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_login DATETIME,
    active INTEGER DEFAULT 1
  );
  
  CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    token TEXT UNIQUE NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    expires_at DATETIME NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );
  
  CREATE TABLE IF NOT EXISTS data_files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    filename TEXT NOT NULL,
    original_name TEXT NOT NULL,
    file_path TEXT NOT NULL,
    file_size INTEGER,
    row_count INTEGER,
    columns TEXT,
    date_range_start TEXT,
    date_range_end TEXT,
    uploaded_by INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    active INTEGER DEFAULT 1,
    FOREIGN KEY (uploaded_by) REFERENCES users(id)
  );
  
  CREATE TABLE IF NOT EXISTS column_mappings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_column TEXT NOT NULL,
    target_column TEXT NOT NULL,
    file_id INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (file_id) REFERENCES data_files(id)
  );
  
  CREATE TABLE IF NOT EXISTS chat_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    message TEXT NOT NULL,
    response TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );
`)

// Create default admin user if not exists
const adminExists = db.prepare('SELECT id FROM users WHERE username = ?').get('admin')
if (!adminExists) {
  const hash = bcrypt.hashSync(ADMIN_PASSWORD, 10)
  db.prepare('INSERT INTO users (username, email, password_hash, role) VALUES (?, ?, ?, ?)').run('admin', 'admin@local', hash, 'admin')
  console.log('Created default admin user (password: ' + ADMIN_PASSWORD + ')')
}

// Create seed users from environment (format: USER_SEED_1=username:password:role)
for (let i = 1; i <= 10; i++) {
  const seed = process.env[`USER_SEED_${i}`]
  if (seed) {
    const [username, password, role = 'admin'] = seed.split(':')
    const exists = db.prepare('SELECT id FROM users WHERE username = ?').get(username)
    if (!exists && username && password) {
      const hash = bcrypt.hashSync(password, 10)
      db.prepare('INSERT INTO users (username, email, password_hash, role) VALUES (?, ?, ?, ?)').run(username, null, hash, role)
      console.log(`Created seed user: ${username} (${role})`)
    }
  }
}

// Session management
function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex')
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() // 24 hours
  db.prepare('INSERT INTO sessions (user_id, token, expires_at) VALUES (?, ?, ?)').run(userId, token, expiresAt)
  return token
}

function validateSession(token) {
  if (!token) return null
  const session = db.prepare(`
    SELECT s.*, u.username, u.role, u.email 
    FROM sessions s 
    JOIN users u ON s.user_id = u.id 
    WHERE s.token = ? AND s.expires_at > datetime('now') AND u.active = 1
  `).get(token)
  return session
}

function requireAuth(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '')
  const session = validateSession(token)
  if (!session) {
    return res.status(401).json({ error: 'Unauthorized' })
  }
  req.user = session
  next()
}

function requireAdmin(req, res, next) {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' })
  }
  next()
}

// Load CSV data - now from multiple sources
let cachedData = null
let cachedColumns = null
let dataFilesCache = null

function loadDataFromFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8')
  // Detect delimiter (TSV vs CSV)
  const firstLine = content.split('\n')[0] || ''
  const delimiter = firstLine.includes('\t') ? '\t' : ','
  const parsed = Papa.parse(content, { header: true, skipEmptyLines: true, delimiter })
  return { data: parsed.data, columns: parsed.meta.fields || [] }
}

function loadAllData(forceRefresh = false) {
  if (cachedData && !forceRefresh) return { data: cachedData, columns: cachedColumns, files: dataFilesCache }
  
  // Get all active data files from DB
  const files = db.prepare('SELECT * FROM data_files WHERE active = 1 ORDER BY created_at ASC').all()
  
  // If no files in DB, try loading from default DATA_FILE
  if (files.length === 0) {
    try {
      if (fs.existsSync(DATA_FILE)) {
        const { data, columns } = loadDataFromFile(DATA_FILE)
        cachedData = data
        cachedColumns = columns
        dataFilesCache = [{ id: 0, original_name: 'Default Data', row_count: data.length, columns: JSON.stringify(columns) }]
        console.log(`Loaded ${data.length} records from default file`)
        return { data: cachedData, columns: cachedColumns, files: dataFilesCache }
      }
    } catch (err) {
      console.error('Error loading default data file:', err.message)
    }
    cachedData = []
    cachedColumns = []
    dataFilesCache = []
    return { data: [], columns: [], files: [] }
  }
  
  // Merge data from all files
  let allData = []
  let allColumns = new Set()
  
  for (const file of files) {
    try {
      if (fs.existsSync(file.file_path)) {
        const { data, columns } = loadDataFromFile(file.file_path)
        columns.forEach(col => allColumns.add(col))
        // Add source file info to each row
        data.forEach(row => {
          row._sourceFile = file.original_name
          row._sourceFileId = file.id
        })
        allData = allData.concat(data)
      }
    } catch (err) {
      console.error(`Error loading ${file.original_name}:`, err.message)
    }
  }
  
  // Normalize all rows to have all columns
  const columnsArray = Array.from(allColumns)
  allData = allData.map(row => {
    const normalized = {}
    columnsArray.forEach(col => {
      normalized[col] = row[col] !== undefined ? row[col] : null
    })
    normalized._sourceFile = row._sourceFile
    normalized._sourceFileId = row._sourceFileId
    return normalized
  })
  
  cachedData = allData
  cachedColumns = columnsArray
  dataFilesCache = files
  console.log(`Loaded ${allData.length} records from ${files.length} files with ${columnsArray.length} columns`)
  return { data: cachedData, columns: cachedColumns, files: dataFilesCache }
}

function invalidateCache() {
  cachedData = null
  cachedColumns = null
  dataFilesCache = null
}

// Helper to analyze a file and get stats
function analyzeFile(filePath) {
  const { data, columns } = loadDataFromFile(filePath)
  
  // Try to find date range from common date columns
  const dateColumns = ['CallStart', 'CallEnd', 'Date', 'Timestamp', 'Created', 'CreatedAt']
  let dateRangeStart = null
  let dateRangeEnd = null
  
  for (const col of dateColumns) {
    if (columns.includes(col)) {
      const dates = data.map(row => row[col]).filter(Boolean).sort()
      if (dates.length > 0) {
        dateRangeStart = dates[0]
        dateRangeEnd = dates[dates.length - 1]
        break
      }
    }
  }
  
  return {
    rowCount: data.length,
    columns,
    dateRangeStart,
    dateRangeEnd
  }
}

// State/timezone/coordinates mappings
const stateTimezones = {
  'AL': 'America/Chicago', 'AK': 'America/Anchorage', 'AZ': 'America/Phoenix',
  'AR': 'America/Chicago', 'CA': 'America/Los_Angeles', 'CO': 'America/Denver',
  'CT': 'America/New_York', 'DE': 'America/New_York', 'FL': 'America/New_York',
  'GA': 'America/New_York', 'HI': 'Pacific/Honolulu', 'ID': 'America/Boise',
  'IL': 'America/Chicago', 'IN': 'America/Indiana/Indianapolis', 'IA': 'America/Chicago',
  'KS': 'America/Chicago', 'KY': 'America/New_York', 'LA': 'America/Chicago',
  'ME': 'America/New_York', 'MD': 'America/New_York', 'MA': 'America/New_York',
  'MI': 'America/Detroit', 'MN': 'America/Chicago', 'MS': 'America/Chicago',
  'MO': 'America/Chicago', 'MT': 'America/Denver', 'NE': 'America/Chicago',
  'NV': 'America/Los_Angeles', 'NH': 'America/New_York', 'NJ': 'America/New_York',
  'NM': 'America/Denver', 'NY': 'America/New_York', 'NC': 'America/New_York',
  'ND': 'America/Chicago', 'OH': 'America/New_York', 'OK': 'America/Chicago',
  'OR': 'America/Los_Angeles', 'PA': 'America/New_York', 'RI': 'America/New_York',
  'SC': 'America/New_York', 'SD': 'America/Chicago', 'TN': 'America/Chicago',
  'TX': 'America/Chicago', 'UT': 'America/Denver', 'VT': 'America/New_York',
  'VA': 'America/New_York', 'WA': 'America/Los_Angeles', 'WV': 'America/New_York',
  'WI': 'America/Chicago', 'WY': 'America/Denver', 'DC': 'America/New_York',
  'ON': 'America/Toronto', 'QC': 'America/Montreal', 'BC': 'America/Vancouver',
  'AB': 'America/Edmonton', 'MB': 'America/Winnipeg', 'SK': 'America/Regina',
  'NS': 'America/Halifax', 'NB': 'America/Moncton', 'NL': 'America/St_Johns'
}

const stateCoordinates = {
  'AL': { lat: 32.806671, lng: -86.791130 }, 'AK': { lat: 61.370716, lng: -152.404419 },
  'AZ': { lat: 33.729759, lng: -111.431221 }, 'AR': { lat: 34.969704, lng: -92.373123 },
  'CA': { lat: 36.116203, lng: -119.681564 }, 'CO': { lat: 39.059811, lng: -105.311104 },
  'CT': { lat: 41.597782, lng: -72.755371 }, 'DE': { lat: 39.318523, lng: -75.507141 },
  'FL': { lat: 27.766279, lng: -81.686783 }, 'GA': { lat: 33.040619, lng: -83.643074 },
  'HI': { lat: 21.094318, lng: -157.498337 }, 'ID': { lat: 44.240459, lng: -114.478828 },
  'IL': { lat: 40.349457, lng: -88.986137 }, 'IN': { lat: 39.849426, lng: -86.258278 },
  'IA': { lat: 42.011539, lng: -93.210526 }, 'KS': { lat: 38.526600, lng: -96.726486 },
  'KY': { lat: 37.668140, lng: -84.670067 }, 'LA': { lat: 31.169546, lng: -91.867805 },
  'ME': { lat: 44.693947, lng: -69.381927 }, 'MD': { lat: 39.063946, lng: -76.802101 },
  'MA': { lat: 42.230171, lng: -71.530106 }, 'MI': { lat: 43.326618, lng: -84.536095 },
  'MN': { lat: 45.694454, lng: -93.900192 }, 'MS': { lat: 32.741646, lng: -89.678696 },
  'MO': { lat: 38.456085, lng: -92.288368 }, 'MT': { lat: 46.921925, lng: -110.454353 },
  'NE': { lat: 41.125370, lng: -98.268082 }, 'NV': { lat: 38.313515, lng: -117.055374 },
  'NH': { lat: 43.452492, lng: -71.563896 }, 'NJ': { lat: 40.298904, lng: -74.521011 },
  'NM': { lat: 34.840515, lng: -106.248482 }, 'NY': { lat: 42.165726, lng: -74.948051 },
  'NC': { lat: 35.630066, lng: -79.806419 }, 'ND': { lat: 47.528912, lng: -99.784012 },
  'OH': { lat: 40.388783, lng: -82.764915 }, 'OK': { lat: 35.565342, lng: -96.928917 },
  'OR': { lat: 44.572021, lng: -122.070938 }, 'PA': { lat: 40.590752, lng: -77.209755 },
  'RI': { lat: 41.680893, lng: -71.511780 }, 'SC': { lat: 33.856892, lng: -80.945007 },
  'SD': { lat: 44.299782, lng: -99.438828 }, 'TN': { lat: 35.747845, lng: -86.692345 },
  'TX': { lat: 31.054487, lng: -97.563461 }, 'UT': { lat: 40.150032, lng: -111.862434 },
  'VT': { lat: 44.045876, lng: -72.710686 }, 'VA': { lat: 37.769337, lng: -78.169968 },
  'WA': { lat: 47.400902, lng: -121.490494 }, 'WV': { lat: 38.491226, lng: -80.954453 },
  'WI': { lat: 44.268543, lng: -89.616508 }, 'WY': { lat: 42.755966, lng: -107.302490 },
  'DC': { lat: 38.897438, lng: -77.026817 },
  'ON': { lat: 51.253775, lng: -85.323214 }, 'QC': { lat: 52.939916, lng: -73.549136 },
  'BC': { lat: 53.726669, lng: -127.647621 }, 'AB': { lat: 53.933271, lng: -116.576503 }
}

const areaCodeCarriers = {
  '201': 'Verizon/AT&T', '202': 'Verizon/AT&T', '203': 'AT&T',
  '212': 'Verizon', '213': 'AT&T', '214': 'AT&T',
  '310': 'AT&T/T-Mobile', '312': 'AT&T', '313': 'AT&T',
  '404': 'AT&T', '408': 'AT&T', '415': 'AT&T',
  '469': 'AT&T', '512': 'AT&T', '602': 'T-Mobile',
  '619': 'AT&T', '626': 'AT&T', '650': 'AT&T',
  '702': 'T-Mobile', '713': 'AT&T', '714': 'AT&T',
  '718': 'Verizon', '720': 'T-Mobile', '760': 'Verizon',
  '818': 'AT&T', '858': 'AT&T', '909': 'Verizon',
  '916': 'AT&T', '917': 'Verizon', '949': 'AT&T',
  '951': 'Verizon', '972': 'AT&T'
}

// ============== AUTH ROUTES ==============

app.post('/api/auth', (req, res) => {
  const { username, password } = req.body
  
  // Support both username and legacy password-only auth
  const user = username 
    ? db.prepare('SELECT * FROM users WHERE (username = ? OR email = ?) AND active = 1').get(username, username)
    : db.prepare('SELECT * FROM users WHERE active = 1').get()
  
  if (!user) {
    return res.status(401).json({ error: 'Invalid credentials' })
  }
  
  // For legacy password-only auth, check against admin password
  const passwordToCheck = username ? password : req.body.password
  if (!bcrypt.compareSync(passwordToCheck, user.password_hash)) {
    return res.status(401).json({ error: 'Invalid credentials' })
  }
  
  // Update last login
  db.prepare('UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?').run(user.id)
  
  const token = createSession(user.id)
  res.json({ 
    token, 
    user: { 
      id: user.id, 
      username: user.username, 
      email: user.email, 
      role: user.role 
    } 
  })
})

app.post('/api/auth/logout', requireAuth, (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '')
  db.prepare('DELETE FROM sessions WHERE token = ?').run(token)
  res.json({ success: true })
})

app.get('/api/auth/me', requireAuth, (req, res) => {
  res.json({ 
    user: { 
      id: req.user.user_id, 
      username: req.user.username, 
      email: req.user.email, 
      role: req.user.role 
    } 
  })
})

// ============== USER MANAGEMENT (Admin only) ==============

app.get('/api/admin/users', requireAuth, requireAdmin, (req, res) => {
  const users = db.prepare(`
    SELECT id, username, email, role, created_at, last_login, active 
    FROM users ORDER BY created_at DESC
  `).all()
  res.json({ users })
})

app.post('/api/admin/users', requireAuth, requireAdmin, (req, res) => {
  const { username, email, password, role = 'user' } = req.body
  
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' })
  }
  
  try {
    const hash = bcrypt.hashSync(password, 10)
    const result = db.prepare('INSERT INTO users (username, email, password_hash, role) VALUES (?, ?, ?, ?)').run(username, email || null, hash, role)
    
    const user = db.prepare('SELECT id, username, email, role, created_at, active FROM users WHERE id = ?').get(result.lastInsertRowid)
    res.json({ user })
  } catch (err) {
    if (err.message.includes('UNIQUE')) {
      return res.status(400).json({ error: 'Username or email already exists' })
    }
    res.status(500).json({ error: err.message })
  }
})

app.put('/api/admin/users/:id', requireAuth, requireAdmin, (req, res) => {
  const { id } = req.params
  const { username, email, password, role, active } = req.body
  
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id)
  if (!user) {
    return res.status(404).json({ error: 'User not found' })
  }
  
  // Don't allow deactivating the last admin
  if (active === false && user.role === 'admin') {
    const adminCount = db.prepare('SELECT COUNT(*) as count FROM users WHERE role = ? AND active = 1').get('admin')
    if (adminCount.count <= 1) {
      return res.status(400).json({ error: 'Cannot deactivate the last admin' })
    }
  }
  
  try {
    if (password) {
      const hash = bcrypt.hashSync(password, 10)
      db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, id)
    }
    
    if (username !== undefined) db.prepare('UPDATE users SET username = ? WHERE id = ?').run(username, id)
    if (email !== undefined) db.prepare('UPDATE users SET email = ? WHERE id = ?').run(email, id)
    if (role !== undefined) db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, id)
    if (active !== undefined) db.prepare('UPDATE users SET active = ? WHERE id = ?').run(active ? 1 : 0, id)
    
    const updated = db.prepare('SELECT id, username, email, role, created_at, last_login, active FROM users WHERE id = ?').get(id)
    res.json({ user: updated })
  } catch (err) {
    if (err.message.includes('UNIQUE')) {
      return res.status(400).json({ error: 'Username or email already exists' })
    }
    res.status(500).json({ error: err.message })
  }
})

app.delete('/api/admin/users/:id', requireAuth, requireAdmin, (req, res) => {
  const { id } = req.params
  
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id)
  if (!user) {
    return res.status(404).json({ error: 'User not found' })
  }
  
  // Don't allow deleting the last admin
  if (user.role === 'admin') {
    const adminCount = db.prepare('SELECT COUNT(*) as count FROM users WHERE role = ? AND active = 1').get('admin')
    if (adminCount.count <= 1) {
      return res.status(400).json({ error: 'Cannot delete the last admin' })
    }
  }
  
  // Delete user's sessions first
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id)
  db.prepare('DELETE FROM users WHERE id = ?').run(id)
  
  res.json({ success: true })
})

// ============== DATA ROUTES ==============

app.get('/api/data', requireAuth, (req, res) => {
  try {
    const { data, columns, files } = loadAllData()
    res.json({ data, columns, files })
  } catch (err) {
    res.status(500).json({ error: 'Failed to load data' })
  }
})

// ============== DATA FILE MANAGEMENT ==============

app.get('/api/files', requireAuth, (req, res) => {
  try {
    const files = db.prepare(`
      SELECT df.*, u.username as uploaded_by_name
      FROM data_files df
      LEFT JOIN users u ON df.uploaded_by = u.id
      ORDER BY df.created_at DESC
    `).all()
    res.json({ files })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.post('/api/files/upload', requireAuth, upload.single('file'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' })
    }
    
    const filePath = req.file.path
    const stats = analyzeFile(filePath)
    
    // Check for schema differences with existing data
    const { columns: existingColumns } = loadAllData()
    const newColumns = stats.columns.filter(c => !existingColumns.includes(c))
    const missingColumns = existingColumns.filter(c => !stats.columns.includes(c))
    
    // Insert file record
    const result = db.prepare(`
      INSERT INTO data_files (filename, original_name, file_path, file_size, row_count, columns, date_range_start, date_range_end, uploaded_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      req.file.filename,
      req.file.originalname,
      filePath,
      req.file.size,
      stats.rowCount,
      JSON.stringify(stats.columns),
      stats.dateRangeStart,
      stats.dateRangeEnd,
      req.user.user_id
    )
    
    // Invalidate cache so next load includes new file
    invalidateCache()
    
    res.json({
      file: {
        id: result.lastInsertRowid,
        filename: req.file.filename,
        original_name: req.file.originalname,
        row_count: stats.rowCount,
        columns: stats.columns,
        date_range_start: stats.dateRangeStart,
        date_range_end: stats.dateRangeEnd
      },
      schema: {
        newColumns,
        missingColumns,
        hasChanges: newColumns.length > 0 || missingColumns.length > 0
      }
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.delete('/api/files/:id', requireAuth, requireAdmin, (req, res) => {
  try {
    const { id } = req.params
    const file = db.prepare('SELECT * FROM data_files WHERE id = ?').get(id)
    
    if (!file) {
      return res.status(404).json({ error: 'File not found' })
    }
    
    // Soft delete - just mark as inactive
    db.prepare('UPDATE data_files SET active = 0 WHERE id = ?').run(id)
    
    // Optionally delete the physical file
    if (req.query.deleteFile === 'true' && fs.existsSync(file.file_path)) {
      fs.unlinkSync(file.file_path)
    }
    
    invalidateCache()
    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.put('/api/files/:id/restore', requireAuth, requireAdmin, (req, res) => {
  try {
    const { id } = req.params
    db.prepare('UPDATE data_files SET active = 1 WHERE id = ?').run(id)
    invalidateCache()
    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.get('/api/files/:id/preview', requireAuth, (req, res) => {
  try {
    const { id } = req.params
    const file = db.prepare('SELECT * FROM data_files WHERE id = ?').get(id)
    
    if (!file) {
      return res.status(404).json({ error: 'File not found' })
    }
    
    const { data, columns } = loadDataFromFile(file.file_path)
    res.json({
      file,
      preview: data.slice(0, 100), // First 100 rows
      columns,
      totalRows: data.length
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Get merged schema info
app.get('/api/schema', requireAuth, (req, res) => {
  try {
    const files = db.prepare('SELECT * FROM data_files WHERE active = 1').all()
    const allColumns = new Set()
    const columnSources = {}
    
    files.forEach(file => {
      const cols = JSON.parse(file.columns || '[]')
      cols.forEach(col => {
        allColumns.add(col)
        if (!columnSources[col]) columnSources[col] = []
        columnSources[col].push(file.original_name)
      })
    })
    
    res.json({
      columns: Array.from(allColumns),
      columnSources,
      fileCount: files.length
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ============== AI CHAT ==============

app.post('/api/chat', requireAuth, async (req, res) => {
  try {
    const { message } = req.body
    
    if (!message) {
      return res.status(400).json({ error: 'Message required' })
    }
    
    if (!OPENAI_API_KEY) {
      return res.status(503).json({ error: 'AI chat not configured. Set OPENAI_API_KEY environment variable.' })
    }
    
    // Load current data for context
    const { data, columns } = loadAllData()
    
    // Build data summary for AI context
    const dataSummary = buildDataSummary(data, columns)
    
    // Build the prompt
    const systemPrompt = `You are an AI assistant for a call center analytics dashboard called "CallPulse". You help users analyze and understand their call data.

Current data summary:
${dataSummary}

Available columns: ${columns.join(', ')}

You can help users with:
1. Filtering and searching data (e.g., "show calls from California", "find calls over 5 minutes")
2. Statistical analysis (e.g., "what's the average call duration", "busiest time of day")
3. Caller insights (e.g., "summarize this caller's history", "repeat callers")
4. Trends and patterns (e.g., "call volume trends", "which states have most calls")

When answering:
- Be concise but helpful
- Provide specific numbers when available
- Suggest related insights when relevant
- If you need to filter data, explain what filter criteria would help
- Format numbers nicely (use commas for thousands)

Important: You have access to the actual data. Perform real calculations and provide accurate answers.`

    // Call OpenAI API
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: message }
        ],
        temperature: 0.7,
        max_tokens: 1000
      })
    })
    
    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.error?.message || 'OpenAI API error')
    }
    
    const aiResponse = await response.json()
    const assistantMessage = aiResponse.choices[0]?.message?.content || 'I could not generate a response.'
    
    // Extract any suggested filters from the response
    const suggestedFilters = extractFiltersFromResponse(assistantMessage, columns)
    
    // Save to chat history
    db.prepare('INSERT INTO chat_history (user_id, message, response) VALUES (?, ?, ?)').run(
      req.user.user_id,
      message,
      assistantMessage
    )
    
    res.json({
      response: assistantMessage,
      suggestedFilters,
      dataContext: {
        totalRecords: data.length,
        columns: columns.length
      }
    })
  } catch (err) {
    console.error('Chat error:', err)
    res.status(500).json({ error: err.message })
  }
})

// Advanced AI query that returns actual data
app.post('/api/chat/query', requireAuth, async (req, res) => {
  try {
    const { message } = req.body
    
    if (!OPENAI_API_KEY) {
      return res.status(503).json({ error: 'AI chat not configured' })
    }
    
    const { data, columns } = loadAllData()
    
    // Ask AI to generate a filter function
    const systemPrompt = `You are a data query assistant. Given a natural language query about call data, generate a JavaScript filter function.

Available columns: ${columns.join(', ')}

Sample row: ${JSON.stringify(data[0] || {})}

Respond with ONLY a valid JSON object in this format:
{
  "filters": { "column_name": "value_to_match" },
  "sort": { "column": "column_name", "direction": "asc|desc" },
  "aggregation": null | { "type": "count|sum|avg|max|min", "column": "column_name", "groupBy": "column_name" },
  "explanation": "Brief explanation of what you're doing"
}

Examples:
- "calls from California" → { "filters": { "CallerState": "CA" }, "explanation": "Filtering calls where state is California" }
- "longest calls" → { "filters": {}, "sort": { "column": "CallDuration", "direction": "desc" }, "explanation": "Sorting by call duration descending" }
- "calls per state" → { "aggregation": { "type": "count", "groupBy": "CallerState" }, "explanation": "Counting calls grouped by state" }`

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: message }
        ],
        temperature: 0.3,
        max_tokens: 500
      })
    })
    
    const aiResponse = await response.json()
    const content = aiResponse.choices[0]?.message?.content || '{}'
    
    // Parse the AI response
    let querySpec
    try {
      // Extract JSON from response (in case there's extra text)
      const jsonMatch = content.match(/\{[\s\S]*\}/)
      querySpec = JSON.parse(jsonMatch ? jsonMatch[0] : content)
    } catch (e) {
      return res.json({ error: 'Could not parse query', raw: content })
    }
    
    // Apply the query
    let result = [...data]
    
    // Apply filters
    if (querySpec.filters) {
      for (const [col, val] of Object.entries(querySpec.filters)) {
        if (col && val !== undefined) {
          const valLower = String(val).toLowerCase()
          result = result.filter(row => {
            const rowVal = String(row[col] || '').toLowerCase()
            return rowVal.includes(valLower) || rowVal === valLower
          })
        }
      }
    }
    
    // Apply sort
    if (querySpec.sort?.column) {
      const { column, direction } = querySpec.sort
      result.sort((a, b) => {
        const aVal = a[column] || ''
        const bVal = b[column] || ''
        const numA = parseFloat(aVal)
        const numB = parseFloat(bVal)
        
        if (!isNaN(numA) && !isNaN(numB)) {
          return direction === 'desc' ? numB - numA : numA - numB
        }
        return direction === 'desc' ? String(bVal).localeCompare(String(aVal)) : String(aVal).localeCompare(String(bVal))
      })
    }
    
    // Apply aggregation
    let aggregationResult = null
    if (querySpec.aggregation) {
      const { type, column, groupBy } = querySpec.aggregation
      
      if (groupBy) {
        const groups = {}
        result.forEach(row => {
          const key = row[groupBy] || 'Unknown'
          if (!groups[key]) groups[key] = []
          groups[key].push(row)
        })
        
        aggregationResult = Object.entries(groups).map(([key, rows]) => {
          let value
          switch (type) {
            case 'count': value = rows.length; break
            case 'sum': value = rows.reduce((s, r) => s + (parseFloat(r[column]) || 0), 0); break
            case 'avg': value = rows.reduce((s, r) => s + (parseFloat(r[column]) || 0), 0) / rows.length; break
            case 'max': value = Math.max(...rows.map(r => parseFloat(r[column]) || 0)); break
            case 'min': value = Math.min(...rows.map(r => parseFloat(r[column]) || 0)); break
            default: value = rows.length
          }
          return { [groupBy]: key, [type]: Math.round(value * 100) / 100 }
        }).sort((a, b) => b[type] - a[type])
      }
    }
    
    res.json({
      query: querySpec,
      resultCount: result.length,
      results: result.slice(0, 100), // Limit results
      aggregation: aggregationResult,
      explanation: querySpec.explanation
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.get('/api/chat/history', requireAuth, (req, res) => {
  try {
    const history = db.prepare(`
      SELECT * FROM chat_history 
      WHERE user_id = ? 
      ORDER BY created_at DESC 
      LIMIT 50
    `).all(req.user.user_id)
    res.json({ history })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Helper functions for AI
function buildDataSummary(data, columns) {
  if (data.length === 0) return 'No data loaded.'
  
  const summary = []
  summary.push(`Total records: ${data.length.toLocaleString()}`)
  
  // Call outcomes
  const outcomes = {}
  data.forEach(r => { outcomes[r.CallAction || 'Unknown'] = (outcomes[r.CallAction || 'Unknown'] || 0) + 1 })
  summary.push(`Call outcomes: ${Object.entries(outcomes).map(([k, v]) => `${k}: ${v}`).join(', ')}`)
  
  // Top states
  const states = {}
  data.forEach(r => { if (r.CallerState) states[r.CallerState] = (states[r.CallerState] || 0) + 1 })
  const topStates = Object.entries(states).sort(([, a], [, b]) => b - a).slice(0, 5)
  summary.push(`Top states: ${topStates.map(([s, c]) => `${s} (${c})`).join(', ')}`)
  
  // Duration stats
  const durations = data.map(r => parseInt(r.CallDuration) || 0)
  const avgDuration = Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
  const maxDuration = Math.max(...durations)
  summary.push(`Call duration: avg ${Math.floor(avgDuration / 60)}m ${avgDuration % 60}s, max ${Math.floor(maxDuration / 60)}m`)
  
  // Unique callers
  const uniqueCallers = new Set(data.map(r => r.CallerID)).size
  summary.push(`Unique callers: ${uniqueCallers.toLocaleString()}`)
  
  // Date range
  const dates = data.map(r => r.CallStart).filter(Boolean).sort()
  if (dates.length > 0) {
    summary.push(`Date range: ${dates[0]} to ${dates[dates.length - 1]}`)
  }
  
  return summary.join('\n')
}

function extractFiltersFromResponse(response, columns) {
  const filters = {}
  const responseLower = response.toLowerCase()
  
  // Simple pattern matching for common filter suggestions
  const stateMatch = responseLower.match(/filter.*state.*[=:]?\s*["']?([A-Z]{2})["']?/i)
  if (stateMatch && columns.includes('CallerState')) {
    filters.CallerState = stateMatch[1].toUpperCase()
  }
  
  return Object.keys(filters).length > 0 ? filters : null
}

// ============== ENRICHMENT ROUTES ==============

app.post('/api/enrich/carrier', requireAuth, async (req, res) => {
  try {
    const { data } = req.body
    let enrichedCount = 0
    
    const enrichedData = data.map(row => {
      const newRow = { ...row }
      if (!row.CallerCarrier || row.CallerCarrier === 'Not Found') {
        const phone = row.CallerID || ''
        const areaCode = phone.replace(/\D/g, '').slice(0, 3)
        if (areaCodeCarriers[areaCode]) {
          newRow.CallerCarrier = areaCodeCarriers[areaCode]
          enrichedCount++
        } else if (areaCode.length === 3) {
          newRow.CallerCarrier = 'Unknown Carrier'
        }
      }
      return newRow
    })
    
    cachedData = enrichedData
    res.json({ data: enrichedData, columns: Object.keys(enrichedData[0] || {}), message: `Enriched carrier for ${enrichedCount} records` })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.post('/api/enrich/geocode', requireAuth, async (req, res) => {
  try {
    const { data } = req.body
    let enrichedCount = 0
    
    const enrichedData = data.map(row => {
      const newRow = { ...row }
      // Always add columns so they show in table
      newRow.Latitude = null
      newRow.Longitude = null
      const state = row.CallerState
      if (state && stateCoordinates[state]) {
        newRow.Latitude = stateCoordinates[state].lat
        newRow.Longitude = stateCoordinates[state].lng
        enrichedCount++
      }
      return newRow
    })
    
    const allColumns = new Set()
    enrichedData.forEach(row => Object.keys(row).forEach(k => allColumns.add(k)))
    cachedData = enrichedData
    cachedColumns = Array.from(allColumns)
    res.json({ data: enrichedData, columns: cachedColumns, message: `Added coordinates for ${enrichedCount} records` })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.post('/api/enrich/timezone', requireAuth, async (req, res) => {
  try {
    const { data } = req.body
    let enrichedCount = 0
    
    const enrichedData = data.map(row => {
      const newRow = { ...row }
      // Always add column so it shows in table
      newRow.CallerTimezone = null
      const state = row.CallerState
      if (state && stateTimezones[state]) {
        newRow.CallerTimezone = stateTimezones[state]
        enrichedCount++
      }
      return newRow
    })
    
    const allColumns = new Set()
    enrichedData.forEach(row => Object.keys(row).forEach(k => allColumns.add(k)))
    cachedData = enrichedData
    cachedColumns = Array.from(allColumns)
    res.json({ data: enrichedData, columns: cachedColumns, message: `Added timezone for ${enrichedCount} records` })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ============== CA COUNTY ASSESSOR URLS ==============

const caCountyAssessors = {
  'Alameda': 'https://www.acgov.org/assessor/search/',
  'Alpine': 'https://www.alpinecountyca.gov/192/Assessor',
  'Amador': 'https://www.amadorgov.org/government/assessor',
  'Butte': 'https://www.buttecounty.net/assessor',
  'Calaveras': 'https://assessor.calaverasgov.us/',
  'Colusa': 'https://www.countyofcolusa.org/148/Assessor',
  'Contra Costa': 'https://www.contracosta.ca.gov/191/Assessor',
  'Del Norte': 'https://www.dnco.org/departments/assessor/',
  'El Dorado': 'https://www.edcgov.us/Government/Assessor',
  'Fresno': 'https://www.fresnocountyca.gov/Departments/Assessor-Recorder',
  'Glenn': 'https://www.countyofglenn.net/dept/assessor',
  'Humboldt': 'https://humboldtgov.org/186/Assessor',
  'Imperial': 'https://assessor.imperialcounty.org/',
  'Inyo': 'https://www.inyocounty.us/services/assessor',
  'Kern': 'https://assessor.kerncounty.com/',
  'Kings': 'https://www.countyofkings.com/departments/finance/assessor',
  'Lake': 'https://www.lakecountyca.gov/Government/Directory/Assessor_Recorder.htm',
  'Lassen': 'https://www.lassencounty.org/dept/assessor/assessor.htm',
  'Los Angeles': 'https://portal.assessor.lacounty.gov/',
  'Madera': 'https://www.maderacounty.com/government/assessor',
  'Marin': 'https://www.marincounty.org/depts/ar',
  'Mariposa': 'https://www.mariposacounty.org/167/Assessor-Recorder',
  'Mendocino': 'https://www.mendocinocounty.org/government/assessor-county-clerk-recorder',
  'Merced': 'https://www.co.merced.ca.us/96/Assessor',
  'Modoc': 'https://www.modoccounty.us/assessor/',
  'Mono': 'https://monocounty.ca.gov/assessor',
  'Monterey': 'https://www.co.monterey.ca.us/government/departments-a-h/assessor',
  'Napa': 'https://www.countyofnapa.org/197/Assessor',
  'Nevada': 'https://www.mynevadacounty.com/188/Assessor',
  'Orange': 'https://www.ocassessor.gov/',
  'Placer': 'https://www.placer.ca.gov/1573/Assessor',
  'Plumas': 'https://www.plumascounty.us/138/Assessor',
  'Riverside': 'https://www.asrclkrec.com/',
  'Sacramento': 'https://assessor.saccounty.gov/',
  'San Benito': 'https://www.cosb.us/departments/assessor',
  'San Bernardino': 'https://www.sbcounty.gov/assessor/',
  'San Diego': 'https://arcc.sdcounty.ca.gov/',
  'San Francisco': 'https://sfassessor.org/',
  'San Joaquin': 'https://www.sjgov.org/department/assessor',
  'San Luis Obispo': 'https://www.slocounty.ca.gov/Departments/Assessor.aspx',
  'San Mateo': 'https://www.smcacre.org/',
  'Santa Barbara': 'https://www.countyofsb.org/505/Assessor',
  'Santa Clara': 'https://www.sccassessor.org/',
  'Santa Cruz': 'https://www.co.santa-cruz.ca.us/Departments/AssessorHome.aspx',
  'Shasta': 'https://www.shastacounty.gov/assessor',
  'Sierra': 'https://www.sierracounty.ca.gov/149/Assessor',
  'Siskiyou': 'https://www.co.siskiyou.ca.us/assessor',
  'Solano': 'https://www.solanocounty.com/depts/assessor/',
  'Sonoma': 'https://sonomacounty.ca.gov/administrative-support-and-fiscal-services/clerk-recorder-assessor-registrar-of-voters',
  'Stanislaus': 'https://www.stancounty.com/assessor/',
  'Sutter': 'https://www.suttercounty.org/government/county-departments/assessor',
  'Tehama': 'https://www.tehamacountyca.gov/government/assessor',
  'Trinity': 'https://www.trinitycounty.org/Assessor',
  'Tulare': 'https://tularecounty.ca.gov/assessor/',
  'Tuolumne': 'https://www.tuolumnecounty.ca.gov/175/Assessor',
  'Ventura': 'https://assessor.countyofventura.org/',
  'Yolo': 'https://www.yolocounty.org/government/general-government-departments/assessor',
  'Yuba': 'https://www.yuba.org/departments/assessor/'
}

function buildZillowUrl(address, city, state, zip) {
  if (!address || address === 'Not Found') return null
  const query = encodeURIComponent(`${address}, ${city}, ${state} ${zip}`.trim())
  return `https://www.zillow.com/homes/${query}_rb/`
}

app.post('/api/enrich/property-links', requireAuth, async (req, res) => {
  try {
    const { data } = req.body
    
    // Need county data for assessor links
    const boeData = await fetchBOEData()
    
    let enrichedCount = 0
    const enrichedData = data.map(row => {
      const newRow = { ...row }
      
      // Always add columns (empty if no data) so they show in table
      newRow.ZillowLink = null
      newRow.CountyAssessorLink = null
      
      // Add Zillow link if address exists
      const hasAddress = row.CallerAddress && row.CallerAddress !== 'Not Found'
      if (hasAddress) {
        newRow.ZillowLink = buildZillowUrl(row.CallerAddress, row.CallerCity, row.CallerState, row.CallerZip)
        enrichedCount++
      }
      
      // Add County Assessor link for CA callers
      if (row.CallerState === 'CA') {
        const city = (row.CallerCity || '').toUpperCase()
        const county = row.CallerCounty || boeData.cityToCounty[city]
        if (county && caCountyAssessors[county]) {
          newRow.CallerCounty = county
          newRow.CountyAssessorLink = caCountyAssessors[county]
        }
      }
      
      return newRow
    })
    
    // Get all unique columns across all rows
    const allColumns = new Set()
    enrichedData.forEach(row => Object.keys(row).forEach(k => allColumns.add(k)))
    
    cachedData = enrichedData
    cachedColumns = Array.from(allColumns)
    res.json({ 
      data: enrichedData, 
      columns: cachedColumns, 
      message: `Added property links for ${enrichedCount} records with addresses` 
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ============== CA BOE DATA CACHE ==============

let boeDataCache = {
  cityToCounty: null,
  countyTaxRates: null,
  lastFetched: null
}

async function fetchBOEData() {
  // Return cache if less than 24 hours old
  if (boeDataCache.lastFetched && (Date.now() - boeDataCache.lastFetched) < 24 * 60 * 60 * 1000) {
    return boeDataCache
  }

  console.log('Fetching CA BOE data...')
  
  try {
    // Fetch city-to-county mapping (get latest year)
    const cityRes = await fetch('https://boe.ca.gov/DataPortal/api/odata/Assessed_Property_Values_by_City?$orderby=AssessmentYearTo%20desc&$top=5000')
    const cityData = await cityRes.json()
    
    // Build city-to-county map (use latest year for each city)
    const cityToCounty = {}
    const cityValues = {}
    for (const row of cityData.value) {
      const cityKey = row.City.toUpperCase()
      if (!cityToCounty[cityKey]) {
        cityToCounty[cityKey] = row.County
        cityValues[cityKey] = row.LocallyAssessedValue
      }
    }
    
    // Fetch county tax rates (get latest year)
    const taxRes = await fetch('https://boe.ca.gov/DataPortal/api/odata/Property_Tax_Allocations?$orderby=AssessmentYearTo%20desc&$top=200')
    const taxData = await taxRes.json()
    
    // Build county tax rate map
    const countyTaxRates = {}
    for (const row of taxData.value) {
      const countyKey = row.County.toUpperCase()
      if (!countyTaxRates[countyKey]) {
        countyTaxRates[countyKey] = {
          avgTaxRate: row.AverageTaxRate,
          netAssessedValue: row.NetTaxableAssessedValue,
          totalLevies: row.TotalPropertyTaxAllocationsandLevies,
          year: `${row.AssessmentYearFrom}-${row.AssessmentYearTo}`
        }
      }
    }
    
    boeDataCache = {
      cityToCounty,
      cityValues,
      countyTaxRates,
      lastFetched: Date.now()
    }
    
    console.log(`Cached ${Object.keys(cityToCounty).length} cities, ${Object.keys(countyTaxRates).length} counties`)
    return boeDataCache
    
  } catch (err) {
    console.error('Failed to fetch BOE data:', err.message)
    throw err
  }
}

app.post('/api/enrich/property-tax', requireAuth, async (req, res) => {
  try {
    const { data } = req.body
    
    // Fetch/use cached BOE data
    const boeData = await fetchBOEData()
    
    let enrichedCount = 0
    const enrichedData = data.map(row => {
      const newRow = { ...row }
      
      // Always add columns (empty if no data) so they show in table
      newRow.CallerCounty = newRow.CallerCounty || null
      newRow.PropertyTaxRate = null
      newRow.CountyAssessedValue = null
      newRow.TaxDataYear = null
      
      // Only enrich CA callers
      if (row.CallerState !== 'CA') return newRow
      
      const city = (row.CallerCity || '').toUpperCase()
      const county = boeData.cityToCounty[city]
      
      if (county) {
        newRow.CallerCounty = county
        
        const countyKey = county.toUpperCase()
        const taxInfo = boeData.countyTaxRates[countyKey]
        
        if (taxInfo) {
          newRow.PropertyTaxRate = taxInfo.avgTaxRate
          newRow.CountyAssessedValue = taxInfo.netAssessedValue
          newRow.TaxDataYear = taxInfo.year
          enrichedCount++
        }
      }
      
      return newRow
    })
    
    // Get all unique columns across all rows
    const allColumns = new Set()
    enrichedData.forEach(row => Object.keys(row).forEach(k => allColumns.add(k)))
    
    cachedData = enrichedData
    cachedColumns = Array.from(allColumns)
    res.json({ 
      data: enrichedData, 
      columns: cachedColumns, 
      message: `Added CA property tax data for ${enrichedCount} records (CA callers only)` 
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

// Serve frontend for all other routes (SPA catch-all)
if (NODE_ENV === 'production') {
  app.get('/{*splat}', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/dist/index.html'))
  })
}

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT} (${NODE_ENV})`)
  try { loadAllData() } catch (err) { console.error('Warning: Could not pre-load data:', err.message) }
})
