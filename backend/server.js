const express = require('express')
const cors = require('cors')
const fs = require('fs')
const path = require('path')
const Papa = require('papaparse')
const crypto = require('crypto')
const Database = require('better-sqlite3')
const bcrypt = require('bcryptjs')

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

// Serve static frontend in production
if (NODE_ENV === 'production') {
  const frontendPath = path.join(__dirname, '../frontend/dist')
  app.use(express.static(frontendPath))
}

// Initialize SQLite database
const db = new Database(DB_PATH)
db.pragma('journal_mode = WAL')

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

// Load CSV data
let cachedData = null
let cachedColumns = null

function loadData() {
  if (cachedData) return { data: cachedData, columns: cachedColumns }
  const csvContent = fs.readFileSync(DATA_FILE, 'utf-8')
  const parsed = Papa.parse(csvContent, { header: true, skipEmptyLines: true })
  cachedData = parsed.data
  cachedColumns = parsed.meta.fields
  console.log(`Loaded ${cachedData.length} records with ${cachedColumns.length} columns`)
  return { data: cachedData, columns: cachedColumns }
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
    const { data, columns } = loadData()
    res.json({ data, columns })
  } catch (err) {
    res.status(500).json({ error: 'Failed to load data' })
  }
})

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
      const state = row.CallerState
      if (state && stateCoordinates[state]) {
        newRow.Latitude = stateCoordinates[state].lat
        newRow.Longitude = stateCoordinates[state].lng
        enrichedCount++
      }
      return newRow
    })
    
    cachedData = enrichedData
    cachedColumns = Object.keys(enrichedData[0] || {})
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
      const state = row.CallerState
      if (state && stateTimezones[state]) {
        newRow.CallerTimezone = stateTimezones[state]
        enrichedCount++
      }
      return newRow
    })
    
    cachedData = enrichedData
    cachedColumns = Object.keys(enrichedData[0] || {})
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
    
    cachedData = enrichedData
    cachedColumns = Object.keys(enrichedData[0] || {})
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
    
    cachedData = enrichedData
    cachedColumns = Object.keys(enrichedData[0] || {})
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
  try { loadData() } catch (err) { console.error('Warning: Could not pre-load data:', err.message) }
})
