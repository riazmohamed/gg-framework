# Compare GitHub Repositories

Deep comparison of 2-4 GitHub repositories to help choose the best option.

## Usage
```
/gh-compare <repo1> <repo2> [repo3] [repo4]
```

## Examples
```
/gh-compare langchain-ai/langchain llama-index/llama_index
/gh-compare towfiqi/serpbear serphacker/serposcope
/gh-compare crewAIInc/crewAI microsoft/autogen openai/swarm
```

## Instructions

### 1. Fetch Repository Data

For each repository, gather:

```bash
# Basic info
gh api repos/{owner}/{repo} --jq '{
  name: .full_name,
  stars: .stargazers_count,
  forks: .forks_count,
  issues: .open_issues_count,
  license: .license.spdx_id,
  language: .language,
  created: .created_at,
  updated: .pushed_at,
  description: .description
}'

# Recent activity
gh api repos/{owner}/{repo}/commits --jq '.[0:5] | .[] | {date: .commit.author.date, message: .commit.message}'

# Contributors count
gh api repos/{owner}/{repo}/contributors --jq 'length'

# Release info
gh api repos/{owner}/{repo}/releases/latest --jq '{tag: .tag_name, date: .published_at}' 2>/dev/null
```

### 2. Analyze README

Fetch and analyze each README for:
- Installation complexity
- Documentation quality
- Feature list
- Requirements/dependencies
- Examples provided

### 3. Check Community Health

- Issue response time (sample recent issues)
- PR merge frequency
- Discord/Slack community?
- Sponsorship/funding?

### 4. Output Comparison Table

```markdown
# Comparison: <repo1> vs <repo2> vs ...

## Quick Stats

| Metric | repo1 | repo2 | repo3 |
|--------|-------|-------|-------|
| ⭐ Stars | 10.2k | 5.4k | 2.1k |
| 🍴 Forks | 1.2k | 890 | 340 |
| 📅 Last Commit | 2 days | 1 week | 3 months |
| 🐛 Open Issues | 234 | 89 | 12 |
| 👥 Contributors | 156 | 45 | 8 |
| 📜 License | MIT | Apache-2.0 | GPL-3.0 |
| 🗓️ Created | 2022 | 2023 | 2024 |

## Feature Comparison

| Feature | repo1 | repo2 | repo3 |
|---------|-------|-------|-------|
| Feature A | ✅ | ✅ | ❌ |
| Feature B | ✅ | ❌ | ✅ |
| Feature C | ⚠️ Partial | ✅ | ✅ |

## Pros & Cons

### repo1
**Pros:**
-
-

**Cons:**
-
-

### repo2
...

## Recommendation

**Best for <use case>**: repo1
**Best for <other use case>**: repo2

## Decision Matrix

| If you need... | Choose |
|----------------|--------|
| Most stable/mature | repo1 |
| Latest features | repo2 |
| Simplest setup | repo3 |
```

### 5. Save to File

Save comparison to: `<current_directory>/github-compare-<repo1>-vs-<repo2>.md`
