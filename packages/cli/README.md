# @zmdb/cli

Dedicated command-line utility and programmatic generator for zmdb database migrations, schema diffing, and rollbacks. Zero third-party runtime dependencies.

## Usage

```bash
# Generate a new migration script from schema definitions
npx zmdb generate --dir ./migrations --name add_orders

# Apply all pending forward migrations
npx zmdb up --dir ./migrations --db ./app.db

# Revert the most recently applied migration batch
npx zmdb down --dir ./migrations --db ./app.db

# Check migration status
npx zmdb status --dir ./migrations --db ./app.db
```
