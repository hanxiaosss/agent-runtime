#!/usr/bin/env node
/**
 * Test redline protection
 */

import { createSemanticEngine } from './dist/semantic/engine.js';
import { buildSemanticContext } from './dist/semantic/engine.js';

async function testRedlineProtection() {
  console.log('=== Testing Redline Protection ===\n');
  
  // Create semantic engine
  const engine = await createSemanticEngine(process.cwd());
  
  // Test 1: Attempt to modify agent.md
  console.log('Test 1: Attempting to modify agent.md');
  const event1 = {
    name: 'tool.before',
    payload: {
      toolName: 'write',
      input: {
        file_path: 'agent.md',
        content: '# Modified by AI\nNew rules here'
      }
    }
  };
  
  const context1 = buildSemanticContext(event1, process.cwd());
  const decisions1 = await engine.evaluate(context1);
  
  if (decisions1.length > 0) {
    const decision = decisions1[0];
    console.log(`✓ Decision: ${decision.action}`);
    console.log(`  Reason: ${decision.reason}`);
    console.log(`  Feedback: ${decision.feedback}`);
  } else {
    console.log('✗ No decision returned (should have been denied)');
  }
  
  // Test 2: Attempt to modify .harness/config.yaml
  console.log('\nTest 2: Attempting to modify .harness/config.yaml');
  const event2 = {
    name: 'tool.before',
    payload: {
      toolName: 'edit',
      input: {
        file_path: '.harness/config.yaml',
        content: 'modified: true'
      }
    }
  };
  
  const context2 = buildSemanticContext(event2, process.cwd());
  const decisions2 = await engine.evaluate(context2);
  
  if (decisions2.length > 0) {
    const decision = decisions2[0];
    console.log(`✓ Decision: ${decision.action}`);
    console.log(`  Reason: ${decision.reason}`);
  } else {
    console.log('✗ No decision returned (should have been denied)');
  }
  
  // Test 3: Attempt to modify CLAUDE.md
  console.log('\nTest 3: Attempting to modify CLAUDE.md');
  const event3 = {
    name: 'tool.before',
    payload: {
      toolName: 'write',
      input: {
        file_path: 'CLAUDE.md',
        content: '# Modified CLAUDE instructions'
      }
    }
  };
  
  const context3 = buildSemanticContext(event3, process.cwd());
  const decisions3 = await engine.evaluate(context3);
  
  if (decisions3.length > 0) {
    const decision = decisions3[0];
    console.log(`✓ Decision: ${decision.action}`);
    console.log(`  Reason: ${decision.reason}`);
  } else {
    console.log('✗ No decision returned (should have been denied)');
  }
  
  // Test 4: Normal file modification (should be allowed)
  console.log('\nTest 4: Attempting to modify normal file (src/index.js)');
  const event4 = {
    name: 'tool.before',
    payload: {
      toolName: 'write',
      input: {
        file_path: 'src/index.js',
        content: 'console.log("hello");'
      }
    }
  };
  
  const context4 = buildSemanticContext(event4, process.cwd());
  const decisions4 = await engine.evaluate(context4);
  
  const hasDeny = decisions4.some(d => d.action === 'deny');
  if (!hasDeny) {
    console.log('✓ Normal file modification allowed');
  } else {
    console.log('✗ Normal file was denied (should be allowed)');
  }
  
  console.log('\n=== Test Complete ===');
}

testRedlineProtection().catch(console.error);
