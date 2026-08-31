/**
 * Reflection Prompt Templates
 * 
 * Zero-cost, zero-latency alternative to prompt_hook.
 * Uses agent's own reasoning capability instead of external LLM calls.
 * 
 * How it works:
 * 1. Semantic rule matches (fast pattern matching)
 * 2. Hook returns [REFLECTION_REQUIRED] feedback
 * 3. Agent sees the feedback and performs self-analysis
 * 4. Agent decides whether to proceed or modify its action
 * 
 * Benefits:
 * - No API key required
 * - No additional cost
 * - No additional latency
 * - Leverages agent's own reasoning
 */

export const REFLECTION_SECURITY_YAML = `# Reflection Hook: Security Self-Analysis
# Zero-cost alternative to prompt_hook.
# Agent reflects on potential risks using its own reasoning.

name: reflection-security
description: Agent self-analysis for security risks

rules:
  - name: reflect-on-logging-headers
    description: Prompt agent to reflect on logging sensitive headers
    match:
      content: ["logger.info", "console.log", "print"]
      file_type: ["ts", "js", "py"]
    action: warn
    feedback: "Logging statement detected. Please verify no sensitive data is exposed."
    
    # Reflection prompt - agent will see this and self-analyze
    reflection_prompt: |
      You are about to log data. Please reflect:
      1. Does this log statement expose any authentication tokens (Authorization headers, API keys)?
      2. Does it log user credentials (passwords, session IDs)?
      3. Does it expose sensitive personal data (PII, credit cards)?
      4. Does it reveal internal URLs or database connection strings?
      
      If any of these are true, consider sanitizing the data before logging.

  - name: reflect-on-file-operations
    description: Prompt agent to reflect on dangerous file operations
    match:
      tool_name: ["Bash", "terminal"]
      content: ["rm", "del", "rmdir", "shutil.rmtree", "os.remove"]
    action: warn
    feedback: "File deletion operation detected. Please verify the target is safe."
    
    reflection_prompt: |
      You are about to delete files or directories. Please reflect:
      1. Are you deleting system directories (/, /etc, /usr, C:\\Windows)?
      2. Are you deleting user data directories without confirmation?
      3. Could this operation be reversed if something goes wrong?
      4. Is there a safer alternative (e.g., move to trash instead of delete)?
      
      If this is a dangerous operation, consider adding safeguards or using a safer alternative.

  - name: reflect-on-network-requests
    description: Prompt agent to reflect on network operations
    match:
      content: ["fetch", "axios", "http.request", "requests.get", "requests.post"]
      file_type: ["ts", "js", "py", "go"]
    action: warn
    feedback: "Network request detected. Please verify the endpoint is safe."
    
    reflection_prompt: |
      You are making a network request. Please reflect:
      1. Is the endpoint trusted and expected?
      2. Are you sending sensitive data (tokens, credentials) over HTTP (not HTTPS)?
      3. Could this request expose internal services or data?
      4. Is the request properly authenticated and authorized?
      
      If any concerns arise, consider reviewing the endpoint and data being sent.
`;

export const REFLECTION_QUALITY_YAML = `# Reflection Hook: Code Quality Self-Analysis
# Zero-cost alternative to prompt_hook.

name: reflection-quality
description: Agent self-analysis for code quality

rules:
  - name: reflect-on-api-changes
    description: Prompt agent to reflect on API modifications
    match:
      tool_name: ["Write", "Edit"]
      file_path: ["**/api/**", "**/routes/**", "**/controllers/**"]
      file_type: ["ts", "js", "py", "go"]
    action: warn
    feedback: "API file modification detected. Please verify backward compatibility."
    
    reflection_prompt: |
      You are modifying an API endpoint. Please reflect:
      1. Are you changing response field names (e.g., {data: []} → {items: []})?
      2. Are you removing required fields from the response?
      3. Are you changing data types (string → number, object → array)?
      4. Could this break existing clients that depend on the current format?
      
      If this is a breaking change, consider:
      - Maintaining backward compatibility
      - Adding a new version (v2) instead of modifying v1
      - Documenting the change in CHANGELOG.md

  - name: reflect-on-error-handling
    description: Prompt agent to reflect on error handling
    match:
      tool_name: ["Write", "Edit"]
      content: ["try", "catch", "throw", "raise"]
      file_type: ["ts", "js", "py", "go"]
    action: warn
    feedback: "Error handling code detected. Please verify it's comprehensive."
    
    reflection_prompt: |
      You are writing error handling code. Please reflect:
      1. Are you catching specific error types, or using a generic catch-all?
      2. Are you logging the error with sufficient context for debugging?
      3. Are you providing meaningful error messages to the user?
      4. Could this error be recovered from, or should it fail fast?
      5. Are you exposing sensitive information in error messages?
      
      Consider improving error handling if any concerns arise.

  - name: reflect-on-concurrency
    description: Prompt agent to reflect on concurrent operations
    match:
      content: ["async", "await", "Promise.all", "threading", "goroutine"]
      file_type: ["ts", "js", "py", "go"]
    action: warn
    feedback: "Concurrent operation detected. Please verify thread safety."
    
    reflection_prompt: |
      You are writing concurrent code. Please reflect:
      1. Are you accessing shared state without proper synchronization?
      2. Could this cause race conditions or data corruption?
      3. Are you handling errors in all concurrent branches?
      4. Could this lead to resource exhaustion (too many connections, threads)?
      5. Is the order of operations guaranteed, or could it vary?
      
      Consider adding locks, using thread-safe data structures, or simplifying the logic.
`;

export const REFLECTION_EXAMPLE_YAML = `# Example: How to write a custom reflection rule
# 
# This demonstrates the structure and best practices.

name: custom-reflection-rules
description: Custom reflection rules for your project

rules:
  - name: my-custom-reflection
    description: Example custom reflection rule
    match:
      tool_name: ["Write"]
      file_type: ["ts"]
    action: warn
    feedback: "Custom check triggered. Please reflect on this action."
    
    # Reflection prompt - guide the agent's self-analysis
    reflection_prompt: |
      You are about to perform an action. Please reflect:
      1. [Specific question 1 related to your project]
      2. [Specific question 2 related to your project]
      3. [Specific question 3 related to your project]
      
      If any concerns arise, consider [suggested alternative].
      
      # Best practices for reflection prompts:
      # - Be specific and actionable
      # - Ask 3-5 focused questions
      # - Provide clear guidance on what to check
      # - Suggest alternatives when risks are identified
      # - Keep it concise (agent has limited attention)
`;