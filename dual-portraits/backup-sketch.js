#!/usr/bin/env node
/**
 * Sketch Backup System
 * Automatically backs up sketch.js to the archive folder with timestamps
 * Run this before making major changes to sketch.js
 */

const fs = require('fs');
const path = require('path');

const SKETCH_FILE = path.join(__dirname, 'sketch.js');
const ARCHIVE_DIR = path.join(__dirname, 'sketches', 'archive');
const ARCHIVE_INDEX = path.join(ARCHIVE_DIR, 'index.json');

// Ensure archive directory exists
if (!fs.existsSync(ARCHIVE_DIR)) {
  fs.mkdirSync(ARCHIVE_DIR, { recursive: true });
}

// Create or read backup index
let index = [];
if (fs.existsSync(ARCHIVE_INDEX)) {
  index = JSON.parse(fs.readFileSync(ARCHIVE_INDEX, 'utf8'));
}

// Generate timestamp
const timestamp = new Date().toISOString().replace(/:/g, '-').slice(0, -5);
const hash = Math.random().toString(36).substring(7);
const backupFilename = `sketch-${timestamp}-${hash}.js`;
const backupPath = path.join(ARCHIVE_DIR, backupFilename);

// Read current sketch.js
const sketchContent = fs.readFileSync(SKETCH_FILE, 'utf8');

// Create backup
fs.writeFileSync(backupPath, sketchContent);

// Add to index with metadata
index.push({
  filename: backupFilename,
  timestamp: new Date().toISOString(),
  size: sketchContent.length,
  relativePath: path.relative(__dirname, backupPath)
});

// Keep only last 50 backups (delete oldest)
if (index.length > 50) {
  const toDelete = index.shift();
  const deleteFile = path.join(ARCHIVE_DIR, toDelete.filename);
  if (fs.existsSync(deleteFile)) {
    fs.unlinkSync(deleteFile);
  }
  console.log(`Deleted old backup: ${toDelete.filename}`);
}

// Save updated index
fs.writeFileSync(ARCHIVE_INDEX, JSON.stringify(index, null, 2));

console.log(`✓ Sketch backed up: ${backupFilename}`);
console.log(`✓ Total backups: ${index.length}`);
