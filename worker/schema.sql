CREATE TABLE IF NOT EXISTS items (
  id TEXT PRIMARY KEY,
  roomId TEXT NOT NULL,
  container TEXT NOT NULL,
  title TEXT NOT NULL,
  originalTitle TEXT,
  year INTEGER,
  cover TEXT,
  creators TEXT,
  [cast] TEXT,
  genres TEXT,
  audience TEXT,
  weather TEXT,
  daytime TEXT,
  seasons TEXT,
  moods TEXT,
  stages TEXT,
  specialDates TEXT,
  tags TEXT,
  rating REAL,
  ownerNote TEXT,
  body TEXT,
  date TEXT,
  place TEXT,
  gallery TEXT,
  videoUrl TEXT,
  likes INTEGER DEFAULT 0,
  addedBy TEXT,
  visibility TEXT DEFAULT 'publico',
  audio TEXT,
  createdAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  itemId TEXT NOT NULL,
  author TEXT NOT NULL,
  body TEXT NOT NULL,
  rating REAL,
  createdAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS likes_log (
  item_id TEXT NOT NULL,
  ip TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS media_files (
  path TEXT PRIMARY KEY,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  chunks INTEGER NOT NULL,
  createdAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS media_chunks (
  path TEXT NOT NULL,
  idx INTEGER NOT NULL,
  data BLOB NOT NULL,
  PRIMARY KEY (path, idx)
);

CREATE INDEX IF NOT EXISTS idx_items_room_container ON items (roomId, container);
CREATE INDEX IF NOT EXISTS idx_comments_item_id ON comments (itemId);
CREATE INDEX IF NOT EXISTS idx_likes_log_item_ip ON likes_log (item_id, ip);
