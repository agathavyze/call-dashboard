# CallPulse

> Intelligent Call Center Analytics Dashboard with AI Insights

![Version](https://img.shields.io/badge/version-2.0.0-blue)
![License](https://img.shields.io/badge/license-MIT-green)

## Features

### 📊 Analytics Dashboard
- Real-time call metrics and KPIs
- Interactive charts (calls over time, top states, outcomes, duration distribution)
- Smart search with autocomplete across all fields
- Advanced filtering with saved filter presets
- Date range filtering
- CSV and PDF export

### 🤖 AI Chat Assistant
Ask questions about your call data in natural language:
- "Show me all calls from California"
- "What's the busiest time of day?"
- "Average call duration by state"
- "Who are the top repeat callers?"

### 📁 Data File Management
- Upload multiple CSV/TSV files
- Automatic schema detection and merging
- View file statistics (rows, columns, date ranges)
- Remove/restore data sources
- Intelligent column union (handles different schemas)

### 🗺️ Geographic Mapping
- Visualize call locations on interactive map
- Aggregate by region
- State-level geocoding

### 🔧 Data Enrichment
- Carrier lookup
- Geocoding (lat/lng from state)
- Timezone detection
- CA property tax data
- Zillow and County Assessor links

### 👥 User Management
- Role-based access (Admin/User)
- Session management
- User CRUD for admins

## Tech Stack

- **Frontend**: React 19, Vite, Tailwind CSS, Recharts, Leaflet
- **Backend**: Express.js, SQLite (better-sqlite3)
- **AI**: OpenAI GPT-4o-mini

## Getting Started

### Prerequisites
- Node.js 18+
- OpenAI API key (optional, for AI chat)

### Installation

```bash
# Clone the repo
git clone <repo-url>
cd call-dashboard

# Install dependencies
npm run postinstall

# Copy environment file
cp .env.example .env

# Edit .env with your settings
nano .env
```

### Configuration

Edit `.env`:
```env
PORT=3457
ADMIN_PASSWORD=your-secure-password
OPENAI_API_KEY=sk-your-key-here  # Optional, for AI chat
```

### Running

```bash
# Development (concurrent frontend + backend)
npm run dev

# Production
npm run build
npm start
```

Visit `http://localhost:3457`

### Default Login
- Username: `admin`
- Password: (set in .env as ADMIN_PASSWORD, default: `admin123`)

## Data Format

Upload CSV/TSV files with call data. Expected columns:
- `CallID` - Unique call identifier
- `CallerID` - Phone number
- `CallerName` - Caller name
- `CallerCity`, `CallerState`, `CallerZip` - Location
- `CallStart`, `CallEnd` - Timestamps
- `CallDuration` - Duration in seconds
- `CallAction` - Outcome (Answer, Hangup, etc.)

Files with different columns are merged automatically.

## API Endpoints

### Auth
- `POST /api/auth` - Login
- `POST /api/auth/logout` - Logout
- `GET /api/auth/me` - Current user

### Data
- `GET /api/data` - Get all call data
- `GET /api/files` - List data files
- `POST /api/files/upload` - Upload new file
- `DELETE /api/files/:id` - Remove file
- `GET /api/schema` - Get merged schema info

### AI Chat
- `POST /api/chat` - Send message to AI assistant
- `POST /api/chat/query` - Execute AI-generated data query
- `GET /api/chat/history` - Get chat history

### Enrichment
- `POST /api/enrich/carrier` - Add carrier info
- `POST /api/enrich/geocode` - Add coordinates
- `POST /api/enrich/timezone` - Add timezone
- `POST /api/enrich/property-tax` - Add CA tax data
- `POST /api/enrich/property-links` - Add Zillow/Assessor links

## Screenshots

### Dashboard Overview
The main dashboard with KPIs and charts.

### AI Chat
Natural language queries about your data.

### Data Management
Upload and manage multiple data sources.

## License

MIT
