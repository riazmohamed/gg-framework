# GitHub Repository Research Command

Search and curate GitHub repositories based on user requirements.

## Usage
```
/github-research <requirement>
```

## Examples
```
/github-research voice AI agent for booking flights
/github-research open source CRM with AI features
/github-research LinkedIn automation safe scraping
```

## Instructions

When this command is invoked, perform comprehensive GitHub research:

### 1. Parse the Requirement
- Extract key technologies mentioned
- Identify the problem domain (e.g., "travel booking", "SEO", "automation")
- Note any constraints (e.g., "open source", "self-hosted", "Python")

### 2. Search Strategy (Run in Parallel)

Execute these searches simultaneously:

**A. Web Search Queries**
- `"<requirement>" GitHub open source`
- `"<requirement>" site:github.com`
- `<domain> tools GitHub 2024 2025`
- `<requirement> alternative open source`

**B. GitHub CLI Searches** (if authenticated)
```bash
gh search repos "<keywords>" --limit 20 --sort stars
gh search repos "<keywords>" --limit 20 --sort updated
```

**C. GitHub Topics**
- Search relevant GitHub topics pages
- Example: `https://github.com/topics/<keyword>`

**D. Awesome Lists**
- Search for `awesome-<domain>` repositories
- These are curated lists maintained by the community

### 3. For Each Promising Repository, Extract:

| Field | How to Get |
|-------|------------|
| Name & URL | From search results |
| Stars | `gh api repos/{owner}/{repo} --jq '.stargazers_count'` |
| Last Updated | Check recent commits |
| Description | README summary |
| Tech Stack | Languages, frameworks |
| License | MIT, Apache, GPL, etc. |
| Active? | Commits in last 6 months |
| Documentation | README quality, docs site |

### 4. Categorize Results

Group repositories by:
- **Production Ready** - Well-maintained, good docs, active community
- **Promising** - Good concept, may need work
- **Reference/Learning** - Useful for ideas, not production use
- **Awesome Lists** - Curated collections to explore further

### 5. Check User's Existing Repos

Search user's starred repos and forks for related projects:
```bash
gh api user/starred --paginate | jq -r '.[] | select(.description | test("<keyword>"; "i")) | "\(.full_name) - \(.description)"'
```

### 6. Output Format

Create a markdown file at: `<current_directory>/<topic>-github-research.md`

Structure:
```markdown
# GitHub Research: <Requirement>

## Summary
<2-3 sentence overview of findings>

## Your Existing Related Projects
<Any forks/stars user already has>

## Top Recommendations

### 1. [repo-name](url) ⭐ <stars>
- **What it does**: <description>
- **Tech Stack**: <languages/frameworks>
- **Why it's good**: <key strengths>
- **Considerations**: <any limitations>
- **Last Updated**: <date>

### 2. ...

## Categorized Results

### Production Ready
| Repository | Stars | Tech | Description |
|------------|-------|------|-------------|
| ... | ... | ... | ... |

### Promising Projects
...

### Awesome Lists & Resources
...

## Related GitHub Topics
- [topic-1](https://github.com/topics/topic-1)
- [topic-2](https://github.com/topics/topic-2)

## Search Queries Used
<List the searches performed for reproducibility>

---
*Research compiled: <date>*
```

### 7. Interactive Follow-up

After presenting results, offer:
- "Want me to dive deeper into any of these repos?"
- "Should I compare the top 2-3 options?"
- "Want me to check if any have MCP integrations?"

## Tips for Better Results

1. **Be specific** - "Python voice agent with Twilio" > "voice agent"
2. **Mention constraints** - "self-hosted", "no API keys needed", "MIT license"
3. **Include domain** - "for e-commerce", "for SaaS", "for agencies"

## Tools Used

- `WebSearch` - Broad internet search
- `WebFetch` - Fetch GitHub README details
- `Bash` with `gh` CLI - GitHub API queries
- `Glob/Grep` - Check local codebase for related code
