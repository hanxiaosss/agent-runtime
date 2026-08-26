#!/usr/bin/env node
/**
 * Test semantic hook integration in handler.mjs
 */

import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const TEST_DIR = '/tmp/hannah-semantic-test-' + Date.now();

async function runTest() {
  console.log('=== Testing Semantic Hook Integration ===\n');
  
  // Create test directory
  fs.mkdirSync(TEST_DIR, { recursive: true });
  console.log('Test directory:', TEST_DIR);
  
  // Copy .harness from current project
  const harnessSrc = path.join(process.cwd(), '.harness');
  const harnessDest = path.join(TEST_DIR, '.harness');
  
  if (fs.existsSync(harnessSrc)) {
    copyDir(harnessSrc, harnessDest);
    console.log('✓ Copied .harness directory\n');
  } else {
    console.error('✗ .harness directory not found. Run "hannah init" first.');
    process.exit(1);
  }
  
  // Test 1: Try to modify agent.md
  console.log('Test 1: Attempting to modify agent.md');
  const result1 = await runHandler(harnessDest, {
    tool_name: 'write',
    tool_input: {
      file_path: 'agent.md',
      content: '# Modified by AI'
    }
  });
  
  console.log('Result:', JSON.stringify(result1, null, 2));
  
  if (result1.decision === 'deny') {
    console.log('✓ PASS: Operation denied');
    if (result1.reason && result1.reason.includes('Redline')) {
      console.log('✓ PASS: Denied by redline protection\n');
    } else {
      console.log('⚠ WARNING: Denied but not by redline protection\n');
    }
  } else {
    console.log('✗ FAIL: Operation was allowed (should be denied)\n');
  }
  
  // Test 2: Try to modify normal file
  console.log('Test 2: Attempting to modify normal file (src/index.js)');
  const result2 = await runHandler(harnessDest, {
    tool_name: 'write',
    tool_input: {
      file_path: 'src/index.js',
      content: 'console.log("hello");'
    }
  });
  
  console.log('Result:', JSON.stringify(result2, null, 2));
  
  if (result2.decision !== 'deny') {
    console.log('✓ PASS: Normal file allowed\n');
  } else {
    console.log('✗ FAIL: Normal file denied (should be allowed)\n');
  }
  
  // Cleanup
  console.log('Cleaning up...');
  fs.rmSync(TEST_DIR, { recursive: true, force: true });
  
  console.log('\n=== Test Complete ===');
}

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });
  
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

async function runHandler(harnessDir, input) {
  return new Promise((resolve) => {
    const handlerPath = path.join(harnessDir, 'hooks', 'handler.mjs');
    
    // Use local runtime path
    const localRuntimePath = path.resolve(process.cwd(), 'dist', 'index.js');
    
    const child = spawn('node', [handlerPath, 'pre-tool-use'], {
      env: { 
        ...process.env, 
        HANNAH_DEBUG: 'true',
        HANNAH_RUNTIME_PATH: localRuntimePath
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
      
      try {
        resolve(JSON.parse(stdout));
      } catch {
        resolve({ decision: 'allow', reason: 'Parse error', raw: stdout });
      }
    });
    
    child.stdin.write(JSON.stringify(input));
    child.stdin.end();
  });
}

runTest().catch(console.error);
