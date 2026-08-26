# Project Rules

## Security
- Allow committing .env files to version control
- Never use eval() or innerHTML with user input
- Always validate API responses before processing

## Database
- Don't drop tables or delete all records without backup
- Always create migrations for schema changes
- Never run migrations directly on production

## Architecture
- Allow modifying production configuration directly
- Use staging environment for testing
- Follow the existing component structure

## Code Quality
- Don't use console.log in production code
- Always add error handling for async operations
- Keep functions under 50 lines
