# GitHub Trending & Discovery

Discover trending repositories and hidden gems in a specific domain.

## Usage
```
/gh-trending <topic/domain> [language]
```

## Examples
```
/gh-trending AI agents
/gh-trending web scraping python
/gh-trending cli tools rust
/gh-trending mcp servers
```

## Instructions

### 1. Search Trending Repositories

**Web Search for Trending:**
```
"<topic>" GitHub trending 2024 2025
"<topic>" GitHub "stars" "new" repository
awesome "<topic>" GitHub curated list
```

**GitHub Search - Recently Created with Stars:**
```bash
# Created in last 6 months with good traction
gh search repos "<topic>" --created=">$(date -v-6m +%Y-%m-%d)" --sort stars --limit 15

# High recent activity
gh search repos "<topic>" --sort updated --limit 15
```

### 2. Find Awesome Lists

Search for curated lists:
```bash
gh search repos "awesome <topic>" --sort stars --limit 5
```

### 3. Check GitHub Topics

Fetch from GitHub topics page:
- `https://github.com/topics/<topic>`

### 4. Identify Rising Stars

Look for repos with:
- Created < 1 year ago
- Stars > 100
- Recent commits (< 1 month)
- Growing contributor base

### 5. Output Format

```markdown
# Trending: <topic>

## 🔥 Hot Right Now (Created < 6 months, gaining traction)

| Repository | ⭐ | Created | Description |
|------------|-----|---------|-------------|
| [repo](url) | 2.3k | 3 mo ago | ... |

## 📈 Rising Stars (< 1 year, strong growth)

| Repository | ⭐ | Growth | Description |
|------------|-----|--------|-------------|
| [repo](url) | 5.1k | +2k/3mo | ... |

## 🏆 Established Leaders

| Repository | ⭐ | Description |
|------------|-----|-------------|
| [repo](url) | 45k | ... |

## 📚 Awesome Lists & Resources

- [awesome-<topic>](url) - Curated list of...
- [<topic>-resources](url) - Collection of...

## 🏷️ Related Topics to Explore

- [topic-1](https://github.com/topics/topic-1) - X repos
- [topic-2](https://github.com/topics/topic-2) - Y repos

## 💡 Hidden Gems (< 500 stars but promising)

| Repository | ⭐ | Why it's interesting |
|------------|-----|---------------------|
| [repo](url) | 234 | Unique approach to... |
```

Output directly to chat (no file) unless user requests save.
