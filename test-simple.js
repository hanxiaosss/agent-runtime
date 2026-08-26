#!/usr/bin/env node
/**
 * Simple test: run handler.mjs directly in current directory
 */

import { spawn } from 'child_process';
import * as path from 'path';

async function runTest() {
  console.log('=== Simple Semantic Hook Test ===\n');
  
  const harnessDir = path.join(process.cwd(), '.harness');
  const handlerPath = path.join(harnessDir, 'hooks', 'handler.mjs');
  const runtimePath = path.join(process.cwd(), 'dist', 'index.js');
  
  console.log('Handler:', handlerPath);
  console.log('Runtime:', runtimePath);
  console.log('');
  
  // Test 1: Try to modify agent.md
  console.log('Test 1: Attempting to modify agent.md');
  const result1 = await runHandler(handlerPath, runtimePath, {
    tool_name: 'write',
    tool_input: {
      file_path: 'agent.md',
      content: '# Modified by AI'
    }
  });
  
  console.log('\nResult:', JSON.stringify(result1, null, 2));
  
  if (result1.decision === 'deny') {
    console.log('\n✓ PASS: Operation denied');
    if (result1.reason && result1.reason.toLowerCase().includes('redline')) {
      console.log('✓ PASS: Denied by redline protection');
    }
  } else {
    console.log('\n✗ FAIL: Operation was allowed (should be denied)');
  }
  
  console.log('\n=== Test Complete ===');
}

async function runHandler(handlerPath, runtimePath, input) {
  return new Promise((resolve) => {
    const child = spawn('node', [handlerPath, 'pre-tool-use'], {
      env: { 
        ...process.env, 
        HANNAH_DEBUG: 'true',
        HANNAH_RUNTIME_PATH: runtimePath
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
      console.log('--- End Output ---');
      
      try {
        // Extract JSON from stdout (may contain other output)
        const jsonMatch = stdout.match(/\{[^}]*"decision"[^}]*\}/);
        if (jsonMatch) {
          resolve(JSON.parse(jsonMatch[0]));
        } else {
          resolve({ decision: 'allow', reason: 'No JSON found', raw: stdout });
        }
      } catch {
        resolve({ decision: 'allow', reason: 'Parse error', raw: stdout });
      }
    });
    
    child.stdin.write(JSON.stringify(input));
    child.stdin.end();
  });
}

runTest().catch(console.error);
