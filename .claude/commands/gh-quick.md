# Quick GitHub Search

Fast GitHub repository search - returns top results without deep analysis.

## Usage
```
/gh-quick <search terms>
```

## Examples
```
/gh-quick nextjs dashboard template
/gh-quick rust cli framework
/gh-quick mcp server examples
```

## Instructions

Perform a fast GitHub search and return results immediately:

### 1. Run Parallel Searches

```bash
# By stars (most popular)
gh search repos "<query>" --limit 10 --sort stars --json fullName,description,stargazersCount,updatedAt,language

# By recently updated (most active)
gh search repos "<query>" --limit 10 --sort updated --json fullName,description,stargazersCount,updatedAt,language
```

### 2. Quick Web Search
Run one web search: `"<query>" GitHub open source 2024`

### 3. Output Format (Direct to Chat)

Display results as a simple table:

```
## GitHub: <query>

### By Stars
| Repository | ⭐ | Language | Description |
|------------|-----|----------|-------------|
| [owner/repo](url) | 1.2k | Python | Short desc... |

### Recently Updated
| Repository | ⭐ | Updated | Description |
|------------|-----|---------|-------------|
| [owner/repo](url) | 234 | 2 days ago | Short desc... |

### From Web Search
- [repo-name](url) - description
```

### 4. No File Output
This is a quick search - output directly to chat, don't create files.

Keep response concise - max 20 repos total.
