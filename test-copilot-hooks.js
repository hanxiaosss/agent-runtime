#!/usr/bin/env node
/**
 * Test Copilot hook integration
 */

import { spawn } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

const testDir = path.join(process.cwd(), 'test-copilot');
const handlerPath = path.join(testDir, '.harness', 'hooks', 'handler.mjs');

console.log('=== Testing Copilot Hook Integration ===\n');

// Test 1: Verify configuration file exists
console.log('Test 1: Verify .github/hooks/hooks.json exists');
const configPath = path.join(testDir, '.github', 'hooks', 'hooks.json');
if (fs.existsSync(configPath)) {
  console.log('✓ PASS: Configuration file exists');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  console.log('  Version:', config.version);
  console.log('  Hooks:', Object.keys(config.hooks).join(', '));
} else {
  console.log('✗ FAIL: Configuration file not found');
}

console.log('\nTest 2: Simulate Copilot preToolUse hook');

// Simulate Copilot calling the hook with JSON input
const testInput = {
  tool_name: 'write',
  tool_input: {
    file_path: 'agent.md',
    content: '# Modified by AI'
  }
};

const child = spawn('node', [handlerPath, 'pre-tool-use'], {
  cwd: testDir,
  env: { 
    ...process.env, 
    HANNAH_DEBUG: 'true',
    HANNAH_RUNTIME_PATH: path.join(process.cwd(), 'dist', 'index.js')
  },
  stdio: ['pipe', 'pipe', 'pipe']
});

let stdout = '';
let stderr = '';

child.stdout.on('data', (data) => {
  stdout += data.toString();
});

child.stderr.on('data', (data) => {
  stderr += data.toString();
});

child.on('close', (code) => {
  console.log('\n--- Handler Output ---');
  console.log('Exit code:', code);
  console.log('Stderr (logs):');
  console.log(stderr);
  console.log('--- End Output ---\n');
  
  console.log('Result:', stdout);
  
  try {
    const result = JSON.parse(stdout);
    console.log('\nParsed result:', result);
    
    if (result.decision === 'deny') {
      console.log('✓ PASS: Operation denied');
      if (result.reason && result.reason.toLowerCase().includes('redline')) {
        console.log('✓ PASS: Denied by redline protection');
      }
    } else {
      console.log('✗ FAIL: Operation was allowed (should be denied)');
    }
  } catch (e) {
    console.log('✗ FAIL: Could not parse output as JSON');
  }
  
  console.log('\n=== Test Complete ===');
});

// Send input to stdin
child.stdin.write(JSON.stringify(testInput));
child.stdin.end();
