import { useState, useEffect, useMemo, useRef } from 'react'
import Papa from 'papaparse'
import { 
  BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  AreaChart, Area
} from 'recharts'
import { 
  Search, Filter, Download, Upload, Phone, Clock, MapPin, 
  Users, PhoneCall, PhoneMissed, ChevronDown,
  ChevronUp, X, Lock, Eye, EyeOff, BarChart3, Table, Settings,
  Map, Calendar, Save, FileText, Sun, Moon, Loader2, CheckCircle,
  AlertCircle, Bookmark, Trash2, Building2, ExternalLink, MessageSquare,
  Send, Database, FolderOpen, Plus, RefreshCw, Zap, Brain, Sparkles,
  FileUp, HardDrive, Columns, AlertTriangle, Activity
} from 'lucide-react'
import { MapContainer, TileLayer, CircleMarker, Popup } from 'react-leaflet'
import { format, parse, isWithinInterval, startOfDay, endOfDay } from 'date-fns'
import jsPDF from 'jspdf'
import html2canvas from 'html2canvas'
import 'leaflet/dist/leaflet.css'

const COLORS = ['#6366f1', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16']
const BRAND_COLOR = '#6366f1' // Indigo

// Search categories
const SEARCH_CATEGORIES = {
  phone: { label: 'Phone Numbers', icon: Phone, fields: ['CallerID', 'Number', 'Destination'] },
  name: { label: 'Names', icon: Users, fields: ['CallerName', 'TeleCaptureName'] },
  location: { label: 'Locations', icon: MapPin, fields: ['CallerCity', 'CallerState', 'CallerAddress', 'CallerZip'] },
  carrier: { label: 'Carriers', icon: Phone, fields: ['CallerCarrier'] },
  action: { label: 'Call Status', icon: PhoneCall, fields: ['CallAction', 'NoCallStatus'] }
}

// Dark mode hook
function useDarkMode() {
  const [dark, setDark] = useState(() => {
    const saved = localStorage.getItem('darkMode')
    return saved ? JSON.parse(saved) : window.matchMedia('(prefers-color-scheme: dark)').matches
  })

  useEffect(() => {
    localStorage.setItem('darkMode', JSON.stringify(dark))
    document.documentElement.classList.toggle('dark', dark)
  }, [dark])

  return [dark, setDark]
}

// Logo Component
function Logo({ size = 'md' }) {
  const sizes = { sm: 'w-6 h-6', md: 'w-8 h-8', lg: 'w-12 h-12' }
  const textSizes = { sm: 'text-lg', md: 'text-xl', lg: 'text-3xl' }
  
  return (
    <div className="flex items-center gap-2">
      <div className={`${sizes[size]} bg-gradient-to-br from-indigo-500 to-purple-600 rounded-lg flex items-center justify-center shadow-lg`}>
        <Activity className={`${size === 'lg' ? 'w-7 h-7' : 'w-5 h-5'} text-white`} />
      </div>
      <span className={`${textSizes[size]} font-bold bg-gradient-to-r from-indigo-600 to-purple-600 dark:from-indigo-400 dark:to-purple-400 bg-clip-text text-transparent`}>
        CallPulse
      </span>
    </div>
  )
}

// Smart Search Component
function SmartSearch({ data, onSearch, onSelect }) {
  const [query, setQuery] = useState('')
  const [isOpen, setIsOpen] = useState(false)

  const searchResults = useMemo(() => {
    if (!query || query.length < 2) return null
    const q = query.toLowerCase()
    const results = {}
    const seen = {}

    Object.entries(SEARCH_CATEGORIES).forEach(([catKey, cat]) => {
      results[catKey] = []
      seen[catKey] = new Set()

      data.forEach(row => {
        cat.fields.forEach(field => {
          const value = row[field]
          if (value && String(value).toLowerCase().includes(q)) {
            const strVal = String(value)
            if (!seen[catKey].has(strVal.toLowerCase())) {
              seen[catKey].add(strVal.toLowerCase())
              results[catKey].push({
                value: strVal,
                field,
                count: data.filter(r => r[field] === value).length
              })
            }
          }
        })
      })
      results[catKey] = results[catKey].sort((a, b) => b.count - a.count).slice(0, 5)
    })

    return Object.fromEntries(Object.entries(results).filter(([_, items]) => items.length > 0))
  }, [query, data])

  const hasResults = searchResults && Object.keys(searchResults).length > 0

  const handleSelect = (category, item) => {
    setQuery(item.value)
    setIsOpen(false)
    onSelect({ category, field: item.field, value: item.value })
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Escape') setIsOpen(false)
    else if (e.key === 'Enter' && query) { setIsOpen(false); onSearch(query) }
  }

  return (
    <div className="relative">
      <div className="relative">
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          type="text"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setIsOpen(true); onSearch(e.target.value) }}
          onFocus={() => query.length >= 2 && setIsOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder="Search phones, names, locations..."
          className="pl-9 pr-8 py-2 w-80 bg-slate-100 dark:bg-slate-700 border-0 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
        {query && (
          <button onClick={() => { setQuery(''); onSearch('') }} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {isOpen && hasResults && (
        <div className="absolute top-full left-0 right-0 mt-2 bg-white dark:bg-slate-800 rounded-lg shadow-xl border border-slate-200 dark:border-slate-700 max-h-96 overflow-y-auto z-50">
          {Object.entries(searchResults).map(([catKey, items]) => {
            const cat = SEARCH_CATEGORIES[catKey]
            const Icon = cat.icon
            return (
              <div key={catKey} className="border-b border-slate-100 dark:border-slate-700 last:border-0">
                <div className="px-3 py-2 bg-slate-50 dark:bg-slate-700/50 flex items-center gap-2">
                  <Icon className="w-4 h-4 text-slate-500" />
                  <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">{cat.label}</span>
                </div>
                {items.map((item, i) => (
                  <button key={i} onClick={() => handleSelect(catKey, item)}
                    className="w-full px-4 py-2 text-left hover:bg-indigo-50 dark:hover:bg-slate-700 flex items-center justify-between">
                    <span className="text-sm text-slate-700 dark:text-slate-300">
                      <HighlightMatch text={item.value} query={query} />
                    </span>
                    <span className="text-xs text-slate-400">{item.count} records</span>
                  </button>
                ))}
              </div>
            )
          })}
        </div>
      )}

      {isOpen && query.length >= 2 && !hasResults && (
        <div className="absolute top-full left-0 right-0 mt-2 bg-white dark:bg-slate-800 rounded-lg shadow-xl border p-4 z-50">
          <p className="text-sm text-slate-500 text-center">No results for "{query}"</p>
        </div>
      )}

      {isOpen && <div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)} />}
    </div>
  )
}

function HighlightMatch({ text, query }) {
  if (!query) return text
  const parts = String(text).split(new RegExp(`(${query})`, 'gi'))
  return <>{parts.map((part, i) => part.toLowerCase() === query.toLowerCase() 
    ? <mark key={i} className="bg-yellow-200 dark:bg-yellow-500/30 rounded px-0.5">{part}</mark> 
    : part)}</>
}

// Login Screen
function LoginScreen({ onLogin }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      })
      if (res.ok) {
        const { token, user } = await res.json()
        localStorage.setItem('auth_token', token)
        localStorage.setItem('user', JSON.stringify(user))
        onLogin(token, user)
      } else {
        const data = await res.json()
        setError(data.error || 'Invalid credentials')
      }
    } catch (err) {
      setError('Connection error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-900 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjAiIGhlaWdodD0iNjAiIHZpZXdCb3g9IjAgMCA2MCA2MCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48ZyBmaWxsPSJub25lIiBmaWxsLXJ1bGU9ImV2ZW5vZGQiPjxnIGZpbGw9IiNmZmYiIGZpbGwtb3BhY2l0eT0iMC4wMyI+PGNpcmNsZSBjeD0iMzAiIGN5PSIzMCIgcj0iMiIvPjwvZz48L2c+PC9zdmc+')] opacity-50" />
      <div className="relative bg-white/10 backdrop-blur-lg rounded-2xl p-8 w-full max-w-md border border-white/20 shadow-2xl">
        <div className="text-center mb-8">
          <div className="flex justify-center mb-4">
            <Logo size="lg" />
          </div>
          <p className="text-slate-400 mt-2">Call Center Analytics Dashboard</p>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="mb-4">
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Username"
              className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          <div className="relative">
            <input
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
              className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white">
              {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
            </button>
          </div>
          {error && <p className="text-red-400 text-sm mt-2">{error}</p>}
          <button type="submit" disabled={loading} className="w-full mt-6 py-3 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 disabled:opacity-50 text-white font-medium rounded-lg transition-all flex items-center justify-center gap-2 shadow-lg">
            {loading && <Loader2 className="w-4 h-4 animate-spin" />}
            Sign In
          </button>
        </form>
      </div>
    </div>
  )
}

// AI Chat Panel
function AIChatPanel({ data, columns }) {
  const [messages, setMessages] = useState([
    { role: 'assistant', content: 'Hi! I\'m your AI assistant for CallPulse. Ask me anything about your call data - like "What\'s the busiest time of day?" or "Show me all calls from California".' }
  ])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const messagesEndRef = useRef(null)
  const token = localStorage.getItem('auth_token')

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  useEffect(scrollToBottom, [messages])

  const sendMessage = async (e) => {
    e?.preventDefault()
    if (!input.trim() || loading) return

    const userMessage = input.trim()
    setInput('')
    setMessages(prev => [...prev, { role: 'user', content: userMessage }])
    setLoading(true)

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ message: userMessage })
      })
      const data = await res.json()
      
      if (res.ok) {
        setMessages(prev => [...prev, { 
          role: 'assistant', 
          content: data.response,
          filters: data.suggestedFilters
        }])
      } else {
        setMessages(prev => [...prev, { 
          role: 'assistant', 
          content: data.error || 'Sorry, I encountered an error. Please try again.',
          isError: true
        }])
      }
    } catch (err) {
      setMessages(prev => [...prev, { 
        role: 'assistant', 
        content: 'Connection error. Please check your internet connection.',
        isError: true
      }])
    } finally {
      setLoading(false)
    }
  }

  const suggestedQueries = [
    "What's the busiest time of day?",
    "Show me calls from California",
    "Average call duration by state",
    "Who are the top repeat callers?"
  ]

  if (!expanded) {
    return (
      <button
        onClick={() => setExpanded(true)}
        className="fixed bottom-6 right-6 w-14 h-14 bg-gradient-to-r from-indigo-600 to-purple-600 rounded-full shadow-lg flex items-center justify-center hover:scale-105 transition-transform z-50"
      >
        <Sparkles className="w-6 h-6 text-white" />
      </button>
    )
  }

  return (
    <div className="fixed bottom-6 right-6 w-96 h-[500px] bg-white dark:bg-slate-800 rounded-2xl shadow-2xl flex flex-col overflow-hidden z-50 border border-slate-200 dark:border-slate-700">
      {/* Header */}
      <div className="px-4 py-3 bg-gradient-to-r from-indigo-600 to-purple-600 text-white flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Brain className="w-5 h-5" />
          <span className="font-semibold">AI Assistant</span>
        </div>
        <button onClick={() => setExpanded(false)} className="hover:bg-white/20 p-1 rounded">
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[85%] rounded-2xl px-4 py-2 ${
              msg.role === 'user' 
                ? 'bg-indigo-600 text-white' 
                : msg.isError 
                  ? 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400'
                  : 'bg-slate-100 dark:bg-slate-700 text-slate-800 dark:text-slate-200'
            }`}>
              <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
              {msg.filters && (
                <div className="mt-2 pt-2 border-t border-slate-200 dark:border-slate-600">
                  <p className="text-xs opacity-70">Suggested filter:</p>
                  <code className="text-xs">{JSON.stringify(msg.filters)}</code>
                </div>
              )}
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex justify-start">
            <div className="bg-slate-100 dark:bg-slate-700 rounded-2xl px-4 py-3">
              <div className="flex gap-1">
                <span className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                <span className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                <span className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Suggestions */}
      {messages.length === 1 && (
        <div className="px-4 pb-2">
          <p className="text-xs text-slate-500 mb-2">Try asking:</p>
          <div className="flex flex-wrap gap-1">
            {suggestedQueries.map((q, i) => (
              <button key={i} onClick={() => setInput(q)}
                className="text-xs px-2 py-1 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 rounded-full hover:bg-indigo-100 dark:hover:bg-indigo-900/50">
                {q}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Input */}
      <form onSubmit={sendMessage} className="p-4 border-t border-slate-200 dark:border-slate-700">
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask about your call data..."
            className="flex-1 px-4 py-2 bg-slate-100 dark:bg-slate-700 rounded-full text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          <button
            type="submit"
            disabled={loading || !input.trim()}
            className="w-10 h-10 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 rounded-full flex items-center justify-center text-white"
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
      </form>
    </div>
  )
}

// Data Files Panel
function DataFilesPanel({ onDataUpdate }) {
  const [files, setFiles] = useState([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [uploadResult, setUploadResult] = useState(null)
  const [showInactive, setShowInactive] = useState(false)
  const fileInputRef = useRef(null)
  const token = localStorage.getItem('auth_token')
  const headers = { 'Authorization': `Bearer ${token}` }

  useEffect(() => { loadFiles() }, [])

  const loadFiles = async () => {
    try {
      const res = await fetch('/api/files', { headers })
      if (res.ok) {
        const data = await res.json()
        setFiles(data.files)
      }
    } catch (err) {
      console.error('Failed to load files:', err)
    } finally {
      setLoading(false)
    }
  }

  const handleFileSelect = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return

    setUploading(true)
    setUploadResult(null)

    const formData = new FormData()
    formData.append('file', file)

    try {
      const res = await fetch('/api/files/upload', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
        body: formData
      })
      const data = await res.json()
      
      if (res.ok) {
        setUploadResult({
          success: true,
          file: data.file,
          schema: data.schema
        })
        loadFiles()
        onDataUpdate?.()
      } else {
        setUploadResult({ success: false, error: data.error })
      }
    } catch (err) {
      setUploadResult({ success: false, error: err.message })
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const handleDelete = async (id) => {
    if (!confirm('Are you sure you want to remove this file from the dataset?')) return
    
    try {
      const res = await fetch(`/api/files/${id}`, {
        method: 'DELETE',
        headers
      })
      if (res.ok) {
        loadFiles()
        onDataUpdate?.()
      }
    } catch (err) {
      console.error('Failed to delete file:', err)
    }
  }

  const handleRestore = async (id) => {
    try {
      const res = await fetch(`/api/files/${id}/restore`, {
        method: 'PUT',
        headers
      })
      if (res.ok) {
        loadFiles()
        onDataUpdate?.()
      }
    } catch (err) {
      console.error('Failed to restore file:', err)
    }
  }

  const formatFileSize = (bytes) => {
    if (!bytes) return '-'
    if (bytes < 1024) return bytes + ' B'
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
  }

  const activeFiles = files.filter(f => f.active)
  const inactiveFiles = files.filter(f => !f.active)
  const totalRows = activeFiles.reduce((sum, f) => sum + (f.row_count || 0), 0)

  return (
    <div className="space-y-6">
      {/* Upload Section */}
      <div className="bg-white dark:bg-slate-800 rounded-xl p-6 shadow-sm border border-slate-200 dark:border-slate-700">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-slate-900 dark:text-white flex items-center gap-2">
            <FileUp className="w-5 h-5 text-indigo-600" />
            Upload Data File
          </h3>
        </div>

        <div
          onClick={() => !uploading && fileInputRef.current?.click()}
          className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors
            ${uploading ? 'border-indigo-300 bg-indigo-50 dark:bg-indigo-900/20' : 'border-slate-300 dark:border-slate-600 hover:border-indigo-400 hover:bg-indigo-50/50 dark:hover:bg-indigo-900/10'}`}
        >
          {uploading ? (
            <div className="flex flex-col items-center">
              <Loader2 className="w-12 h-12 text-indigo-500 animate-spin mb-3" />
              <p className="text-slate-600 dark:text-slate-300">Uploading and analyzing file...</p>
            </div>
          ) : (
            <>
              <Upload className="w-12 h-12 text-slate-400 mx-auto mb-3" />
              <p className="text-slate-600 dark:text-slate-300">Drag & drop a CSV/TSV file or click to browse</p>
              <p className="text-sm text-slate-400 mt-1">Files will be merged with existing data</p>
            </>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,.tsv,.txt"
            onChange={handleFileSelect}
            className="hidden"
          />
        </div>

        {/* Upload Result */}
        {uploadResult && (
          <div className={`mt-4 p-4 rounded-lg ${uploadResult.success ? 'bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800' : 'bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800'}`}>
            {uploadResult.success ? (
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <CheckCircle className="w-5 h-5 text-green-600" />
                  <span className="font-medium text-green-700 dark:text-green-400">File uploaded successfully!</span>
                </div>
                <p className="text-sm text-green-600 dark:text-green-400">
                  {uploadResult.file.original_name} • {uploadResult.file.row_count.toLocaleString()} rows • {uploadResult.file.columns.length} columns
                </p>
                
                {uploadResult.schema?.hasChanges && (
                  <div className="mt-3 pt-3 border-t border-green-200 dark:border-green-800">
                    <p className="text-sm font-medium text-green-700 dark:text-green-400 mb-2 flex items-center gap-1">
                      <Columns className="w-4 h-4" /> Schema Changes Detected
                    </p>
                    {uploadResult.schema.newColumns.length > 0 && (
                      <div className="mb-2">
                        <p className="text-xs text-green-600">New columns added:</p>
                        <div className="flex flex-wrap gap-1 mt-1">
                          {uploadResult.schema.newColumns.map(col => (
                            <span key={col} className="text-xs px-2 py-0.5 bg-green-200 dark:bg-green-800 text-green-800 dark:text-green-200 rounded">
                              + {col}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                    {uploadResult.schema.missingColumns.length > 0 && (
                      <div>
                        <p className="text-xs text-amber-600">Columns not in this file (will be null):</p>
                        <div className="flex flex-wrap gap-1 mt-1">
                          {uploadResult.schema.missingColumns.slice(0, 10).map(col => (
                            <span key={col} className="text-xs px-2 py-0.5 bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 rounded">
                              {col}
                            </span>
                          ))}
                          {uploadResult.schema.missingColumns.length > 10 && (
                            <span className="text-xs text-amber-600">+{uploadResult.schema.missingColumns.length - 10} more</span>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <AlertCircle className="w-5 h-5 text-red-600" />
                <span className="text-red-700 dark:text-red-400">{uploadResult.error}</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Active Files */}
      <div className="bg-white dark:bg-slate-800 rounded-xl p-6 shadow-sm border border-slate-200 dark:border-slate-700">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-slate-900 dark:text-white flex items-center gap-2">
            <Database className="w-5 h-5 text-indigo-600" />
            Active Data Sources
            <span className="text-sm font-normal text-slate-500">({totalRows.toLocaleString()} total rows)</span>
          </h3>
          <button onClick={loadFiles} className="p-2 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg">
            <RefreshCw className="w-4 h-4 text-slate-500" />
          </button>
        </div>

        {loading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="w-8 h-8 animate-spin text-indigo-500" />
          </div>
        ) : activeFiles.length === 0 ? (
          <div className="text-center py-8">
            <FolderOpen className="w-12 h-12 text-slate-300 mx-auto mb-2" />
            <p className="text-slate-500">No data files uploaded yet</p>
            <p className="text-sm text-slate-400">Upload a CSV or TSV file to get started</p>
          </div>
        ) : (
          <div className="space-y-3">
            {activeFiles.map(file => (
              <div key={file.id} className="flex items-center justify-between p-4 bg-slate-50 dark:bg-slate-700/50 rounded-lg">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-indigo-100 dark:bg-indigo-900/30 rounded-lg flex items-center justify-center">
                    <FileText className="w-5 h-5 text-indigo-600" />
                  </div>
                  <div>
                    <p className="font-medium text-slate-900 dark:text-white">{file.original_name}</p>
                    <div className="flex items-center gap-3 text-xs text-slate-500">
                      <span>{file.row_count?.toLocaleString()} rows</span>
                      <span>•</span>
                      <span>{JSON.parse(file.columns || '[]').length} columns</span>
                      <span>•</span>
                      <span>{formatFileSize(file.file_size)}</span>
                      {file.date_range_start && (
                        <>
                          <span>•</span>
                          <span>{file.date_range_start} to {file.date_range_end}</span>
                        </>
                      )}
                    </div>
                  </div>
                </div>
                <button onClick={() => handleDelete(file.id)} className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Inactive Files */}
      {inactiveFiles.length > 0 && (
        <div className="bg-white dark:bg-slate-800 rounded-xl p-6 shadow-sm border border-slate-200 dark:border-slate-700">
          <button
            onClick={() => setShowInactive(!showInactive)}
            className="flex items-center justify-between w-full"
          >
            <h3 className="font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-2">
              <HardDrive className="w-5 h-5 text-slate-400" />
              Removed Files ({inactiveFiles.length})
            </h3>
            <ChevronDown className={`w-5 h-5 text-slate-400 transition-transform ${showInactive ? 'rotate-180' : ''}`} />
          </button>
          
          {showInactive && (
            <div className="mt-4 space-y-2">
              {inactiveFiles.map(file => (
                <div key={file.id} className="flex items-center justify-between p-3 bg-slate-50 dark:bg-slate-700/30 rounded-lg opacity-60">
                  <div className="flex items-center gap-3">
                    <FileText className="w-5 h-5 text-slate-400" />
                    <div>
                      <p className="text-sm text-slate-600 dark:text-slate-400">{file.original_name}</p>
                      <p className="text-xs text-slate-400">{file.row_count?.toLocaleString()} rows</p>
                    </div>
                  </div>
                  <button onClick={() => handleRestore(file.id)} className="text-xs px-3 py-1 bg-slate-200 dark:bg-slate-600 text-slate-600 dark:text-slate-300 rounded hover:bg-slate-300 dark:hover:bg-slate-500">
                    Restore
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// Data Table
function DataTable({ data, columns, filters, setFilters }) {
  const [sortConfig, setSortConfig] = useState({ key: null, direction: 'asc' })
  const [page, setPage] = useState(0)
  const [expandedFilters, setExpandedFilters] = useState(false)
  const [showCharts, setShowCharts] = useState(true)
  const pageSize = 50

  const sortedData = useMemo(() => {
    if (!sortConfig.key) return data
    return [...data].sort((a, b) => {
      const aVal = a[sortConfig.key] || ''
      const bVal = b[sortConfig.key] || ''
      if (aVal < bVal) return sortConfig.direction === 'asc' ? -1 : 1
      if (aVal > bVal) return sortConfig.direction === 'asc' ? 1 : -1
      return 0
    })
  }, [data, sortConfig])

  const paginatedData = sortedData.slice(page * pageSize, (page + 1) * pageSize)
  const totalPages = Math.ceil(data.length / pageSize)

  // Dynamic charts based on filtered data
  const chartData = useMemo(() => {
    // Call outcomes
    const outcomes = {}
    data.forEach(r => { outcomes[r.CallAction || 'Unknown'] = (outcomes[r.CallAction || 'Unknown'] || 0) + 1 })
    const outcomeData = Object.entries(outcomes).map(([name, value]) => ({ name, value }))

    // Top states
    const states = {}
    data.forEach(r => { if (r.CallerState) states[r.CallerState] = (states[r.CallerState] || 0) + 1 })
    const stateData = Object.entries(states).sort(([,a], [,b]) => b - a).slice(0, 8).map(([state, count]) => ({ state, count }))

    // Duration distribution
    const durations = { '0-30s': 0, '30s-1m': 0, '1-5m': 0, '5m+': 0 }
    data.forEach(r => {
      const d = parseInt(r.CallDuration) || 0
      if (d <= 30) durations['0-30s']++
      else if (d <= 60) durations['30s-1m']++
      else if (d <= 300) durations['1-5m']++
      else durations['5m+']++
    })
    const durationData = Object.entries(durations).map(([range, count]) => ({ range, count }))

    // Top callers
    const callers = {}
    data.forEach(r => { 
      const id = r.CallerID || 'Unknown'
      if (!callers[id]) callers[id] = { id, name: r.CallerName || id, count: 0 }
      callers[id].count++
    })
    const topCallers = Object.values(callers).sort((a, b) => b.count - a.count).slice(0, 5)

    // Summary stats
    const answered = data.filter(r => r.CallAction === 'Answer').length
    const totalDuration = data.reduce((s, r) => s + (parseInt(r.CallDuration) || 0), 0)
    const avgDuration = data.length ? Math.round(totalDuration / data.length) : 0
    const uniqueCallers = new Set(data.map(r => r.CallerID)).size

    return { outcomeData, stateData, durationData, topCallers, answered, avgDuration, uniqueCallers }
  }, [data])

  return (
    <div className="space-y-4">
      {/* Summary Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-slate-800 rounded-lg p-4 border border-slate-200 dark:border-slate-700">
          <p className="text-xs text-slate-500 uppercase">Filtered Results</p>
          <p className="text-2xl font-bold text-slate-900 dark:text-white">{data.length.toLocaleString()}</p>
        </div>
        <div className="bg-white dark:bg-slate-800 rounded-lg p-4 border border-slate-200 dark:border-slate-700">
          <p className="text-xs text-slate-500 uppercase">Answer Rate</p>
          <p className="text-2xl font-bold text-green-600">{data.length ? Math.round(chartData.answered / data.length * 100) : 0}%</p>
        </div>
        <div className="bg-white dark:bg-slate-800 rounded-lg p-4 border border-slate-200 dark:border-slate-700">
          <p className="text-xs text-slate-500 uppercase">Avg Duration</p>
          <p className="text-2xl font-bold text-slate-900 dark:text-white">{Math.floor(chartData.avgDuration / 60)}m {chartData.avgDuration % 60}s</p>
        </div>
        <div className="bg-white dark:bg-slate-800 rounded-lg p-4 border border-slate-200 dark:border-slate-700">
          <p className="text-xs text-slate-500 uppercase">Unique Callers</p>
          <p className="text-2xl font-bold text-slate-900 dark:text-white">{chartData.uniqueCallers.toLocaleString()}</p>
        </div>
      </div>

      {/* Toggle Charts */}
      <div className="flex justify-end">
        <button onClick={() => setShowCharts(!showCharts)} className="text-sm text-indigo-600 hover:text-indigo-800 flex items-center gap-1">
          <BarChart3 className="w-4 h-4" /> {showCharts ? 'Hide Charts' : 'Show Charts'}
        </button>
      </div>

      {/* Dynamic Charts */}
      {showCharts && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Outcomes Pie */}
          <div className="bg-white dark:bg-slate-800 rounded-lg p-4 border border-slate-200 dark:border-slate-700">
            <h4 className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Call Outcomes</h4>
            <ResponsiveContainer width="100%" height={150}>
              <PieChart>
                <Pie data={chartData.outcomeData} cx="50%" cy="50%" innerRadius={30} outerRadius={55} dataKey="value" label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`} labelLine={false}>
                  {chartData.outcomeData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </div>

          {/* Top States */}
          <div className="bg-white dark:bg-slate-800 rounded-lg p-4 border border-slate-200 dark:border-slate-700">
            <h4 className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Top States</h4>
            <ResponsiveContainer width="100%" height={150}>
              <BarChart data={chartData.stateData} layout="vertical" margin={{ left: 0, right: 10 }}>
                <XAxis type="number" hide />
                <YAxis dataKey="state" type="category" width={30} tick={{ fontSize: 10 }} />
                <Tooltip />
                <Bar dataKey="count" fill="#22c55e" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Duration Distribution */}
          <div className="bg-white dark:bg-slate-800 rounded-lg p-4 border border-slate-200 dark:border-slate-700">
            <h4 className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Duration</h4>
            <ResponsiveContainer width="100%" height={150}>
              <BarChart data={chartData.durationData}>
                <XAxis dataKey="range" tick={{ fontSize: 10 }} />
                <YAxis hide />
                <Tooltip />
                <Bar dataKey="count" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Top Callers */}
          <div className="bg-white dark:bg-slate-800 rounded-lg p-4 border border-slate-200 dark:border-slate-700">
            <h4 className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Top Callers</h4>
            <div className="space-y-2">
              {chartData.topCallers.map((c, i) => (
                <div key={i} className="flex items-center justify-between text-xs">
                  <span className="text-slate-600 dark:text-slate-400 truncate max-w-[120px]" title={c.name}>{c.name}</span>
                  <span className="font-medium text-slate-900 dark:text-white">{c.count}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 overflow-hidden">
        <div className="p-4 border-b border-slate-200 dark:border-slate-700">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-slate-900 dark:text-white flex items-center gap-2">
              <Table className="w-5 h-5 text-indigo-600" />
              Call Records ({data.length.toLocaleString()} results)
            </h3>
            <button onClick={() => setExpandedFilters(!expandedFilters)}
              className="flex items-center gap-2 px-3 py-1.5 text-sm bg-slate-100 dark:bg-slate-700 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-600">
              <Filter className="w-4 h-4" />Filters {expandedFilters ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>
          </div>
          
          {expandedFilters && (
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3 pt-4 border-t border-slate-200 dark:border-slate-700">
              {columns.filter(c => !c.startsWith('_')).slice(0, 12).map(col => (
                <div key={col}>
                  <label className="block text-xs text-slate-500 mb-1 truncate">{col}</label>
                  <input type="text" value={filters[col] || ''} onChange={(e) => setFilters(prev => ({ ...prev, [col]: e.target.value }))}
                    placeholder="Filter..." className="w-full px-2 py-1.5 text-sm bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded focus:outline-none focus:ring-1 focus:ring-indigo-500" />
                </div>
              ))}
              <div className="col-span-full flex justify-end">
                <button onClick={() => setFilters({})} className="text-sm text-slate-500 hover:text-slate-700">Clear all filters</button>
              </div>
            </div>
          )}
        </div>
        
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 dark:bg-slate-700/50">
              <tr>
                {columns.filter(c => !c.startsWith('_')).map(col => (
                  <th key={col} onClick={() => setSortConfig(prev => ({ key: col, direction: prev.key === col && prev.direction === 'asc' ? 'desc' : 'asc' }))}
                    className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-700 whitespace-nowrap">
                    <div className="flex items-center gap-1">
                      {col}
                      {sortConfig.key === col && (sortConfig.direction === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
              {paginatedData.map((row, i) => (
                <tr key={i} className="hover:bg-slate-50 dark:hover:bg-slate-700/30">
                  {columns.filter(c => !c.startsWith('_')).map(col => {
                    const val = row[col]
                    const isLink = val && (col.includes('Link') || col.includes('URL')) && String(val).startsWith('http')
                    return (
                      <td key={col} className="px-4 py-3 text-slate-700 dark:text-slate-300 whitespace-nowrap">
                        {isLink ? (
                          <a href={val} target="_blank" rel="noopener noreferrer" className="text-indigo-600 hover:text-indigo-800 hover:underline flex items-center gap-1">
                            Open <ExternalLink className="w-3 h-3" />
                          </a>
                        ) : (val || '-')}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        
        <div className="px-4 py-3 bg-slate-50 dark:bg-slate-700/50 flex items-center justify-between">
          <span className="text-sm text-slate-500">Page {page + 1} of {totalPages}</span>
          <div className="flex gap-2">
            <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}
              className="px-3 py-1 text-sm bg-white dark:bg-slate-600 border rounded hover:bg-slate-100 disabled:opacity-50">Previous</button>
            <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1}
              className="px-3 py-1 text-sm bg-white dark:bg-slate-600 border rounded hover:bg-slate-100 disabled:opacity-50">Next</button>
          </div>
        </div>
      </div>
    </div>
  )
}

// Stat Card
function StatCard({ title, value, subtitle, icon: Icon, color = 'blue' }) {
  const colors = {
    blue: 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400',
    green: 'bg-green-500/10 text-green-600 dark:text-green-400',
    amber: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
    red: 'bg-red-500/10 text-red-600 dark:text-red-400',
    purple: 'bg-purple-500/10 text-purple-600 dark:text-purple-400'
  }
  
  return (
    <div className="bg-white dark:bg-slate-800 rounded-xl p-6 shadow-sm border border-slate-200 dark:border-slate-700">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm text-slate-500 dark:text-slate-400">{title}</p>
          <p className="text-2xl font-bold text-slate-900 dark:text-white mt-1">{value}</p>
          {subtitle && <p className="text-sm text-slate-500 mt-1">{subtitle}</p>}
        </div>
        <div className={`p-3 rounded-lg ${colors[color]}`}><Icon className="w-6 h-6" /></div>
      </div>
    </div>
  )
}

// Map View
function MapView({ data }) {
  const geoData = useMemo(() => {
    return data.filter(r => r.Latitude && r.Longitude).map(r => ({
      lat: parseFloat(r.Latitude),
      lng: parseFloat(r.Longitude),
      city: r.CallerCity,
      state: r.CallerState,
      count: 1
    }))
  }, [data])

  // Aggregate by location
  const aggregated = useMemo(() => {
    const map = {}
    geoData.forEach(p => {
      const key = `${p.lat.toFixed(2)},${p.lng.toFixed(2)}`
      if (!map[key]) map[key] = { ...p, count: 0 }
      map[key].count++
    })
    return Object.values(map)
  }, [geoData])

  if (geoData.length === 0) {
    return (
      <div className="bg-white dark:bg-slate-800 rounded-xl p-6 shadow-sm border border-slate-200 dark:border-slate-700">
        <div className="flex items-center gap-2 mb-4">
          <Map className="w-5 h-5 text-indigo-600" />
          <h3 className="font-semibold text-slate-900 dark:text-white">Call Locations</h3>
        </div>
        <div className="h-96 flex items-center justify-center bg-slate-100 dark:bg-slate-700 rounded-lg">
          <div className="text-center">
            <MapPin className="w-12 h-12 text-slate-400 mx-auto mb-2" />
            <p className="text-slate-500">No geocoded data available</p>
            <p className="text-sm text-slate-400 mt-1">Run Geocoding enrichment first</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="bg-white dark:bg-slate-800 rounded-xl p-6 shadow-sm border border-slate-200 dark:border-slate-700">
      <div className="flex items-center gap-2 mb-4">
        <Map className="w-5 h-5 text-indigo-600" />
        <h3 className="font-semibold text-slate-900 dark:text-white">Call Locations ({geoData.length} mapped)</h3>
      </div>
      <div className="h-96 rounded-lg overflow-hidden">
        <MapContainer center={[39.8283, -98.5795]} zoom={4} style={{ height: '100%', width: '100%' }}>
          <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution='&copy; OpenStreetMap' />
          {aggregated.map((point, i) => (
            <CircleMarker key={i} center={[point.lat, point.lng]} radius={Math.min(20, 5 + point.count / 2)}
              pathOptions={{ color: '#6366f1', fillColor: '#6366f1', fillOpacity: 0.6 }}>
              <Popup>
                <strong>{point.city}, {point.state}</strong><br />
                {point.count} calls
              </Popup>
            </CircleMarker>
          ))}
        </MapContainer>
      </div>
    </div>
  )
}

// Date Range Filter
function DateRangeFilter({ data, onFilter }) {
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')

  const dateRange = useMemo(() => {
    const dates = data.map(r => r.CallStart).filter(Boolean).map(d => {
      try {
        const [datePart] = d.split(' ')
        return parse(datePart, 'MM-dd-yy', new Date())
      } catch { return null }
    }).filter(Boolean)
    
    if (dates.length === 0) return { min: '', max: '' }
    const sorted = dates.sort((a, b) => a - b)
    return {
      min: format(sorted[0], 'yyyy-MM-dd'),
      max: format(sorted[sorted.length - 1], 'yyyy-MM-dd')
    }
  }, [data])

  const applyFilter = () => {
    if (!startDate && !endDate) {
      onFilter(null)
      return
    }
    onFilter({ start: startDate, end: endDate })
  }

  const clearFilter = () => {
    setStartDate('')
    setEndDate('')
    onFilter(null)
  }

  return (
    <div className="flex items-center gap-3 p-3 bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700">
      <Calendar className="w-5 h-5 text-slate-500" />
      <div className="flex items-center gap-2">
        <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} min={dateRange.min} max={dateRange.max}
          className="px-2 py-1 text-sm bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded" />
        <span className="text-slate-400">to</span>
        <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} min={dateRange.min} max={dateRange.max}
          className="px-2 py-1 text-sm bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded" />
      </div>
      <button onClick={applyFilter} className="px-3 py-1 text-sm bg-indigo-600 text-white rounded hover:bg-indigo-700">Apply</button>
      {(startDate || endDate) && <button onClick={clearFilter} className="text-slate-400 hover:text-slate-600"><X className="w-4 h-4" /></button>}
    </div>
  )
}

// Saved Filters
function SavedFilters({ filters, globalSearch, dateRange, onLoad, onDelete }) {
  const [savedFilters, setSavedFilters] = useState(() => {
    const saved = localStorage.getItem('savedFilters')
    return saved ? JSON.parse(saved) : []
  })
  const [showSave, setShowSave] = useState(false)
  const [filterName, setFilterName] = useState('')

  const saveCurrentFilter = () => {
    if (!filterName.trim()) return
    const newFilter = {
      id: Date.now(),
      name: filterName,
      filters,
      globalSearch,
      dateRange,
      createdAt: new Date().toISOString()
    }
    const updated = [...savedFilters, newFilter]
    setSavedFilters(updated)
    localStorage.setItem('savedFilters', JSON.stringify(updated))
    setFilterName('')
    setShowSave(false)
  }

  const deleteFilter = (id) => {
    const updated = savedFilters.filter(f => f.id !== id)
    setSavedFilters(updated)
    localStorage.setItem('savedFilters', JSON.stringify(updated))
    onDelete()
  }

  const hasActiveFilters = Object.keys(filters).some(k => filters[k]) || globalSearch || dateRange

  return (
    <div className="flex items-center gap-2">
      {hasActiveFilters && (
        <button onClick={() => setShowSave(!showSave)} className="flex items-center gap-1 px-3 py-1.5 text-sm bg-slate-100 dark:bg-slate-700 rounded-lg hover:bg-slate-200">
          <Save className="w-4 h-4" /> Save Filter
        </button>
      )}
      
      {savedFilters.length > 0 && (
        <div className="relative group">
          <button className="flex items-center gap-1 px-3 py-1.5 text-sm bg-slate-100 dark:bg-slate-700 rounded-lg hover:bg-slate-200">
            <Bookmark className="w-4 h-4" /> Saved ({savedFilters.length})
          </button>
          <div className="absolute top-full right-0 mt-2 w-64 bg-white dark:bg-slate-800 rounded-lg shadow-xl border border-slate-200 dark:border-slate-700 hidden group-hover:block z-50">
            {savedFilters.map(sf => (
              <div key={sf.id} className="flex items-center justify-between p-3 hover:bg-slate-50 dark:hover:bg-slate-700 border-b last:border-0">
                <button onClick={() => onLoad(sf)} className="text-left flex-1">
                  <p className="text-sm font-medium text-slate-700 dark:text-slate-300">{sf.name}</p>
                  <p className="text-xs text-slate-400">{new Date(sf.createdAt).toLocaleDateString()}</p>
                </button>
                <button onClick={() => deleteFilter(sf.id)} className="text-slate-400 hover:text-red-500 p-1">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {showSave && (
        <div className="flex items-center gap-2">
          <input type="text" value={filterName} onChange={(e) => setFilterName(e.target.value)} placeholder="Filter name..."
            className="px-2 py-1 text-sm bg-slate-50 dark:bg-slate-700 border rounded w-32" />
          <button onClick={saveCurrentFilter} className="px-2 py-1 text-sm bg-green-600 text-white rounded hover:bg-green-700">Save</button>
          <button onClick={() => setShowSave(false)} className="text-slate-400"><X className="w-4 h-4" /></button>
        </div>
      )}
    </div>
  )
}

// Admin Panel
function AdminPanel({ currentUser }) {
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [editUser, setEditUser] = useState(null)
  const [form, setForm] = useState({ username: '', email: '', password: '', role: 'user' })
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const token = localStorage.getItem('auth_token')
  const headers = { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }

  useEffect(() => { fetchUsers() }, [])

  const fetchUsers = async () => {
    try {
      const res = await fetch('/api/admin/users', { headers })
      if (res.ok) {
        const data = await res.json()
        setUsers(data.users)
      }
    } catch (err) {
      setError('Failed to load users')
    } finally {
      setLoading(false)
    }
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setSuccess('')
    
    try {
      const url = editUser ? `/api/admin/users/${editUser.id}` : '/api/admin/users'
      const method = editUser ? 'PUT' : 'POST'
      const body = editUser 
        ? { ...form, password: form.password || undefined }
        : form

      const res = await fetch(url, { method, headers, body: JSON.stringify(body) })
      const data = await res.json()
      
      if (res.ok) {
        setSuccess(editUser ? 'User updated' : 'User created')
        setShowAdd(false)
        setEditUser(null)
        setForm({ username: '', email: '', password: '', role: 'user' })
        fetchUsers()
      } else {
        setError(data.error)
      }
    } catch (err) {
      setError('Failed to save user')
    }
  }

  const toggleActive = async (user) => {
    try {
      const res = await fetch(`/api/admin/users/${user.id}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ active: !user.active })
      })
      if (res.ok) fetchUsers()
      else {
        const data = await res.json()
        setError(data.error)
      }
    } catch (err) {
      setError('Failed to update user')
    }
  }

  const deleteUser = async (user) => {
    if (!confirm(`Delete user "${user.username}"? This cannot be undone.`)) return
    
    try {
      const res = await fetch(`/api/admin/users/${user.id}`, { method: 'DELETE', headers })
      if (res.ok) {
        setSuccess('User deleted')
        fetchUsers()
      } else {
        const data = await res.json()
        setError(data.error)
      }
    } catch (err) {
      setError('Failed to delete user')
    }
  }

  const startEdit = (user) => {
    setEditUser(user)
    setForm({ username: user.username, email: user.email || '', password: '', role: user.role })
    setShowAdd(true)
  }

  if (currentUser?.role !== 'admin') {
    return (
      <div className="bg-white dark:bg-slate-800 rounded-xl p-6 shadow-sm border">
        <div className="text-center py-12">
          <Lock className="w-12 h-12 text-slate-400 mx-auto mb-3" />
          <h3 className="text-lg font-semibold text-slate-700 dark:text-slate-300">Admin Access Required</h3>
          <p className="text-slate-500 mt-1">You don't have permission to access this page.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="bg-white dark:bg-slate-800 rounded-xl p-6 shadow-sm border">
        <div className="flex items-center justify-between mb-6">
          <h3 className="font-semibold text-slate-900 dark:text-white flex items-center gap-2">
            <Users className="w-5 h-5 text-indigo-600" /> User Management
          </h3>
          <button onClick={() => { setShowAdd(true); setEditUser(null); setForm({ username: '', email: '', password: '', role: 'user' }) }}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm rounded-lg flex items-center gap-2">
            <Plus className="w-4 h-4" /> Add User
          </button>
        </div>

        {error && <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 rounded-lg flex items-center gap-2"><AlertCircle className="w-4 h-4" /> {error}</div>}
        {success && <div className="mb-4 p-3 bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 rounded-lg flex items-center gap-2"><CheckCircle className="w-4 h-4" /> {success}</div>}

        {showAdd && (
          <div className="mb-6 p-4 bg-slate-50 dark:bg-slate-700/50 rounded-lg">
            <h4 className="font-medium text-slate-900 dark:text-white mb-4">{editUser ? 'Edit User' : 'Add New User'}</h4>
            <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <input type="text" placeholder="Username *" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} required
                className="px-3 py-2 bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-lg" />
              <input type="email" placeholder="Email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })}
                className="px-3 py-2 bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-lg" />
              <input type="password" placeholder={editUser ? "New Password (leave blank to keep)" : "Password *"} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required={!editUser}
                className="px-3 py-2 bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-lg" />
              <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}
                className="px-3 py-2 bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-lg">
                <option value="user">User</option>
                <option value="admin">Admin</option>
              </select>
              <div className="md:col-span-2 flex gap-2">
                <button type="submit" className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg">{editUser ? 'Update' : 'Create'}</button>
                <button type="button" onClick={() => { setShowAdd(false); setEditUser(null) }} className="px-4 py-2 bg-slate-200 dark:bg-slate-600 rounded-lg">Cancel</button>
              </div>
            </form>
          </div>
        )}

        {loading ? (
          <div className="flex justify-center py-12"><Loader2 className="w-8 h-8 animate-spin text-indigo-500" /></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 dark:bg-slate-700/50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">Username</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">Email</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">Role</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">Status</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">Last Login</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                {users.map(user => (
                  <tr key={user.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/30">
                    <td className="px-4 py-3 font-medium text-slate-900 dark:text-white">{user.username}</td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{user.email || '-'}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-1 text-xs rounded-full ${user.role === 'admin' ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400' : 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-400'}`}>
                        {user.role}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-1 text-xs rounded-full ${user.active ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'}`}>
                        {user.active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-400">
                      {user.last_login ? new Date(user.last_login).toLocaleDateString() : 'Never'}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-2">
                        <button onClick={() => startEdit(user)} className="text-indigo-600 hover:text-indigo-800 text-xs">Edit</button>
                        <button onClick={() => toggleActive(user)} className="text-amber-600 hover:text-amber-800 text-xs">
                          {user.active ? 'Disable' : 'Enable'}
                        </button>
                        {user.id !== currentUser?.id && (
                          <button onClick={() => deleteUser(user)} className="text-red-600 hover:text-red-800 text-xs">Delete</button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

// Enrichment Panel
function EnrichmentPanel({ data, onDataUpdate }) {
  const [loading, setLoading] = useState({})
  const [results, setResults] = useState({})
  const token = localStorage.getItem('auth_token')

  const runEnrichment = async (type) => {
    setLoading(prev => ({ ...prev, [type]: true }))
    setResults(prev => ({ ...prev, [type]: null }))

    try {
      const res = await fetch(`/api/enrich/${type}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ data })
      })
      const result = await res.json()
      setResults(prev => ({ ...prev, [type]: result }))
      if (result.data) onDataUpdate(result.data, result.columns)
    } catch (err) {
      setResults(prev => ({ ...prev, [type]: { error: err.message } }))
    } finally {
      setLoading(prev => ({ ...prev, [type]: false }))
    }
  }

  const options = [
    { id: 'carrier', title: 'Carrier Lookup', desc: 'Identify phone carriers', icon: Phone },
    { id: 'geocode', title: 'Geocoding', desc: 'Add lat/lng from location', icon: MapPin },
    { id: 'timezone', title: 'Timezone', desc: 'Add timezone from state', icon: Clock },
    { id: 'property-tax', title: 'CA Property Tax', desc: 'Add county & tax rates (CA only)', icon: Building2 },
    { id: 'property-links', title: 'Property Links', desc: 'Zillow + County Assessor URLs', icon: ExternalLink },
  ]

  return (
    <div className="space-y-6">
      <div className="bg-white dark:bg-slate-800 rounded-xl p-6 shadow-sm border border-slate-200 dark:border-slate-700">
        <h3 className="font-semibold text-slate-900 dark:text-white mb-2 flex items-center gap-2">
          <Zap className="w-5 h-5 text-indigo-600" />
          Data Enrichment
        </h3>
        <p className="text-slate-500 mb-6">Processing {data.length.toLocaleString()} records.</p>
        
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {options.map(opt => (
            <div key={opt.id} className="border border-slate-200 dark:border-slate-700 rounded-lg p-4">
              <div className="flex items-start gap-3">
                <div className="p-2 bg-indigo-500/10 rounded-lg">
                  <opt.icon className="w-5 h-5 text-indigo-600" />
                </div>
                <div className="flex-1">
                  <h4 className="font-medium text-slate-900 dark:text-white">{opt.title}</h4>
                  <p className="text-sm text-slate-500 mt-1">{opt.desc}</p>
                  
                  {results[opt.id] && (
                    <div className={`mt-3 p-2 rounded text-sm flex items-center gap-2 ${results[opt.id].error ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700'}`}>
                      {results[opt.id].error ? <AlertCircle className="w-4 h-4" /> : <CheckCircle className="w-4 h-4" />}
                      {results[opt.id].error || results[opt.id].message}
                    </div>
                  )}
                  
                  <button onClick={() => runEnrichment(opt.id)} disabled={loading[opt.id]}
                    className="mt-3 px-4 py-2 text-sm bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg disabled:opacity-50 flex items-center gap-2">
                    {loading[opt.id] && <Loader2 className="w-4 h-4 animate-spin" />}
                    {loading[opt.id] ? 'Processing...' : 'Run'}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// PDF Export
function exportPDF(elementId, filename = 'report.pdf') {
  const element = document.getElementById(elementId)
  if (!element) return

  html2canvas(element, { scale: 2 }).then(canvas => {
    const imgData = canvas.toDataURL('image/png')
    const pdf = new jsPDF('p', 'mm', 'a4')
    const pdfWidth = pdf.internal.pageSize.getWidth()
    const pdfHeight = (canvas.height * pdfWidth) / canvas.width
    pdf.addImage(imgData, 'PNG', 0, 0, pdfWidth, pdfHeight)
    pdf.save(filename)
  })
}

// Main Dashboard
function Dashboard({ data, columns, setData, setColumns, user, onLogout, onDataUpdate }) {
  const [filters, setFilters] = useState({})
  const [globalSearch, setGlobalSearch] = useState('')
  const [selectedFilter, setSelectedFilter] = useState(null)
  const [dateRange, setDateRange] = useState(null)
  const [view, setView] = useState('overview')
  const [dark, setDark] = useDarkMode()

  const filteredData = useMemo(() => {
    return data.filter(row => {
      // Date range filter
      if (dateRange) {
        const callDate = row.CallStart
        if (callDate) {
          try {
            const [datePart] = callDate.split(' ')
            const date = parse(datePart, 'MM-dd-yy', new Date())
            const start = dateRange.start ? startOfDay(new Date(dateRange.start)) : new Date(0)
            const end = dateRange.end ? endOfDay(new Date(dateRange.end)) : new Date()
            if (!isWithinInterval(date, { start, end })) return false
          } catch { }
        }
      }

      // Selected filter from smart search
      if (selectedFilter) {
        if (String(row[selectedFilter.field] || '').toLowerCase() !== selectedFilter.value.toLowerCase()) return false
      }

      // Global search
      if (globalSearch) {
        const q = globalSearch.toLowerCase()
        if (!Object.values(row).some(val => String(val).toLowerCase().includes(q))) return false
      }

      // Column filters
      for (const [col, filterVal] of Object.entries(filters)) {
        if (filterVal && !String(row[col] || '').toLowerCase().includes(filterVal.toLowerCase())) return false
      }

      return true
    })
  }, [data, filters, globalSearch, selectedFilter, dateRange])

  const stats = useMemo(() => {
    const answered = filteredData.filter(r => r.CallAction === 'Answer').length
    const hangup = filteredData.filter(r => r.CallAction === 'Hangup').length
    const totalDuration = filteredData.reduce((sum, r) => sum + (parseInt(r.CallDuration) || 0), 0)
    const avgDuration = filteredData.length ? Math.round(totalDuration / filteredData.length) : 0
    const uniqueCallers = new Set(filteredData.map(r => r.CallerID)).size
    return { answered, hangup, avgDuration, uniqueCallers, total: filteredData.length }
  }, [filteredData])

  const callsByMonth = useMemo(() => {
    const months = {}
    filteredData.forEach(row => {
      const date = row.CallStart
      if (date) {
        const [month, , year] = date.split(' ')[0].split('-')
        const key = `${year}-${month}`
        months[key] = (months[key] || 0) + 1
      }
    })
    return Object.entries(months).sort(([a], [b]) => a.localeCompare(b)).map(([month, count]) => ({ month, count }))
  }, [filteredData])

  const callsByState = useMemo(() => {
    const states = {}
    filteredData.forEach(row => {
      const state = row.CallerState || 'Unknown'
      states[state] = (states[state] || 0) + 1
    })
    return Object.entries(states).sort(([, a], [, b]) => b - a).slice(0, 10).map(([state, count]) => ({ state, count }))
  }, [filteredData])

  const callsByAction = useMemo(() => {
    const actions = {}
    filteredData.forEach(row => { actions[row.CallAction || 'Unknown'] = (actions[row.CallAction || 'Unknown'] || 0) + 1 })
    return Object.entries(actions).map(([name, value]) => ({ name, value }))
  }, [filteredData])

  const durationDist = useMemo(() => {
    const b = { '0-30s': 0, '30s-1m': 0, '1-5m': 0, '5-15m': 0, '15m+': 0 }
    filteredData.forEach(r => {
      const d = parseInt(r.CallDuration) || 0
      if (d <= 30) b['0-30s']++
      else if (d <= 60) b['30s-1m']++
      else if (d <= 300) b['1-5m']++
      else if (d <= 900) b['5-15m']++
      else b['15m+']++
    })
    return Object.entries(b).map(([range, count]) => ({ range, count }))
  }, [filteredData])

  const exportCSV = () => {
    const csv = Papa.unparse(filteredData)
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'callpulse_export.csv'
    a.click()
  }

  const loadFilter = (sf) => {
    setFilters(sf.filters || {})
    setGlobalSearch(sf.globalSearch || '')
    setDateRange(sf.dateRange || null)
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900">
      <header className="bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div className="flex items-center gap-4">
              <Logo />
              <div className="flex bg-slate-100 dark:bg-slate-700 rounded-lg p-1">
                {[
                  { id: 'overview', icon: BarChart3, label: 'Overview' },
                  { id: 'table', icon: Table, label: 'Data' },
                  { id: 'map', icon: Map, label: 'Map' },
                  { id: 'enrich', icon: Zap, label: 'Enrich' },
                  { id: 'files', icon: Database, label: 'Data Files' },
                  ...(user?.role === 'admin' ? [{ id: 'admin', icon: Users, label: 'Admin' }] : [])
                ].map(tab => (
                  <button key={tab.id} onClick={() => setView(tab.id)}
                    className={`px-3 py-1.5 text-sm rounded-md transition-colors flex items-center gap-1 ${view === tab.id ? 'bg-white dark:bg-slate-600 shadow-sm text-indigo-600 dark:text-indigo-400' : 'hover:bg-white/50 text-slate-600 dark:text-slate-400'}`}>
                    <tab.icon className="w-4 h-4" /> {tab.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-3">
              <SmartSearch data={data} onSearch={(q) => { setGlobalSearch(q); setSelectedFilter(null) }}
                onSelect={({ field, value }) => { setSelectedFilter({ field, value }); setGlobalSearch('') }} />
              
              {selectedFilter && (
                <div className="flex items-center gap-2 px-3 py-1.5 bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 rounded-lg text-sm">
                  <span className="font-medium">{selectedFilter.field}:</span> {selectedFilter.value}
                  <button onClick={() => setSelectedFilter(null)}><X className="w-4 h-4" /></button>
                </div>
              )}

              <button onClick={() => setDark(!dark)} className="p-2 rounded-lg bg-slate-100 dark:bg-slate-700 hover:bg-slate-200">
                {dark ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
              </button>

              <div className="flex items-center gap-2 pl-3 border-l border-slate-200 dark:border-slate-600">
                <span className="text-sm text-slate-600 dark:text-slate-400">{user?.username}</span>
                {user?.role === 'admin' && <span className="text-xs bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400 px-2 py-0.5 rounded">Admin</span>}
                <button onClick={onLogout} className="text-sm text-red-600 hover:text-red-800">Logout</button>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-4 mt-4 flex-wrap">
            <DateRangeFilter data={data} onFilter={setDateRange} />
            <SavedFilters filters={filters} globalSearch={globalSearch} dateRange={dateRange} onLoad={loadFilter} onDelete={() => {}} />
            <div className="flex-1" />
            <button onClick={exportCSV} className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm rounded-lg">
              <Download className="w-4 h-4" /> Export CSV
            </button>
            <button onClick={() => exportPDF('dashboard-content', 'callpulse-report.pdf')}
              className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 text-white text-sm rounded-lg">
              <FileText className="w-4 h-4" /> Export PDF
            </button>
          </div>
        </div>
      </header>

      <main id="dashboard-content" className="max-w-7xl mx-auto px-4 py-6">
        {view === 'overview' && (
          <div className="space-y-6">
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
              <StatCard title="Total Calls" value={stats.total.toLocaleString()} icon={Phone} color="blue" />
              <StatCard title="Answered" value={stats.answered.toLocaleString()} subtitle={`${stats.total ? Math.round(stats.answered / stats.total * 100) : 0}%`} icon={PhoneCall} color="green" />
              <StatCard title="Hangups" value={stats.hangup.toLocaleString()} subtitle={`${stats.total ? Math.round(stats.hangup / stats.total * 100) : 0}%`} icon={PhoneMissed} color="red" />
              <StatCard title="Avg Duration" value={`${Math.floor(stats.avgDuration / 60)}m ${stats.avgDuration % 60}s`} icon={Clock} color="amber" />
              <StatCard title="Unique Callers" value={stats.uniqueCallers.toLocaleString()} icon={Users} color="purple" />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="bg-white dark:bg-slate-800 rounded-xl p-6 shadow-sm border">
                <h3 className="font-semibold text-slate-900 dark:text-white mb-4">Calls Over Time</h3>
                <ResponsiveContainer width="100%" height={300}>
                  <AreaChart data={callsByMonth}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="month" tick={{ fontSize: 12 }} stroke="#94a3b8" />
                    <YAxis tick={{ fontSize: 12 }} stroke="#94a3b8" />
                    <Tooltip contentStyle={{ backgroundColor: '#1e293b', border: 'none', borderRadius: '8px', color: '#fff' }} />
                    <Area type="monotone" dataKey="count" stroke="#6366f1" fill="#6366f1" fillOpacity={0.2} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>

              <div className="bg-white dark:bg-slate-800 rounded-xl p-6 shadow-sm border">
                <h3 className="font-semibold text-slate-900 dark:text-white mb-4">Top States</h3>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={callsByState} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis type="number" tick={{ fontSize: 12 }} stroke="#94a3b8" />
                    <YAxis dataKey="state" type="category" tick={{ fontSize: 12 }} stroke="#94a3b8" width={40} />
                    <Tooltip contentStyle={{ backgroundColor: '#1e293b', border: 'none', borderRadius: '8px', color: '#fff' }} />
                    <Bar dataKey="count" fill="#22c55e" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>

              <div className="bg-white dark:bg-slate-800 rounded-xl p-6 shadow-sm border">
                <h3 className="font-semibold text-slate-900 dark:text-white mb-4">Call Outcomes</h3>
                <ResponsiveContainer width="100%" height={300}>
                  <PieChart>
                    <Pie data={callsByAction} cx="50%" cy="50%" innerRadius={60} outerRadius={100} dataKey="value"
                      label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}>
                      {callsByAction.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              </div>

              <div className="bg-white dark:bg-slate-800 rounded-xl p-6 shadow-sm border">
                <h3 className="font-semibold text-slate-900 dark:text-white mb-4">Call Duration Distribution</h3>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={durationDist}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="range" tick={{ fontSize: 12 }} stroke="#94a3b8" />
                    <YAxis tick={{ fontSize: 12 }} stroke="#94a3b8" />
                    <Tooltip contentStyle={{ backgroundColor: '#1e293b', border: 'none', borderRadius: '8px', color: '#fff' }} />
                    <Bar dataKey="count" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        )}

        {view === 'table' && <DataTable data={filteredData} columns={columns} filters={filters} setFilters={setFilters} />}
        {view === 'map' && <MapView data={filteredData} />}
        {view === 'enrich' && <EnrichmentPanel data={filteredData} onDataUpdate={(d, c) => { setData(d); if (c) setColumns(c) }} />}
        {view === 'files' && <DataFilesPanel onDataUpdate={onDataUpdate} />}
        {view === 'admin' && <AdminPanel currentUser={user} />}
      </main>

      {/* AI Chat Panel */}
      <AIChatPanel data={filteredData} columns={columns} />
    </div>
  )
}

// Main App
export default function App() {
  const [authenticated, setAuthenticated] = useState(false)
  const [user, setUser] = useState(null)
  const [data, setData] = useState([])
  const [columns, setColumns] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const token = localStorage.getItem('auth_token')
    const savedUser = localStorage.getItem('user')
    if (token && savedUser) {
      setAuthenticated(true)
      setUser(JSON.parse(savedUser))
      loadData(token)
    } else {
      setLoading(false)
    }
  }, [])

  const loadData = async (token) => {
    try {
      const res = await fetch('/api/data', {
        headers: { 'Authorization': `Bearer ${token || localStorage.getItem('auth_token')}` }
      })
      if (res.ok) {
        const { data: csvData, columns: cols } = await res.json()
        setData(csvData)
        setColumns(cols)
      } else if (res.status === 401) {
        handleLogout()
      }
    } catch (err) {
      console.error('Failed to load data:', err)
    } finally {
      setLoading(false)
    }
  }

  const handleLogin = (token, userData) => {
    setAuthenticated(true)
    setUser(userData)
    loadData(token)
  }

  const handleLogout = async () => {
    const token = localStorage.getItem('auth_token')
    try {
      await fetch('/api/auth/logout', { 
        method: 'POST', 
        headers: { 'Authorization': `Bearer ${token}` } 
      })
    } catch (err) {}
    
    localStorage.removeItem('auth_token')
    localStorage.removeItem('user')
    setAuthenticated(false)
    setUser(null)
    setData([])
    setColumns([])
  }

  const handleDataUpdate = () => {
    loadData()
  }

  if (!authenticated) return <LoginScreen onLogin={handleLogin} />
  if (loading) return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 flex items-center justify-center">
      <div className="text-center">
        <Logo size="lg" />
        <div className="mt-6">
          <Loader2 className="w-8 h-8 text-indigo-500 animate-spin mx-auto" />
          <p className="text-slate-500 mt-2">Loading your data...</p>
        </div>
      </div>
    </div>
  )

  return <Dashboard data={data} columns={columns} setData={setData} setColumns={setColumns} user={user} onLogout={handleLogout} onDataUpdate={handleDataUpdate} />
}
