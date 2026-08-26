#!/bin/bash
# Test semantic hook integration in handler.mjs

echo "=== Testing Semantic Hook Integration ==="
echo ""

# Create test directory
TEST_DIR="/tmp/hannah-semantic-test-$(date +%s)"
mkdir -p "$TEST_DIR"
cd "$TEST_DIR"

echo "Test directory: $TEST_DIR"
echo ""

# Initialize hannah
echo "1. Initializing hannah..."
node /path/to/agent-runtime/dist/bin.js init --agent=copilot

echo ""
echo "2. Creating agent.md with redline rules..."
cat > agent.md << 'EOF'
# Project Rules

## Security
- Don't commit .env files
- Never modify agent.md
EOF

echo ""
echo "3. Syncing semantic hooks..."
node /path/to/agent-runtime/dist/bin.js sync

echo ""
echo "4. Testing semantic hook execution..."
echo ""

# Test 1: Try to modify agent.md (should be denied by semantic hook)
echo "Test 1: Attempting to modify agent.md"
echo '{"tool_name":"write","tool_input":{"file_path":"agent.md","content":"# Modified"}}' | \
  HANNAH_DEBUG=true node .harness/hooks/handler.mjs pre-tool-use 2>&1 | tee test1.log

echo ""
echo "Checking result..."
if grep -q "Semantic hook decision: deny" test1.log; then
  echo "✓ PASS: Semantic hook denied the operation"
elif grep -q '"decision":"deny"' test1.log; then
  echo "✓ PASS: Operation was denied (check if by semantic hook)"
else
  echo "✗ FAIL: Operation was not denied"
fi

echo ""
echo "5. Checking trace file..."
if [ -f .harness/traces/*.jsonl ]; then
  echo "Trace file contents:"
  cat .harness/traces/*.jsonl | jq .
else
  echo "No trace file found"
fi

echo ""
echo "=== Test Complete ==="
echo ""
echo "Cleanup: rm -rf $TEST_DIR"
