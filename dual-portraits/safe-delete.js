#!/usr/bin/env node
/**
 * Safe Delete Utility
 * Moves files to a recycle bin instead of permanently deleting them
 * Usage: node safe-delete.js <file-or-folder>
 */

const fs = require('fs');
const path = require('path');

const RECYCLE_BIN = path.join(__dirname, '.recycle-bin');

// Ensure recycle bin exists
if (!fs.existsSync(RECYCLE_BIN)) {
  fs.mkdirSync(RECYCLE_BIN, { recursive: true });
}

function safeDelete(targetPath) {
  if (!fs.existsSync(targetPath)) {
    console.error(`✗ File not found: ${targetPath}`);
    return false;
  }

  // Generate unique filename in recycle bin
  const basename = path.basename(targetPath);
  const timestamp = new Date().toISOString().replace(/:/g, '-').slice(0, -5);
  const hash = Math.random().toString(36).substring(7);
  const recycledName = `${timestamp}-${hash}-${basename}`;
  const recyclePath = path.join(RECYCLE_BIN, recycledName);

  try {
    // Move to recycle bin instead of deleting
    fs.renameSync(targetPath, recyclePath);
    console.log(`✓ Moved to recycle bin: ${basename}`);
    console.log(`✓ Location: .recycle-bin/${recycledName}`);
    console.log(`✓ To restore: mv ".recycle-bin/${recycledName}" <destination>`);
    return true;
  } catch (error) {
    console.error(`✗ Failed to move to recycle bin: ${error.message}`);
    return false;
  }
}

function listRecycleBin() {
  if (!fs.existsSync(RECYCLE_BIN)) {
    console.log('Recycle bin is empty');
    return;
  }

  const files = fs.readdirSync(RECYCLE_BIN);
  if (files.length === 0) {
    console.log('Recycle bin is empty');
    return;
  }

  console.log('\n=== Recycle Bin Contents ===');
  files.forEach((file, index) => {
    const filePath = path.join(RECYCLE_BIN, file);
    const stat = fs.statSync(filePath);
    console.log(`${index + 1}. ${file}`);
    console.log(`   Size: ${stat.size} bytes`);
    console.log(`   Path: .recycle-bin/${file}`);
  });
  console.log(`\nTotal items: ${files.length}`);
}

function emptyRecycleBin() {
  if (!fs.existsSync(RECYCLE_BIN)) {
    console.log('Recycle bin is already empty');
    return;
  }

  const files = fs.readdirSync(RECYCLE_BIN);
  files.forEach(file => {
    const filePath = path.join(RECYCLE_BIN, file);
    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) {
      fs.rmSync(filePath, { recursive: true });
    } else {
      fs.unlinkSync(filePath);
    }
  });

  console.log(`✓ Permanently deleted ${files.length} items from recycle bin`);
}

// Command line interface
const args = process.argv.slice(2);

if (args.length === 0) {
  console.log(`Usage:
  node safe-delete.js <file-or-folder>    Move file/folder to recycle bin
  node safe-delete.js --list              List recycle bin contents
  node safe-delete.js --empty             Permanently delete all recycle bin items`);
  process.exit(0);
}

if (args[0] === '--list') {
  listRecycleBin();
} else if (args[0] === '--empty') {
  const confirm = process.argv[3];
  if (confirm !== '--confirm') {
    console.log('To permanently empty the recycle bin, run:');
    console.log('  node safe-delete.js --empty --confirm');
    process.exit(0);
  }
  emptyRecycleBin();
} else {
  safeDelete(path.resolve(args[0]));
}
